import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STORES } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const yearParam = searchParams.get("year");
    const monthsParam = searchParams.get("months");

    if (!yearParam && !monthsParam) {
      return NextResponse.json(
        { error: "year or months parameter is required" },
        { status: 400 },
      );
    }

    // Parse year-month pairs
    type YearMonth = { year: number; month: number };
    const periods: YearMonth[] = [];

    if (monthsParam) {
      // "2025-10,2025-11,...,2026-09"
      for (const part of monthsParam.split(",")) {
        const [y, m] = part.trim().split("-").map(Number);
        if (!isNaN(y) && !isNaN(m)) {
          periods.push({ year: y, month: m });
        }
      }
    } else {
      const year = parseInt(yearParam!, 10);
      for (let m = 1; m <= 12; m++) {
        periods.push({ year, month: m });
      }
    }

    if (periods.length === 0) {
      return NextResponse.json(
        { error: "No valid year-month periods provided" },
        { status: 400 },
      );
    }

    const years = [...new Set(periods.map((p) => p.year))];

    // Fetch all data
    const [allPayroll, allExpenses, allSalesDetail, allRevenue, allSquare, allMonthlySummary] =
      await Promise.all([
        prisma.payrollData.findMany({ where: { year: { in: years } } }),
        prisma.expenseData.findMany({ where: { year: { in: years }, isRevenue: 0 } }),
        prisma.salesDetail.findMany({ where: { year: { in: years } } }),
        prisma.revenueData.findMany({ where: { year: { in: years } } }),
        prisma.squareSales.findMany({ where: { year: { in: years } } }),
        prisma.monthlySummary.findMany({
          where: { year: { in: years } },
          orderBy: [{ year: "desc" }, { month: "desc" }],
        }),
      ]);

    const isInPeriod = (y: number, m: number) =>
      periods.some((p) => p.year === y && p.month === m);

    const storeData = STORES.map((storeName) => {
      // Revenue
      const sales = allSalesDetail.filter(
        (r) => r.storeName === storeName && isInPeriod(r.year, r.month),
      );
      const rev = allRevenue.filter(
        (r) => r.storeName === storeName && isInPeriod(r.year, r.month),
      );
      const sq = allSquare.filter(
        (r) => r.storeName === storeName && isInPeriod(r.year, r.month),
      );

      const squareTotal = sq.reduce((s, r) => s + r.grossSales, 0);
      let salesTotal = 0;
      if (sales.length > 0) {
        salesTotal = sales.reduce((s, r) => s + r.amount, 0);
      } else {
        salesTotal = rev.reduce((s, r) => s + r.amount, 0);
      }
      const totalRevenue = salesTotal + squareTotal;

      // Labor
      const payroll = allPayroll.filter(
        (r) => r.storeName === storeName && isInPeriod(r.year, r.month),
      );
      const totalLabor = payroll.reduce(
        (s, r) => s + r.grossTotal * (r.ratio / 100),
        0,
      );

      // Expenses
      const expenses = allExpenses.filter(
        (r) => r.storeName === storeName && isInPeriod(r.year, r.month),
      );
      const totalExpense = expenses.reduce((s, r) => s + r.amount, 0);

      // Member summary - latest record for this store
      const ms = allMonthlySummary.find((r) => r.storeName === storeName);

      return {
        store: storeName,
        revenue: Math.round(totalRevenue),
        labor: Math.round(totalLabor),
        expense: Math.round(totalExpense),
        profit: Math.round(totalRevenue - totalLabor - totalExpense),
        plan_subscribers: ms?.planSubscribers ?? 0,
        cancellation_rate: ms?.cancellationRate ?? "",
      };
    });

    return NextResponse.json({
      periods: periods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
      stores: storeData,
    });
  } catch (error) {
    console.error("Store compare API error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
