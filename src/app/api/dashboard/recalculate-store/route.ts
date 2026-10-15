import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { homeStoreFromId } from "@/lib/payroll-reallocate";
import {
  groupMonthlySplits,
  periodKey,
  resolveAssignments,
  type EmployeeMapping,
  type StoreAssignment,
} from "@/lib/payroll-allocation";

/**
 * Recalculate store assignments for existing payroll data.
 * 優先順位: その月の月別調整 ＞ store_overrides（適用開始月・移転前店舗を考慮）＞ 社員番号ルール
 * （月別調整がある月は、この再計算でも上書きしない）
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { year, month, allMonths } = body;

    if (!year) {
      return NextResponse.json({ error: "year is required" }, { status: 400 });
    }

    // Get payroll records — all months or specific month
    const whereClause = allMonths ? { year } : { year, month };
    const payrollRows = await prisma.payrollData.findMany({
      where: whereClause,
    });

    if (payrollRows.length === 0) {
      return NextResponse.json({ updated: 0, message: "データがありません" });
    }

    // Get all store overrides（従業員ごとのマッピング。適用開始月・移転前店舗も保持）
    const overrides = await prisma.storeOverride.findMany();
    const mappingByEmp = new Map<number, EmployeeMapping>();
    for (const o of overrides) {
      const m = mappingByEmp.get(o.employeeId);
      if (m) {
        m.stores.push({ storeName: o.storeName, ratio: o.ratio });
      } else {
        mappingByEmp.set(o.employeeId, {
          stores: [{ storeName: o.storeName, ratio: o.ratio }],
          effectiveYear: o.effectiveYear ?? null,
          effectiveMonth: o.effectiveMonth ?? null,
          baseStore: o.baseStore ?? null,
        });
      }
    }

    // 月別調整（その月だけの按分）。再計算でも優先して残す。
    const splitRows = await prisma.payrollMonthlySplit.findMany({
      where: whereClause,
      select: { year: true, month: true, employeeId: true, storeName: true, ratio: true },
    });
    const splitsByEmpPeriod = new Map<string, Map<string, StoreAssignment[]>>();
    for (const empId of new Set(splitRows.map((r) => r.employeeId))) {
      splitsByEmpPeriod.set(
        empId,
        groupMonthlySplits(splitRows.filter((r) => r.employeeId === empId)),
      );
    }

    // Group by employee + month for correct per-month handling
    const empMonthGroups = new Map<string, typeof payrollRows>();
    for (const row of payrollRows) {
      const key = `${row.employeeId}__${row.year}_${row.month}`;
      const list = empMonthGroups.get(key) || [];
      list.push(row);
      empMonthGroups.set(key, list);
    }

    // Rebuild records with correct store assignments inside a transaction
    const result = await prisma.$transaction(async (tx) => {
      let updated = 0;
      let deleted = 0;

      for (const [, rows] of empMonthGroups) {
        const empId = rows[0].employeeId;
        const rowYear = rows[0].year;
        const rowMonth = rows[0].month;
        const empIdNum = parseInt(empId, 10);

        // Determine assignments（月別調整 ＞ マッピング ＞ 社員番号ルール）
        const assignments = resolveAssignments({
          monthlySplits: splitsByEmpPeriod.get(empId)?.get(periodKey(rowYear, rowMonth)),
          mapping: isNaN(empIdNum) ? null : (mappingByEmp.get(empIdNum) ?? null),
          homeStore: isNaN(empIdNum) ? null : homeStoreFromId(empIdNum),
          year: rowYear,
          month: rowMonth,
        });

        if (assignments.length === 0) continue;

        // 【重要】PayrollData の各フィールドは 100%換算（CSV原本そのまま）の値が保存されている。
        // すべての行が同じ 100%換算値を持つため、最初の1行をそのまま再利用すれば良い。
        // （旧実装は applyRatio 済みデータを想定して reduce(sum) していたが、新仕様では行ごとに
        //   完全な値が入っているので合算すると n 倍になってバグる）
        const baseRow = rows[0];

        // Delete old rows for this employee/month
        await tx.payrollData.deleteMany({
          where: { year: rowYear, month: rowMonth, employeeId: empId },
        });
        deleted += rows.length;

        // Create new rows — 値は 100%換算のまま、ratio だけ assign の値で保存。
        // 集計時に dashboard 側で value × (ratio/100) を行う仕様。
        for (const assign of assignments) {
          await tx.payrollData.create({
            data: {
              year: rowYear,
              month: rowMonth,
              employeeId: empId,
              employeeName: baseRow.employeeName,
              contractType: baseRow.contractType,
              storeName: assign.storeName,
              ratio: assign.ratio,
              workDaysWeekday: baseRow.workDaysWeekday,
              workDaysHoliday: baseRow.workDaysHoliday,
              workDaysLegalHoliday: baseRow.workDaysLegalHoliday,
              scheduledHours: baseRow.scheduledHours,
              overtimeHours: baseRow.overtimeHours,
              baseSalary: baseRow.baseSalary,
              positionAllowance: baseRow.positionAllowance,
              overtimePay: baseRow.overtimePay,
              commuteTaxable: baseRow.commuteTaxable,
              commuteNontax: baseRow.commuteNontax,
              taxableTotal: baseRow.taxableTotal,
              grossTotal: baseRow.grossTotal,
              healthInsuranceCo: baseRow.healthInsuranceCo,
              careInsuranceCo: baseRow.careInsuranceCo,
              pensionCo: baseRow.pensionCo,
              childContributionCo: baseRow.childContributionCo,
              pensionFundCo: baseRow.pensionFundCo,
              employmentInsuranceCo: baseRow.employmentInsuranceCo,
              workersCompCo: baseRow.workersCompCo,
              generalContributionCo: baseRow.generalContributionCo,
            },
          });
          updated++;
        }
      }

      return { updated, deleted };
    });

    return NextResponse.json({
      updated: result.updated,
      deleted: result.deleted,
      employees: empMonthGroups.size,
    });
  } catch (error) {
    logError("Recalculate store error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
