// PL（損益計算書）月次集計の共通ロジック
// pl-xlsx / pl-csv 両エクスポートから利用する。

import { prisma } from "@/lib/prisma";
import { HQ_STORE } from "@/lib/constants";
import { toFiscalIndex, type PlMonthlyData } from "@/lib/pl-xlsx";
import {
  singleStoreShare,
  allStoresShare,
  expenseRowShare,
} from "@/lib/manual-expense-split";

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
        // 依頼A: splitRatios あり行はフィルタを跨ぐため OR で展開
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

  // 依頼A: splitRatios あり行は比率で配分
  const expenseTarget: string | null = store ? store : null;
  for (const r of allExpenses) {
    const ey = r.accrualYear ?? r.year;
    const em = r.accrualMonth ?? r.month;
    const idx = toFiscalIndex(ey, em, fiscalYear);
    if (idx === null) continue;
    const share = expenseRowShare(r, expenseTarget);
    if (share === 0) continue;
    const slot = ensureSlot(idx);
    const cat = r.category ?? "その他";
    if (cat === "仕入高") {
      slot.cogs += share;
    } else {
      slot.expenses[cat] = (slot.expenses[cat] ?? 0) + share;
    }
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
