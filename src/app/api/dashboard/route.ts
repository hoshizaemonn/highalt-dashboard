import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HQ_STORE, STORES } from "@/lib/constants";
import { getHiddenStores } from "@/lib/hidden-stores";
import { memoCache } from "@/lib/memo-cache";

const CACHE_TTL_MS = 30_000;
import {
  requireSession,
  effectiveStoreScope,
  getEffectiveStoreFilter,
} from "@/lib/auth";
import { trialDateMonthWhere } from "@/lib/csv-utils";
import {
  parseSplitRatios,
  expenseRowShareWithCategorySplit,
  expenseRowSharesByCategory,
} from "@/lib/manual-expense-split";

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

    // 全体集計時は 本部 + 非表示店舗（閉店/テスト）を除外
    const hiddenStores = await getHiddenStores();
    const notHqOrHidden = { notIn: [HQ_STORE, ...hiddenStores] };
    // 複数店舗マネージャー対応のフィルタ（admin: 単店 or 全店 / 店長: 担当店舗のみ）
    const storeNameFilter = getEffectiveStoreFilter(
      auth.session,
      requestedStore,
      notHqOrHidden,
    );

    // 30秒キャッシュ: 同一フィルタを共有するセッション間でキャッシュを共有
    const cacheKey = `dashboard:${year}:${month ?? "all"}:${JSON.stringify(storeNameFilter)}`;
    const responseData = await memoCache(cacheKey, CACHE_TTL_MS, async () => {

    // ── Payroll ──────────────────────────────────────────────
    const payrollWhere = {
      year,
      ...(month !== undefined && { month }),
      storeName: storeNameFilter,
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
    let totalCommuteTaxable = 0;
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
      totalCommuteTaxable += row.commuteTaxable * ratio;
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
      // 課税支給合計から通勤手当(課税分)を除外して表示する
      // （CSVの「課税支給合計」は通勤手当課税分を含むが、運用上は基本給+役職手当+残業代のみを表示したい）
      taxable_total: Math.round(totalTaxableTotal - totalCommuteTaxable),
      total_hours: Math.round(totalHours * 10) / 10,
      employee_count: employeeIds.size,
      fulltime_count: fulltimeCount,
      parttime_count: parttimeCount,
      legal_welfare: Math.round(legalWelfare),
    };

    // ── Expenses ─────────────────────────────────────────────
    // 発生月対応（依頼⑥）: 内訳に "N月" 等があると accrualYear/Month に帰属月が記録される。
    // 集計は accrual を優先し、未設定なら決済年月を使う。
    // 単月クエリでも、他月決済かつ accrual=対象月 の行を拾うため広めに取得して JS で絞る。
    // 単店ビュー: target = 要求店舗、全体ビュー: target = null（全店合算）
    const expenseTarget: string | null = store && store !== "全体" ? store : null;
    const expenseFetchWhere = {
      // 当年＋前年（12月決済の前年帰属など跨年シフトに備える）
      year: { in: [year - 1, year] },
      // splitRatios / categorySplits あり行は店舗フィルタを跨ぐため OR で展開
      OR: [
        { storeName: storeNameFilter },
        { splitRatios: { not: null } },
        { categorySplits: { not: null } },
      ],
      isRevenue: 0,
    };

    const expenseRowsAll = await prisma.expenseData.findMany({
      where: expenseFetchWhere,
    });

    const expenseRows = expenseRowsAll.filter((row) => {
      const effYear = row.accrualYear ?? row.year;
      const effMonth = row.accrualMonth ?? row.month;
      if (effYear !== year) return false;
      if (month !== undefined && effMonth !== month) return false;
      return true;
    });

    const expenseByCategory: Record<string, number> = {};
    let totalExpense = 0;

    for (const row of expenseRows) {
      // categorySplits あれば科目別に分解、無ければ単一カテゴリで計上
      const sharesByCat = expenseRowSharesByCategory(row, expenseTarget);
      for (const [cat, share] of Object.entries(sharesByCat)) {
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + share;
        totalExpense += share;
      }
    }

    // ── 本部一括経費（admin 手動入力）を均等按分して加算 ─────────
    // 電気代・水道代・家賃など本部で一括支払いされ PayPay 銀行 CSV に現れない
    // 経費を、totalAmount / 営業店舗数 で按分する（坪井さん要望: 自動均等割で確定）。
    const manualExpenseRows = await prisma.manualExpenseEntry.findMany({
      where: {
        year,
        ...(month !== undefined && { month }),
      },
    });
    const storeCount = STORES.length;
    const isSingleStore = !!(store && store !== "全体");
    const manualExpenseByCategory: Record<string, number> = {};
    for (const row of manualExpenseRows) {
      // storeName 空 = 本部一括（均等按分 or splitRatios按分）、店舗名指定 = その店のみ計上
      let share = 0;
      const splitRatios = parseSplitRatios(row.splitRatios);
      if (row.storeName === "" && splitRatios) {
        // 手動按分（splitRatios 指定）: 比率に従って配分
        if (isSingleStore) {
          const r = splitRatios[store!] ?? 0;
          share = Math.round((row.totalAmount * r) / 100);
        } else {
          // 全体ビュー: 指定された店舗への配分合計
          const totalRatio = Object.values(splitRatios).reduce(
            (s, v) => s + v,
            0,
          );
          share = Math.round((row.totalAmount * totalRatio) / 100);
        }
      } else if (row.storeName === "") {
        // 本部一括（均等按分）: 単店ビューは均等按分、全体ビューは全額
        share = isSingleStore
          ? Math.round(row.totalAmount / storeCount)
          : row.totalAmount;
      } else {
        // 店舗別: 単店ビューは当該店のみ、全体ビューは全額合算
        if (isSingleStore) {
          if (row.storeName !== store) continue;
          share = row.totalAmount;
        } else {
          share = row.totalAmount;
        }
      }
      expenseByCategory[row.category] =
        (expenseByCategory[row.category] || 0) + share;
      manualExpenseByCategory[row.category] =
        (manualExpenseByCategory[row.category] || 0) + share;
      totalExpense += share;
    }

    // 消耗品費・広告宣伝費はクライアント公式PL（pl_actuals）を正とする（坪井さん決定）。
    // PayPay自動仕分けの誤分類（消耗品費が桁違い等）を避けるため、PLに該当月の値があれば上書き。
    const PL_OVERRIDE_CATS = ["消耗品費", "広告宣伝費"];
    const plExpRows = await prisma.plActual.findMany({
      where: {
        storeName: storeNameFilter,
        category: { in: PL_OVERRIDE_CATS },
        ...(month !== undefined ? { year, month } : { year }),
      },
      select: { category: true, amount: true },
    });
    if (plExpRows.length > 0) {
      const plByCat: Record<string, number> = {};
      for (const r of plExpRows) {
        plByCat[r.category] = (plByCat[r.category] || 0) + r.amount;
      }
      for (const cat of PL_OVERRIDE_CATS) {
        if (plByCat[cat] !== undefined) {
          const old = expenseByCategory[cat] || 0;
          expenseByCategory[cat] = plByCat[cat];
          totalExpense += plByCat[cat] - old;
        }
      }
    }

    const expenseSummary = {
      total: Math.round(totalExpense),
      by_category: expenseByCategory,
      manual_by_category: manualExpenseByCategory,
    };

    // ── Revenue / Sales ──────────────────────────────────────
    const commonWhere = {
      year,
      ...(month !== undefined && { month }),
      storeName: storeNameFilter,
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

    // ── 店長手動追記（坪井さん要望） ─────────────────────────
    // 単月ビューは store 指定必須相当だが、全体ビューでは複数店舗を合算する
    const manualWhere = { year, ...(month !== undefined && { month }), storeName: storeNameFilter };
    const manualRows = await prisma.manualEntry.findMany({ where: manualWhere });
    const manualTrial = manualRows.reduce((s, r) => s + r.trialCount, 0);
    const manualOtherSales = manualRows.reduce((s, r) => s + r.otherSalesAmount, 0);

    // 体験者数の自動算出（坪井さん要望: hacomono CSV由来で自動、手動で上書き可）
    // ML001 は時点スナップショットのため、年月別フィルタは trialDate / firstTrialDate を
    // 直接照合する（"YYYY/MM/" or "YYYY-MM-" で始まる文字列）。
    const memberStoreFilter = { storeName: storeNameFilter };
    const autoTrialCount = month !== undefined
      ? await prisma.memberData.count({
          where: { ...memberStoreFilter, ...trialDateMonthWhere(year, month) },
        })
      : await prisma.memberData.count({
          where: {
            ...memberStoreFilter,
            OR: [
              { trialDate: { startsWith: `${year}/` } },
              { trialDate: { startsWith: `${year}-` } },
              { firstTrialDate: { startsWith: `${year}/` } },
              { firstTrialDate: { startsWith: `${year}-` } },
            ],
          },
        });
    // 手動入力があればそれを使う、無ければ自動
    const effectiveTrialCount = manualTrial > 0 ? manualTrial : autoTrialCount;

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

    // 手動追記の「その他売上」は売上合計に含める（坪井さん要望: 請求書ベースの売上を計上）
    const totalRevenue = salesTotal + squareTotal + manualOtherSales;

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

    // ── Square アイテム別売上（あれば パーソナル/物販/サービス を分離） ──
    // クライアントが商品名にキーワード（パーソナル/物販/サービス）を入れて
    // 運用してくれた場合、SquareItemSales.classification ベースで集計する。
    // 取り込みがない月は従来通り SquareSales 合計＝物販扱いにフォールバック。
    const squareItemRows = await prisma.squareItemSales.findMany({
      where: commonWhere,
    });
    const squareItemByClass: Record<string, number> = {};
    for (const row of squareItemRows) {
      const key = row.classification || "その他";
      squareItemByClass[key] =
        (squareItemByClass[key] || 0) + row.grossSales;
    }
    const hasSquareItem = squareItemRows.length > 0;

    // 売上4分類（坪井さん要望: 会費/パーソナル/物販/その他）
    const salesMembership =
      (salesByCategory["月会費"] ?? 0) + (salesByCategory["入会金"] ?? 0);
    // パーソナル/物販は Square アイテム別売上が取り込まれていれば classification 由来、
    // 無ければ従来ロジック（PL001 摘要由来のパーソナル + SquareSales 全額=物販）。
    const salesPersonal = hasSquareItem
      ? squareItemByClass["パーソナル"] ?? 0
      : salesByCategory["パーソナル"] ?? 0;
    const salesProduct = hasSquareItem
      ? squareItemByClass["物販"] ?? 0
      : squareTotal;
    const salesService = hasSquareItem
      ? squareItemByClass["サービス"] ?? 0
      : 0;
    // その他 = hacomonoのスポット等 + 手動追記の請求書「その他」
    const salesOther =
      salesTotal - salesMembership - salesPersonal + manualOtherSales;

    const revenueSummary = {
      total: Math.round(totalRevenue),
      sales_total: Math.round(salesTotal),
      square_total: Math.round(squareTotal),
      by_category: salesByCategory,
      monthly_fee_ps001: monthlyFeeFromPs001,
      membership: Math.round(salesMembership),
      personal: Math.round(salesPersonal),
      product: Math.round(salesProduct),
      service: Math.round(salesService),
      other: Math.round(salesOther),
      square_item_loaded: hasSquareItem,
      square_item_by_class: squareItemByClass,
    };

    // ── Member Summary (MA002) ───────────────────────────────
    const memberWhere = {
      ...(month !== undefined && { year, month }),
      ...(month === undefined && { year }),
      ...(store && { storeName: storeNameFilter }),
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
            // 体験者数（坪井さん要望: 店長手動追記）。入会率 = 新規入会÷体験者数 の分母。
            trial_count: effectiveTrialCount,
          }
        : effectiveTrialCount > 0
        ? {
            plan_subscribers: 0,
            new_plan_signups: 0,
            cancellations: 0,
            suspensions: 0,
            cancellation_rate: "",
            plan_changes: 0,
            total_members: 0,
            trial_count: effectiveTrialCount,
          }
        : null;

    // ── Budget ───────────────────────────────────────────────
    const budgetWhere = {
      year,
      ...(month !== undefined && { month }),
      ...(store && { storeName: storeNameFilter }),
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
        const sf = { storeName: storeNameFilter };
        // payroll: grossTotal × ratio/100 を集計
        const payRows = await prisma.payrollData.findMany({
          where: { year: y, month: m, ...sf },
          select: { grossTotal: true, ratio: true },
        });
        const labor = payRows.reduce(
          (s, r) => s + r.grossTotal * (r.ratio / 100),
          0,
        );

        // 発生月対応（依頼⑥）: 当年＋前年から取得し、accrual優先で当該月の合計を算出
        // splitRatios / categorySplits あり行も拾うため OR で展開
        const expRowsForMonth = await prisma.expenseData.findMany({
          where: {
            year: { in: [y - 1, y] },
            isRevenue: 0,
            ...(store
              ? {
                  OR: [
                    { storeName: storeNameFilter },
                    { splitRatios: { not: null } },
                    { categorySplits: { not: null } },
                  ],
                }
              : {}),
          },
          select: {
            year: true,
            month: true,
            amount: true,
            storeName: true,
            splitRatios: true,
            categorySplits: true,
            accrualYear: true,
            accrualMonth: true,
          },
        });
        const expTarget: string | null = store && store !== "全体" ? store : null;
        const expenseTotal = expRowsForMonth.reduce((s, r) => {
          const ey = r.accrualYear ?? r.year;
          const em = r.accrualMonth ?? r.month;
          if (ey !== y || em !== m) return s;
          return s + expenseRowShareWithCategorySplit(r, expTarget);
        }, 0);

        const cw = {
          year: y,
          month: m,
          ...(store && { storeName: storeNameFilter }),
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

    return {
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
    };
    });

    // 社員給与の黒塗り（安蒜さん依頼）: 店長など非admin には社員の給与額を返さない。
    // 正社員給与・基本給・役職手当・残業手当を 0 に伏せ、payroll_masked を立てる。
    // 課税支給合計（基本給+役職手当+残業代の合算・社員/アルバイト混在）は店長にも表示するため伏せない。
    // アルバイト（契約社員給与）・通勤手当・法定福利費・総勤務時間・人件費合計も従来どおり表示。
    // ※ responseData はキャッシュ共有オブジェクトのため破壊的に変更せず、コピーを返す。
    if (auth.session.role !== "admin") {
      const masked = {
        ...responseData,
        payroll: {
          ...responseData.payroll,
          fulltime_gross: 0,
          base_salary: 0,
          position_allowance: 0,
          overtime_pay: 0,
        },
        payroll_masked: true,
      };
      return NextResponse.json(masked);
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
