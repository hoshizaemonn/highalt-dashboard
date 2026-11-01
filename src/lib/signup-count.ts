// 新規入会数の算出（松尾さん②・2026-08）。
//
// 従来: 全画面で MA002「プラン新規契約数」(monthly_summary.new_plan_signups) を集計。
//       これは hacomono がプラン契約（≒プラン契約適用開始日）ベースで数えた値。
// 変更: 松尾さんの意向で「入会日時」ベースに切り替える。
//
// 方針(い): 対象月に ML001（メンバー一覧）スナップショットがあれば、その月の
//   member_data から「入会日時が当月」の会員数を数える（＝入会日時ベース）。
//   スナップショットが無い月は従来どおり MA002 の値にフォールバックする
//   （過去〈ML001未取込〉月は定義が変わらない）。
//
// 注意（数字の性質）: ある月のスナップショットは「その時点で在籍している会員」だけを含む。
//   その月に入会し同月内に退会した会員は取りこぼす（実務上ごく僅か）。毎月末に
//   ML001 を保存する運用にすることで、各月の入会数を入会日時ベースで正確に積み上げる。

export interface MemberJoinRow {
  year: number;
  month: number;
  joinDate: string | null;
}

/** join_date（"YYYY/MM/DD..." または "YYYY-MM-DD..."）が指定年月かどうか */
export function joinDateInMonth(
  joinDate: string | null | undefined,
  year: number,
  month: number,
): boolean {
  if (!joinDate) return false;
  const mm = String(month).padStart(2, "0");
  const s = String(joinDate).trim();
  return s.startsWith(`${year}/${mm}`) || s.startsWith(`${year}-${mm}`);
}

/**
 * 指定 (year, month) の新規入会数を返す。
 * memberRows は対象スコープ（店舗など）の member_data マスタ行（1会員1行）。
 *
 * マスタ方式（松尾さん②・2026-08）: 会員マスタ（契約中＋退会済みを合算した全会員）を
 * 取り込んでいる店舗は、その月に「入会日時」が該当する会員数を数える（退会済みも含めて
 * 取りこぼさない・全月ぶん算出可能）。マスタを取り込んでいない店舗は従来どおり
 * maFallback（MA002 の新規契約数）にフォールバックする。
 *
 * hasMaster: このスコープに会員マスタが存在するか（＝memberRows が空でないか）。
 *   true  → 入会日時ベースで件数（該当0なら0を返す。maFallbackには落とさない）
 *   false → maFallback
 *
 * 注意: 会員マスタは (year,month) スナップではなくなったため、year/month 列では
 * フィルタしない。会員の入会日時のみで判定する。
 */
export function signupsForMonth(
  memberRows: MemberJoinRow[],
  maFallback: number,
  year: number,
  month: number,
  hasMaster: boolean,
): number {
  if (!hasMaster) return maFallback;
  return memberRows.filter((r) => joinDateInMonth(r.joinDate, year, month))
    .length;
}

// ─── 体験シート優先（星崎さん 2026-11-01: 体験シートが正） ───────────────
// 体験シートの行がある店舗・月は、新規入会数を「体験シートの入会（即日+後日）」にする。
// 体験シートの無い店舗・月は従来どおり（ML001 の入会日時 → MA002）。
// 体験シートに載らない入会（別窓口など）は店長手動追記で足す運用。

export interface SheetResultRow {
  storeName: string;
  year: number;
  month: number;
  resultType: string;
}

const SHEET_JOINED = new Set(["即日入会", "後日入会"]);

/** 年月 → 店舗 → 体験シートの入会数（即日+後日）。体験シートの行がある店舗は、入会0でもキーを持つ */
export function sheetJoinedByMonth(
  rows: SheetResultRow[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    const byStore = out.get(key) ?? new Map<string, number>();
    byStore.set(
      r.storeName,
      (byStore.get(r.storeName) ?? 0) + (SHEET_JOINED.has(r.resultType) ? 1 : 0),
    );
    out.set(key, byStore);
  }
  return out;
}

/**
 * 体験シートがある店舗はその入会数、無い店舗は従来の signupsForMonth で数えて合算する。
 * memberRows は店舗付きの会員マスタ行、maByStore は店舗ごとの MA002 新規契約数。
 * 体験シートの無い店舗の扱い（hasMaster の判定含む）は従来と同じ。
 */
export function signupsForMonthWithSheet(
  memberRows: { storeName: string; joinDate: string | null }[],
  maByStore: Map<string, number>,
  year: number,
  month: number,
  hasMaster: boolean,
  sheetJoined: Map<string, number> | undefined,
): number {
  const sheetStores = new Set(sheetJoined ? sheetJoined.keys() : []);
  const restRows = memberRows
    .filter((r) => !sheetStores.has(r.storeName))
    .map((r) => ({ year: 0, month: 0, joinDate: r.joinDate }));
  let restMa = 0;
  for (const [store, v] of maByStore) if (!sheetStores.has(store)) restMa += v;
  const rest = signupsForMonth(restRows, restMa, year, month, hasMaster);
  let sheet = 0;
  if (sheetJoined) for (const v of sheetJoined.values()) sheet += v;
  return rest + sheet;
}
