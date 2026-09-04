// 前年比比較（人件費・消耗品費・広告宣伝費）のデータソース切り替え。
//
// 9期（2025/10〜2026/9）までは クライアント様の「予算実績対比表（損益計算書）」＝ pl_actuals を参照する。
// 10期（2026/10〜2027/9）からは スプレッドシート運用が廃止されるため（松尾さん依頼 2026-09）、
// ダッシュボードが毎月取り込んでいる給与CSV（payroll_data）・経費CSV（expense_data）を参照する。
//
// ★当年と前年で参照先を混ぜてはいけない。
//   同じ費目でも集計基準が違うため、混ぜると前年比が実態から大きくずれる
//   （人件費は予算実績対比表比で 94〜98%、賞与の扱い等で差が出る）。
//   そのため切り替えは「会計年度まるごと」で行い、当年・前年とも同じソースから読む。

import { prisma } from "@/lib/prisma";
import { expenseRowSharesByCategory } from "@/lib/manual-expense-split";

/** ダッシュボード集計を参照する最初の会計年度（＝10期。fiscalYear は年度末年） */
export const DASHBOARD_SOURCE_FROM_FISCAL_YEAR = 2027;

export type StoreFilter = string | { notIn: string[] } | { in: string[] };

export interface ComparisonSource {
  /** (費目, 年, 月) の金額（円） */
  amount: (cat: string, y: number, m: number) => number;
  /** (費目, 年, 月) にデータがある店舗数。取込途中の月を検出するために使う */
  coverage: (cat: string, y: number, m: number) => number;
  /** 満額とみなす店舗数 */
  expectedStores: number;
  /** 画面表示用のデータ出所 */
  sourceLabel: string;
}

/** その会計年度がどちらのソースを使うか */
export function usesDashboardSource(fiscalYear: number): boolean {
  return fiscalYear >= DASHBOARD_SOURCE_FROM_FISCAL_YEAR;
}

interface Ym {
  y: number;
  m: number;
}

/** 予算実績対比表（pl_actuals）から読む（9期まで） */
async function loadFromPlActuals(
  months: Ym[],
  storeFilter: StoreFilter,
): Promise<ComparisonSource> {
  const ymSet = new Set<string>();
  for (const mm of months) {
    ymSet.add(`${mm.y}-${mm.m}`);
    ymSet.add(`${mm.y - 1}-${mm.m}`);
  }
  const orConds = Array.from(ymSet).map((k) => {
    const [y, m] = k.split("-").map(Number);
    return { year: y, month: m };
  });

  const rows = await prisma.plActual.findMany({
    where: { storeName: storeFilter, OR: orConds },
  });

  const amt = new Map<string, number>();
  const cov = new Map<string, Set<string>>();
  const monthStores = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = `${r.category}:${r.year}:${r.month}`;
    amt.set(k, (amt.get(k) ?? 0) + r.amount);
    if (!cov.has(k)) cov.set(k, new Set());
    cov.get(k)!.add(r.storeName);
    const ymk = `${r.year}:${r.month}`;
    if (!monthStores.has(ymk)) monthStores.set(ymk, new Set());
    monthStores.get(ymk)!.add(r.storeName);
  }

  let expectedStores = 0;
  for (const s of monthStores.values()) {
    expectedStores = Math.max(expectedStores, s.size);
  }

  return {
    amount: (cat, y, m) => amt.get(`${cat}:${y}:${m}`) ?? 0,
    coverage: (cat, y, m) => cov.get(`${cat}:${y}:${m}`)?.size ?? 0,
    expectedStores,
    sourceLabel: "予算実績対比表（損益計算書）",
  };
}

/** ダッシュボードの取込データ（給与CSV・経費CSV）から読む（10期以降） */
async function loadFromDashboard(
  months: Ym[],
  storeFilter: StoreFilter,
): Promise<ComparisonSource> {
  // 当年・前年に加え、経費は発生主義（accrual）で前々年に遡ることがあるため広めに取る
  const years = new Set<number>();
  for (const mm of months) {
    years.add(mm.y);
    years.add(mm.y - 1);
    years.add(mm.y - 2);
  }
  const yearList = Array.from(years);
  const targetStore = typeof storeFilter === "string" ? storeFilter : null;

  const [payroll, expenses] = await Promise.all([
    prisma.payrollData.findMany({
      where: { year: { in: yearList }, storeName: storeFilter },
    }),
    prisma.expenseData.findMany({
      where: {
        year: { in: yearList },
        isRevenue: 0,
        // 按分行（splitRatios / categorySplits）は店舗フィルタを跨ぐため OR で拾う
        OR: [
          { storeName: storeFilter },
          { splitRatios: { not: null } },
          { categorySplits: { not: null } },
        ],
      },
    }),
  ]);

  const amt = new Map<string, number>();
  const cov = new Map<string, Set<string>>();
  const add = (cat: string, y: number, m: number, v: number, store: string) => {
    const k = `${cat}:${y}:${m}`;
    amt.set(k, (amt.get(k) ?? 0) + v);
    if (!cov.has(k)) cov.set(k, new Set());
    cov.get(k)!.add(store);
  };

  // 人件費: pl-data.ts（PL出力）と同じ定義にそろえる。
  // 基本給＋役職手当＋残業代 ＋ 通勤費 ＋ 会社負担の法定福利費、いずれも按分率を適用。
  for (const r of payroll) {
    const v =
      ((r.baseSalary + r.positionAllowance + r.overtimePay) +
        (r.commuteTaxable + r.commuteNontax) +
        (r.healthInsuranceCo +
          r.careInsuranceCo +
          r.pensionCo +
          r.childContributionCo +
          r.pensionFundCo +
          r.employmentInsuranceCo +
          r.workersCompCo +
          r.generalContributionCo)) *
      (r.ratio / 100);
    add("人件費", r.year, r.month, v, r.storeName);
  }

  // 経費: 発生主義の年月に寄せ、按分・科目分解を考慮して科目別に配分する。
  // 経費は月の銀行明細をまとめて取り込むため、「その月にその店舗の明細が入っているか」で
  // 取込済みかを判断する（科目の行が無い＝その月は使わなかった、なので科目単位では見ない）。
  const expenseMonthStores = new Map<string, Set<string>>();
  for (const r of expenses) {
    const y = r.accrualYear ?? r.year;
    const m = r.accrualMonth ?? r.month;
    const ymk = `${y}:${m}`;
    if (!expenseMonthStores.has(ymk)) expenseMonthStores.set(ymk, new Set());
    expenseMonthStores.get(ymk)!.add(r.storeName);

    const shares = expenseRowSharesByCategory(r, targetStore);
    for (const [cat, share] of Object.entries(shares)) {
      if (cat !== "消耗品費" && cat !== "広告宣伝費") continue;
      const k = `${cat}:${y}:${m}`;
      amt.set(k, (amt.get(k) ?? 0) + share);
    }
  }

  let expectedStores = 0;
  const payrollMonthStores = new Map<string, Set<string>>();
  for (const r of payroll) {
    const ymk = `${r.year}:${r.month}`;
    if (!payrollMonthStores.has(ymk)) payrollMonthStores.set(ymk, new Set());
    payrollMonthStores.get(ymk)!.add(r.storeName);
  }
  for (const s of payrollMonthStores.values()) {
    expectedStores = Math.max(expectedStores, s.size);
  }
  for (const s of expenseMonthStores.values()) {
    expectedStores = Math.max(expectedStores, s.size);
  }

  return {
    amount: (cat, y, m) => amt.get(`${cat}:${y}:${m}`) ?? 0,
    coverage: (cat, y, m) => {
      const ymk = `${y}:${m}`;
      if (cat === "人件費") {
        return payrollMonthStores.get(ymk)?.size ?? cov.get(`${cat}:${y}:${m}`)?.size ?? 0;
      }
      return expenseMonthStores.get(ymk)?.size ?? 0;
    },
    expectedStores,
    sourceLabel: "ダッシュボード取込データ（給与CSV・経費CSV）",
  };
}

export async function loadComparisonSource(
  fiscalYear: number,
  months: Ym[],
  storeFilter: StoreFilter,
): Promise<ComparisonSource> {
  return usesDashboardSource(fiscalYear)
    ? loadFromDashboard(months, storeFilter)
    : loadFromPlActuals(months, storeFilter);
}
