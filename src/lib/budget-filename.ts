import { STORES } from "@/lib/constants";

/**
 * 予算CSVのファイル名から 店舗 / 決算年(fiscalYear) / 期(period) を推定する。
 * 例:
 *   "2026_9期　予算実績対比表（祖師ヶ谷大蔵スタジオ）.xlsx .xlsx - 販促報告.csv"
 *     → { store: "祖師ヶ谷大蔵", fiscalYear: 2026, period: 9 }
 *
 * 取込時、ファイル名から確実に取れた値で UI 選択値を上書きする
 * （別店舗のファイルを誤った店舗で取り込む事故を防ぐ）。
 */
export interface BudgetFilenameInfo {
  store?: string;
  fiscalYear?: number;
  period?: number;
}

export function parseBudgetFilename(filename: string): BudgetFilenameInfo {
  const info: BudgetFilenameInfo = {};

  // 店舗: 全角/半角カッコ内のテキストから「スタジオ」を除去し、既知店舗にマッチ
  const paren = filename.match(/[（(]([^）)]+)[）)]/);
  if (paren) {
    const inner = paren[1].replace(/スタジオ/g, "").trim();
    const matched = STORES.find((s) => inner === s || inner.includes(s));
    if (matched) info.store = matched;
    else if (inner) info.store = inner; // 未知店舗でも名前があれば採用
  }

  // 決算年 + 期: "2026_9期" / "2026 9期" / "2026年9期" など
  const ym = filename.match(/(20\d{2})[_\s　年]*?(\d{1,2})期/);
  if (ym) {
    info.fiscalYear = parseInt(ym[1], 10);
    info.period = parseInt(ym[2], 10);
  } else {
    const y = filename.match(/(20\d{2})/);
    if (y) info.fiscalYear = parseInt(y[1], 10);
  }

  return info;
}
