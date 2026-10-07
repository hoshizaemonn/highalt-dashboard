// Source: client supplied プラン.pdf, 2026-10-07. Exact allowlist, no substring matches.
export const INCLUDED_PLANS = [
  "ハイアルチ塾",
  "デイS会員",
  "ウィークワンS会員",
  "スタンダードS会員",
  "プレミアムS会員",
  "学生デイS会員",
  "学生ウィークワンS会員",
  "学生スタンダードS会員",
  "★ペア デイS会員",
  "★ペア ウィークワンS会員",
  "★ペア スタンダードS会員",
  "★ペア プレミアムS会員",
  "【祖師ヶ谷・下北沢】 ハイアルチ塾（月4回）",
  "【祖師ヶ谷・下北沢】 ハイアルチ塾（月8回）",
  "パーソナルチケット",
  "パーソナル紹介【東日本橋】",
  "デイ会員",
  "【祖師ヶ谷大蔵】パーソナル会員（月4回）",
  "パーソナル会員（月4回）",
  "ウィークワン会員",
  "スタンダード会員",
  "プレミアム会員",
  "学生デイ",
  "学生ウィークワン",
  "学生スタンダード",
  "★ペア デイ会員",
  "★ペア ウィークワン会員",
  "★ペア スタンダード会員",
  "★ペア プレミアム会員",
  "★ペア ハイアルチ塾",
  "ハイアルチ塾８回",
  "アドバンス",
  "ハイアルチ塾（中学生）",
  "★ペア ハイアルチ塾（中学生）",
  "★ペア ハイアルチ塾８回"
] as const;
export function normalizePlanName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, "").trim();
}
const names = new Map(INCLUDED_PLANS.map(name => [normalizePlanName(name), name]));
export function includedPlanName(name: string | null): string | null {
  return name ? names.get(normalizePlanName(name)) ?? null : null;
}
export interface PlanMember {
  year: number; month: number; storeName: string; planName: string | null; isActive: number;
}
export interface PlanSummary {
  year: number; month: number; storeName: string; planSubscribers: number; suspensions: number;
}
export function summarizePlans(rows: Pick<PlanMember, "planName" | "isActive">[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = includedPlanName(row.planName);
    if (name && row.isActive === 1) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
// MemberData is replaced on import. Only its recorded month can support this filter;
// never apply today's plans retroactively to historical MA002 totals.
export function filterPlanSummaries<T extends PlanSummary>(summaries: T[], members: PlanMember[]) {
  const snapshots = new Map<string, PlanMember[]>();
  const key = (r: { year: number; month: number; storeName: string }) => JSON.stringify([r.year, r.month, r.storeName]);
  for (const member of members) {
    const k = key(member); const rows = snapshots.get(k) ?? [];
    rows.push(member); snapshots.set(k, rows);
  }
  return summaries.map(row => {
    const rows = snapshots.get(key(row));
    const filtered = rows !== undefined;
    const count = filtered ? summarizePlans(rows).reduce((n, p) => n + p.count, 0) : row.planSubscribers;
    return { ...row, planSubscribers: count, planFilterApplied: filtered,
      // Active allowed plans already exclude suspension plans; do not subtract MA002 again.
      activePlanSubscribers: filtered ? count : Math.max(0, count - row.suspensions) };
  });
}
export const PLAN_FILTER_NOTE = "プラン契約者数は指定プランのみ集計。同月の会員データがない店舗・月は従来値（対象プラン未確認）です。休会数・退会数などは従来の集計です。";
