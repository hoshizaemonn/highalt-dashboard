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
