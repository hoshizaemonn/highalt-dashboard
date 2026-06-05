// 損益計算書 (PL) Excel書式エクスポート（アンビルさん依頼④）
//
// クライアント指定のテンプレ `src/lib/templates/budget_pl_template.xlsx` の
// 「損益計算書」シートにダッシュボード集計値を書き込んで返す。
//
// 単位は千円。会計年度は10月〜翌9月で、列マッピングは:
//   B=10月, C=11月, D=12月, E=1月, F=2月, G=3月, H=4月, I=5月, J=6月, K=7月, L=8月, M=9月
//
// 入力データは月単位の以下の集計値:
//   - sales: { personal, product, other, membership, vending }
//   - expenses: 勘定科目別の経費合計（円）
//   - payroll: { fulltime, bonus, commute, legalWelfare, welfare }

import path from "path";
import { promises as fs } from "fs";
import ExcelJS from "exceljs";

export const PL_TEMPLATE_PATH = path.join(
  process.cwd(),
  "src/lib/templates/budget_pl_template.xlsx",
);

export interface PlMonthlyData {
  // 売上（円）
  salesPersonalAndProduct: number; // パーソナル + 物販 + その他収入
  salesMembership: number; // 月会費 + 入会金
  salesService: number;
  salesVending: number;
  // 売上原価
  cogs: number; // 仕入高
  // 経費（円・勘定科目別）
  expenses: Record<string, number>;
  // 人件費（円）
  payrollFulltime: number; // 正社員・契約社員給与
  payrollBonus: number; // 賞与
  payrollCommute: number; // 通勤手当
  payrollLegalWelfare: number; // 法定福利費
  payrollWelfare: number; // 福利厚生費
}

// 損益計算書シートの行マッピング（勘定科目 → 行番号）
const PL_ROW_MAP = {
  salesPersonalAndProduct: 4, // パーソナル・物販・その他収入
  salesMembership: 5, // 月会費収入
  salesService: 6, // サービス収入
  salesVending: 7, // 自販機手数料収入
  cogs: 10, // 仕入高
  // 経費（販管費）
  expenseAdvertising: 13, // 広告宣伝費
  payrollFulltime: 14, // 正社員・契約社員給与
  payrollBonus: 15, // 賞与
  payrollCommute: 16, // 通勤手当
  payrollLegalWelfare: 17, // 法定福利費
  payrollWelfare: 18, // 福利厚生費
  expenseRepair: 19, // 修繕費
  expenseDepreciation: 20, // 減価償却費
  expenseRent: 21, // 賃借料
  expenseConsumables: 22, // 消耗品費
  expenseSupplies: 23, // 備品費
  expenseElectricity: 24, // 電気料
  expenseWater: 25, // 上下水道料
  expenseCommunication: 26, // 通信費
  expenseTraining: 27, // 研修費
  expenseFee: 28, // 支払手数料
  expenseLease: 29, // リース料
  expenseOutsourcing: 30, // 委託料
  expenseInsurance: 31, // 保険料
  expenseEntertainment: 32, // 接待交際費
  expenseDevAmortization: 33, // 開発費償却
  expenseTax: 34, // 租税公課
} as const;

// 経費勘定科目名 → 行番号
const EXPENSE_CATEGORY_TO_ROW: Record<string, number> = {
  広告宣伝費: PL_ROW_MAP.expenseAdvertising,
  修繕費: PL_ROW_MAP.expenseRepair,
  減価償却費: PL_ROW_MAP.expenseDepreciation,
  賃借料: PL_ROW_MAP.expenseRent,
  消耗品費: PL_ROW_MAP.expenseConsumables,
  備品費: PL_ROW_MAP.expenseSupplies,
  電気料: PL_ROW_MAP.expenseElectricity,
  上下水道料: PL_ROW_MAP.expenseWater,
  通信費: PL_ROW_MAP.expenseCommunication,
  研修費: PL_ROW_MAP.expenseTraining,
  支払手数料: PL_ROW_MAP.expenseFee,
  リース料: PL_ROW_MAP.expenseLease,
  委託料: PL_ROW_MAP.expenseOutsourcing,
  保険料: PL_ROW_MAP.expenseInsurance,
  接待交際費: PL_ROW_MAP.expenseEntertainment,
  開発費償却: PL_ROW_MAP.expenseDevAmortization,
  租税公課: PL_ROW_MAP.expenseTax,
};

// 会計年度内の月インデックス → Excel列
// fiscalIndex 0=10月, 1=11月, ..., 11=9月
const COL_LETTERS = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];

/**
 * 暦上の (year, month) を fiscalYear 基準の月インデックス（0-11）に変換。
 * fiscalYear=2026 のとき 2025/10 が 0, 2026/9 が 11。
 * 範囲外なら null。
 */
export function toFiscalIndex(
  year: number,
  month: number,
  fiscalYear: number,
): number | null {
  // 10〜12月は fiscalYear-1, 1〜9月は fiscalYear
  if (year === fiscalYear - 1 && month >= 10 && month <= 12) {
    return month - 10;
  }
  if (year === fiscalYear && month >= 1 && month <= 9) {
    return month - 1 + 3; // 1月→3, 9月→11
  }
  return null;
}

/**
 * 円 → 千円（小数1位まで・banker's rounding ではなく通常四捨五入）
 */
function yenToThousand(yen: number): number {
  if (!yen || !Number.isFinite(yen)) return 0;
  return Math.round(yen / 100) / 10; // 1000で割って小数1桁
}

/**
 * テンプレを読み込んで PL シートに月次データを書き込み、Buffer を返す。
 *
 * @param fiscalYear 会計年度 (例: 2026 = 2025/10〜2026/9 = 2026/9期)
 * @param storeDisplayName 店舗表示名（B1セルに反映）
 * @param monthlyData fiscalIndex(0-11) → PlMonthlyData
 */
export async function generatePlXlsx(
  fiscalYear: number,
  storeDisplayName: string,
  monthlyData: Map<number, PlMonthlyData>,
): Promise<Buffer> {
  const templateBuf = await fs.readFile(PL_TEMPLATE_PATH);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuf as unknown as ArrayBuffer);

  const sheet = wb.getWorksheet("損益計算書");
  if (!sheet) throw new Error("損益計算書 シートがテンプレに見つかりません");

  // タイトル行を期に合わせて更新
  sheet.getCell("A1").value = `${fiscalYear}/9期　　損益計算書`;
  sheet.getCell("B1").value = storeDisplayName;

  for (let fiscalIdx = 0; fiscalIdx < 12; fiscalIdx++) {
    const col = COL_LETTERS[fiscalIdx];
    const data = monthlyData.get(fiscalIdx);
    if (!data) continue;

    // 売上
    sheet.getCell(`${col}${PL_ROW_MAP.salesPersonalAndProduct}`).value =
      yenToThousand(data.salesPersonalAndProduct);
    sheet.getCell(`${col}${PL_ROW_MAP.salesMembership}`).value = yenToThousand(
      data.salesMembership,
    );
    sheet.getCell(`${col}${PL_ROW_MAP.salesService}`).value = yenToThousand(
      data.salesService,
    );
    sheet.getCell(`${col}${PL_ROW_MAP.salesVending}`).value = yenToThousand(
      data.salesVending,
    );

    // 売上原価
    sheet.getCell(`${col}${PL_ROW_MAP.cogs}`).value = yenToThousand(data.cogs);

    // 人件費
    sheet.getCell(`${col}${PL_ROW_MAP.payrollFulltime}`).value = yenToThousand(
      data.payrollFulltime,
    );
    sheet.getCell(`${col}${PL_ROW_MAP.payrollBonus}`).value = yenToThousand(
      data.payrollBonus,
    );
    sheet.getCell(`${col}${PL_ROW_MAP.payrollCommute}`).value = yenToThousand(
      data.payrollCommute,
    );
    sheet.getCell(`${col}${PL_ROW_MAP.payrollLegalWelfare}`).value =
      yenToThousand(data.payrollLegalWelfare);
    sheet.getCell(`${col}${PL_ROW_MAP.payrollWelfare}`).value = yenToThousand(
      data.payrollWelfare,
    );

    // 経費（勘定科目別）
    for (const [cat, row] of Object.entries(EXPENSE_CATEGORY_TO_ROW)) {
      const yen = data.expenses[cat] ?? 0;
      sheet.getCell(`${col}${row}`).value = yenToThousand(yen);
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
