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
    const { year, month } = body;

    if (!year || !month) {
      return NextResponse.json({ error: "year and month are required" }, { status: 400 });
    }

    // Get all payroll records for this month
    const payrollRows = await prisma.payrollData.findMany({
      where: { year, month },
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

    // Group payroll by employee
    const empGroups = new Map<string, typeof payrollRows>();
    for (const row of payrollRows) {
      const list = empGroups.get(row.employeeId) || [];
      list.push(row);
      empGroups.set(row.employeeId, list);
    }

    // Rebuild records with correct store assignments
    let updated = 0;
    let deleted = 0;

    for (const [empId, rows] of empGroups) {
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

      // Take the first row as the "original" data (full amounts before ratio)
      // We need to reconstruct from total amounts
      // Sum up all existing rows for this employee to get the full amount
      const sumRow = {
        employeeName: rows[0].employeeName,
        contractType: rows[0].contractType,
        workDaysWeekday: rows.reduce((s, r) => s + r.workDaysWeekday, 0),
        workDaysHoliday: rows.reduce((s, r) => s + r.workDaysHoliday, 0),
        workDaysLegalHoliday: rows.reduce((s, r) => s + r.workDaysLegalHoliday, 0),
        scheduledHours: rows.reduce((s, r) => s + r.scheduledHours, 0),
        overtimeHours: rows.reduce((s, r) => s + r.overtimeHours, 0),
        baseSalary: rows.reduce((s, r) => s + r.baseSalary, 0),
        positionAllowance: rows.reduce((s, r) => s + r.positionAllowance, 0),
        overtimePay: rows.reduce((s, r) => s + r.overtimePay, 0),
        commuteTaxable: rows.reduce((s, r) => s + r.commuteTaxable, 0),
        commuteNontax: rows.reduce((s, r) => s + r.commuteNontax, 0),
        taxableTotal: rows.reduce((s, r) => s + r.taxableTotal, 0),
        grossTotal: rows.reduce((s, r) => s + r.grossTotal, 0),
        healthInsuranceCo: rows.reduce((s, r) => s + r.healthInsuranceCo, 0),
        careInsuranceCo: rows.reduce((s, r) => s + r.careInsuranceCo, 0),
        pensionCo: rows.reduce((s, r) => s + r.pensionCo, 0),
        childContributionCo: rows.reduce((s, r) => s + r.childContributionCo, 0),
        pensionFundCo: rows.reduce((s, r) => s + r.pensionFundCo, 0),
        employmentInsuranceCo: rows.reduce((s, r) => s + r.employmentInsuranceCo, 0),
        workersCompCo: rows.reduce((s, r) => s + r.workersCompCo, 0),
        generalContributionCo: rows.reduce((s, r) => s + r.generalContributionCo, 0),
      };

      // Delete old rows for this employee/month
      await prisma.payrollData.deleteMany({
        where: { year, month, employeeId: empId },
      });
      deleted += rows.length;

      // Create new rows with correct assignments
      for (const assign of assignments) {
        const r = assign.ratio / 100;
        await prisma.payrollData.create({
          data: {
            year,
            month,
            employeeId: empId,
            employeeName: sumRow.employeeName,
            contractType: sumRow.contractType,
            storeName: assign.storeName,
            ratio: assign.ratio,
            workDaysWeekday: sumRow.workDaysWeekday * r,
            workDaysHoliday: sumRow.workDaysHoliday * r,
            workDaysLegalHoliday: sumRow.workDaysLegalHoliday * r,
            scheduledHours: sumRow.scheduledHours * r,
            overtimeHours: sumRow.overtimeHours * r,
            baseSalary: sumRow.baseSalary * r,
            positionAllowance: sumRow.positionAllowance * r,
            overtimePay: sumRow.overtimePay * r,
            commuteTaxable: sumRow.commuteTaxable * r,
            commuteNontax: sumRow.commuteNontax * r,
            taxableTotal: sumRow.taxableTotal * r,
            grossTotal: sumRow.grossTotal * r,
            healthInsuranceCo: sumRow.healthInsuranceCo * r,
            careInsuranceCo: sumRow.careInsuranceCo * r,
            pensionCo: sumRow.pensionCo * r,
            childContributionCo: sumRow.childContributionCo * r,
            pensionFundCo: sumRow.pensionFundCo * r,
            employmentInsuranceCo: sumRow.employmentInsuranceCo * r,
            workersCompCo: sumRow.workersCompCo * r,
            generalContributionCo: sumRow.generalContributionCo * r,
          },
        });
        updated++;
      }
    }

    return NextResponse.json({
      updated,
      deleted,
      employees: empGroups.size,
    });
  } catch (error) {
    console.error("Recalculate store error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
