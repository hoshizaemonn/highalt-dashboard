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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year") || "", 10);
    const month = parseInt(searchParams.get("month") || "", 10);

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year, month are required" },
        { status: 400 },
      );
    }

    const count = await prisma.payrollData.count({
      where: { year, month },
    });

    return NextResponse.json({
      exists: count > 0,
      count,
    });
  } catch (error) {
    console.error("Payroll check error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
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

    // Store name mapping from CSV section headers like 【東日本橋スタジオ】
    const SECTION_STORE_MAP: Record<string, string> = {
      "東日本橋": "東日本橋", "春日": "春日", "船橋": "船橋",
      "巣鴨": "巣鴨", "祖師ヶ谷大蔵": "祖師ヶ谷大蔵",
      "下北沢": "下北沢", "中目黒": "中目黒", "東陽町": "東陽町",
      "本部": "本部（除外）",
    };

    function detectStoreFromSection(header: string): string | null {
      const cleaned = header.replace(/[【】\s]/g, "").replace("ハイアルチ", "").replace("スタジオ", "");
      for (const [key, store] of Object.entries(SECTION_STORE_MAP)) {
        if (cleaned.includes(key)) return store;
      }
      return null;
    }

    const records: PayrollRecord[] = [];
    const unresolved: UnresolvedEmployee[] = [];
    let currentSectionStore: string | null = null;

    for (const row of dataRows) {
      if (row.length < 10) continue;

      const empIdStr = row[0]?.trim() || "";

      // Track section headers like 【東日本橋スタジオ】
      if (empIdStr.startsWith("【")) {
        currentSectionStore = detectStoreFromSection(empIdStr);
        continue;
      }

      if (!empIdStr) continue;

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

      let assignments = await resolveStore(empIdStr);

      // Fallback: use CSV section header (e.g. 【東日本橋スタジオ】)
      if (assignments.length === 0 && currentSectionStore) {
        assignments = [{ storeName: currentSectionStore, ratio: 100 }];
      }

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

    // Check for name conflicts with existing data
    interface NameConflict {
      employeeId: string;
      csvName: string;
      existingName: string;
    }
    const nameConflicts: NameConflict[] = [];

    // Collect unique employees from this CSV
    const csvEmployees = new Map<string, string>();
    for (const rec of records) {
      if (rec.employeeName && !csvEmployees.has(rec.employeeId)) {
        csvEmployees.set(rec.employeeId, rec.employeeName);
      }
    }

    // Check against existing payroll_data and store_overrides
    const existingPayroll = await prisma.payrollData.findMany({
      where: { employeeId: { in: [...csvEmployees.keys()] } },
      select: { employeeId: true, employeeName: true },
      distinct: ["employeeId"],
    });
    const existingOverrides = await prisma.storeOverride.findMany({
      where: { employeeId: { in: [...csvEmployees.keys()].map((id) => parseInt(id, 10)).filter((n) => !isNaN(n)) } },
      select: { employeeId: true, employeeName: true },
    });

    // Build existing name map (prefer override name, fallback to payroll)
    const existingNameMap = new Map<string, string>();
    for (const p of existingPayroll) {
      if (p.employeeName) existingNameMap.set(p.employeeId, p.employeeName);
    }
    for (const o of existingOverrides) {
      if (o.employeeName) existingNameMap.set(String(o.employeeId), o.employeeName);
    }

    for (const [empId, csvName] of csvEmployees) {
      const existingName = existingNameMap.get(empId);
      if (existingName && existingName !== csvName) {
        nameConflicts.push({ employeeId: empId, csvName, existingName });
      }
    }

    // If there are name conflicts and no override flag, return conflicts for user to resolve
    const forceNames = formData.get("forceNames") === "true";
    if (nameConflicts.length > 0 && !forceNames) {
      return NextResponse.json({
        records: 0,
        unresolved,
        nameConflicts,
        needsConfirmation: true,
      });
    }

    // Apply name resolutions if provided
    const nameResolutionsRaw = formData.get("nameResolutions") as string | null;
    if (nameResolutionsRaw) {
      try {
        const resolutions = JSON.parse(nameResolutionsRaw) as Record<string, string>;
        for (const rec of records) {
          if (resolutions[rec.employeeId]) {
            rec.employeeName = resolutions[rec.employeeId];
          }
        }
      } catch { /* ignore parse errors */ }
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

    // Update store_overrides names if CSV has newer names
    for (const [empId, csvName] of csvEmployees) {
      const empIdNum = parseInt(empId, 10);
      if (isNaN(empIdNum)) continue;
      await prisma.storeOverride.updateMany({
        where: { employeeId: empIdNum, employeeName: "" },
        data: { employeeName: csvName },
      });
    }

    return NextResponse.json({
      records: records.length,
      unresolved,
      nameConflicts: [],
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
