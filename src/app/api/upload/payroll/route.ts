import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";
import {
  decodeFileBuffer,
  parseCSV,
  safeFloat,
  applyRatio,
} from "@/lib/csv-utils";

interface StoreAssignment {
  storeName: string;
  ratio: number;
}

interface UnresolvedEmployee {
  employeeId: string;
  employeeName: string;
  contractType: string;
  grossTotal: number;
}

/**
 * Resolve an employee ID to store assignments.
 * 1. Check store_overrides table
 * 2. Fall back to thousand-digit rule
 */
async function resolveStore(employeeId: string): Promise<StoreAssignment[]> {
  const empId = parseInt(employeeId, 10);
  if (isNaN(empId)) return [];

  // 1. Check override table
  const overrides = await prisma.storeOverride.findMany({
    where: { employeeId: empId },
  });

  if (overrides.length > 0) {
    return overrides.map((o) => ({
      storeName: o.storeName,
      ratio: o.ratio,
    }));
  }

  // 2. Thousand-digit rule
  if (empId >= 1000) {
    const thousandDigit = Math.floor(empId / 1000);
    const store = THOUSAND_DIGIT_MAP[thousandDigit];
    if (store) {
      return [{ storeName: store, ratio: 100 }];
    }
  }

  return [];
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const year = parseInt(formData.get("year") as string, 10);
    const month = parseInt(formData.get("month") as string, 10);

    if (!file || isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "file, year, month are required" },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const text = decodeFileBuffer(buffer, "shift_jis");
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return NextResponse.json(
        { error: "CSVにデータ行がありません" },
        { status: 400 },
      );
    }

    // Skip header row
    const dataRows = allRows.slice(1);

    interface PayrollRecord {
      year: number;
      month: number;
      employeeId: string;
      employeeName: string;
      contractType: string;
      storeName: string;
      ratio: number;
      workDaysWeekday: number;
      workDaysHoliday: number;
      scheduledHours: number;
      overtimeHours: number;
      
      
      baseSalary: number;
      positionAllowance: number;
      overtimePay: number;
      commuteTaxable: number;
      commuteNontax: number;
      taxableTotal: number;
      grossTotal: number;
      healthInsuranceCo: number;
      careInsuranceCo: number;
      pensionCo: number;
      childContributionCo: number;
      pensionFundCo: number;
      employmentInsuranceCo: number;
      workersCompCo: number;
      generalContributionCo: number;
    }

    const records: PayrollRecord[] = [];
    const unresolved: UnresolvedEmployee[] = [];

    for (const row of dataRows) {
      if (row.length < 10) continue;

      const empIdStr = row[0]?.trim() || "";
      if (!empIdStr || empIdStr.startsWith("【")) continue;

      const empName = row[1]?.trim() || "";
      if (empName === "-") continue;

      const contractType = row[5]?.trim() || "";

      const col = (idx: number) =>
        safeFloat(idx < row.length ? row[idx] : undefined);

      const workDaysWeekday = col(6);
      const workDaysHoliday = col(7);
      const scheduledHours = col(12);

      // Overtime hours = sum of columns 15-23
      let overtimeHours = 0;
      for (let c = 15; c < 24; c++) {
        overtimeHours += col(c);
      }

      const baseSalary = col(27);
      const positionAllowance = col(28);
      const overtimePay = col(32);
      const commuteTaxable = col(44);
      const commuteNontax = col(45);
      const taxableTotal = col(51);
      const grossTotal = col(55);

      const healthInsuranceCo = col(89);
      const careInsuranceCo = col(90);
      const pensionCo = col(91);
      const childContributionCo = col(92);
      const pensionFundCo = col(93);
      const employmentInsuranceCo = col(94);
      const workersCompCo = col(95);
      const generalContributionCo = col(96);

      const assignments = await resolveStore(empIdStr);

      if (assignments.length === 0) {
        unresolved.push({
          employeeId: empIdStr,
          employeeName: empName,
          contractType,
          grossTotal,
        });
        continue;
      }

      for (const assignment of assignments) {
        const r = assignment.ratio;
        records.push({
          year,
          month,
          employeeId: empIdStr,
          employeeName: empName,
          contractType,
          storeName: assignment.storeName,
          ratio: r,
          workDaysWeekday: applyRatio(workDaysWeekday, r),
          workDaysHoliday: applyRatio(workDaysHoliday, r),
          scheduledHours: applyRatio(scheduledHours, r),
          overtimeHours: applyRatio(overtimeHours, r),
          
          
          baseSalary: applyRatio(baseSalary, r),
          positionAllowance: applyRatio(positionAllowance, r),
          overtimePay: applyRatio(overtimePay, r),
          commuteTaxable: applyRatio(commuteTaxable, r),
          commuteNontax: applyRatio(commuteNontax, r),
          taxableTotal: applyRatio(taxableTotal, r),
          grossTotal: applyRatio(grossTotal, r),
          healthInsuranceCo: applyRatio(healthInsuranceCo, r),
          careInsuranceCo: applyRatio(careInsuranceCo, r),
          pensionCo: applyRatio(pensionCo, r),
          childContributionCo: applyRatio(childContributionCo, r),
          pensionFundCo: applyRatio(pensionFundCo, r),
          employmentInsuranceCo: applyRatio(employmentInsuranceCo, r),
          workersCompCo: applyRatio(workersCompCo, r),
          generalContributionCo: applyRatio(generalContributionCo, r),
        });
      }
    }

    // Delete existing payroll data for this year/month, then insert
    await prisma.$transaction(async (tx) => {
      await tx.payrollData.deleteMany({ where: { year, month } });

      if (records.length > 0) {
        await tx.payrollData.createMany({ data: records });
      }

      // Create upload log
      await tx.uploadLog.create({
        data: {
          userId: session.userId,
          userName: session.displayName || session.storeName || "ユーザー",
          dataType: "payroll",
          year,
          month,
          fileName: file.name,
          recordCount: records.length,
          note: unresolved.length > 0
            ? `未登録従業員 ${unresolved.length}名`
            : null,
        },
      });
    });

    return NextResponse.json({
      records: records.length,
      unresolved,
    });
  } catch (error) {
    console.error("Payroll upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
