/**
 * 広告ダッシュボード（highalt-ads）の広告費【実測】を、業績の「広告宣伝費」に月次で入れる取込の安全ガード。
 *
 * 経緯（星崎さん・山本さん 2026-11-09）:
 *   - 業績の広告宣伝費は、〜2026/4は税理士PL（pl_actuals）、2026/5〜は経費明細（PayPay/Amazon等）が出どころで、
 *     Google広告・Metaの広告費はどちらにも入っていなかった（10期=2026/10〜で入れる決定）。
 *   - 入れ方は本部一括経費（manual_expense_entry）と同じ枠。計算（月次・年間・店舗比較・CSV/Excel）は既存のまま使える。
 *   - 店舗に付く分は「その店舗のみ」、店舗に割れない分（本部P-MAX・全社/他拠点Meta・店舗未判定）は
 *     店舗名を空にして営業店舗数で均等按分（既存の本部一括経費と同じ）。
 *   - 経費明細の広告宣伝費（チラシ・電柱・イベント等）とは別行で、足し算になる（二重計上なし。2026/7〜10の明細に
 *     Google/Meta の支払いが無いことを確認済み）。
 *
 * 置き換えの範囲は「年月×カテゴリ=広告宣伝費×note が [広告自動] で始まる行」だけ。人が入れた行は触らない。
 * ここは純粋関数だけ（DB に触れない）。
 */

export const AD_SPEND_CATEGORY = "広告宣伝費";
/** 自動で入れた行の目印。置き換え・削除の対象はこの目印の行だけ */
export const AD_SPEND_NOTE_PREFIX = "[広告自動]";
export const AD_SPEND_UPDATED_BY = "広告自動連携";
/** 10期の最初の月。これより前（9期以前）は税理士PL・経費明細が正なので入れない */
export const AD_SPEND_FIRST_YM = { year: 2026, month: 10 } as const;
/** 1店舗・1媒体・1か月の上限（桁違いの値を止める） */
export const AD_SPEND_MAX_AMOUNT = 5_000_000;

export type AdSpendItem = { store: string; google: number; meta: number };
export type AdSpendRow = {
  year: number;
  month: number;
  category: string;
  storeName: string; // "" = 本部一括（均等按分）
  totalAmount: number;
  note: string;
};

const ymKey = (y: number, m: number) => y * 12 + m;

/** 日本時間の「今月」 */
export function currentYmJst(now: Date = new Date()): { year: number; month: number } {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1 };
}

/** 入れられない理由（空配列なら入れてよい）。 */
export function adSpendBlockReasons(
  year: number,
  month: number,
  items: AdSpendItem[],
  stores: readonly string[],
  now: Date = new Date(),
): string[] {
  const why: string[] = [];
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return ["対象年月が不正です"];
  }
  if (ymKey(year, month) < ymKey(AD_SPEND_FIRST_YM.year, AD_SPEND_FIRST_YM.month)) {
    why.push(`${AD_SPEND_FIRST_YM.year}年${AD_SPEND_FIRST_YM.month}月より前（9期以前）は入れません`);
  }
  const cur = currentYmJst(now);
  if (ymKey(year, month) >= ymKey(cur.year, cur.month)) {
    why.push("当月・未来の月は入れません（月が終わって実測が揃ってから入れる）");
  }
  if (!Array.isArray(items) || items.length === 0) {
    why.push("明細がありません");
    return why;
  }
  const seen = new Set<string>();
  for (const it of items) {
    const store = typeof it.store === "string" ? it.store : "";
    if (store !== "" && !stores.includes(store)) why.push(`店舗名が不明です: ${store}`);
    if (seen.has(store)) why.push(`店舗が重複しています: ${store || "（共通）"}`);
    seen.add(store);
    for (const [k, v] of [["google", it.google], ["meta", it.meta]] as const) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > AD_SPEND_MAX_AMOUNT) {
        why.push(`${store || "共通"} の ${k} が範囲外です: ${String(v)}`);
      }
    }
  }
  return why;
}

/** 入れる行を作る（媒体ごとに1行・0円の行は作らない・円未満は四捨五入）。 */
export function buildAdSpendRows(year: number, month: number, items: AdSpendItem[]): AdSpendRow[] {
  const rows: AdSpendRow[] = [];
  for (const it of items) {
    const where = it.store === "" ? "共通（本部P-MAX・全社/他拠点・店舗未判定）" : it.store;
    for (const [label, amount] of [["Google", it.google], ["Meta", it.meta]] as const) {
      const total = Math.round(amount);
      if (total <= 0) continue;
      rows.push({
        year,
        month,
        category: AD_SPEND_CATEGORY,
        storeName: it.store,
        totalAmount: total,
        note: `${AD_SPEND_NOTE_PREFIX} ${label} ${where}`,
      });
    }
  }
  return rows;
}
