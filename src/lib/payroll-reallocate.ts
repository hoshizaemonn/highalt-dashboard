// 人件費の店舗按分ロジック（取込時・マッピング保存時・マッピング削除時・月別調整で共用）。
//
// 設計（松尾さん要望・2026-08 / 2026-10 月別調整を追加）:
//  - 店舗割当の優先順位は「その月の月別調整（payroll_monthly_split）＞ マッピング（store_overrides）
//    ＞ 社員番号ルール」。判定本体は payroll-allocation.ts（純粋関数・テストあり）。
//  - マッピングは「適用開始年月（この月から按分/移転を適用）」を持つ。null＝全期間。
//  - 適用開始月より前の月は「移転前の店舗（baseStore）」1店舗100%にする。
//    baseStore は初回設定時に自動取得（既存データの最初の所属店舗→社員番号ルール）し編集可。
//  - マッピング保存/削除のたびに、その従業員の全月を「元の100%金額」から再計算する。
//    ただし月別調整がある月はそのまま残す（上書きしない）。
//    （PayrollData の数値フィールドは常に100%換算・ratio は別保持。集計側で value×ratio/100）

import { prisma } from "@/lib/prisma";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";

import {
  assignmentsForMonth as assignmentsForMonthCore,
  clearMonthlySplit as clearMonthlySplitCore,
  recomputeEmployeePayroll as recomputeCore,
  saveMonthlySplit as saveMonthlySplitCore,
  type EmployeeMapping,
  type PayrollRepo,
  type PayrollRowInput,
  type StoreAssignment,
} from "@/lib/payroll-allocation";

export type { EmployeeMapping, StoreAssignment } from "@/lib/payroll-allocation";

// prisma 本体と $transaction の tx は必要なデリゲートが構造的に同一なので、
// 必要なデリゲートだけを持つ最小インターフェースで受ける。
export interface PayrollTx {
  payrollData: typeof prisma.payrollData;
  storeOverride: typeof prisma.storeOverride;
  payrollMonthlySplit: typeof prisma.payrollMonthlySplit;
}

/** 社員番号の千の位から店舗を判定（2桁ID等・不明なら null） */
export function homeStoreFromId(empId: number): string | null {
  if (!Number.isFinite(empId) || empId < 1000) return null;
  const thousandDigit = Math.floor(empId / 1000);
  return THOUSAND_DIGIT_MAP[thousandDigit] ?? null;
}

/** store_overrides から従業員のマッピングを読む（無ければ null） */
export async function loadEmployeeMapping(
  tx: PayrollTx,
  empId: number,
): Promise<EmployeeMapping | null> {
  const rows = await tx.storeOverride.findMany({ where: { employeeId: empId } });
  if (rows.length === 0) return null;
  const head = rows[0];
  return {
    stores: rows.map((r) => ({ storeName: r.storeName, ratio: r.ratio })),
    effectiveYear: head.effectiveYear ?? null,
    effectiveMonth: head.effectiveMonth ?? null,
    baseStore: head.baseStore ?? null,
  };
}

/**
 * 従業員の「移転前の店舗（baseStore）」の初期値を決める。
 *  1) 既存マッピングに baseStore があればそれ
 *  2) 既存の人件費データの最初の所属店舗（＝最初に設定された店舗）
 *  3) 社員番号ルール
 */
export async function captureBaseStore(
  tx: PayrollTx,
  empId: number,
  empIdStr: string,
): Promise<string | null> {
  const existingOverride = await tx.storeOverride.findFirst({
    where: { employeeId: empId, NOT: { baseStore: null } },
    select: { baseStore: true },
  });
  if (existingOverride?.baseStore) return existingOverride.baseStore;

  const earliest = await tx.payrollData.findFirst({
    where: { employeeId: empIdStr },
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: { storeName: true },
  });
  if (earliest?.storeName) return earliest.storeName;

  return homeStoreFromId(empId);
}

/** 社員番号（文字列）から社員番号ルールの店舗を引く */
export function homeStoreFromIdStr(empIdStr: string): string | null {
  return homeStoreFromId(parseInt(empIdStr, 10));
}

/**
 * ある月に対して、この従業員をどの店舗にどの比率で割り当てるかを返す（マッピングのみで判定）。
 * 月別調整を含めた判定は payroll-allocation.ts の resolveAssignments を使う。
 */
export function assignmentsForMonth(
  mapping: EmployeeMapping,
  empId: number,
  year: number,
  month: number,
): StoreAssignment[] {
  return assignmentsForMonthCore(mapping, homeStoreFromId(empId), year, month);
}

/** prisma（または $transaction の tx）を PayrollRepo として使うアダプタ */
export function prismaPayrollRepo(tx: PayrollTx): PayrollRepo {
  return {
    async findPayrollRows({ employeeId, year, month }) {
      const rows = await tx.payrollData.findMany({
        where: {
          employeeId,
          ...(year != null ? { year } : {}),
          ...(month != null ? { month } : {}),
        },
        orderBy: [{ year: "asc" }, { month: "asc" }],
      });
      return rows as PayrollRowInput[];
    },
    async replacePayrollRows(employeeId, year, month, rows) {
      await tx.payrollData.deleteMany({ where: { employeeId, year, month } });
      if (rows.length > 0) {
        await tx.payrollData.createMany({
          data: rows.map((r) => ({ ...r, employeeId, year, month })),
        });
      }
    },
    async findMonthlySplits({ employeeId, year, month }) {
      return tx.payrollMonthlySplit.findMany({
        where: {
          ...(employeeId != null ? { employeeId } : {}),
          ...(year != null ? { year } : {}),
          ...(month != null ? { month } : {}),
        },
        orderBy: [{ year: "asc" }, { month: "asc" }, { ratio: "desc" }, { storeName: "asc" }],
        select: { year: true, month: true, employeeId: true, storeName: true, ratio: true },
      });
    },
    async replaceMonthlySplits(employeeId, year, month, splits, updatedBy) {
      await tx.payrollMonthlySplit.deleteMany({ where: { employeeId, year, month } });
      await tx.payrollMonthlySplit.createMany({
        data: splits.map((s) => ({
          year,
          month,
          employeeId,
          storeName: s.storeName,
          ratio: Math.round(s.ratio),
          updatedBy,
          updatedAt: new Date(),
        })),
      });
    },
    async deleteMonthlySplits(employeeId, year, month) {
      const r = await tx.payrollMonthlySplit.deleteMany({ where: { employeeId, year, month } });
      return r.count;
    },
  };
}

/**
 * 従業員の全月の人件費を、与えられたマッピング（null＝マッピング無し→社員番号ルール）で再計算する。
 * その月に月別調整があれば月別調整を優先して残す。
 * 呼び出し側で $transaction 内から呼ぶこと（tx を渡す）。
 */
export async function recomputeEmployeePayroll(
  tx: PayrollTx,
  empId: number,
  empIdStr: string,
  mapping: EmployeeMapping | null,
  scope?: { year: number; month?: number },
): Promise<number> {
  return recomputeCore(prismaPayrollRepo(tx), empIdStr, mapping, homeStoreFromId(empId), scope);
}

/** 月別調整を保存し、その月の人件費行を組み直す（$transaction 内から呼ぶ） */
export async function saveMonthlySplit(
  tx: PayrollTx,
  params: { year: number; month: number; employeeId: string; splits: StoreAssignment[]; updatedBy: string },
) {
  return saveMonthlySplitCore(prismaPayrollRepo(tx), params);
}

/** 月別調整を解除し、その月をマッピング→社員番号ルールで組み直す（$transaction 内から呼ぶ） */
export async function clearMonthlySplit(
  tx: PayrollTx,
  params: { year: number; month: number; employeeId: string },
) {
  const empId = parseInt(params.employeeId, 10);
  const mapping = Number.isNaN(empId) ? null : await loadEmployeeMapping(tx, empId);
  return clearMonthlySplitCore(prismaPayrollRepo(tx), {
    ...params,
    mapping,
    homeStore: homeStoreFromId(empId),
  });
}
