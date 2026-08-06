// 人件費の店舗按分ロジック（取込時・マッピング保存時・マッピング削除時で共用）。
//
// 設計（松尾さん要望・2026-08）:
//  - マッピング（store_overrides）を「唯一の正」とする。
//  - マッピングは「適用開始年月（この月から按分/移転を適用）」を持つ。null＝全期間。
//  - 適用開始月より前の月は「移転前の店舗（baseStore）」1店舗100%にする。
//    baseStore は初回設定時に自動取得（既存データの最初の所属店舗→社員番号ルール）し編集可。
//  - マッピング保存/削除のたびに、その従業員の全月を「元の100%金額」から再計算する。
//    （PayrollData の数値フィールドは常に100%換算・ratio は別保持。集計側で value×ratio/100）
//
// これにより「8月に入れたが7月からにしたい」「移転前は別店舗」も、開始月を変更して
// 保存し直すだけで何度でも正しく組み直せる（各行が元金額を保持しているため可逆）。

import { prisma } from "@/lib/prisma";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";

// prisma 本体と $transaction の tx は payrollData / storeOverride 部分が構造的に同一なので、
// 必要なデリゲートだけを持つ最小インターフェースで受ける。
export interface PayrollTx {
  payrollData: typeof prisma.payrollData;
  storeOverride: typeof prisma.storeOverride;
}

export interface StoreAssignment {
  storeName: string;
  ratio: number;
}

export interface EmployeeMapping {
  stores: StoreAssignment[]; // 適用開始月以降の按分先
  effectiveYear: number | null;
  effectiveMonth: number | null;
  baseStore: string | null; // 適用開始月より前に使う店舗
}

const ymIndex = (year: number, month: number) => year * 12 + (month - 1);

/** 社員番号の千の位から店舗を判定（2桁ID等・不明なら null） */
export function homeStoreFromId(empId: number): string | null {
  if (!Number.isFinite(empId) || empId < 1000) return null;
  const thousandDigit = Math.floor(empId / 1000);
  return THOUSAND_DIGIT_MAP[thousandDigit] ?? null;
}

/** 適用開始月より前に使う店舗を解決する（baseStore → 社員番号 → 按分先の先頭） */
function resolveBaseStore(mapping: EmployeeMapping, empId: number): string | null {
  return (
    mapping.baseStore ||
    homeStoreFromId(empId) ||
    mapping.stores[0]?.storeName ||
    null
  );
}

/**
 * ある月に対して、この従業員をどの店舗にどの比率で割り当てるかを返す。
 *  - 適用開始月以降（または適用開始月が未設定）→ マッピングの按分先
 *  - それより前 → 移転前の店舗1店舗100%（解決できなければ按分先のまま）
 */
export function assignmentsForMonth(
  mapping: EmployeeMapping,
  empId: number,
  year: number,
  month: number,
): StoreAssignment[] {
  const split = mapping.stores.filter((s) => s.ratio > 0);
  const hasEffective =
    mapping.effectiveYear != null && mapping.effectiveMonth != null;
  const applySplit =
    !hasEffective ||
    ymIndex(year, month) >=
      ymIndex(mapping.effectiveYear as number, mapping.effectiveMonth as number);

  if (applySplit) return split.length > 0 ? split : [];

  const base = resolveBaseStore(mapping, empId);
  if (base) return [{ storeName: base, ratio: 100 }];
  return split; // 移転前店舗を解決できない場合は按分をそのまま維持（消失させない）
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

/**
 * 従業員の全月の人件費を、与えられたマッピング（null＝店舗解除→homeへ）で再計算する。
 * 各月の既存行から100%換算の元値を1件取り出し、月ごとに割当を作り直す。
 * 呼び出し側で $transaction 内から呼ぶこと（tx を渡す）。
 */
export async function recomputeEmployeePayroll(
  tx: PayrollTx,
  empId: number,
  empIdStr: string,
  mapping: EmployeeMapping | null,
): Promise<number> {
  const rows = await tx.payrollData.findMany({
    where: { employeeId: empIdStr },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  if (rows.length === 0) return 0;

  // マッピングが無い（解除）場合は home 店舗1本に戻す
  const effMapping: EmployeeMapping =
    mapping ?? {
      stores: [],
      effectiveYear: null,
      effectiveMonth: null,
      baseStore: homeStoreFromId(empId),
    };

  // (year,month) ごとに 100%換算の元行を1件確保
  const baseByPeriod = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    if (!baseByPeriod.has(key)) baseByPeriod.set(key, r);
  }

  let created = 0;
  for (const [key, base] of baseByPeriod) {
    const [year, month] = key.split("-").map(Number);

    let assignments: StoreAssignment[];
    if (mapping === null) {
      const home = homeStoreFromId(empId) ?? base.storeName;
      assignments = [{ storeName: home, ratio: 100 }];
    } else {
      assignments = assignmentsForMonth(effMapping, empId, year, month);
      if (assignments.length === 0) {
        // 念のため：割当が空なら元の店舗を維持
        assignments = [{ storeName: base.storeName, ratio: 100 }];
      }
    }

    await tx.payrollData.deleteMany({ where: { employeeId: empIdStr, year, month } });
    await tx.payrollData.createMany({
      data: assignments.map((a) => ({
        year,
        month,
        employeeId: empIdStr,
        employeeName: base.employeeName,
        contractType: base.contractType,
        storeName: a.storeName,
        ratio: Math.round(a.ratio),
        workDaysWeekday: base.workDaysWeekday,
        workDaysHoliday: base.workDaysHoliday,
        workDaysLegalHoliday: base.workDaysLegalHoliday,
        scheduledHours: base.scheduledHours,
        overtimeHours: base.overtimeHours,
        baseSalary: base.baseSalary,
        positionAllowance: base.positionAllowance,
        overtimePay: base.overtimePay,
        commuteTaxable: base.commuteTaxable,
        commuteNontax: base.commuteNontax,
        taxableTotal: base.taxableTotal,
        grossTotal: base.grossTotal,
        healthInsuranceCo: base.healthInsuranceCo,
        careInsuranceCo: base.careInsuranceCo,
        pensionCo: base.pensionCo,
        childContributionCo: base.childContributionCo,
        pensionFundCo: base.pensionFundCo,
        employmentInsuranceCo: base.employmentInsuranceCo,
        workersCompCo: base.workersCompCo,
        generalContributionCo: base.generalContributionCo,
      })),
    });
    created += assignments.length;
  }
  return created;
}
