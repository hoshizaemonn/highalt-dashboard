import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HQ_STORE, STORES, BUDGET_CATEGORY_UNIT_PRICE } from "@/lib/constants";
import {
  requireSession,
  effectiveStoreScope,
  getEffectiveStoreFilter,
} from "@/lib/auth";
import {
  singleStoreShare,
  allStoresShare,
  expenseRowShareWithCategorySplit,
  expenseRowSharesByCategory,
} from "@/lib/manual-expense-split";
import { trialDateMatchesMonth } from "@/lib/csv-utils";
import { getHiddenStores } from "@/lib/hidden-stores";
import { memoCache } from "@/lib/memo-cache";

const CACHE_TTL_MS = 30_000; // 30秒

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
  /** 体験者数（hacomono自動算出または店長手動上書き） */
  trial_count: number;
  /** 体験者のうち紹介経由（店長手動入力） */
  trial_referral_count: number;
  /** 体験者のうち紹介以外（=trial_count - trial_referral_count、0以上にクランプ） */
  trial_non_referral_count: number;
  /** 請求書ベースの「その他」売上（店長手動追記） */
  manual_other_sales: number;
  expense_by_category: Record<string, number>;
  sales_by_category: Record<string, number>;
  /** PS001 商品別売上から算出した月会費（PS001未取込時は null） */
  monthly_fee_ps001: number | null;
  /** Square売上（物販想定） */
  square_total: number;
  /** 4分類集計（坪井さん要望: 会費/パーソナル/物販/その他）
      会費 = 月会費 + 入会金
      パーソナル = パーソナル
      物販 = Square売上
      その他 = 全hacomono売上 − 会費 − パーソナル */
  sales_membership: number;
  sales_personal: number;
  sales_product: number;
  sales_other: number;
  budget_revenue: number;
  budget_labor: number;
  budget_expense: number;
  budget_profit: number;
  budget_unit_price: number;
  /** 経費の項目別予算（坪井さん要望: 各推移グラフに予算折れ線を重ねるため） */
  budget_advertising: number;
  budget_supplies: number;
  /** 売上カテゴリ別予算（坪井さん要望: 前年比比較グラフに予算も追加） */
  budget_membership_income: number;
  budget_mixed_revenue: number;
  /** 会員系KPIの予算（坪井さん要望: 推移グラフに予算折れ線重ね） */
  budget_new_signups: number;
  budget_cancellations: number;
  budget_suspensions: number;
  budget_cancellation_rate: number;
  budget_trial_count: number;
  /** 売上4分類の各予算（坪井さん要望: 売上内訳推移にも予算折れ線重ね） */
  budget_sales_membership: number;
  budget_sales_personal: number;
  budget_sales_product: number;
  budget_sales_other: number;
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

    // 30秒キャッシュ: 同じパラメータでの取得は省略してDB往復をスキップ
    // キーは fiscalYear / store / 月範囲 / yearParam に基づく
    const cacheKey = `annual:${fiscalYearParam ?? ""}:${store ?? "*"}:${monthStartParam ?? ""}:${monthEndParam ?? ""}:${yearParam ?? ""}`;
    const responseData = await memoCache(cacheKey, CACHE_TTL_MS, async () => {

    // Fetch all data for the year range at once to minimize queries
    const years = [...new Set(periods.map((p) => p.year))];
    // 全体集計時は 本部 + 非表示店舗（閉店/テスト）を除外
    const hiddenStores = await getHiddenStores();
    const notHqOrHidden = { notIn: [HQ_STORE, ...hiddenStores] };
    // 複数店舗マネージャー対応のフィルタ
    const storeNameFilter = getEffectiveStoreFilter(
      auth.session,
      requestedStore,
      notHqOrHidden,
    );
    const storeWhere = { storeName: storeNameFilter };

    // 高速化: 独立した取得を並列化。ただしSupabaseプール(connection_limit=5)を
    // 圧迫しないよう、5クエリ並列のチャンクで分割実行（5並列ユーザー時の他リクエストへの
    // 影響を最小化）。逐次より速く、フル並列より他APIに優しい。
    const budgetWhere = { year: { in: years }, storeName: storeNameFilter };
    // バッチ1: 集計の主軸となる重めのデータ
    const [allPayroll, allExpenses, allSalesDetail, allRevenue, allSquare] = await Promise.all([
      prisma.payrollData.findMany({ where: { year: { in: years }, ...storeWhere } }),
      // 発生月対応（依頼⑥）: 当年の前年も取得して跨年シフト分も拾う
      // splitRatios / categorySplits あり行は店舗フィルタを跨ぐため OR で展開
      prisma.expenseData.findMany({
        where: {
          year: { in: [...years, ...years.map((y) => y - 1)] },
          isRevenue: 0,
          OR: [
            { storeName: storeNameFilter },
            { splitRatios: { not: null } },
            { categorySplits: { not: null } },
          ],
        },
      }),
      prisma.salesDetail.findMany({ where: { year: { in: years }, ...storeWhere } }),
      prisma.revenueData.findMany({ where: { year: { in: years }, ...storeWhere } }),
      prisma.squareSales.findMany({ where: { year: { in: years }, ...storeWhere } }),
    ]);
    // バッチ2: 補助・予算・手動入力系
    const [
      allManualExpense,
      allMonthlySummary,
      allProductSales,
      allManual,
      allMember,
      allBudget,
      allPlActual,
    ] = await Promise.all([
      // 本部一括経費（手動入力）
      prisma.manualExpenseEntry.findMany({ where: { year: { in: years } } }),
      prisma.monthlySummary.findMany({ where: { year: { in: years }, ...storeWhere } }),
      prisma.productSales.findMany({ where: { year: { in: years }, ...storeWhere } }),
      // 店長手動追記（体験者数 / 請求書その他売上）
      prisma.manualEntry.findMany({ where: { year: { in: years }, ...storeWhere } }),
      // 体験者数の自動算出（ML001 時点スナップショット）
      prisma.memberData.findMany({
        where: { ...storeWhere },
        select: { trialDate: true, firstTrialDate: true },
      }),
      // 予算: 店舗指定があればその店舗、全体時は本部+非表示除外
      prisma.budgetData.findMany({ where: budgetWhere }),
      // 消耗品費・広告宣伝費はクライアント公式PLを正とする（坪井さん決定）
      prisma.plActual.findMany({
        where: {
          year: { in: years },
          ...storeWhere,
          category: { in: ["消耗品費", "広告宣伝費"] },
        },
        select: { year: true, month: true, category: true, amount: true },
      }),
    ]);
    // PL上書き用マップ: `${year}-${month}-${category}` -> 金額（全体時は店舗合算）
    const plExpMap = new Map<string, number>();
    for (const r of allPlActual) {
      const k = `${r.year}-${r.month}-${r.category}`;
      plExpMap.set(k, (plExpMap.get(k) ?? 0) + r.amount);
    }

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

      // Expenses（依頼⑥: accrual を優先 / 依頼A: splitRatios+categorySplits 対応）
      const expenseTarget: string | null = store ? store : null;
      const expenses = allExpenses.filter((r) => {
        const ey = r.accrualYear ?? r.year;
        const em = r.accrualMonth ?? r.month;
        return ey === y && em === m;
      });
      let totalExpense = 0;
      const expenseByCat: Record<string, number> = {};
      for (const row of expenses) {
        const sharesByCat = expenseRowSharesByCategory(row, expenseTarget);
        for (const [cat, share] of Object.entries(sharesByCat)) {
          expenseByCat[cat] = (expenseByCat[cat] || 0) + share;
          totalExpense += share;
        }
      }
      // 本部一括経費（手動入力）を加算
      //   - splitRatios あり: 比率で配分
      //   - storeName="" & splitRatios無し: 単店ビュー=÷店舗数、全体=全額
      //   - storeName=店舗名: 単店ビュー=当該店のみ、全体=全額合算
      const storeCount = STORES.length;
      const manualExp = allManualExpense.filter((r) => r.year === y && r.month === m);
      for (const row of manualExp) {
        const share = store
          ? singleStoreShare(row, store, storeCount)
          : allStoresShare(row);
        if (share === 0) continue;
        expenseByCat[row.category] = (expenseByCat[row.category] || 0) + share;
        totalExpense += share;
      }

      // 消耗品費・広告宣伝費はクライアント公式PL（pl_actuals）を正に上書き（坪井さん決定）
      for (const cat of ["消耗品費", "広告宣伝費"]) {
        const plVal = plExpMap.get(`${y}-${m}-${cat}`);
        if (plVal !== undefined) {
          const old = expenseByCat[cat] || 0;
          expenseByCat[cat] = plVal;
          totalExpense += plVal - old;
        }
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

      // 店長手動追記の合算（その月の全店舗合算）
      const manualMonth = allManual.filter((r) => r.year === y && r.month === m);
      const manualTrial = manualMonth.reduce((s, r) => s + r.trialCount, 0);
      const manualOther = manualMonth.reduce((s, r) => s + r.otherSalesAmount, 0);

      // 体験者数自動算出（trialDate / firstTrialDate が当月にマッチする会員数）。
      // 手動入力があればそれで上書き、無ければ自動値を使う。
      const autoTrialCount = allMember.filter((r) =>
        trialDateMatchesMonth(r.trialDate, r.firstTrialDate, y, m),
      ).length;
      const effectiveTrial = manualTrial > 0 ? manualTrial : autoTrialCount;
      // 紹介経由は店長手動入力（全店舗合算）
      const manualReferral = manualMonth.reduce((s, r) => s + r.trialReferralCount, 0);
      const trialNonReferral = Math.max(0, effectiveTrial - manualReferral);

      const totalRevenue = salesTotal + squareTotal + manualOther;

      // 売上4分類（坪井さん要望: 会費/パーソナル/物販/その他）
      const salesMembership =
        (salesByCat["月会費"] ?? 0) + (salesByCat["入会金"] ?? 0);
      const salesPersonal = salesByCat["パーソナル"] ?? 0;
      const salesProduct = squareTotal;
      const salesOther = salesTotal - salesMembership - salesPersonal + manualOther;

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
      const budgetAdvertising = budgetMap["広告宣伝費"] ?? 0;
      const budgetSupplies = budgetMap["消耗品費"] ?? 0;
      const budgetMembershipIncome = budgetMap["月会費収入"] ?? 0;
      const budgetMixedRevenue = budgetMap["パーソナル・物販・その他収入"] ?? 0;
      // 会員系予算（複数のキー名候補をチェック、CSV提供されたら自動反映）
      const budgetNewSignups =
        budgetMap["新規入会数"] ?? budgetMap["新規入会"] ?? 0;
      const budgetCancellations =
        budgetMap["退会数"] ?? budgetMap["退会"] ?? 0;
      const budgetSuspensions =
        budgetMap["休会数"] ?? budgetMap["休会"] ?? 0;
      const budgetCancellationRate =
        budgetMap["退会率"] ?? 0; // 例: 8 = 8%
      const budgetTrialCount =
        budgetMap["体験者数"] ?? budgetMap["新規体験者数"] ?? 0;
      // 売上4分類の予算（複数キー候補対応。CSV予算カテゴリの呼び方差異を吸収）
      const budgetSalesMembership =
        budgetMap["会費売上"] ??
        budgetMap["会費収入"] ??
        budgetMap["月会費収入"] ??
        0;
      const budgetSalesPersonal =
        budgetMap["パーソナル売上"] ??
        budgetMap["パーソナル収入"] ??
        0;
      const budgetSalesProduct =
        budgetMap["物販売上"] ?? budgetMap["物販収入"] ?? 0;
      const budgetSalesOther =
        budgetMap["その他売上"] ??
        budgetMap["その他収入"] ??
        budgetMap["パーソナル・物販・その他収入"] ??
        0;

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
        trial_count: effectiveTrial,
        trial_referral_count: manualReferral,
        trial_non_referral_count: trialNonReferral,
        manual_other_sales: manualOther,
        expense_by_category: expenseByCat,
        sales_by_category: salesByCat,
        monthly_fee_ps001: monthlyFeePs001,
        square_total: Math.round(squareTotal),
        sales_membership: Math.round(salesMembership),
        sales_personal: Math.round(salesPersonal),
        sales_product: Math.round(salesProduct),
        sales_other: Math.round(salesOther),
        budget_revenue: budgetRevenue,
        budget_labor: budgetLabor,
        budget_expense: budgetExpense,
        budget_profit: budgetProfit,
        budget_unit_price: budgetUnitPrice,
        budget_advertising: budgetAdvertising,
        budget_supplies: budgetSupplies,
        budget_membership_income: budgetMembershipIncome,
        budget_mixed_revenue: budgetMixedRevenue,
        budget_new_signups: budgetNewSignups,
        budget_cancellations: budgetCancellations,
        budget_suspensions: budgetSuspensions,
        budget_cancellation_rate: budgetCancellationRate,
        budget_trial_count: budgetTrialCount,
        budget_sales_membership: budgetSalesMembership,
        budget_sales_personal: budgetSalesPersonal,
        budget_sales_product: budgetSalesProduct,
        budget_sales_other: budgetSalesOther,
      };
    });

    // ── 前年同期の合計集計 ───────────────────────────────────
    // 坪井さん要望: 前年比（2025/9期 など）のデータを比較表示したい。
    // periods の (year, month) をそれぞれ 1 年シフトして集計する。
    //
    // 自動YTDキャップ（坪井さん要望）:
    // 現年度のデータが入っている月までに前期も揃える。
    // 例: 今期に1〜4月分しか入っていなければ、前期も同年度の1〜4月だけを集計し、
    // 「1〜4月実績 vs 前期1〜4月実績」が並ぶようにする（8ヶ月分なら8ヶ月比較）。
    const periodKey = (y: number, m: number) => y * 100 + m;
    const currentDataKeys = new Set<number>();
    for (const r of allSalesDetail) currentDataKeys.add(periodKey(r.year, r.month));
    for (const r of allRevenue) currentDataKeys.add(periodKey(r.year, r.month));
    for (const r of allSquare) currentDataKeys.add(periodKey(r.year, r.month));
    for (const r of allPayroll) currentDataKeys.add(periodKey(r.year, r.month));
    for (const r of allExpenses) currentDataKeys.add(periodKey(r.year, r.month));
    let cappedPeriods = periods;
    if (currentDataKeys.size > 0) {
      let maxDataKey = 0;
      for (const p of periods) {
        const k = periodKey(p.year, p.month);
        if (currentDataKeys.has(k) && k > maxDataKey) maxDataKey = k;
      }
      if (maxDataKey > 0) {
        cappedPeriods = periods.filter(
          (p) => periodKey(p.year, p.month) <= maxDataKey,
        );
      }
    }
    const prevPeriods = cappedPeriods.map((p) => ({ year: p.year - 1, month: p.month }));
    const prevYears = [...new Set(prevPeriods.map((p) => p.year))];

    // 高速化: 前期データも Promise.all で並列取得
    const [prevPayroll, prevExpenses, prevSales, prevRevenue, prevSquare, prevMonthlySummary] = await Promise.all([
      prisma.payrollData.findMany({ where: { year: { in: prevYears }, ...storeWhere } }),
      prisma.expenseData.findMany({
        where: {
          year: { in: [...prevYears, ...prevYears.map((y) => y - 1)] },
          isRevenue: 0,
          OR: [
            { storeName: storeNameFilter },
            { splitRatios: { not: null } },
            { categorySplits: { not: null } },
          ],
        },
      }),
      prisma.salesDetail.findMany({ where: { year: { in: prevYears }, ...storeWhere } }),
      prisma.revenueData.findMany({ where: { year: { in: prevYears }, ...storeWhere } }),
      prisma.squareSales.findMany({ where: { year: { in: prevYears }, ...storeWhere } }),
      prisma.monthlySummary.findMany({ where: { year: { in: prevYears }, ...storeWhere } }),
    ]);

    const isInPeriod = (y: number, m: number) =>
      prevPeriods.some((p) => p.year === y && p.month === m);

    const prevLabor = prevPayroll
      .filter((r) => isInPeriod(r.year, r.month))
      .reduce((s, r) => s + r.grossTotal * (r.ratio / 100), 0);

    const prevExpenseByCat: Record<string, number> = {};
    let prevExpense = 0;
    const prevExpenseTarget: string | null = store ? store : null;
    for (const r of prevExpenses) {
      // 依頼⑥: accrual を優先して帰属判定
      const ey = r.accrualYear ?? r.year;
      const em = r.accrualMonth ?? r.month;
      if (!isInPeriod(ey, em)) continue;
      // 依頼A: splitRatios / categorySplits 対応
      const sharesByCat = expenseRowSharesByCategory(r, prevExpenseTarget);
      for (const [cat, share] of Object.entries(sharesByCat)) {
        prevExpenseByCat[cat] = (prevExpenseByCat[cat] ?? 0) + share;
        prevExpense += share;
      }
    }

    const prevSalesByCat: Record<string, number> = {};
    let prevSalesTotal = 0;
    const salesRows = prevSales.length > 0 ? prevSales : prevRevenue;
    for (const r of salesRows) {
      if (!isInPeriod(r.year, r.month)) continue;
      const cat = r.category || "その他";
      prevSalesByCat[cat] = (prevSalesByCat[cat] ?? 0) + r.amount;
      prevSalesTotal += r.amount;
    }
    const prevSquareTotal = prevSquare
      .filter((r) => isInPeriod(r.year, r.month))
      .reduce((s, r) => s + r.grossSales, 0);
    const prevRevenueTotal = prevSalesTotal + prevSquareTotal;

    const prevMembershipSales =
      (prevSalesByCat["月会費"] ?? 0) + (prevSalesByCat["入会金"] ?? 0);
    const prevPersonalSales = prevSalesByCat["パーソナル"] ?? 0;
    const prevProductSales = prevSquareTotal;
    const prevOtherSales = prevSalesTotal - prevMembershipSales - prevPersonalSales;

    const prevNewSignups = prevMonthlySummary
      .filter((r) => isInPeriod(r.year, r.month))
      .reduce((s, r) => s + r.newPlanSignups, 0);
    const prevCancellations = prevMonthlySummary
      .filter((r) => isInPeriod(r.year, r.month))
      .reduce((s, r) => s + r.cancellations, 0);

    const previousPeriodTotals = {
      revenue: Math.round(prevRevenueTotal),
      labor: Math.round(prevLabor),
      expense: Math.round(prevExpense),
      profit: Math.round(prevRevenueTotal - prevLabor - prevExpense),
      sales_membership: Math.round(prevMembershipSales),
      sales_personal: Math.round(prevPersonalSales),
      sales_product: Math.round(prevProductSales),
      sales_other: Math.round(prevOtherSales),
      advertising: Math.round(prevExpenseByCat["広告宣伝費"] ?? 0),
      supplies: Math.round(prevExpenseByCat["消耗品費"] ?? 0),
      new_signups: prevNewSignups,
      cancellations: prevCancellations,
    };

    return {
      store: store ?? null,
      periods: periods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
      // 前期/予算と揃えるため「実績データのある最終月」までキャップした範囲。
      effective_periods: cappedPeriods.map(
        (p) => `${p.year}-${String(p.month).padStart(2, "0")}`,
      ),
      monthly_data: monthlyData,
      previous_period_totals: previousPeriodTotals,
    };
    });

    // 社員給与の黒塗り（安蒜さん依頼）: 店長など非admin には社員の給与額を返さない。
    // 各月の fulltime_gross（正社員給与）のみ 0 に伏せ、payroll_masked を立てる。
    // gross_total（人件費・課税支給合計）・契約社員給与（アルバイト）・法定福利費・人件費合計・人数は従来どおり表示。
    // ※ responseData はキャッシュ共有オブジェクトのため破壊的に変更せず、コピーを返す。
    if (auth.session.role !== "admin") {
      const masked = {
        ...responseData,
        monthly_data: responseData.monthly_data.map((m) => ({
          ...m,
          fulltime_gross: 0,
        })),
        payroll_masked: true,
      };
      return NextResponse.json(masked);
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Dashboard annual API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
