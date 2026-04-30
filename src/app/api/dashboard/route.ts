import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HQ_STORE } from "@/lib/constants";
import { requireSession, effectiveStoreScope } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

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
    // 非adminは店舗パラメータを無視して自店舗に強制スコープ
    const requestedStore = storeParam || undefined;
    const scopedStore = effectiveStoreScope(auth.session, requestedStore);
    const store = scopedStore ?? undefined;

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

    // ── 月会費 (PS001 商品別売上から正確に算出) ─────────────────
    // PL001 の摘要キーワードマッチでは月会費と入会金等が混ざる可能性があり、
    // 客単価実績が予算表とズレる原因になっている。
    // PS001 が取り込まれている場合はそちらを優先利用する。
    const productSalesRows = await prisma.productSales.findMany({
      where: commonWhere,
    });
    let monthlyFeeFromPs001: number | null = null;
    if (productSalesRows.length > 0) {
      monthlyFeeFromPs001 = productSalesRows
        .filter((r) => r.productName.includes("月会費"))
        .reduce((s, r) => s + r.totalAmount, 0);
    }

    const revenueSummary = {
      total: Math.round(totalRevenue),
      sales_total: Math.round(salesTotal),
      square_total: Math.round(squareTotal),
      by_category: salesByCategory,
      monthly_fee_ps001: monthlyFeeFromPs001,
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
            total_members: memberRows.reduce((s, r) => s + r.totalMembers, 0),
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

    // ── 前月 / 前年同月 の合計（KPIカードの前期比表示に使う）─────
    // 月次ビューで year + month が指定されているときのみ計算する。
    // 集計のみで重い詳細は不要なので、軽量な集約クエリで取得する。
    type Totals = { revenue: number; labor: number; expense: number; profit: number };
    let prevMonthTotals: Totals | null = null;
    let prevYearTotals: Totals | null = null;
    if (month !== undefined) {
      const computeTotals = async (y: number, m: number): Promise<Totals> => {
        const sf = store && store !== "全体"
          ? { storeName: store }
          : { storeName: { not: HQ_STORE } };
        // payroll: grossTotal × ratio/100 を集計
        const payRows = await prisma.payrollData.findMany({
          where: { year: y, month: m, ...sf },
          select: { grossTotal: true, ratio: true },
        });
        const labor = payRows.reduce(
          (s, r) => s + r.grossTotal * (r.ratio / 100),
          0,
        );

        const expWhere = {
          year: y,
          month: m,
          isRevenue: 0,
          ...(store && { storeName: store }),
        };
        const expAgg = await prisma.expenseData.aggregate({
          _sum: { amount: true },
          where: expWhere,
        });
        const expenseTotal = expAgg._sum.amount ?? 0;

        const cw = {
          year: y,
          month: m,
          ...(store && { storeName: store }),
        };
        const sd = await prisma.salesDetail.aggregate({
          _sum: { amount: true },
          where: cw,
        });
        const rev = await prisma.revenueData.aggregate({
          _sum: { amount: true },
          where: cw,
        });
        const sq = await prisma.squareSales.aggregate({
          _sum: { grossSales: true },
          where: cw,
        });
        // PL001 がある月はそちら優先、無ければ revenueData
        const sales = (sd._sum.amount ?? 0) || (rev._sum.amount ?? 0);
        const square = sq._sum.grossSales ?? 0;
        const revenueTotal = sales + square;

        return {
          revenue: Math.round(revenueTotal),
          labor: Math.round(labor),
          expense: Math.round(expenseTotal),
          profit: Math.round(revenueTotal - labor - expenseTotal),
        };
      };

      // 前月（月をまたぐ場合は年も繰り上げ/繰り下げ）
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevMonthYear = month === 1 ? year - 1 : year;
      try {
        prevMonthTotals = await computeTotals(prevMonthYear, prevMonth);
      } catch {
        prevMonthTotals = null;
      }
      // 前年同月
      try {
        prevYearTotals = await computeTotals(year - 1, month);
      } catch {
        prevYearTotals = null;
      }
    }

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
      prev_month_totals: prevMonthTotals,
      prev_year_totals: prevYearTotals,
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
