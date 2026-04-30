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
    if (session.role !== "admin") {
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
    }));

    return NextResponse.json({ employees });
  } catch (error) {
    console.error("Payroll detail API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
