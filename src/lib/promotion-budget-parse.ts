import { safeInt } from "@/lib/csv-utils";

// 販促報告シートから取り込む KPI 予算カテゴリ（BudgetData のカテゴリ名）。
// 削除スコープもこれに限定し、売上・経費系の予算は触らない。
export const PROMOTION_BUDGET_CATEGORIES = [
  "体験者数",
  "新規入会数",
  "退会数",
  "有効在籍数",
] as const;

export type PromotionBudgetCategory =
  (typeof PROMOTION_BUDGET_CATEGORIES)[number];

export interface PromotionBudgetRecord {
  storeName: string;
  year: number;
  month: number;
  category: string;
  amount: number;
}

const norm = (s: string) =>
  s.replace(/\s/g, "").replace(/[（）]/g, (c) => (c === "（" ? "(" : ")"));

/**
 * CSV テキストが「販促報告」シートかどうかを判定する。
 * 予算実績対比表（売上・経費の予算）とは別シートで、行レイアウトが異なる。
 */
export function isPromotionReportCsv(text: string): boolean {
  return (
    text.includes("販促報告") ||
    text.includes("紹介からの体験数") ||
    text.includes("紹介以外からの体験数")
  );
}

function classify(labelRaw: string): PromotionBudgetCategory | null {
  const l = norm(labelRaw);
  if (!l.includes("(予算)")) return null;
  // 体験数（紹介 / 紹介以外）→ 体験者数 に合算
  if (l.includes("紹介からの体験数") || l.includes("紹介以外からの体験数")) {
    return "体験者数";
  }
  // 入会数（予算）。「6ヶ月内の入会者数」など別語は除外
  if (l.startsWith("入会数(予算)")) return "新規入会数";
  if (l.startsWith("退会数(予算)")) return "退会数";
  // 有効在籍数（予算）→ 在籍会員数チャートの予算線に使う（松尾さん確定 2026-07）。
  // 「在籍数(実績)」「有効在籍数(実績)」「有効在籍数(予実差)」は (予算) を含まないので除外される。
  if (l.startsWith("有効在籍数(予算)")) return "有効在籍数";
  return null;
}

/**
 * 販促報告シートの行配列から、体験者数 / 新規入会数 / 退会数 の月別予算を抽出する。
 * シート様式: col1=行ラベル, col2〜col13=10月〜9月（単一列・件数）, col14=合計。
 * fiscalYear の会計年度（10月〜翌9月）にマッピングする。
 */
export function extractPromotionBudgetRecords(
  allRows: string[][],
  store: string,
  fiscalYear: number,
): PromotionBudgetRecord[] {
  const fyMonths: { year: number; month: number }[] = [];
  for (let m = 10; m <= 12; m++) fyMonths.push({ year: fiscalYear - 1, month: m });
  for (let m = 1; m <= 9; m++) fyMonths.push({ year: fiscalYear, month: m });

  const agg: Record<string, number[]> = {};
  for (const c of PROMOTION_BUDGET_CATEGORIES) agg[c] = new Array(12).fill(0);

  for (const row of allRows) {
    if (!row || row.length < 14) continue;
    const label = (row[1] ?? "").trim();
    if (!label) continue;
    const cat = classify(label);
    if (!cat) continue;
    for (let i = 0; i < 12; i++) {
      const cell = row[2 + i];
      agg[cat][i] += cell ? safeInt(cell) : 0;
    }
  }

  const records: PromotionBudgetRecord[] = [];
  for (const cat of PROMOTION_BUDGET_CATEGORIES) {
    for (let i = 0; i < 12; i++) {
      const amount = agg[cat][i];
      if (amount === 0) continue;
      records.push({
        storeName: store,
        year: fyMonths[i].year,
        month: fyMonths[i].month,
        category: cat,
        amount,
      });
    }
  }
  return records;
}
