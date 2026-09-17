// PL（損益計算書）月次集計の共通ロジック
// pl-xlsx / pl-csv 両エクスポートから利用する。

import { prisma } from "@/lib/prisma";
import { HQ_STORE } from "@/lib/constants";
import { toFiscalIndex, type PlMonthlyData } from "@/lib/pl-xlsx";
import {
  singleStoreShare,
  allStoresShare,
  expenseRowSharesByCategory,
  expenseRowShare,
} from "@/lib/manual-expense-split";

// 福利厚生費は EXPENSE_CATEGORIES / BUDGET_ITEMS 上は経費科目として選べるが、
// PL出力では人件費の内訳（正社員給与・賞与・通勤手当・法定福利費と並ぶ行）として
// 別枠 payrollWelfare に集計する（slot.expenses には入れない。pl-xlsx.ts 参照）。
const WELFARE_CATEGORY = "福利厚生費";
// 自販機手数料収入はPayPay銀行CSVの入金（is_revenue=1）で分類する売上科目。
// PL出力では salesVending（自販機手数料収入の専用行）に集計する。
const VENDING_REVENUE_CATEGORY = "自販機手数料収入";

export interface PlAggregateResult {
  fiscalYear: number;
  storeDisplayName: string;
  monthly: Map<number, PlMonthlyData>;
}

export async function aggregatePlForFiscalYear(
  fiscalYear: number,
  store: string,
): Promise<PlAggregateResult> {
  const years = [fiscalYear - 1, fiscalYear];
  // 経費は accrual 対応のため前々年も含めて拾う
  const expenseYears = [fiscalYear - 2, fiscalYear - 1, fiscalYear];

  const hiddenStores = (
    await prisma.storeDisplayName.findMany({
      where: { hidden: true },
      select: { storeName: true },
    })
  ).map((r) => r.storeName);
  const notHqOrHidden = { notIn: [HQ_STORE, ...hiddenStores] };

  const [
    allPayroll,
    allExpenses,
    allVendingRevenue,
    allSalesDetail,
    allRevenue,
    allSquare,
    allManualExpense,
    displayNames,
  ] = await Promise.all([
    prisma.payrollData.findMany({
      where: {
        year: { in: years },
        ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
      },
    }),
    prisma.expenseData.findMany({
      where: {
        year: { in: expenseYears },
        isRevenue: 0,
        // 依頼A: splitRatios / categorySplits あり行はフィルタを跨ぐため OR で展開
        OR: [
          { storeName: store ? store : notHqOrHidden },
          { splitRatios: { not: null } },
          { categorySplits: { not: null } },
        ],
      },
    }),
    // 自販機手数料収入（PayPay銀行CSVの入金・is_revenue=1）。
    // 通常の経費行とはスコープが逆（isRevenue: 1）なので別クエリで拾う。
    prisma.expenseData.findMany({
      where: {
        year: { in: expenseYears },
        isRevenue: 1,
        category: VENDING_REVENUE_CATEGORY,
        OR: [
          { storeName: store ? store : notHqOrHidden },
          { splitRatios: { not: null } },
        ],
      },
    }),
    prisma.salesDetail.findMany({
      where: {
        year: { in: years },
        ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
      },
    }),
    prisma.revenueData.findMany({
      where: {
        year: { in: years },
        ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
      },
    }),
    prisma.squareSales.findMany({
      where: {
        year: { in: years },
        ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
      },
    }),
    prisma.manualExpenseEntry.findMany({
      where: { year: { in: years } },
    }),
    prisma.storeDisplayName.findMany(),
  ]);

  const activeStores = (
    await prisma.storeDisplayName.findMany({ where: { hidden: false } })
  ).length;
  const storeCount = Math.max(activeStores || 7, 1);

  const displayMap = new Map(
    displayNames.map((d) => [d.storeName, d.displayName]),
  );
  const storeDisplayName = store
    ? (displayMap.get(store) ?? store)
    : "全体合計";

  const monthly = new Map<number, PlMonthlyData>();
  const ensureSlot = (idx: number): PlMonthlyData => {
    let slot = monthly.get(idx);
    if (!slot) {
      slot = {
        salesPersonalAndProduct: 0,
        salesMembership: 0,
        salesService: 0,
        salesVending: 0,
        cogs: 0,
        expenses: {},
        payrollFulltime: 0,
        payrollBonus: 0,
        payrollCommute: 0,
        payrollLegalWelfare: 0,
        payrollWelfare: 0,
      };
      monthly.set(idx, slot);
    }
    return slot;
  };

  const salesRows = allSalesDetail.length > 0 ? allSalesDetail : allRevenue;
  for (const r of salesRows) {
    const idx = toFiscalIndex(r.year, r.month, fiscalYear);
    if (idx === null) continue;
    const slot = ensureSlot(idx);
    const cat = r.category ?? "その他";
    if (cat === "月会費" || cat === "入会金") {
      slot.salesMembership += r.amount;
    } else {
      slot.salesPersonalAndProduct += r.amount;
    }
  }

  for (const r of allSquare) {
    const idx = toFiscalIndex(r.year, r.month, fiscalYear);
    if (idx === null) continue;
    ensureSlot(idx).salesPersonalAndProduct += r.grossSales;
  }

  // 依頼A: splitRatios / categorySplits に対応した科目別配分
  const expenseTarget: string | null = store ? store : null;
  for (const r of allExpenses) {
    const ey = r.accrualYear ?? r.year;
    const em = r.accrualMonth ?? r.month;
    const idx = toFiscalIndex(ey, em, fiscalYear);
    if (idx === null) continue;
    const sharesByCat = expenseRowSharesByCategory(r, expenseTarget);
    if (Object.keys(sharesByCat).length === 0) continue;
    const slot = ensureSlot(idx);
    for (const [cat, share] of Object.entries(sharesByCat)) {
      if (cat === "仕入高") {
        slot.cogs += share;
      } else if (cat === WELFARE_CATEGORY) {
        slot.payrollWelfare += share;
      } else {
        slot.expenses[cat] = (slot.expenses[cat] ?? 0) + share;
      }
    }
  }

  // 自販機手数料収入（is_revenue=1）
  for (const r of allVendingRevenue) {
    const ey = r.accrualYear ?? r.year;
    const em = r.accrualMonth ?? r.month;
    const idx = toFiscalIndex(ey, em, fiscalYear);
    if (idx === null) continue;
    const share = expenseRowShare(r, expenseTarget);
    if (share === 0) continue;
    ensureSlot(idx).salesVending += share;
  }

  for (const r of allManualExpense) {
    const idx = toFiscalIndex(r.year, r.month, fiscalYear);
    if (idx === null) continue;
    const amount = store
      ? singleStoreShare(r, store, storeCount)
      : allStoresShare(r);
    if (amount === 0) continue;
    const slot = ensureSlot(idx);
    if (r.category === "仕入高") {
      slot.cogs += amount;
    } else if (r.category === WELFARE_CATEGORY) {
      slot.payrollWelfare += amount;
    } else {
      slot.expenses[r.category] = (slot.expenses[r.category] ?? 0) + amount;
    }
  }

  for (const r of allPayroll) {
    const idx = toFiscalIndex(r.year, r.month, fiscalYear);
    if (idx === null) continue;
    const slot = ensureSlot(idx);
    slot.payrollFulltime +=
      (r.baseSalary + r.positionAllowance + r.overtimePay) * (r.ratio / 100);
    slot.payrollCommute +=
      (r.commuteTaxable + r.commuteNontax) * (r.ratio / 100);
    slot.payrollLegalWelfare +=
      (r.healthInsuranceCo +
        r.careInsuranceCo +
        r.pensionCo +
        r.childContributionCo +
        r.pensionFundCo +
        r.employmentInsuranceCo +
        r.workersCompCo +
        r.generalContributionCo) *
      (r.ratio / 100);
  }

  return { fiscalYear, storeDisplayName, monthly };
}

/**
 * 千円換算（円 → 千円、小数1位まで）
 */
export function yenToThousand(yen: number): number {
  if (!yen || !Number.isFinite(yen)) return 0;
  return Math.round(yen / 100) / 10;
}
