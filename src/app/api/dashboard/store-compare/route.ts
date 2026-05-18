import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STORES, HQ_STORE } from "@/lib/constants";
import { requireSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    // 店舗比較は全店舗のデータを返すため admin のみ閲覧可
    if (auth.session.role !== "admin") {
      return NextResponse.json(
        { error: "店舗比較は管理者のみ閲覧できます" },
        { status: 403 },
      );
    }

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
    // Sequential queries to avoid Supabase connection pool limits
    const allPayroll = await prisma.payrollData.findMany({ where: { year: { in: years } } });
    const allExpenses = await prisma.expenseData.findMany({ where: { year: { in: years }, isRevenue: 0 } });
    const allSalesDetail = await prisma.salesDetail.findMany({ where: { year: { in: years } } });
    const allRevenue = await prisma.revenueData.findMany({ where: { year: { in: years } } });
    const allSquare = await prisma.squareSales.findMany({ where: { year: { in: years } } });
    const allMonthlySummary = await prisma.monthlySummary.findMany({
      where: { year: { in: years } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    // 予算: 店舗別に売上系/人件費/経費を集計する。
    // 売上予算 = 月会費収入 + パーソナル・物販・その他収入 + サービス収入 + 自販機手数料収入
    // 人件費予算 = 正社員・契約社員給与 + 賞与 + 通勤手当 + 法定福利費 + 福利厚生費
    // 経費予算 = それ以外（広告宣伝費・消耗品費等の合計）
    const REVENUE_BUDGET_CATEGORIES = new Set([
      "月会費収入",
      "パーソナル・物販・その他収入",
      "サービス収入",
      "自販機手数料収入",
    ]);
    const LABOR_BUDGET_CATEGORIES = new Set([
      "正社員・契約社員給与",
      "賞与",
      "通勤手当",
      "法定福利費",
      "福利厚生費",
    ]);
    const allBudget = await prisma.budgetData.findMany({
      where: { year: { in: years } },
    });
    // 体験者数: ManualEntry の trial_count（店長手動入力） or
    //          MemberData の trialDate / firstTrialDate を期間内マッチでカウント
    const allManual = await prisma.manualEntry.findMany({
      where: { year: { in: years } },
    });
    const allMember = await prisma.memberData.findMany({
      select: { storeName: true, trialDate: true, firstTrialDate: true },
    });

    const isInPeriod = (y: number, m: number) =>
      periods.some((p) => p.year === y && p.month === m);

    // 動的店舗リスト: 既定 STORES に加え、各テーブルでデータがある店舗を全て拾う。
    // ハコモノCSVで新店舗が追加されれば自動的に比較対象に含まれる（坪井さん要望17）。
    // 本部（除外）はPL対象外なので除く。
    const dynamicStoreSet = new Set<string>(STORES);
    for (const r of allPayroll) dynamicStoreSet.add(r.storeName);
    for (const r of allExpenses) dynamicStoreSet.add(r.storeName);
    for (const r of allSalesDetail) dynamicStoreSet.add(r.storeName);
    for (const r of allRevenue) dynamicStoreSet.add(r.storeName);
    for (const r of allSquare) dynamicStoreSet.add(r.storeName);
    for (const r of allMonthlySummary) dynamicStoreSet.add(r.storeName);
    dynamicStoreSet.delete(HQ_STORE);
    // STORES の順を尊重し、その後に自動検出された新店舗を追加
    const orderedStores: string[] = [];
    const seen = new Set<string>();
    for (const s of STORES) {
      if (dynamicStoreSet.has(s)) {
        orderedStores.push(s);
        seen.add(s);
      }
    }
    for (const s of Array.from(dynamicStoreSet).sort()) {
      if (!seen.has(s)) orderedStores.push(s);
    }

    const storeData = orderedStores.map((storeName) => {
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

      // Member summary - latest record for this store WITHIN the requested period.
      // NOTE: Prisma where は年単位でのみフィルタしているため、例えば 8期 (2024/10〜2025/9)
      // を表示しているときに同じ years=[2024,2025] に含まれる 9期の先頭月 (2025/10〜12)
      // のレコードまで取り込まれ、year/month desc の find() で 9期値が 8期画面に
      // 漏れていた。期間内のみを対象にするため isInPeriod を追加する。
      const ms = allMonthlySummary.find(
        (r) => r.storeName === storeName && isInPeriod(r.year, r.month),
      );

      // 予算集計: 期間内 (years×months) で各カテゴリの予算合計
      const budgetRows = allBudget.filter(
        (b) => b.storeName === storeName && isInPeriod(b.year, b.month),
      );
      let budgetRevenue = 0;
      let budgetLabor = 0;
      let budgetExpense = 0;
      let budgetTrialCount = 0;
      let budgetNewSignups = 0;
      let budgetCancellations = 0;
      for (const b of budgetRows) {
        if (REVENUE_BUDGET_CATEGORIES.has(b.category)) {
          budgetRevenue += b.amount;
        } else if (LABOR_BUDGET_CATEGORIES.has(b.category)) {
          budgetLabor += b.amount;
        } else if (b.category === "体験者数") {
          budgetTrialCount += b.amount;
        } else if (b.category === "新規入会数") {
          budgetNewSignups += b.amount;
        } else if (b.category === "退会数") {
          budgetCancellations += b.amount;
        } else if (b.category !== "客単価" && b.category !== "退会率") {
          budgetExpense += b.amount;
        }
      }
      const budgetProfit = budgetRevenue - budgetLabor - budgetExpense;

      // 期間内の新規入会数 / 退会数 / 休会数 / 体験者数（MA002 + ManualEntry/MemberData）
      const msList = allMonthlySummary.filter(
        (r) => r.storeName === storeName && isInPeriod(r.year, r.month),
      );
      const newSignups = msList.reduce((s, r) => s + r.newPlanSignups, 0);
      const cancellations = msList.reduce((s, r) => s + r.cancellations, 0);

      // 体験者数: 期間内の各月で manualEntry.trialCount > 0 なら採用、
      // 無ければ MemberData の trialDate/firstTrialDate を月マッチで自動カウント
      let trialCount = 0;
      for (const p of periods) {
        const me = allManual.find(
          (m) =>
            m.storeName === storeName && m.year === p.year && m.month === p.month,
        );
        if (me && me.trialCount > 0) {
          trialCount += me.trialCount;
        } else {
          const mm = String(p.month).padStart(2, "0");
          const prefixes = [`${p.year}/${mm}/`, `${p.year}-${mm}-`];
          for (const r of allMember) {
            if (r.storeName !== storeName) continue;
            if (
              (r.trialDate &&
                prefixes.some((pref) => r.trialDate!.startsWith(pref))) ||
              (r.firstTrialDate &&
                prefixes.some((pref) => r.firstTrialDate!.startsWith(pref)))
            ) {
              trialCount++;
            }
          }
        }
      }

      // 入会率 = 新規入会数 / 体験者数（パーセント）
      const signupRate =
        trialCount > 0 ? (newSignups / trialCount) * 100 : 0;
      const budgetSignupRate =
        budgetTrialCount > 0
          ? (budgetNewSignups / budgetTrialCount) * 100
          : 0;

      return {
        store: storeName,
        revenue: Math.round(totalRevenue),
        labor: Math.round(totalLabor),
        expense: Math.round(totalExpense),
        profit: Math.round(totalRevenue - totalLabor - totalExpense),
        plan_subscribers: ms?.planSubscribers ?? 0,
        cancellation_rate: ms?.cancellationRate ?? "",
        trial_count: trialCount,
        new_signups: newSignups,
        cancellations,
        signup_rate: Number(signupRate.toFixed(1)),
        budget_revenue: Math.round(budgetRevenue),
        budget_labor: Math.round(budgetLabor),
        budget_expense: Math.round(budgetExpense),
        budget_profit: Math.round(budgetProfit),
        budget_trial_count: budgetTrialCount,
        budget_new_signups: budgetNewSignups,
        budget_cancellations: budgetCancellations,
        budget_signup_rate: Number(budgetSignupRate.toFixed(1)),
      };
    });

    return NextResponse.json({
      periods: periods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
      stores: storeData,
    });
  } catch (error) {
    console.error("Store compare API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
