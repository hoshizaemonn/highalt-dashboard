import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HQ_STORE, BUDGET_CATEGORY_UNIT_PRICE } from "@/lib/constants";
import { requireSession, effectiveStoreScope } from "@/lib/auth";

interface MonthlyEntry {
  month: number;
  month_label: string;
  revenue: number;
  labor_cost: number;
  expense: number;
  operating_profit: number;
  fulltime_gross: number;
  parttime_gross: number;
  gross_total: number;
  legal_welfare: number;
  total_hours: number;
  employee_count: number;
  fulltime_count: number;
  parttime_count: number;
  ma_total_members: number;
  ma_plan_subscribers: number;
  ma_new_signups: number;
  ma_cancellations: number;
  ma_suspensions: number;
  ma_cancel_rate: string;
  expense_by_category: Record<string, number>;
  sales_by_category: Record<string, number>;
  /** PS001 商品別売上から算出した月会費（PS001未取込時は null） */
  monthly_fee_ps001: number | null;
  budget_revenue: number;
  budget_labor: number;
  budget_expense: number;
  budget_profit: number;
  budget_unit_price: number;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const yearParam = searchParams.get("year");
    const requestedStore = searchParams.get("store") || undefined;
    // 非adminは店舗パラメータを無視して自店舗に強制スコープ
    const store = effectiveStoreScope(auth.session, requestedStore) ?? undefined;
    const fiscalYearParam = searchParams.get("fiscalYear");
    const monthStartParam = searchParams.get("monthStart");
    const monthEndParam = searchParams.get("monthEnd");

    if (!yearParam && !fiscalYearParam) {
      return NextResponse.json(
        { error: "year or fiscalYear is required" },
        { status: 400 },
      );
    }

    // Build list of { year, month } pairs
    type YearMonth = { year: number; month: number };
    const periods: YearMonth[] = [];

    if (fiscalYearParam) {
      const fy = parseInt(fiscalYearParam, 10);
      if (isNaN(fy)) {
        return NextResponse.json(
          { error: "fiscalYear must be a number" },
          { status: 400 },
        );
      }
      // Fiscal year: Oct of previous year through Sep of fiscal year
      for (let m = 10; m <= 12; m++) {
        periods.push({ year: fy - 1, month: m });
      }
      for (let m = 1; m <= 9; m++) {
        periods.push({ year: fy, month: m });
      }
    } else {
      const year = parseInt(yearParam!, 10);
      if (isNaN(year)) {
        return NextResponse.json(
          { error: "year must be a number" },
          { status: 400 },
        );
      }
      const monthStart = monthStartParam ? parseInt(monthStartParam, 10) : 1;
      const monthEnd = monthEndParam ? parseInt(monthEndParam, 10) : 12;
      for (let m = monthStart; m <= monthEnd; m++) {
        periods.push({ year, month: m });
      }
    }

    // Fetch all data for the year range at once to minimize queries
    const years = [...new Set(periods.map((p) => p.year))];
    const storeWhere = store ? { storeName: store } : { storeName: { not: HQ_STORE } };

    // Sequential queries to avoid Supabase connection pool limits
    const allPayroll = await prisma.payrollData.findMany({
      where: { year: { in: years }, ...storeWhere },
    });
    const allExpenses = await prisma.expenseData.findMany({
      where: { year: { in: years }, isRevenue: 0, ...storeWhere },
    });
    const allSalesDetail = await prisma.salesDetail.findMany({
      where: { year: { in: years }, ...storeWhere },
    });
    const allRevenue = await prisma.revenueData.findMany({
      where: { year: { in: years }, ...storeWhere },
    });
    const allSquare = await prisma.squareSales.findMany({
      where: { year: { in: years }, ...storeWhere },
    });
    const allMonthlySummary = await prisma.monthlySummary.findMany({
      where: { year: { in: years }, ...storeWhere },
    });
    const allProductSales = await prisma.productSales.findMany({
      where: { year: { in: years }, ...storeWhere },
    });
    const allBudget = store
      ? await prisma.budgetData.findMany({
          where: { year: { in: years }, storeName: store },
        })
      : [];

    const monthLabels = [
      "", "1月", "2月", "3月", "4月", "5月", "6月",
      "7月", "8月", "9月", "10月", "11月", "12月",
    ];

    const monthlyData: MonthlyEntry[] = periods.map(({ year: y, month: m }) => {
      // Payroll
      const payroll = allPayroll.filter((r) => r.year === y && r.month === m);
      let fulltimeGross = 0;
      let parttimeGross = 0;
      let totalLabor = 0;
      let totalHours = 0;
      let legalWelfare = 0;
      const empIds = new Set<string>();
      let ftCount = 0;
      let ptCount = 0;

      for (const row of payroll) {
        const ratio = row.ratio / 100;
        const gross = row.grossTotal * ratio;
        totalLabor += gross;
        totalHours +=
          (row.scheduledHours + row.overtimeHours) * ratio;
        legalWelfare +=
          (row.healthInsuranceCo +
            row.careInsuranceCo +
            row.pensionCo +
            row.childContributionCo +
            row.pensionFundCo +
            row.employmentInsuranceCo +
            row.workersCompCo +
            row.generalContributionCo) *
          ratio;
        if (!empIds.has(row.employeeId)) {
          empIds.add(row.employeeId);
          if (row.contractType === "正社員") ftCount++;
          else ptCount++;
        }
        if (row.contractType === "正社員") fulltimeGross += gross;
        else parttimeGross += gross;
      }

      // Expenses
      const expenses = allExpenses.filter((r) => r.year === y && r.month === m);
      let totalExpense = 0;
      const expenseByCat: Record<string, number> = {};
      for (const row of expenses) {
        const cat = row.category || "その他";
        expenseByCat[cat] = (expenseByCat[cat] || 0) + row.amount;
        totalExpense += row.amount;
      }

      // Sales
      const sales = allSalesDetail.filter((r) => r.year === y && r.month === m);
      const rev = allRevenue.filter((r) => r.year === y && r.month === m);
      const sq = allSquare.filter((r) => r.year === y && r.month === m);
      const squareTotal = sq.reduce((s, r) => s + r.grossSales, 0);

      let salesTotal = 0;
      const salesByCat: Record<string, number> = {};

      if (sales.length > 0) {
        for (const row of sales) {
          const cat = row.category || "その他";
          salesByCat[cat] = (salesByCat[cat] || 0) + row.amount;
          salesTotal += row.amount;
        }
      } else {
        for (const row of rev) {
          const cat = row.category || "売上";
          salesByCat[cat] = (salesByCat[cat] || 0) + row.amount;
          salesTotal += row.amount;
        }
      }

      const totalRevenue = salesTotal + squareTotal;

      // 月会費 (PS001 商品別売上から正確に算出 — 取込時のみ)
      const productSalesMonth = allProductSales.filter(
        (r) => r.year === y && r.month === m,
      );
      const monthlyFeePs001 =
        productSalesMonth.length > 0
          ? productSalesMonth
              .filter((r) => r.productName.includes("月会費"))
              .reduce((s, r) => s + r.totalAmount, 0)
          : null;

      // Member summary (MA002)
      const ms = allMonthlySummary.filter((r) => r.year === y && r.month === m);

      // Budget per month
      const budgetForMonth = allBudget.filter((r) => r.year === y && r.month === m);
      const budgetMap: Record<string, number> = {};
      for (const b of budgetForMonth) {
        budgetMap[b.category] = (budgetMap[b.category] || 0) + b.amount;
      }
      // Calculate budget aggregates from component items (matching BUDGET_ITEMS)
      const REV_ITEMS = ["パーソナル・物販・その他収入", "月会費収入", "サービス収入", "自販機手数料収入"];
      const LABOR_ITEMS = ["正社員・契約社員給与", "賞与", "通勤手当", "法定福利費"];

      const budgetRevenue = REV_ITEMS.reduce((s, k) => s + (budgetMap[k] ?? 0), 0);
      const budgetLabor = LABOR_ITEMS.reduce((s, k) => s + (budgetMap[k] ?? 0), 0);
      // Non-monetary KPI budgets must not roll up into the expense bucket
      const budgetExpense = Object.entries(budgetMap)
        .filter(
          ([k]) =>
            !REV_ITEMS.includes(k) &&
            !LABOR_ITEMS.includes(k) &&
            k !== BUDGET_CATEGORY_UNIT_PRICE,
        )
        .reduce((s, [, v]) => s + v, 0);
      const budgetProfit = budgetRevenue - budgetLabor - budgetExpense;
      const budgetUnitPrice = budgetMap[BUDGET_CATEGORY_UNIT_PRICE] ?? 0;

      return {
        month: m,
        month_label: monthLabels[m],
        revenue: Math.round(totalRevenue),
        labor_cost: Math.round(totalLabor),
        expense: Math.round(totalExpense),
        operating_profit: Math.round(totalRevenue - totalLabor - totalExpense),
        fulltime_gross: Math.round(fulltimeGross),
        parttime_gross: Math.round(parttimeGross),
        gross_total: Math.round(fulltimeGross + parttimeGross),
        legal_welfare: Math.round(legalWelfare),
        total_hours: Math.round(totalHours * 10) / 10,
        employee_count: empIds.size,
        fulltime_count: ftCount,
        parttime_count: ptCount,
        ma_total_members: ms.reduce((s, r) => s + r.totalMembers, 0),
        ma_plan_subscribers: ms.reduce((s, r) => s + r.planSubscribers, 0),
        ma_new_signups: ms.reduce((s, r) => s + r.newPlanSignups, 0),
        ma_cancellations: ms.reduce((s, r) => s + r.cancellations, 0),
        ma_suspensions: ms.reduce((s, r) => s + r.suspensions, 0),
        ma_cancel_rate: ms.length > 0 ? ms[0].cancellationRate : "",
        expense_by_category: expenseByCat,
        sales_by_category: salesByCat,
        monthly_fee_ps001: monthlyFeePs001,
        budget_revenue: budgetRevenue,
        budget_labor: budgetLabor,
        budget_expense: budgetExpense,
        budget_profit: budgetProfit,
        budget_unit_price: budgetUnitPrice,
      };
    });

    return NextResponse.json({
      store: store ?? null,
      periods: periods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
      monthly_data: monthlyData,
    });
  } catch (error) {
    console.error("Dashboard annual API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
