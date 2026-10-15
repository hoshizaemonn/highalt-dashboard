import { canViewAllStores } from "@/lib/permissions";
import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "not authenticated" },
        { status: 401 },
      );
    }

    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const storeParam = searchParams.get("store");

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    // 従業員別明細は admin のみ閲覧可
    // （安蒜さんの依頼により、自店店長にも非表示にする変更）
    if (!canViewAllStores(session.role)) {
      return NextResponse.json({ employees: [] });
    }

    // Fetch employee records for the specified store/month
    const where = {
      year,
      month,
      ...(storeParam && storeParam !== "全体" && { storeName: storeParam }),
    };

    const rows = await prisma.payrollData.findMany({
      where,
      orderBy: [{ storeName: "asc" }, { employeeId: "asc" }],
    });

    // この月に「月別調整」が保存されている従業員（画面に「月別調整中」と解除ボタンを出す）
    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const splitRows =
      employeeIds.length > 0
        ? await prisma.payrollMonthlySplit.findMany({
            where: { year, month, employeeId: { in: employeeIds } },
            select: { employeeId: true },
          })
        : [];
    const adjusted = new Set(splitRows.map((r) => r.employeeId));

    const employees = rows.map((row) => ({
      employeeId: row.employeeId,
      employeeName: row.employeeName ?? "",
      contractType: row.contractType ?? "",
      baseSalary: row.baseSalary,
      positionAllowance: row.positionAllowance,
      overtimePay: row.overtimePay,
      commuteTaxable: row.commuteTaxable,
      commuteNontax: row.commuteNontax,
      taxableTotal: row.taxableTotal,
      grossTotal: row.grossTotal,
      scheduledHours: row.scheduledHours,
      overtimeHours: row.overtimeHours,
      ratio: row.ratio,
      storeName: row.storeName,
      monthlySplit: adjusted.has(row.employeeId),
    }));

    return NextResponse.json({ employees });
  } catch (error) {
    logError("Payroll detail API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
