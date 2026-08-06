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
 * memberRows は対象スコープ（店舗など）で絞り込み済みの member_data 行。
 *   - その月の ML001 スナップショットがある（＝year/month 一致行が存在する）→ 入会日時ベースで件数
 *   - 無ければ maFallback（MA002 の新規入会数）を返す
 */
export function signupsForMonth(
  memberRows: MemberJoinRow[],
  maFallback: number,
  year: number,
  month: number,
): number {
  const snap = memberRows.filter((r) => r.year === year && r.month === month);
  if (snap.length === 0) return maFallback;
  return snap.filter((r) => joinDateInMonth(r.joinDate, year, month)).length;
}
