import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";

/**
 * Recalculate store assignments for existing payroll data
 * based on the latest store_overrides + thousand-digit rule.
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

    // Get all store overrides
    const overrides = await prisma.storeOverride.findMany();
    const overrideMap = new Map<number, { storeName: string; ratio: number }[]>();
    for (const o of overrides) {
      const list = overrideMap.get(o.employeeId) || [];
      list.push({ storeName: o.storeName, ratio: o.ratio });
      overrideMap.set(o.employeeId, list);
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

        // Determine assignments
        let assignments: { storeName: string; ratio: number }[] = [];

        // 1. Check overrides
        if (!isNaN(empIdNum) && overrideMap.has(empIdNum)) {
          assignments = overrideMap.get(empIdNum)!;
        }
        // 2. Thousand-digit rule
        else if (!isNaN(empIdNum) && empIdNum >= 1000) {
          const thousandDigit = Math.floor(empIdNum / 1000);
          const store = THOUSAND_DIGIT_MAP[thousandDigit];
          if (store) {
            assignments = [{ storeName: store, ratio: 100 }];
          }
        }

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
    console.error("Recalculate store error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
