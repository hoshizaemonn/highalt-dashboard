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

/** 按分先（店舗と比率%）。所属店舗の売上のうち、この店舗へ付け替える割合 */
export interface SplitTarget {
  store: string;
  ratio: number;
}

export interface OptionSplitRule {
  /** ルールの識別子（自動採番の文字列）。I0345/I0346 は旧形式（空の商品名なら hacomono の商品名で照合） */
  productCode: string;
  /** 摘要に含まれる商品名（画面で入力）。空なら productCode の hacomono 商品名（PS001）を使う */
  matchName?: string | null;
  /** 按分先（複数可）。無ければ targetStore / ratioPercent（旧形式の1件）を使う */
  targets?: SplitTarget[] | null;
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
  return validateTargets(ruleTargets(rule)) === null;
}

/** DBに保存した按分先のJSON文字列を読む。壊れていたら null（旧形式の1件にフォールバックさせる） */
export function parseTargetsJson(raw: string | null | undefined): SplitTarget[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const out: SplitTarget[] = [];
    for (const x of v) {
      if (!x || typeof x.store !== "string" || typeof x.ratio !== "number") return null;
      out.push({ store: x.store, ratio: x.ratio });
    }
    return out;
  } catch {
    return null;
  }
}

/** ルールの按分先（targets があればそれ、無ければ旧形式の targetStore / ratioPercent の1件） */
export function ruleTargets(rule: OptionSplitRule): SplitTarget[] {
  const t = (rule.targets ?? []).filter((x) => x && x.store);
  if (t.length > 0) return t;
  return rule.targetStore ? [{ store: rule.targetStore, ratio: rule.ratioPercent }] : [];
}

/** 按分先の検証。問題があれば理由（日本語）、問題なければ null */
export function validateTargets(targets: SplitTarget[]): string | null {
  if (targets.length === 0) return "按分先の店舗を1つ以上指定してください";
  const seen = new Set<string>();
  let sum = 0;
  for (const t of targets) {
    if (!t.store) return "按分先の店舗が未選択です";
    if (seen.has(t.store)) return `按分先の店舗が重複しています（${t.store}）`;
    seen.add(t.store);
    if (!Number.isInteger(t.ratio) || t.ratio < 1 || t.ratio > 100) return "按分比率は1〜100の整数で指定してください";
    sum += t.ratio;
  }
  if (sum > 100) return `按分比率の合計が100%を超えています（${sum}%）`;
  return null;
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

/** 具体性（照合する商品名のうち最長の、正規化後の文字数）。長いほど具体的なルール */
function specificity(names: string[]): number {
  return names.reduce((mx, n) => Math.max(mx, normalizeForMatch(n ?? "").length), 0);
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
    // 一致するルールを集め、「最も具体的な（照合する商品名が長い）1件」だけを適用する。
    // 同じ長さなら識別子の昇順（DBの返却順に依存しない）。これで、複数のルールが同じ売上に一致しても二重に按分されない。
    const candidates = activeRules
      .map((r) => ({ r, names: namesForRule(r, namesByCode) }))
      .filter(({ r, names }) => descriptionMatchesAny(desc, names) && isRuleActiveFor(r, row.year, row.month));
    if (candidates.length === 0) {
      out.push(row);
      continue;
    }
    candidates.sort(
      (x, y) =>
        specificity(y.names) - specificity(x.names) || x.r.productCode.localeCompare(y.r.productCode),
    );
    const rule = candidates[0].r;
    // 所属店舗と同じ按分先は動かさない（その分は所属店舗に残る＝二重計上しない）
    const targets = ruleTargets(rule).filter((t) => t.store !== row.storeName);
    if (targets.length === 0) {
      out.push(row);
      continue;
    }
    if (!isSingleItemDescription(desc)) {
      stats.unsplittable += 1;
      out.push(row);
      continue;
    }
    // 各按分先へ「元の金額 × 比率」を移す。端数の丸めで移動合計が元の金額を超えないよう、残りを上限にする。
    // 返金（負の金額）も符号を保って同じ比率で分ける。
    const sign = row.amount < 0 ? -1 : 1;
    let remaining = Math.abs(row.amount);
    const moves: Array<{ store: string; amount: number }> = [];
    for (const t of targets) {
      const m = Math.min(remaining, Math.round((Math.abs(row.amount) * t.ratio) / 100));
      if (m > 0) {
        moves.push({ store: t.store, amount: sign * m });
        remaining -= m;
      }
    }
    if (moves.length === 0) {
      out.push(row);
      continue;
    }
    const movedTotal = moves.reduce((acc, m) => acc + m.amount, 0);
    stats.split += 1;
    stats.movedTotal += movedTotal;
    // 所属店舗側: 付け替え分を差し引く
    out.push({ ...row, amount: row.amount - movedTotal });
    // 按分先側: 付け替え分を加算（合成行。id は元行と衝突しない負の値）
    for (const m of moves) {
      syntheticSeq += 1;
      out.push({ ...row, id: -syntheticSeq, storeName: m.store, amount: m.amount });
    }
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
