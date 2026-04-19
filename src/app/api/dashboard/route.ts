import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HQ_STORE } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const monthParam = searchParams.get("month");
    const storeParam = searchParams.get("store");

    if (isNaN(year)) {
      return NextResponse.json(
        { error: "year is required and must be a number" },
        { status: 400 },
      );
    }

    const month = monthParam ? parseInt(monthParam, 10) : undefined;
    const store = storeParam || undefined;

    // ── Payroll ──────────────────────────────────────────────
    const storeFilter = store && store !== "全体"
      ? { storeName: store }
      : { storeName: { not: HQ_STORE } };
    const payrollWhere = {
      year,
      ...(month !== undefined && { month }),
      ...storeFilter,
    };

    const payrollRows = await prisma.payrollData.findMany({
      where: payrollWhere,
    });

    let fulltimeGross = 0;
    let parttimeGross = 0;
    let totalLaborCost = 0;
    let totalHours = 0;
    let legalWelfare = 0;
    let totalBaseSalary = 0;
    let totalPositionAllowance = 0;
    let totalOvertimePay = 0;
    let totalCommute = 0;
    let totalTaxableTotal = 0;
    const employeeIds = new Set<string>();
    let fulltimeCount = 0;
    let parttimeCount = 0;

    for (const row of payrollRows) {
      const ratio = row.ratio / 100;
      const gross = row.grossTotal * ratio;
      totalLaborCost += gross;

      totalBaseSalary += row.baseSalary * ratio;
      totalPositionAllowance += row.positionAllowance * ratio;
      totalOvertimePay += row.overtimePay * ratio;
      totalCommute += (row.commuteTaxable + row.commuteNontax) * ratio;
      totalTaxableTotal += row.taxableTotal * ratio;

      const hours =
        (row.scheduledHours + row.overtimeHours) * ratio;
      totalHours += hours;

      const welfare =
        (row.healthInsuranceCo +
          row.careInsuranceCo +
          row.pensionCo +
          row.childContributionCo +
          row.pensionFundCo +
          row.employmentInsuranceCo +
          row.workersCompCo +
          row.generalContributionCo) *
        ratio;
      legalWelfare += welfare;

      if (!employeeIds.has(row.employeeId)) {
        employeeIds.add(row.employeeId);
        if (row.contractType === "正社員") {
          fulltimeCount++;
        } else {
          parttimeCount++;
        }
      }

      if (row.contractType === "正社員") {
        fulltimeGross += gross;
      } else {
        parttimeGross += gross;
      }
    }

    const payrollSummary = {
      total_labor_cost: Math.round(totalLaborCost),
      fulltime_gross: Math.round(fulltimeGross),
      parttime_gross: Math.round(parttimeGross),
      base_salary: Math.round(totalBaseSalary),
      position_allowance: Math.round(totalPositionAllowance),
      overtime_pay: Math.round(totalOvertimePay),
      commute: Math.round(totalCommute),
      taxable_total: Math.round(totalTaxableTotal),
      total_hours: Math.round(totalHours * 10) / 10,
      employee_count: employeeIds.size,
      fulltime_count: fulltimeCount,
      parttime_count: parttimeCount,
      legal_welfare: Math.round(legalWelfare),
    };

    // ── Expenses ─────────────────────────────────────────────
    const expenseWhere = {
      year,
      ...(month !== undefined && { month }),
      ...(store && { storeName: store }),
      isRevenue: 0,
    };

    const expenseRows = await prisma.expenseData.findMany({
      where: expenseWhere,
    });

    const expenseByCategory: Record<string, number> = {};
    let totalExpense = 0;

    for (const row of expenseRows) {
      const cat = row.category || "その他";
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + row.amount;
      totalExpense += row.amount;
    }

    const expenseSummary = {
      total: Math.round(totalExpense),
      by_category: expenseByCategory,
    };

    // ── Revenue / Sales ──────────────────────────────────────
    const commonWhere = {
      year,
      ...(month !== undefined && { month }),
      ...(store && { storeName: store }),
    };

    const salesDetailRows = await prisma.salesDetail.findMany({
      where: commonWhere,
    });

    const revenueRows = await prisma.revenueData.findMany({
      where: commonWhere,
    });

    const squareRows = await prisma.squareSales.findMany({
      where: commonWhere,
    });

    const squareTotal = squareRows.reduce((s, r) => s + r.grossSales, 0);

    let salesTotal = 0;
    const salesByCategory: Record<string, number> = {};

    if (salesDetailRows.length > 0) {
      for (const row of salesDetailRows) {
        const cat = row.category || "その他";
        salesByCategory[cat] = (salesByCategory[cat] || 0) + row.amount;
        salesTotal += row.amount;
      }
    } else {
      for (const row of revenueRows) {
        const cat = row.category || "売上";
        salesByCategory[cat] = (salesByCategory[cat] || 0) + row.amount;
        salesTotal += row.amount;
      }
    }

    const totalRevenue = salesTotal + squareTotal;

    const revenueSummary = {
      total: Math.round(totalRevenue),
      sales_total: Math.round(salesTotal),
      square_total: Math.round(squareTotal),
      by_category: salesByCategory,
    };

    // ── Member Summary (MA002) ───────────────────────────────
    const memberWhere = {
      ...(month !== undefined && { year, month }),
      ...(month === undefined && { year }),
      ...(store && { storeName: store }),
    };

    const memberRows = await prisma.monthlySummary.findMany({
      where: memberWhere,
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    // If multiple months, take latest; if single month, aggregate by store
    const memberSummary =
      memberRows.length > 0
        ? {
            plan_subscribers: memberRows.reduce((s, r) => s + r.planSubscribers, 0),
            new_plan_signups: memberRows.reduce((s, r) => s + r.newPlanSignups, 0),
            cancellations: memberRows.reduce((s, r) => s + r.cancellations, 0),
            suspensions: memberRows.reduce((s, r) => s + r.suspensions, 0),
            cancellation_rate: memberRows[0].cancellationRate,
            plan_changes: memberRows.reduce((s, r) => s + r.planChanges, 0),
            total_members: memberRows.reduce((s, r) => s + (r.totalMembers || r.planSubscribers), 0),
          }
        : null;

    // ── Budget ───────────────────────────────────────────────
    const budgetWhere = {
      year,
      ...(month !== undefined && { month }),
      ...(store && { storeName: store }),
    };

    const budgetRows = await prisma.budgetData.findMany({
      where: budgetWhere,
    });

    const budgetByCategory: Record<string, number> = {};
    for (const row of budgetRows) {
      budgetByCategory[row.category] =
        (budgetByCategory[row.category] || 0) + row.amount;
    }

    // ── Operating Profit ─────────────────────────────────────
    const operatingProfit = totalRevenue - totalLaborCost - totalExpense;

    return NextResponse.json({
      year,
      month: month ?? null,
      store: store ?? null,
      payroll: payrollSummary,
      expense: expenseSummary,
      revenue: revenueSummary,
      member: memberSummary,
      budget: budgetByCategory,
      square_total: Math.round(squareTotal),
      total_revenue: Math.round(totalRevenue),
      total_labor: Math.round(totalLaborCost),
      total_expense: Math.round(totalExpense),
      operating_profit: Math.round(operatingProfit),
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
