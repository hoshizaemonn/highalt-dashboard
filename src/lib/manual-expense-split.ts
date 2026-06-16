// 本部一括経費の手動按分ヘルパ
// ManualExpenseEntry.splitRatios（JSON文字列）をパースして {店舗→比率%} のマップを返す。

/**
 * 例: '{"東日本橋":40,"中目黒":30,"船橋":30}' → { "東日本橋": 40, "中目黒": 30, "船橋": 30 }
 * 不正な値や空文字列の場合は null を返す（既存挙動にフォールバック）。
 */
export function parseSplitRatios(
  raw: string | null | undefined,
): Record<string, number> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const out: Record<string, number> = {};
    let hasAny = false;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
      if (!Number.isFinite(n) || n <= 0) continue;
      out[k] = n;
      hasAny = true;
    }
    return hasAny ? out : null;
  } catch {
    return null;
  }
}

/**
 * splitRatios を考慮した単店配分額を返す。
 * - splitRatios あり: totalAmount × ratio[store] / 100
 * - splitRatios なし & storeName=="": totalAmount / storeCount（均等按分）
 * - storeName==store: totalAmount（その店のみ計上）
 * - 上記以外: 0
 */
export function singleStoreShare(
  row: {
    storeName: string;
    totalAmount: number;
    splitRatios: string | null;
  },
  store: string,
  storeCount: number,
): number {
  const ratios = parseSplitRatios(row.splitRatios);
  if (row.storeName === "" && ratios) {
    const r = ratios[store] ?? 0;
    return Math.round((row.totalAmount * r) / 100);
  }
  if (row.storeName === "") {
    return Math.round(row.totalAmount / Math.max(storeCount, 1));
  }
  return row.storeName === store ? row.totalAmount : 0;
}

/**
 * splitRatios を考慮した全店合算配分額を返す。
 * - splitRatios あり: totalAmount × Σratios / 100 （未指定店舗は除外）
 * - splitRatios なし & storeName=="": totalAmount（全額が経費に立つ）
 * - storeName!="": totalAmount（その店分が全体に加算）
 */
export function allStoresShare(
  row: {
    storeName: string;
    totalAmount: number;
    splitRatios: string | null;
  },
): number {
  const ratios = parseSplitRatios(row.splitRatios);
  if (row.storeName === "" && ratios) {
    const totalRatio = Object.values(ratios).reduce((s, v) => s + v, 0);
    return Math.round((row.totalAmount * totalRatio) / 100);
  }
  return row.totalAmount;
}

/**
 * ExpenseData 行 1 件を、対象店舗 (target) に対していくら計上するか返す。
 * - splitRatios あり: amount × ratios[target] / 100 （target が未指定なら 0）
 * - splitRatios なし: storeName == target なら amount、それ以外は 0
 *
 * target が null（全店ビュー）の場合:
 * - splitRatios あり: amount × Σratios / 100 （明示された店舗合計）
 * - splitRatios なし: amount（このまま全体に加算）
 */
export function expenseRowShare(
  row: {
    storeName: string;
    amount: number;
    splitRatios?: string | null;
  },
  target: string | null,
): number {
  const ratios = parseSplitRatios(row.splitRatios ?? null);
  if (ratios) {
    if (target === null) {
      const totalRatio = Object.values(ratios).reduce((s, v) => s + v, 0);
      return (row.amount * totalRatio) / 100;
    }
    const r = ratios[target] ?? 0;
    return (row.amount * r) / 100;
  }
  if (target === null) {
    return row.amount;
  }
  return row.storeName === target ? row.amount : 0;
}

/**
 * ExpenseData 行 1 件のカテゴリ別配分マップを返す。
 * 全店ビューでカテゴリ別に分解しつつ、splitRatios あり行も正しく分配するために使う。
 */
export function expenseRowSharesByStore(
  row: {
    storeName: string;
    amount: number;
    splitRatios?: string | null;
  },
): Record<string, number> {
  const ratios = parseSplitRatios(row.splitRatios ?? null);
  if (ratios) {
    const out: Record<string, number> = {};
    for (const [store, r] of Object.entries(ratios)) {
      out[store] = (row.amount * r) / 100;
    }
    return out;
  }
  return { [row.storeName]: row.amount };
}

// ─── カテゴリ別分解（依頼: PayPay銀行で家賃+電気代等が一括出金される行の分解） ───

export interface CategorySplit {
  category: string;
  amount: number;
  /** 各分解項目ごとの店舗按分（null/未指定なら親行の splitRatios もしくは storeName を使う） */
  splitRatios?: Record<string, number> | null;
}

/**
 * categorySplits の JSON 文字列を配列に正規化。
 * 不正値は除外し、何も残らなければ null を返す。
 */
export function parseCategorySplits(
  raw: string | null | undefined,
): CategorySplit[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    const out: CategorySplit[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const category = String((item as { category?: unknown }).category ?? "").trim();
      const amount = Number((item as { amount?: unknown }).amount ?? 0);
      if (!category || !Number.isFinite(amount) || amount === 0) continue;
      const rawSr = (item as { splitRatios?: unknown }).splitRatios;
      let splitRatios: Record<string, number> | null = null;
      if (rawSr && typeof rawSr === "object") {
        const clean: Record<string, number> = {};
        for (const [k, v] of Object.entries(rawSr as Record<string, unknown>)) {
          const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
          if (Number.isFinite(n) && n > 0) clean[k] = n;
        }
        if (Object.keys(clean).length > 0) splitRatios = clean;
      } else if (typeof rawSr === "string") {
        splitRatios = parseSplitRatios(rawSr);
      }
      out.push({ category, amount, splitRatios });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * categorySplits 配慮版の expenseRowShare。
 * categorySplits が設定されている場合は分解項目を独立に計算して合算、
 * 無ければ従来の expenseRowShare に委譲。
 */
export function expenseRowShareWithCategorySplit(
  row: {
    storeName: string;
    amount: number;
    splitRatios?: string | null;
    categorySplits?: string | null;
  },
  target: string | null,
): number {
  const splits = parseCategorySplits(row.categorySplits ?? null);
  if (splits) {
    let total = 0;
    for (const sp of splits) {
      const sr = sp.splitRatios
        ? JSON.stringify(sp.splitRatios)
        : (row.splitRatios ?? null);
      total += expenseRowShare(
        { storeName: row.storeName, amount: sp.amount, splitRatios: sr },
        target,
      );
    }
    return total;
  }
  return expenseRowShare(row, target);
}

/**
 * カテゴリ別配分を返す（カテゴリ→金額）。categorySplits があれば科目別に分解。
 */
export function expenseRowSharesByCategory(
  row: {
    storeName: string;
    amount: number;
    category?: string | null;
    splitRatios?: string | null;
    categorySplits?: string | null;
  },
  target: string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  const splits = parseCategorySplits(row.categorySplits ?? null);
  if (splits) {
    for (const sp of splits) {
      const sr = sp.splitRatios
        ? JSON.stringify(sp.splitRatios)
        : (row.splitRatios ?? null);
      const share = expenseRowShare(
        { storeName: row.storeName, amount: sp.amount, splitRatios: sr },
        target,
      );
      if (share === 0) continue;
      out[sp.category] = (out[sp.category] ?? 0) + share;
    }
    return out;
  }
  const share = expenseRowShare(row, target);
  if (share !== 0) {
    out[row.category ?? "その他"] = share;
  }
  return out;
}
