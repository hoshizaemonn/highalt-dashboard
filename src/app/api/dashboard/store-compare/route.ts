import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STORES, HQ_STORE } from "@/lib/constants";
import { requireSession, getSessionAllowedStores } from "@/lib/auth";
import { expenseRowShareWithCategorySplit } from "@/lib/manual-expense-split";
import { getHiddenStores } from "@/lib/hidden-stores";
import { memoCache } from "@/lib/memo-cache";

const CACHE_TTL_MS = 30_000;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    // 店舗比較は admin と複数店舗マネージャーのみ閲覧可（単店マネージャーは自店舗のみで意味なし）
    if (auth.session.role !== "admin") {
      const allowed = getSessionAllowedStores(auth.session);
      if (allowed.length < 2) {
        return NextResponse.json(
          { error: "店舗比較は管理者または複数店舗担当者のみ閲覧できます" },
          { status: 403 },
        );
      }
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

    // 30秒キャッシュ
    const cacheKey = `storeCompare:${(yearParam ?? "")}:${(monthsParam ?? "")}`;
    const responseData = await memoCache(cacheKey, CACHE_TTL_MS, async () => {

    // 高速化: 5並列のチャンクで取得（プール圧迫を避ける）
    const [allPayroll, allExpenses, allSalesDetail, allRevenue, allSquare] = await Promise.all([
      prisma.payrollData.findMany({ where: { year: { in: years } } }),
      prisma.expenseData.findMany({
        where: {
          year: { in: [...years, ...years.map((y) => y - 1)] },
          isRevenue: 0,
        },
      }),
      prisma.salesDetail.findMany({ where: { year: { in: years } } }),
      prisma.revenueData.findMany({ where: { year: { in: years } } }),
      prisma.squareSales.findMany({ where: { year: { in: years } } }),
    ]);
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
    const [allBudget, allManual, allMember] = await Promise.all([
      prisma.budgetData.findMany({ where: { year: { in: years } } }),
      // 体験者数: ManualEntry の trial_count（店長手動入力）or MemberData trialDate
      prisma.manualEntry.findMany({ where: { year: { in: years } } }),
      prisma.memberData.findMany({
        select: { storeName: true, trialDate: true, firstTrialDate: true },
      }),
    ]);

    // 「実績データが入っている最終月」までに periods を自動キャップする（坪井さん要望）。
    // 例: 通期12ヶ月のうち1〜4月までしか売上/人件費が入っていない場合、
    // 予算・前期比も 1〜4月（つまり「入っている分」）に揃える。
    // 8ヶ月分入ってれば 8ヶ月分で比較できる。
    const periodKey = (y: number, m: number) => y * 100 + m;
    const dataKeys = new Set<number>();
    for (const r of allSalesDetail) dataKeys.add(periodKey(r.year, r.month));
    for (const r of allRevenue) dataKeys.add(periodKey(r.year, r.month));
    for (const r of allSquare) dataKeys.add(periodKey(r.year, r.month));
    for (const r of allPayroll) dataKeys.add(periodKey(r.year, r.month));
    for (const r of allExpenses) dataKeys.add(periodKey(r.year, r.month));
    for (const r of allMonthlySummary) dataKeys.add(periodKey(r.year, r.month));

    let cappedPeriods = periods;
    if (dataKeys.size > 0) {
      // periods の中で実績データのある最大キー
      let maxDataKey = 0;
      for (const p of periods) {
        const k = periodKey(p.year, p.month);
        if (dataKeys.has(k) && k > maxDataKey) maxDataKey = k;
      }
      if (maxDataKey > 0) {
        cappedPeriods = periods.filter(
          (p) => periodKey(p.year, p.month) <= maxDataKey,
        );
      }
    }

    const isInPeriod = (y: number, m: number) =>
      cappedPeriods.some((p) => p.year === y && p.month === m);

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
    // 非表示店舗（閉店/テスト店舗）を比較から除外
    const hiddenStores = await getHiddenStores();
    for (const h of hiddenStores) dynamicStoreSet.delete(h);
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

      // Expenses（依頼⑥: accrual を優先 / 依頼A: splitRatios + categorySplits 対応）
      let totalExpense = 0;
      for (const r of allExpenses) {
        const ey = r.accrualYear ?? r.year;
        const em = r.accrualMonth ?? r.month;
        if (!isInPeriod(ey, em)) continue;
        totalExpense += expenseRowShareWithCategorySplit(r, storeName);
      }

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
      // 退会率: 単月レコードの文字列ではなく、期間の退会数合計÷在籍(プラン契約者)合計で算出。
      // （従来は ms 1件の cancellation_rate 文字列を使っており、春日のように該当月が0%だと
      //   退会数があるのに0%表示になる不具合があった）
      const subscribersSum = msList.reduce((s, r) => s + r.planSubscribers, 0);
      const periodCancelRate =
        subscribersSum > 0 ? (cancellations / subscribersSum) * 100 : 0;

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
        cancellation_rate: `${periodCancelRate.toFixed(1)}%`,
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

    return {
      periods: periods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`),
      effective_periods: cappedPeriods.map(
        (p) => `${p.year}-${String(p.month).padStart(2, "0")}`,
      ),
      stores: storeData,
    };
    });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Store compare API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
