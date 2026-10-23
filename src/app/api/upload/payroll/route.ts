import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireAdminOrIngest } from "@/lib/auth";
import { INGEST_ROLE } from "@/lib/permissions";
import {
  checkPayrollHeader,
  isExcludedContractType,
  isHeadquartersEmployeeId,
  payrollIngestBlockReasons,
  previousMonth,
  readPayrollCompanyAmounts,
} from "@/lib/payroll-ingest";
import {
  decodeFileBuffer,
  parseCSV,
  safeFloat,
} from "@/lib/csv-utils";
import { homeStoreFromId, loadEmployeeMapping } from "@/lib/payroll-reallocate";
import {
  groupMonthlySplitsByEmployee,
  resolveAssignments,
  type StoreAssignment,
} from "@/lib/payroll-allocation";

interface UnresolvedEmployee {
  employeeId: string;
  employeeName: string;
  contractType: string;
  grossTotal: number;
}

/**
 * Resolve an employee ID to store assignments for a specific month.
 * 優先順位: その月の月別調整 ＞ マッピング（期間ごとの按分・期間外の店舗を考慮）＞ 社員番号ルール
 * 月別調整は CSV を再取込しても消えない（ここで毎回優先して適用する）。
 */
async function resolveStore(
  employeeId: string,
  year: number,
  month: number,
  monthlySplitsByEmp: Map<string, StoreAssignment[]>,
): Promise<StoreAssignment[]> {
  const monthlySplits = monthlySplitsByEmp.get(employeeId);
  const empId = parseInt(employeeId, 10);
  if (isNaN(empId)) {
    return resolveAssignments({ monthlySplits, mapping: null, homeStore: null, year, month });
  }
  const mapping = monthlySplits?.length ? null : await loadEmployeeMapping(prisma, empId);
  return resolveAssignments({
    monthlySplits,
    mapping,
    homeStore: homeStoreFromId(empId),
    year,
    month,
  });
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
    logError("Payroll check error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // admin（画面からの手動取込）または取込専用ロール ingest（GitHub Actions の月1自動取込）。
    // ingest は proxy.ts の許可リスト（POST/GET /api/upload/payroll）経由でのみ到達する。
    const auth = await requireAdminOrIngest();
    if (auth.error) return auth.error;
    const isIngest = auth.session.role === INGEST_ROLE;

    const formData = await request.formData();
    // dryRun=true: 解析と件数確認だけ行い、DB には一切書き込まない（応答は件数のみ・氏名を含めない）
    const dryRun = formData.get("dryRun") === "true";
    const file = formData.get("file") as File | null;
    const year = parseInt(formData.get("year") as string, 10);
    const month = parseInt(formData.get("month") as string, 10);

    if (!file || isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "file, year, month are required" },
        { status: 400 },
      );
    }

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
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

    // Skip header row（会社負担の列位置は見出しから引く。必須見出しが無い／重複なら headerCheck.ok=false）
    const headerCheck = checkPayrollHeader(allRows[0]);
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

    // この月の「月別調整」（従業員別明細で保存した按分）。マッピングより優先する。
    const monthlySplitsByEmp = groupMonthlySplitsByEmployee(
      await prisma.payrollMonthlySplit.findMany({
        where: { year, month },
        select: { year: true, month: true, employeeId: true, storeName: true, ratio: true },
      }),
    );

    const records: PayrollRecord[] = [];
    const unresolved: UnresolvedEmployee[] = [];
    // 業務用ダッシュボードに載せない人（役員／本部）の人数。氏名は持たない
    let excludedCount = 0;
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

      // 会社負担9項目は見出しから引いた列位置で読む（payroll-ingest.ts）。
      // 位置固定だと、クラウド給与の列増減（2026年4月支給分から97→99列）で別項目を取り込む。
      // 見出しが揃っていない場合は columns が null で、書き込まず後段で止める（下の headerCheck 参照）。
      const company = headerCheck.columns
        ? readPayrollCompanyAmounts(row, headerCheck.columns, safeFloat)
        : null;
      const {
        healthInsuranceCo = 0,
        careInsuranceCo = 0,
        pensionCo = 0,
        childContributionCo = 0,
        pensionFundCo = 0,
        employmentInsuranceCo = 0,
        workersCompCo = 0,
        generalContributionCo = 0,
      } = company ?? {};

      // 役員は店舗判定の前に除外（店舗未判定として数えない）
      if (isExcludedContractType(contractType)) {
        excludedCount++;
        continue;
      }

      let assignments = await resolveStore(empIdStr, year, month, monthlySplitsByEmp);

      // Fallback: use CSV section header (e.g. 【東日本橋スタジオ】)
      if (assignments.length === 0 && currentSectionStore) {
        assignments = [{ storeName: currentSectionStore, ratio: 100 }];
      }

      // 店舗が決まらず、番号が1000未満（社員番号ルール外）なら本部として除外。
      // 1000以上で決まらない人は従来どおり店舗未判定（停止条件）。
      if (assignments.length === 0 && isHeadquartersEmployeeId(empIdStr)) {
        excludedCount++;
        continue;
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
        // 【重要】各フィールドには「100%換算（CSV原本そのまま）」の値を保存し、
        // ratio は別フィールドで保持する。集計側 (dashboard/route.ts) で
        // value × (ratio/100) を行う仕様に統一。
        //
        // 旧実装は applyRatio(value, r) で「按分済みの値」を保存していたが、
        // 集計側でも ratio を掛けるため二重 ratio バグになっていた。
        // ratio=100 の従業員は影響ゼロ（× 1.0 × 1.0 = ×1）だが、
        // 按分対象の従業員（例: 渡邉さん）は本来の値の (ratio/100) 倍に
        // 過小集計されていた。
        records.push({
          year,
          month,
          employeeId: empIdStr,
          employeeName: empName,
          contractType,
          storeName: assignment.storeName,
          ratio: r,
          workDaysWeekday,
          workDaysHoliday,
          scheduledHours,
          overtimeHours,
          baseSalary,
          positionAllowance,
          overtimePay,
          commuteTaxable,
          commuteNontax,
          taxableTotal,
          grossTotal,
          healthInsuranceCo,
          careInsuranceCo,
          pensionCo,
          childContributionCo,
          pensionFundCo,
          employmentInsuranceCo,
          workersCompCo,
          generalContributionCo,
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
    const csvEmpIdNums = [...csvEmployees.keys()].map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
    const existingOverrides = [
      ...(await prisma.storeOverride.findMany({
        where: { employeeId: { in: csvEmpIdNums } },
        select: { employeeId: true, employeeName: true },
      })),
      ...(await prisma.storeOverridePeriod.findMany({
        where: { employeeId: { in: csvEmpIdNums } },
        select: { employeeId: true, employeeName: true },
      })),
    ];

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

    // 自動取込（ingest）と dryRun は、氏名を返さず件数だけで判定する。
    // ingest は「止める条件」に1つでも当たれば書き込まない（上書き・氏名の強制変更・取りこぼしをしない）。
    if (dryRun || isIngest) {
      const prev = previousMonth(year, month);
      const [existingCount, previousCount] = await Promise.all([
        prisma.payrollData.count({ where: { year, month } }),
        prisma.payrollData.count({ where: { year: prev.year, month: prev.month } }),
      ]);
      const facts = {
        records: records.length,
        headerOk: headerCheck.ok,
        nameConflictCount: nameConflicts.length,
        unresolvedCount: unresolved.length,
        excludedCount,
        existingCount,
        previousCount,
      };
      const blockReasons = isIngest ? payrollIngestBlockReasons(facts) : [];
      const summary = {
        dryRun,
        year,
        month,
        ...facts,
        employees: csvEmployees.size,
        headerMismatches: headerCheck.mismatches,
        blocked: blockReasons.length > 0,
        blockReasons,
      };
      if (dryRun) return NextResponse.json(summary);
      if (blockReasons.length > 0) return NextResponse.json(summary, { status: 409 });
    }

    // 会社負担の見出しが揃っていないCSVは書き込まない（手動取込でも。0円で上書きしてしまうのを防ぐ）。
    // 応答には見出し名だけを入れる（個人情報は入らない）。
    if (!headerCheck.columns) {
      return NextResponse.json(
        {
          error: "CSVの見出しに必要な会社負担の列が見つからない（または重複している）ため取り込みを止めました",
          headerMismatches: headerCheck.mismatches,
        },
        { status: 400 },
      );
    }

    // If there are name conflicts and no override flag, return conflicts for user to resolve
    // （ingest はここに来る時点で氏名不一致0件。forceNames / nameResolutions は ingest では使わない）
    const forceNames = !isIngest && formData.get("forceNames") === "true";
    if (nameConflicts.length > 0 && !forceNames) {
      return NextResponse.json({
        records: 0,
        unresolved,
        excludedCount,
        nameConflicts,
        needsConfirmation: true,
      });
    }

    // Apply name resolutions if provided
    const nameResolutionsRaw = isIngest ? null : (formData.get("nameResolutions") as string | null);
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
          userId: auth.session.userId,
          userName: auth.session.displayName || auth.session.storeName || "ユーザー",
          dataType: "payroll",
          year,
          month,
          fileName: file.name,
          recordCount: records.length,
          note: isIngest
            ? "自動取込（クラウド給与）"
            : unresolved.length > 0
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
      await prisma.storeOverridePeriod.updateMany({
        where: { employeeId: empIdNum, employeeName: "" },
        data: { employeeName: csvName },
      });
    }

    if (isIngest) {
      // 自動取込の応答は件数だけ（Actions のログに氏名を残さない）
      return NextResponse.json({ records: records.length, employees: csvEmployees.size, excludedCount, year, month });
    }
    return NextResponse.json({
      records: records.length,
      unresolved,
      excludedCount,
      nameConflicts: [],
    });
  } catch (error) {
    logError("Payroll upload error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
