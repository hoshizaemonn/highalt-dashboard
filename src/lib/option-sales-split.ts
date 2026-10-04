// オプション売上の店舗按分（付け替え）
//
// 対象: hacomono 商品コード I0345（HYROXオプション 月額費）/ I0346（HYROXオプション（月4回） 初月額費）
// 方式: 所属店舗の売上から ratioPercent % を按分先店舗（targetStore）へ付け替える。総額は変えない。
//       付け替えは「売上明細（sales_detail）の行」単位で行い、分類（category）は元の行のまま維持する。
//       → 総売上・内訳（会費/パーソナル/物販/その他）の両方に同じ比率で反映され、内訳合計＝売上合計が保たれる。
// 安全性:
//   - ルールが無効（enabled=false・開始年月未設定・比率不正）の間は、入力行をそのまま返す（集計結果は従来と完全一致）。
//   - 開始年月より前の月の行は一切変更しない。
//   - 按分先が所属店舗と同じ行は変更しない（二重計上しない）。
//   - 複数商品が1行にまとまっている売上明細（"A x1, B x1"）は、商品別の金額が分からないため按分せず件数だけ数える。
//
// 依存を持たない純粋関数として書く（Node の型ストリップで単体テスト可能にするため）。

export interface OptionSplitRule {
  productCode: string;
  /** 摘要に含まれる商品名（画面で入力）。空なら productCode の hacomono 商品名（PS001）を使う */
  matchName?: string | null;
  targetStore: string;
  ratioPercent: number;
  startYear: number | null;
  startMonth: number | null;
  enabled: boolean;
}

export interface SalesRowLike {
  id: number;
  year: number;
  month: number;
  storeName: string;
  description: string | null;
  category: string | null;
  amount: number;
}

export interface SplitStats {
  /** 按分で付け替えた行の数 */
  split: number;
  /** 対象商品を含むが1行に複数商品があり按分できなかった行の数（要確認） */
  unsplittable: number;
  /** 付け替えた金額の合計（円） */
  movedTotal: number;
}

/** ルールとして有効な設定か（年月に依らない。無効な設定は一切適用しない） */
export function isRuleUsable(rule: OptionSplitRule): boolean {
  if (!rule.enabled) return false;
  if (rule.startYear == null || rule.startMonth == null) return false;
  if (!rule.targetStore) return false;
  return Number.isInteger(rule.ratioPercent) && rule.ratioPercent > 0 && rule.ratioPercent <= 100;
}

/** ルールが今回の年月に適用されるか */
export function isRuleActiveFor(rule: OptionSplitRule, year: number, month: number): boolean {
  if (!isRuleUsable(rule)) return false;
  return year * 12 + month >= (rule.startYear as number) * 12 + (rule.startMonth as number);
}

/**
 * 商品名の照合用に正規化する。全角/半角（英数・括弧・スペース）、空白の有無、英字の大小の違いを無視する。
 * 例: 「HYROXオプション下北沢(月4回)」と「ＨＹＲＯＸオプション 下北沢（月4回）」は同じになる。
 */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toLowerCase();
}

/** 摘要が、いずれかの商品名を含むか（正規化して照合） */
export function descriptionMatchesAny(description: string, names: string[]): boolean {
  const d = normalizeForMatch(description);
  return names.some((n) => {
    const nn = normalizeForMatch(n ?? "");
    return nn !== "" && d.includes(nn);
  });
}

/** ルールの照合に使う商品名: 画面で入力した商品名があればそれ、なければ PS001 の商品名 */
export function namesForRule(rule: OptionSplitRule, namesByCode: Record<string, string[]>): string[] {
  const mn = (rule.matchName ?? "").trim();
  return mn ? [mn] : (namesByCode[rule.productCode] ?? []);
}

/** 売上明細の摘要が「単一商品」か（複数商品が ", " で連結された行は按分対象外） */
export function isSingleItemDescription(description: string): boolean {
  return !description.includes(", ");
}

/**
 * 売上明細行に按分を適用する。
 * @param rows 売上明細行（按分先店舗の行も含めて渡すこと）
 * @param rules 按分ルール（無効なものは無視される）
 * @param namesByCode 商品コード → 商品名の一覧（PS001 の商品名。摘要との照合に使う）
 */
export function applyOptionSalesSplit<T extends SalesRowLike>(
  rows: T[],
  rules: OptionSplitRule[],
  namesByCode: Record<string, string[]>,
): { rows: T[]; stats: SplitStats } {
  const stats: SplitStats = { split: 0, unsplittable: 0, movedTotal: 0 };
  const activeRules = rules.filter(isRuleUsable);
  if (activeRules.length === 0) return { rows, stats };

  const out: T[] = [];
  let syntheticSeq = 0;
  for (const row of rows) {
    const desc = row.description ?? "";
    const rule = activeRules.find(
      (r) =>
        descriptionMatchesAny(desc, namesForRule(r, namesByCode)) &&
        isRuleActiveFor(r, row.year, row.month) &&
        row.storeName !== r.targetStore,
    );
    if (!rule) {
      out.push(row);
      continue;
    }
    if (!isSingleItemDescription(desc)) {
      stats.unsplittable += 1;
      out.push(row);
      continue;
    }
    const moved = Math.round((row.amount * rule.ratioPercent) / 100);
    if (moved === 0) {
      out.push(row);
      continue;
    }
    stats.split += 1;
    stats.movedTotal += moved;
    // 所属店舗側: 付け替え分を差し引く
    out.push({ ...row, amount: row.amount - moved });
    // 按分先側: 付け替え分を加算（合成行。id は元行と衝突しない負の値）
    syntheticSeq += 1;
    out.push({ ...row, id: -syntheticSeq, storeName: rule.targetStore, amount: moved });
  }
  return { rows: out, stats };
}

/** 未分割（1行に複数商品）の件数を、年月×店舗ごとに数える。按分設定画面の表示用。 */
export interface UnsplittableCount {
  year: number;
  month: number;
  storeName: string;
  count: number;
}

export function summarizeUnsplittable(
  rows: Array<Pick<SalesRowLike, "year" | "month" | "storeName" | "description">>,
  namesByCode: Record<string, string[]>,
  rules: OptionSplitRule[] = [],
): UnsplittableCount[] {
  // 照合する商品名: ルールに画面入力の商品名があればそれ、無ければ PS001 の商品名（全ルール分）
  const names = new Set<string>();
  const customCodes = new Set<string>();
  for (const r of rules) {
    if ((r.matchName ?? "").trim()) { names.add(r.matchName!.trim()); customCodes.add(r.productCode); }
  }
  for (const [code, list] of Object.entries(namesByCode)) {
    if (!customCodes.has(code)) for (const n of list) if (n) names.add(n);
  }
  const nameList = [...names];
  const map = new Map<string, UnsplittableCount>();
  for (const r of rows) {
    const desc = r.description ?? "";
    if (!descriptionMatchesAny(desc, nameList)) continue;
    if (isSingleItemDescription(desc)) continue;
    const key = `${r.year}-${r.month}-${r.storeName}`;
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { year: r.year, month: r.month, storeName: r.storeName, count: 1 });
  }
  return [...map.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month || a.storeName.localeCompare(b.storeName, "ja"),
  );
}
