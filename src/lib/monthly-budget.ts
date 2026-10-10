import { BUDGET_ITEMS } from "./constants";

const REVENUE = ["パーソナル・物販・その他収入", "月会費収入", "サービス収入"];
const REVENUE_DETAIL = ["会費売上", "パーソナル売上", "物販売上", "その他売上"];
const LABOR = ["正社員・契約社員給与", "賞与", "通勤手当", "法定福利費"];
const KPI = ["新規入会数", "退会数", "休会数", "退会率", "体験者数"];
const EXPENSE = BUDGET_ITEMS.filter(k =>
  ![...REVENUE, ...REVENUE_DETAIL, ...LABOR, ...KPI, "自販機手数料収入"].includes(k),
);

/** 未登録と0円を区別する。人数・率・客単価を経費に合算しない。 */
export function monthlyBudgetTotals(budget: Record<string, number>) {
  const sum = (keys: readonly string[]): number | null => {
    const present = keys.filter(k => Object.hasOwn(budget, k));
    return present.length ? present.reduce((s, k) => s + budget[k], 0) : null;
  };
  // 旧予算書と売上4分類を併記したファイルでも、売上を二重計上しない。
  const revenueKeys = REVENUE.some(k => Object.hasOwn(budget, k)) ? REVENUE : REVENUE_DETAIL;
  const revenue = sum([...revenueKeys, "自販機手数料収入"]);
  const labor = sum(LABOR);
  const expense = sum(EXPENSE);
  const profit = revenue === null || labor === null || expense === null ? null : revenue - labor - expense;
  return { revenue, labor, expense, profit, expenseCategories: EXPENSE.filter(k => Object.hasOwn(budget, k)) };
}

export function budgetComparison(budget: number | null, actual: number | null) {
  return {
    difference: budget === null || actual === null ? null : actual - budget,
    // 0円・赤字予算の達成率は誤解を招くため表示せず、差額で比較する。
    ratio: budget !== null && budget > 0 && actual !== null ? actual / budget * 100 : null,
  };
}

/** 合算予算を個別カテゴリへ推測配賦しない。未設定と明示的な0円を区別する。 */
export function monthlyRevenueBudgets(budget: Record<string, number>) {
  return {
    membership: budget["会費売上"] ?? budget["月会費収入"] ?? null,
    personal: budget["パーソナル売上"] ?? null,
    product: budget["物販売上"] ?? null,
    other: budget["その他売上"] ?? null,
    combined: budget["パーソナル・物販・その他収入"] ?? null,
  };
}
