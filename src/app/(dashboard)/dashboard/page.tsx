"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import { STORES } from "@/lib/constants";
import {
  FISCAL_MONTHS,
  Skeleton,
  ErrorMessage,
  DashboardData,
  AnnualData,
  MonthlyEntry,
  StoreCompareData,
  PlanBreakdownEntry,
} from "./components/shared";
import PeriodSelector from "./components/PeriodSelector";
import MonthlyView from "./components/MonthlyView";
import PeriodView from "./components/PeriodView";

// ─── Constants ──────────────────────────────────────────────

const STORE_OPTIONS = [...STORES, "全体"] as const;

// ─── Main Dashboard Page ────────────────────────────────────

export default function DashboardPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [period, setPeriod] = useState("通期");
  const [store, setStore] = useState("全体");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionStoreName, setSessionStoreName] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  // Check admin status and store name from session cookie (read via API)
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.role === "admin") setIsAdmin(true);
        if (data?.storeName) setSessionStoreName(data.storeName);
      })
      .catch(() => {});
  }, []);

  // Monthly data (single month selected)
  const [monthlyData, setMonthlyData] = useState<DashboardData | null>(null);

  // Annual/period data (通期/上期/下期 selected)
  const [annualData, setAnnualData] = useState<AnnualData | null>(null);
  const [storeCompareData, setStoreCompareData] = useState<StoreCompareData | null>(null);
  const [periodBudget, setPeriodBudget] = useState<Record<string, number>>({});
  const [planBreakdown, setPlanBreakdown] = useState<PlanBreakdownEntry[] | null>(null);

  const isMonthly = !["通期", "上期", "下期"].includes(period);
  const isAllStores = store === "全体";

  // Build fiscal year months string for store-compare API
  const buildMonthsParam = useCallback(
    (y: number, p: string) => {
      const pairs: string[] = [];
      if (p === "通期") {
        for (let m = 10; m <= 12; m++)
          pairs.push(`${y}-${String(m).padStart(2, "0")}`);
        for (let m = 1; m <= 9; m++)
          pairs.push(`${y + 1}-${String(m).padStart(2, "0")}`);
      } else if (p === "上期") {
        for (let m = 10; m <= 12; m++)
          pairs.push(`${y}-${String(m).padStart(2, "0")}`);
        for (let m = 1; m <= 3; m++)
          pairs.push(`${y + 1}-${String(m).padStart(2, "0")}`);
      } else if (p === "下期") {
        for (let m = 4; m <= 9; m++)
          pairs.push(`${y + 1}-${String(m).padStart(2, "0")}`);
      }
      return pairs.join(",");
    },
    [],
  );

  // Determine the actual calendar year/month for API calls
  const getCalendarYearMonth = useCallback(
    (y: number, monthStr: string) => {
      const m = parseInt(monthStr, 10);
      // The year selector represents the calendar year directly
      // No fiscal year conversion needed for monthly view
      return { calYear: y, calMonth: m };
    },
    [],
  );

  // Fetch data
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      setMonthlyData(null);
      setAnnualData(null);
      setStoreCompareData(null);
      setPeriodBudget({});
      setPlanBreakdown(null);

      try {
        if (isMonthly) {
          // Single month
          const { calYear, calMonth } = getCalendarYearMonth(year, period);
          const params = new URLSearchParams({
            year: String(calYear),
            month: String(calMonth),
          });
          if (!isAllStores) params.set("store", store);

          const res = await fetch(`/api/dashboard?${params}`);
          if (!res.ok) throw new Error(`API error: ${res.status}`);
          const data = await res.json();
          if (!cancelled) setMonthlyData(data);
        } else {
          // Period view — use annual endpoint
          // Year selector = fiscal year end (e.g. 2026 = 2025/10〜2026/9期)
          const annualParams = new URLSearchParams({
            fiscalYear: String(year),
          });
          if (!isAllStores) annualParams.set("store", store);

          // For 上期/下期, specify monthStart/monthEnd
          if (period === "上期") {
            annualParams.set("monthStart", "10");
            annualParams.set("monthEnd", "12");
            // Also need Jan-Mar of next year
            // The annual API with fiscalYear handles the full year;
            // We'll filter client-side for 上期/下期
          }

          const fetches: Promise<Response>[] = [
            fetch(`/api/dashboard/annual?${annualParams}`),
          ];

          // Store comparison (only when 全体)
          if (isAllStores) {
            const monthsParam = buildMonthsParam(year, period);
            fetches.push(
              fetch(`/api/dashboard/store-compare?months=${monthsParam}`),
            );
          }

          // Budget data (when store is not 全体, fetch from main endpoint without month)
          if (!isAllStores) {
            // Get budget by fetching dashboard without month
            const budgetParams = new URLSearchParams({
              year: String(year),
              store,
            });
            // We need to fetch budget for the fiscal year period
            // Use the same dashboard endpoint with calendar year
            // Actually, budget is per month so we aggregate via annual
            fetches.push(fetch(`/api/dashboard?${budgetParams}`));
          }

          const responses = await Promise.all(fetches);
          for (const r of responses) {
            if (!r.ok) throw new Error(`API error: ${r.status}`);
          }

          const annualJson = await responses[0].json();

          if (!cancelled) {
            // Filter monthly data for 上期/下期
            let filteredMonthly = annualJson.monthly_data;
            if (period === "上期") {
              filteredMonthly = filteredMonthly.filter(
                (m: MonthlyEntry) => m.month >= 10 || m.month <= 3,
              );
            } else if (period === "下期") {
              filteredMonthly = filteredMonthly.filter(
                (m: MonthlyEntry) => m.month >= 4 && m.month <= 9,
              );
            }

            setAnnualData({
              ...annualJson,
              monthly_data: filteredMonthly,
            });

            if (isAllStores && responses.length > 1) {
              const compareJson = await responses[1].json();
              setStoreCompareData(compareJson);
            }

            if (!isAllStores && responses.length > 1) {
              const budgetJson = await responses[responses.length - 1].json();
              setPeriodBudget(budgetJson.budget || {});
            }

            // Fetch plan breakdown for the latest month with data
            const monthsWithMembers = filteredMonthly
              .filter((m: MonthlyEntry) => m.ma_plan_subscribers > 0)
              .sort((a: MonthlyEntry, b: MonthlyEntry) => {
                // Sort by year-month descending (higher month later in fiscal year)
                const aIdx = FISCAL_MONTHS.indexOf(a.month);
                const bIdx = FISCAL_MONTHS.indexOf(b.month);
                return bIdx - aIdx;
              });

            if (monthsWithMembers.length > 0) {
              const latestMonth = monthsWithMembers[0] as MonthlyEntry;
              // Determine calendar year for this month
              const calYear = latestMonth.month >= 10 ? year - 1 : year;
              const planParams = new URLSearchParams({
                year: String(calYear),
                month: String(latestMonth.month),
              });
              if (!isAllStores) planParams.set("store", store);
              try {
                const planRes = await fetch(`/api/dashboard/plan-breakdown?${planParams}`);
                if (planRes.ok) {
                  const planJson = await planRes.json();
                  if (!cancelled) setPlanBreakdown(planJson.plans ?? null);
                }
              } catch {
                // Plan breakdown is optional, don't fail
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "データの取得に失敗しました");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [year, period, store, isMonthly, isAllStores, getCalendarYearMonth, buildMonthsParam, refreshCount]);

  // Compute calendar year/month for MonthlyView props
  const calendarYM = useMemo(() => {
    if (!isMonthly) return { calYear: year, calMonth: 1 };
    return getCalendarYearMonth(year, period);
  }, [year, period, isMonthly, getCalendarYearMonth]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="text-[#567FC0]" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">ダッシュボード</h1>
      </div>

      {/* Period selector */}
      <PeriodSelector
        year={year}
        period={period}
        store={store}
        onYearChange={setYear}
        onPeriodChange={setPeriod}
        onStoreChange={setStore}
      />

      {/* Content */}
      {loading && <Skeleton />}
      {error && <ErrorMessage message={error} />}

      {!loading && !error && isMonthly && monthlyData && (
        <MonthlyView
          data={monthlyData}
          isAllStores={isAllStores}
          year={calendarYM.calYear}
          month={calendarYM.calMonth}
          store={store}
          isAdmin={isAdmin}
          sessionStoreName={sessionStoreName}
          onRefresh={() => setRefreshCount((c) => c + 1)}
        />
      )}

      {!loading && !error && !isMonthly && annualData && (
        <PeriodView
          annualData={annualData}
          storeCompareData={storeCompareData}
          isAllStores={isAllStores}
          budgetData={periodBudget}
          store={store}
          planBreakdown={planBreakdown}
          fiscalYear={year}
        />
      )}

      {!loading && !error && !monthlyData && !annualData && (
        <div className="bg-white rounded-lg border shadow-sm p-8 text-center">
          <p className="text-gray-500">
            データがありません。先にデータをアップロードしてください。
          </p>
        </div>
      )}
    </div>
  );
}
