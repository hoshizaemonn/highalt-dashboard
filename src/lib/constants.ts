export const STORES = [
  "東日本橋",
  "春日",
  "船橋",
  "巣鴨",
  "祖師ヶ谷大蔵",
  "下北沢",
  "中目黒",
] as const;

export const HQ_STORE = "本部（除外）";

export const EXPENSE_CATEGORIES = [
  "消耗品費",
  "広告宣伝費",
  "委託料",
  "通信費",
  "賃借料",
  "支払手数料",
  "雑費",
  "その他",
] as const;

export const THOUSAND_DIGIT_MAP: Record<number, string> = {
  1: "東日本橋",
  2: "春日",
  3: "船橋",
  4: "巣鴨",
  5: "東日本橋",
  6: "祖師ヶ谷大蔵",
  7: "下北沢",
  8: "中目黒",
};

// Unit price budget is stored in BudgetData with this category name.
// It is excluded from the expense budget bucket in buildBudgetRows and
// preserved across CSV re-uploads.
export const BUDGET_CATEGORY_UNIT_PRICE = "客単価";

export const BUDGET_ITEMS = [
  "パーソナル・物販・その他収入",
  "月会費収入",
  "サービス収入",
  "自販機手数料収入",
  "仕入高",
  "広告宣伝費",
  "正社員・契約社員給与",
  "賞与",
  "通勤手当",
  "法定福利費",
  "福利厚生費",
  "修繕費",
  "減価償却費",
  "賃借料",
  "消耗品費",
  "備品費",
  "電気料",
  "上下水道料",
  "通信費",
  "研修費",
  "支払手数料",
  "リース料",
  "委託料",
  "保険料",
  "接待交際費",
  "開発費償却",
  "租税公課",
] as const;

export const SALES_CATEGORIES = [
  "月会費",
  "パーソナル",
  "オプション",
  "入会金",
  "スポット",
  "体験",
  "ロッカー",
  "クーポン/割引",
  "その他",
] as const;
