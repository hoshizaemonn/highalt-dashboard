// シンエナジー「電気料金明細表」（請求明細書Excel）の厳格パーサ。
//
// 既存の parseSinenergyElectricity（fee-electricity-parse.ts）は、店舗を表示名・住所の文字列で判定し、
// 判定できない行を黙って捨てる。自動取込では金額が静かに少なくなるのを避けるため、こちらを使う:
//   - 店舗は「供給地点特定番号」（またはご使用場所番号 J…）の対応表で判定する（名義は店舗名でないため）
//   - 未登録の番号が1行でもあれば、そのファイルは取り込まない（エラー）
//   - 明細の合計が「合 計」行と一致しなければ取り込まない
//   - 計上月は「請求書のN月分」の翌月＝口座引落月（既存データと照合済み: 5月分→6月に登録されている）
//   - 請求書番号（末尾6桁=YYYYMM=N月分）を取り込みのキーにする（ファイル名に依存しない）
//
// 依存を持たない純粋関数（node --experimental-strip-types で単体テスト可能）。

/** 供給地点特定番号 / ご使用場所番号 → 店舗。契約は6使用場所のみ（星崎さん確認 2026-10）。 */
export const SINENERGY_SUPPLY_POINTS: Array<{ supplyPoint: string; placeNo: string; store: string; label: string }> = [
  { supplyPoint: "0300111000800909064446", placeNo: "J0245248", store: "春日", label: "電灯" },
  { supplyPoint: "0300111001227628301011", placeNo: "J0259642", store: "祖師ヶ谷大蔵", label: "電灯" },
  { supplyPoint: "0300112001227628301013", placeNo: "J0259643", store: "祖師ヶ谷大蔵", label: "動力" },
  { supplyPoint: "0300111050204816061894", placeNo: "J0245238", store: "船橋", label: "電灯" },
  { supplyPoint: "0300112050204816069004", placeNo: "J0245237", store: "船橋", label: "動力" },
  { supplyPoint: "0300112000800910034876", placeNo: "J0245239", store: "巣鴨", label: "動力" },
];

export interface InvoiceLine {
  supplyPoint: string;
  placeNo: string;
  amount: number;
  store: string | null;
}

export interface ParsedInvoice {
  /** 請求書番号（例 218607900123202605） */
  invoiceNo: string;
  /** 請求書の「N月分」 */
  usageYear: number;
  usageMonth: number;
  /** 口座引落月＝ダッシュボードの計上月 */
  bookingYear: number;
  bookingMonth: number;
  lines: InvoiceLine[];
  /** 明細の合計（店舗判定の成否に関係なく全行） */
  linesTotal: number;
  /** 「合 計」行の金額 */
  declaredTotal: number;
  /** 店舗別の合算（未登録行を含まない。errors が空のときのみ使う） */
  byStore: Array<{ store: string; amount: number }>;
  /** 取り込んではいけない理由（空なら取り込み可） */
  errors: string[];
}

const norm = (v: unknown) => String(v ?? "").replace(/\s/g, "");

function toNumber(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,¥￥円\s]/g, "");
  if (s === "") return NaN;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-") || s.startsWith("△");
  const n = Number(s.replace(/[()\-△]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

function findCol(header: unknown[], candidates: string[]): number {
  const h = header.map(norm);
  for (const c of candidates) {
    const i = h.findIndex((x) => x === norm(c));
    if (i >= 0) return i;
  }
  for (const c of candidates) {
    const i = h.findIndex((x) => x.includes(norm(c)));
    if (i >= 0) return i;
  }
  return -1;
}

/** 全角数字などを半角へ（請求書の表記ゆれ対策） */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 明細表（Excelを2次元配列にしたもの）を解析する。
 * 例外は投げず、取り込めない理由を errors に積む（呼び出し側が全部まとめて警告できるように）。
 */
export function parseSinenergyInvoice(rows: unknown[][]): ParsedInvoice {
  const errors: string[] = [];
  const text = rows.map((r) => (r ?? []).map((c) => String(c ?? "")).join(" "));
  const all = toHalfWidth(text.join("\n"));

  // 請求書番号
  const noMatch = all.match(/請求書番号[：:]\s*(\d{8,})/);
  const invoiceNo = noMatch ? noMatch[1] : "";
  if (!invoiceNo) errors.push("請求書番号が見つかりません");

  // タイトル: 「2026年08月分 2026年09月23日 口座引落し分」
  const tm = all.match(/(\d{4})年\s*(\d{1,2})月分\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*口座引落/);
  let usageYear = 0, usageMonth = 0, bookingYear = 0, bookingMonth = 0;
  if (!tm) {
    errors.push("明細表のタイトル（○年○月分 ○年○月○日 口座引落し分）から月を判定できません");
  } else {
    usageYear = Number(tm[1]);
    usageMonth = Number(tm[2]);
    bookingYear = Number(tm[3]);
    bookingMonth = Number(tm[4]);
    // 月判定の整合性: 引落月 = N月分の翌月（年またぎあり）
    const expected = usageYear * 12 + usageMonth + 1;
    if (bookingYear * 12 + bookingMonth !== expected) {
      errors.push(
        `月の判定が一致しません（${usageYear}年${usageMonth}月分 → 引落 ${bookingYear}年${bookingMonth}月。翌月引落のはず）`,
      );
    }
    if (usageMonth < 1 || usageMonth > 12 || bookingMonth < 1 || bookingMonth > 12) {
      errors.push("月の値が不正です");
    }
    // 請求書番号の末尾6桁 = YYYYMM（N月分）
    if (invoiceNo && invoiceNo.slice(-6) !== `${usageYear}${String(usageMonth).padStart(2, "0")}`) {
      errors.push(`請求書番号の末尾（${invoiceNo.slice(-6)}）と「${usageYear}年${usageMonth}月分」が一致しません`);
    }
  }

  // ヘッダー行（№）
  const headerIdx = rows.findIndex((r) => (r ?? []).some((c) => ["№", "No", "NO"].includes(norm(c))));
  if (headerIdx < 0) {
    errors.push("明細のヘッダー行（№）が見つかりません");
    return { invoiceNo, usageYear, usageMonth, bookingYear, bookingMonth, lines: [], linesTotal: 0, declaredTotal: NaN, byStore: [], errors };
  }
  const header = rows[headerIdx] ?? [];
  const supCol = findCol(header, ["供給地点特定番号"]);
  const placeCol = findCol(header, ["ご使用場所番号", "使用場所番号"]);
  const amtCol = findCol(header, ["請求金額合計（円）", "請求金額合計", "請求金額"]);
  if (supCol < 0 && placeCol < 0) errors.push("供給地点特定番号／ご使用場所番号の列が見つかりません");
  if (amtCol < 0) errors.push("請求金額合計の列が見つかりません");
  if ((supCol < 0 && placeCol < 0) || amtCol < 0) {
    return { invoiceNo, usageYear, usageMonth, bookingYear, bookingMonth, lines: [], linesTotal: 0, declaredTotal: NaN, byStore: [], errors };
  }

  const lines: InvoiceLine[] = [];
  let declaredTotal = NaN;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const isTotalRow = r.some((c) => norm(c) === "合計");
    if (isTotalRow) {
      declaredTotal = toNumber(r[amtCol]);
      break;
    }
    // 明細行は先頭列（№）が数字の行だけ。ヘッダーの結合セルは ExcelJS だと各行に同じ文字（№など）が
    // 繰り返されて見えるため、数字でない行（結合ヘッダー・注記・空行）は読み飛ばす。
    if (!/^\d+$/.test(toHalfWidth(norm(r[0])))) continue;
    const supplyPoint = norm(supCol >= 0 ? r[supCol] : "");
    const placeNo = norm(placeCol >= 0 ? r[placeCol] : "");
    const amount = toNumber(r[amtCol]);
    if (!Number.isFinite(amount)) {
      errors.push(`№${norm(r[0])} の請求金額を読み取れません`);
      continue;
    }
    const hit =
      SINENERGY_SUPPLY_POINTS.find((p) => supplyPoint && p.supplyPoint === supplyPoint) ??
      SINENERGY_SUPPLY_POINTS.find((p) => placeNo && p.placeNo === placeNo);
    lines.push({ supplyPoint, placeNo, amount, store: hit ? hit.store : null });
    // 供給地点番号とご使用場所番号が別々の店舗を指していないか（取り違え検知）
    const bySup = SINENERGY_SUPPLY_POINTS.find((p) => supplyPoint && p.supplyPoint === supplyPoint);
    const byPlace = SINENERGY_SUPPLY_POINTS.find((p) => placeNo && p.placeNo === placeNo);
    if (bySup && byPlace && bySup.store !== byPlace.store) {
      errors.push(`№${norm(r[0])}: 供給地点特定番号とご使用場所番号が別の店舗を指しています`);
    }
  }

  if (lines.length === 0) errors.push("明細行が0件です");
  const unmapped = lines.filter((l) => !l.store);
  if (unmapped.length > 0) {
    errors.push(
      `対応表にない使用場所があります（${unmapped
        .map((l) => `${l.placeNo || "-"}／${l.supplyPoint || "-"}／${l.amount}円`)
        .join("、")}）。対応表への追加が必要です`,
    );
  }

  const linesTotal = lines.reduce((s, l) => s + l.amount, 0);
  if (!Number.isFinite(declaredTotal)) {
    errors.push("「合 計」行が見つかりません");
  } else if (declaredTotal !== linesTotal) {
    errors.push(`明細の合計（${linesTotal}円）が合計行（${declaredTotal}円）と一致しません`);
  }

  const map = new Map<string, number>();
  for (const l of lines) if (l.store) map.set(l.store, (map.get(l.store) ?? 0) + l.amount);
  const byStore = [...map.entries()].map(([store, amount]) => ({ store, amount: Math.round(amount) }));

  return { invoiceNo, usageYear, usageMonth, bookingYear, bookingMonth, lines, linesTotal, declaredTotal, byStore, errors };
}

/** 前月比が極端（3倍超または1/3未満）か。前月が無い・0なら判定しない */
export function isExtremeChange(current: number, previous: number | null | undefined): boolean {
  if (!previous || previous <= 0) return false;
  const ratio = current / previous;
  return ratio > 3 || ratio < 1 / 3;
}

export type ImportAction = "create" | "update" | "unchanged" | "skip-existing" | "held";

export interface ExistingRow {
  amount: number;
  note: string | null;
}

export interface PlanItem {
  store: string;
  amount: number;
  action: ImportAction;
  /** 既存行がある場合の合計額 */
  existingAmount: number | null;
  reason: string | null;
}

/** 請求書番号つきの note（同じ請求書の再取込を上書きにするキー） */
export function invoiceNote(invoiceNo: string): string {
  return `シンエナジー 請求書番号 ${invoiceNo}`;
}

/**
 * 店舗ごとの取込計画。ファイル全体の errors が空のときだけ呼ぶ。
 *  - 同じ請求書番号の行が既にあり、金額も同じ → unchanged（何も書かない。日次実行で毎日書き込みが走らないように）
 *  - 同じ請求書番号の行が既にあり、金額が違う → update（上書き。二重計上しない）
 *  - 別の note の既存行（手入力・過去の手動取込）がある → skip-existing（加算も上書きもしない。金額の差は reason に出す）
 *  - 前月比が極端 → held（取り込まず警告）
 *  - それ以外 → create
 * @param existing 同じ計上月・同じ店舗の「電気料」既存行
 * @param previousAmount 前月の同店舗の電気料合計
 */
export function planStoreImport(args: {
  store: string;
  amount: number;
  invoiceNo: string;
  existing: ExistingRow[];
  previousAmount: number | null;
}): PlanItem {
  const { store, amount, invoiceNo, existing, previousAmount } = args;
  const note = invoiceNote(invoiceNo);
  const existingAmount = existing.length > 0 ? existing.reduce((s, r) => s + r.amount, 0) : null;
  const same = existing.find((r) => r.note === note);
  const others = existing.filter((r) => r.note !== note);
  if (others.length > 0) {
    const sum = others.reduce((s, r) => s + r.amount, 0);
    return {
      store, amount, action: "skip-existing", existingAmount,
      reason: sum === amount
        ? "既存の登録あり（金額は請求書と一致）。重複を避けるためスキップ"
        : `既存の登録あり（登録額${sum}円／請求書${amount}円で不一致）。重複を避けるためスキップ。要確認`,
    };
  }
  if (same) {
    return same.amount === amount
      ? { store, amount, action: "unchanged", existingAmount, reason: null }
      : { store, amount, action: "update", existingAmount, reason: `請求書番号が同じで金額が違うため上書き（${same.amount}円→${amount}円）` };
  }
  if (isExtremeChange(amount, previousAmount)) {
    return {
      store, amount, action: "held", existingAmount,
      reason: `前月比が極端です（前月${previousAmount}円→${amount}円）。取り込まず保留`,
    };
  }
  return { store, amount, action: "create", existingAmount, reason: null };
}
