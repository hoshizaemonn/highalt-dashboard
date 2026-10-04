// Amazon Business 注文履歴CSVの解析・行キー・取込計画・差し替え。
//
// 背景（2026-10 発覚）: amazon_orders の一意キーが（注文番号, 商品名）だったため、同じ注文に同じ商品が
// 複数行ある場合（例: 同じ商品を7個→7行・各7,378円）に1行へ潰れていた。2026年3月分で DB 264,096円 に対し
// CSV 308,364円（差 44,268円）。取込は上書き方式のため、再取込でも直らなかった。
//
// 新しい行キー: 注文番号 + ASIN + 配送業者の問い合わせ番号 + 同一グループ内の連番（line_seq）。
// 取込は「ファイルに含まれる注文番号ごとに、その注文の既存行をすべて削除して、新しい行を入れ直す」方式
// （旧キーで潰れていた行も、再取込で正しく入る。旧キーの行と新キーの行が二重にならない。他の注文には触れない）。
//
// 依存を持たない純粋関数（CSVヘルパーは引数で受け取る）。node --experimental-strip-types で単体テスト可能。

export const AMAZON_ACCOUNT_USER_MAP: Record<string, string> = {
  "東日本橋スタジオ": "東日本橋",
  "春日スタジオ": "春日",
  "船橋スタジオ": "船橋",
  "巣鴨スタジオ": "巣鴨",
  "ハイアルチ祖師ヶ谷大蔵スタジオ": "祖師ヶ谷大蔵",
  "下北沢スタジオ": "下北沢",
  "中目黒スタジオ": "中目黒",
  "東陽町スタジオ": "東陽町",
  "High Altitude Management株式会社": "本部",
};

/** アカウントユーザー（店舗名義のAmazonユーザー）から店舗を判定する。 */
export function detectStoreFromAccountUser(accountUser: string): string | null {
  if (!accountUser) return null;
  const trimmed = accountUser.trim();
  if (AMAZON_ACCOUNT_USER_MAP[trimmed]) return AMAZON_ACCOUNT_USER_MAP[trimmed];
  for (const [key, value] of Object.entries(AMAZON_ACCOUNT_USER_MAP)) {
    if (trimmed.includes(key) || key.includes(trimmed)) return value;
  }
  return null;
}

/** 配送先住所のキーワードから店舗を判定する。 */
export function detectStoreFromAddress(address: string): string | null {
  if (!address) return null;
  const storeKeywords: Record<string, string> = {
    "東日本橋": "東日本橋", "春日": "春日", "船橋": "船橋", "巣鴨": "巣鴨",
    "祖師ヶ谷": "祖師ヶ谷大蔵", "下北沢": "下北沢", "中目黒": "中目黒", "東陽町": "東陽町",
  };
  for (const [keyword, store] of Object.entries(storeKeywords)) {
    if (address.includes(keyword)) return store;
  }
  return null;
}

export interface AmazonParsedRecord {
  orderDate: string;
  orderId: string;
  storeName: string;
  productName: string;
  shortName: string;
  asin: string;
  amazonCategory: string;
  expenseCategory: string;
  amount: number;
  orderTotal: number;
  quantity: number;
  taxAmount: number;
  taxRate: string;
  accountUser: string;
  deliveryAddress: string;
  paymentDate: string;
  invoiceNumber: string;
  /** 配送業者の問い合わせ番号（出荷前は空） */
  trackingNo: string;
  /** (注文番号, ASIN, 問い合わせ番号) が同じ行の中での連番（0始まり） */
  lineSeq: number;
}

export interface CsvHelpers {
  buildHeaderMap: (header: string[]) => Record<string, number>;
  safeInt: (v: string | undefined | null) => number;
}

/** 行を保存できるか（注文番号と商品名が無い行は、一覧には返すがDBには保存しない＝従来どおり） */
export const isStorable = (r: { orderId: string; productName: string }) => !!(r.orderId && r.productName);

/**
 * (注文番号, ASIN, 問い合わせ番号) ごとに連番を振る。グループ内は内容（金額・商品名・日付）で並べ替えてから
 * 振るので、CSVの行順が変わっても同じ結果になる。保存対象の行だけが対象。
 */
export function assignLineSeq<T extends AmazonParsedRecord>(records: T[]): void {
  const groups = new Map<string, T[]>();
  for (const r of records) {
    if (!isStorable(r)) { r.lineSeq = 0; continue; }
    const k = `${r.orderId}\u0000${r.asin}\u0000${r.trackingNo}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    g.sort((a, b) =>
      a.amount - b.amount ||
      a.productName.localeCompare(b.productName) ||
      a.orderDate.localeCompare(b.orderDate) ||
      a.paymentDate.localeCompare(b.paymentDate),
    );
    g.forEach((r, i) => { r.lineSeq = i; });
  }
}

/** Amazon Business 注文履歴CSV（ヘッダー付きの2次元配列）を解析する。列の読み方は従来から変更なし（問い合わせ番号のみ追加）。 */
export function parseAmazonOrderRows(
  allRows: string[][],
  masterByAsin: Map<string, { expenseCategory?: string | null }>,
  h: CsvHelpers,
): { records: AmazonParsedRecord[]; autoClassified: number } {
  const hmap = h.buildHeaderMap(allRows[0] ?? []);
  const getVal = (row: string[], col: string): string => {
    const idx = hmap[col];
    return idx !== undefined && idx < row.length ? row[idx].trim() : "";
  };
  const records: AmazonParsedRecord[] = [];
  let autoClassified = 0;

  for (const row of allRows.slice(1)) {
    if (row.length < 5) continue;
    const orderDate = getVal(row, "注文日");
    const orderId = getVal(row, "注文番号");
    const productName = getVal(row, "商品名");
    const asin = getVal(row, "ASIN") || getVal(row, "ASIN/ISBN");
    const amazonCategory = getVal(row, "商品カテゴリー") || getVal(row, "カテゴリー");
    const accountUser = getVal(row, "アカウントユーザー") || getVal(row, "注文者");
    const deliveryAddress = getVal(row, "配送先住所") || getVal(row, "届け先住所");
    const paymentDate = getVal(row, "支払い確定日") || getVal(row, "支払い日");
    const invoiceNumber = getVal(row, "適格請求書（または支払い明細書）番号") || getVal(row, "請求書番号");
    const trackingNo = getVal(row, "配送業者の問い合わせ番号");
    const quantity = h.safeInt(getVal(row, "商品の数量") || getVal(row, "数量")) || 1;
    const amount = h.safeInt(getVal(row, "商品および配送料の合計（税込）") || getVal(row, "商品小計"));
    const orderTotal = h.safeInt(getVal(row, "注文の合計（税込）") || getVal(row, "合計"));
    const taxAmount = h.safeInt(getVal(row, "商品の小計（消費税）") || getVal(row, "税額"));
    const taxRate = getVal(row, "商品の小計（税率）") || getVal(row, "税率");

    const storeName = detectStoreFromAccountUser(accountUser) || detectStoreFromAddress(deliveryAddress) || "";

    const cleaned = productName.replace(/\s*[\[【（(].*?[\]】）)]/g, "").trim();
    const shortName = cleaned.length > 30 ? cleaned.substring(0, 30) + "…" : cleaned;

    let expenseCategory = "";
    const master = masterByAsin.get(asin);
    if (master && master.expenseCategory) {
      expenseCategory = master.expenseCategory;
      autoClassified++;
    }

    records.push({
      orderDate, orderId, storeName, productName, shortName, asin, amazonCategory, expenseCategory,
      amount, orderTotal, quantity, taxAmount, taxRate, accountUser, deliveryAddress, paymentDate,
      invoiceNumber, trackingNo, lineSeq: 0,
    });
  }
  assignLineSeq(records);
  return { records, autoClassified };
}

export interface ExistingOrderSummary {
  orderId: string;
  lines: number;
  total: number;
}

export interface OrderPlan {
  orderId: string;
  newLines: number;
  newTotal: number;
  oldLines: number;
  oldTotal: number;
  status: "new" | "same" | "changed";
}

export interface ImportPlan {
  lines: number;
  orders: number;
  total: number;
  skippedNoOrderId: number;
  newOrders: number;
  changedOrders: number;
  sameOrders: number;
  existingLines: number;
  existingTotal: number;
  /** 取込後に、その注文の行数・金額がどう変わるか（ファイルに含まれる注文だけ） */
  delta: { lines: number; total: number };
  /** 既存より行が減る注文（部分的なエクスポートの疑い。要確認） */
  shrunkOrders: string[];
  perOrder: OrderPlan[];
}

/** 取込計画（書き込みなし）。existing は、ファイルに含まれる注文番号の既存行の集計。 */
export function planAmazonImport(records: AmazonParsedRecord[], existing: ExistingOrderSummary[]): ImportPlan {
  const storable = records.filter(isStorable);
  const byOrder = new Map<string, { lines: number; total: number }>();
  for (const r of storable) {
    const o = byOrder.get(r.orderId) ?? { lines: 0, total: 0 };
    o.lines += 1;
    o.total += r.amount;
    byOrder.set(r.orderId, o);
  }
  const ex = new Map(existing.map((e) => [e.orderId, e]));
  const perOrder: OrderPlan[] = [];
  for (const [orderId, n] of byOrder) {
    const old = ex.get(orderId);
    perOrder.push({
      orderId, newLines: n.lines, newTotal: n.total, oldLines: old?.lines ?? 0, oldTotal: old?.total ?? 0,
      status: !old ? "new" : old.lines === n.lines && old.total === n.total ? "same" : "changed",
    });
  }
  const inFile = [...byOrder.keys()];
  const existingInFile = existing.filter((e) => byOrder.has(e.orderId));
  const newTotal = storable.reduce((s, r) => s + r.amount, 0);
  const oldLines = existingInFile.reduce((s, e) => s + e.lines, 0);
  const oldTotal = existingInFile.reduce((s, e) => s + e.total, 0);
  return {
    lines: storable.length,
    orders: inFile.length,
    total: newTotal,
    skippedNoOrderId: records.length - storable.length,
    newOrders: perOrder.filter((p) => p.status === "new").length,
    changedOrders: perOrder.filter((p) => p.status === "changed").length,
    sameOrders: perOrder.filter((p) => p.status === "same").length,
    existingLines: oldLines,
    existingTotal: oldTotal,
    delta: { lines: storable.length - oldLines, total: newTotal - oldTotal },
    shrunkOrders: perOrder.filter((p) => p.oldLines > p.newLines).map((p) => p.orderId),
    perOrder,
  };
}

/** prisma の amazon_orders 作成データ */
export function toOrderCreateData(r: AmazonParsedRecord) {
  return {
    orderDate: r.orderDate || null,
    orderId: r.orderId,
    storeName: r.storeName || null,
    productName: r.productName,
    shortName: r.shortName || null,
    amount: r.amount || 0,
    orderTotal: r.orderTotal || 0,
    paymentDate: r.paymentDate || null,
    deliveryAddress: r.deliveryAddress || null,
    asin: r.asin || "",
    amazonCategory: r.amazonCategory || "",
    expenseCategory: r.expenseCategory || "",
    quantity: r.quantity || 1,
    taxAmount: r.taxAmount || 0,
    taxRate: r.taxRate || "",
    accountUser: r.accountUser || "",
    invoiceNumber: r.invoiceNumber || "",
    trackingNo: r.trackingNo || "",
    lineSeq: r.lineSeq || 0,
  };
}

/** トランザクション内で使う最小限の prisma インターフェース（テストで差し替え可能） */
export interface AmazonOrderTx {
  amazonOrder: {
    deleteMany(args: { where: { orderId: { in: string[] } } }): Promise<{ count: number }>;
    createMany(args: { data: ReturnType<typeof toOrderCreateData>[] }): Promise<{ count: number }>;
  };
}

/**
 * ファイルに含まれる注文番号ごとに、その注文の既存行をすべて削除してから、新しい行を入れ直す。
 * 他の注文番号の行には触れない。呼び出し側がトランザクション内で呼ぶこと。
 */
export async function applyAmazonImport(tx: AmazonOrderTx, records: AmazonParsedRecord[]) {
  const storable = records.filter(isStorable);
  const orderIds = [...new Set(storable.map((r) => r.orderId))];
  if (orderIds.length === 0) return { deleted: 0, created: 0, orders: 0 };
  const del = await tx.amazonOrder.deleteMany({ where: { orderId: { in: orderIds } } });
  const cre = await tx.amazonOrder.createMany({ data: storable.map(toOrderCreateData) });
  return { deleted: del.count, created: cre.count, orders: orderIds.length };
}
