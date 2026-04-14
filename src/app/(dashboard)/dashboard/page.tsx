"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import { STORES } from "@/lib/constants";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

// ─── Constants ──────────────────────────────────────────────

const COLORS = {
  blue: "#2196F3",
  red: "#F44336",
  orange: "#FF9800",
  green: "#4CAF50",
  gray: "#B0BEC5",
  purple: "#9C27B0",
  teal: "#009688",
};

const FISCAL_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const PERIOD_OPTIONS = [
  { value: "通期", label: "通期（10〜9月）" },
  { value: "上期", label: "上期（10〜3月）" },
  { value: "下期", label: "下期（4〜9月）" },
  ...FISCAL_MONTHS.map((m) => ({ value: String(m), label: `${m}月` })),
];

const STORE_OPTIONS = [...STORES, "全体"] as const;

// ─── Number formatting ─────────────────────────────────────

const yenFormat = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const numFormat = new Intl.NumberFormat("ja-JP");

function formatYen(n: number): string {
  return yenFormat.format(n);
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(0)}万`;
  return numFormat.format(n);
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Types ──────────────────────────────────────────────────

interface DashboardData {
  year: number;
  month: number | null;
  store: string | null;
  payroll: {
    total_labor_cost: number;
    fulltime_gross: number;
    parttime_gross: number;
    total_hours: number;
    employee_count: number;
    fulltime_count: number;
    parttime_count: number;
    legal_welfare: number;
  };
  expense: {
    total: number;
    by_category: Record<string, number>;
  };
  revenue: {
    total: number;
    sales_total: number;
    square_total: number;
    by_category: Record<string, number>;
  };
  member: {
    plan_subscribers: number;
    new_plan_signups: number;
    cancellations: number;
    suspensions: number;
    cancellation_rate: string;
    plan_changes: number;
    total_members: number;
  } | null;
  budget: Record<string, number>;
  total_revenue: number;
  total_labor: number;
  total_expense: number;
  operating_profit: number;
}

interface MonthlyEntry {
  month: number;
  month_label: string;
  revenue: number;
  labor_cost: number;
  expense: number;
  operating_profit: number;
  ma_total_members: number;
  ma_plan_subscribers: number;
  ma_new_signups: number;
  ma_cancellations: number;
  ma_suspensions: number;
  ma_cancel_rate: string;
  expense_by_category: Record<string, number>;
  sales_by_category: Record<string, number>;
}

interface AnnualData {
  store: string | null;
  monthly_data: MonthlyEntry[];
}

interface StoreCompareEntry {
  store: string;
  revenue: number;
  labor: number;
  expense: number;
  profit: number;
  plan_subscribers: number;
  cancellation_rate: string;
}

interface StoreCompareData {
  stores: StoreCompareEntry[];
}

// ─── Shared components ─────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-lg border shadow-sm p-4 h-24">
            <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
            <div className="h-6 bg-gray-200 rounded w-32" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border shadow-sm p-6 h-64">
        <div className="h-4 bg-gray-200 rounded w-40 mb-4" />
        <div className="h-48 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
      <p className="font-medium">エラーが発生しました</p>
      <p className="text-sm mt-1">{message}</p>
    </div>
  );
}

function KPICard({
  title,
  value,
  color,
  sub,
}: {
  title: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <p className="text-xs text-gray-500 font-medium">{title}</p>
      <p className="text-xl font-bold mt-1" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-gray-700 mt-8 mb-3">{children}</h2>;
}

// Custom tooltip for charts
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {formatYen(entry.value)}
        </p>
      ))}
    </div>
  );
}

function MemberTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-bold mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {numFormat.format(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Period selector component ──────────────────────────────

function PeriodSelector({
  year,
  period,
  store,
  onYearChange,
  onPeriodChange,
  onStoreChange,
}: {
  year: number;
  period: string;
  store: string;
  onYearChange: (y: number) => void;
  onPeriodChange: (p: string) => void;
  onStoreChange: (s: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <select
        value={year}
        onChange={(e) => onYearChange(Number(e.target.value))}
        className="border rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        <option value={2025}>2025年</option>
        <option value={2026}>2026年</option>
      </select>
      <select
        value={period}
        onChange={(e) => onPeriodChange(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={store}
        onChange={(e) => onStoreChange(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {STORE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Budget vs Actual helpers ───────────────────────────────

const SALES_CATEGORIES = [
  "月会費",
  "パーソナル",
  "オプション",
  "入会金",
  "スポット",
  "体験",
  "ロッカー",
  "クーポン/割引",
  "その他",
];

const EXPENSE_BUDGET_CATEGORIES = [
  "人件費",
  "地代家賃",
  "水道光熱費",
  "消耗品費",
  "広告宣伝費",
  "委託料",
  "通信費",
  "賃借料",
  "支払手数料",
  "雑費",
  "その他経費",
];

interface BudgetRow {
  group: string;
  category: string;
  budget: number;
  actual: number;
  diff: number;
  ratio: number;
  isGood: boolean;
}

function buildBudgetRows(
  budget: Record<string, number>,
  revenueByCategory: Record<string, number>,
  laborCost: number,
  expenseByCategory: Record<string, number>,
  totalRevenue: number,
  totalExpense: number,
  operatingProfit: number,
): BudgetRow[] {
  const rows: BudgetRow[] = [];

  // Revenue rows
  for (const cat of SALES_CATEGORIES) {
    const b = budget[cat] ?? 0;
    const a = revenueByCategory[cat] ?? 0;
    if (b === 0 && a === 0) continue;
    const diff = a - b;
    const ratio = b !== 0 ? a / b : 0;
    rows.push({
      group: "売上",
      category: cat,
      budget: b,
      actual: a,
      diff,
      ratio,
      isGood: diff >= 0,
    });
  }

  // Revenue total
  const revBudget = budget["売上合計"] ?? 0;
  rows.push({
    group: "売上",
    category: "売上合計",
    budget: revBudget,
    actual: totalRevenue,
    diff: totalRevenue - revBudget,
    ratio: revBudget !== 0 ? totalRevenue / revBudget : 0,
    isGood: totalRevenue >= revBudget,
  });

  // Labor
  const laborBudget = budget["人件費"] ?? 0;
  rows.push({
    group: "人件費",
    category: "人件費",
    budget: laborBudget,
    actual: laborCost,
    diff: laborCost - laborBudget,
    ratio: laborBudget !== 0 ? laborCost / laborBudget : 0,
    isGood: laborCost <= laborBudget,
  });

  // Expense rows
  for (const cat of EXPENSE_BUDGET_CATEGORIES) {
    if (cat === "人件費") continue;
    const b = budget[cat] ?? 0;
    const a = expenseByCategory[cat] ?? 0;
    if (b === 0 && a === 0) continue;
    const diff = a - b;
    const ratio = b !== 0 ? a / b : 0;
    rows.push({
      group: "経費",
      category: cat,
      budget: b,
      actual: a,
      diff,
      ratio,
      isGood: diff <= 0,
    });
  }

  // Expense total
  const expBudget = budget["経費合計"] ?? 0;
  rows.push({
    group: "経費",
    category: "経費合計",
    budget: expBudget,
    actual: totalExpense,
    diff: totalExpense - expBudget,
    ratio: expBudget !== 0 ? totalExpense / expBudget : 0,
    isGood: totalExpense <= expBudget,
  });

  // Operating profit
  const profitBudget = budget["営業利益"] ?? 0;
  rows.push({
    group: "利益",
    category: "営業利益",
    budget: profitBudget,
    actual: operatingProfit,
    diff: operatingProfit - profitBudget,
    ratio: profitBudget !== 0 ? operatingProfit / profitBudget : 0,
    isGood: operatingProfit >= profitBudget,
  });

  return rows;
}

// ─── Monthly View component ─────────────────────────────────

function MonthlyView({
  data,
  isAllStores,
}: {
  data: DashboardData;
  isAllStores: boolean;
}) {
  const budgetRows = useMemo(() => {
    if (isAllStores || Object.keys(data.budget).length === 0) return [];
    return buildBudgetRows(
      data.budget,
      data.revenue.by_category,
      data.total_labor,
      data.expense.by_category,
      data.total_revenue,
      data.total_expense,
      data.operating_profit,
    );
  }, [data, isAllStores]);

  // Budget bar chart data
  const budgetChartData = useMemo(() => {
    if (budgetRows.length === 0) return [];
    return budgetRows
      .filter((r) =>
        ["売上合計", "人件費", "経費合計", "営業利益"].includes(r.category),
      )
      .map((r) => ({
        name: r.category,
        予算: r.budget,
        実績: r.actual,
      }));
  }, [budgetRows]);

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title="売上合計" value={formatYen(data.total_revenue)} color={COLORS.blue} />
        <KPICard title="人件費合計" value={formatYen(data.total_labor)} color={COLORS.red} />
        <KPICard title="経費合計" value={formatYen(data.total_expense)} color={COLORS.orange} />
        <KPICard
          title="営業利益"
          value={formatYen(data.operating_profit)}
          color={COLORS.green}
        />
      </div>

      {/* PL Table */}
      <SectionTitle>損益計算書 (PL)</SectionTitle>
      <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-2 font-medium text-gray-600">科目</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">金額</th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue */}
            <tr className="border-b bg-blue-50/50">
              <td className="px-4 py-2 font-bold text-blue-700" colSpan={2}>
                売上
              </td>
            </tr>
            {Object.entries(data.revenue.by_category)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, amt]) => (
                <tr key={`rev-${cat}`} className="border-b">
                  <td className="px-4 py-1.5 pl-8 text-gray-600">{cat}</td>
                  <td className="px-4 py-1.5 text-right">{formatYen(amt)}</td>
                </tr>
              ))}
            {data.revenue.square_total > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">Square売上</td>
                <td className="px-4 py-1.5 text-right">
                  {formatYen(data.revenue.square_total)}
                </td>
              </tr>
            )}
            <tr className="border-b font-bold">
              <td className="px-4 py-2 text-blue-700">売上合計</td>
              <td className="px-4 py-2 text-right text-blue-700">
                {formatYen(data.total_revenue)}
              </td>
            </tr>

            {/* Labor */}
            <tr className="border-b bg-red-50/50">
              <td className="px-4 py-2 font-bold text-red-700" colSpan={2}>
                人件費
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">正社員</td>
              <td className="px-4 py-1.5 text-right">
                {formatYen(data.payroll.fulltime_gross)}
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">パート・アルバイト</td>
              <td className="px-4 py-1.5 text-right">
                {formatYen(data.payroll.parttime_gross)}
              </td>
            </tr>
            <tr className="border-b font-bold">
              <td className="px-4 py-2 text-red-700">人件費合計</td>
              <td className="px-4 py-2 text-right text-red-700">
                {formatYen(data.total_labor)}
              </td>
            </tr>

            {/* Expenses */}
            <tr className="border-b bg-orange-50/50">
              <td className="px-4 py-2 font-bold text-orange-700" colSpan={2}>
                経費
              </td>
            </tr>
            {Object.entries(data.expense.by_category)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, amt]) => (
                <tr key={`exp-${cat}`} className="border-b">
                  <td className="px-4 py-1.5 pl-8 text-gray-600">{cat}</td>
                  <td className="px-4 py-1.5 text-right">{formatYen(amt)}</td>
                </tr>
              ))}
            <tr className="border-b font-bold">
              <td className="px-4 py-2 text-orange-700">経費合計</td>
              <td className="px-4 py-2 text-right text-orange-700">
                {formatYen(data.total_expense)}
              </td>
            </tr>

            {/* Operating Profit */}
            <tr className="bg-green-50">
              <td className="px-4 py-3 font-bold text-green-700">営業利益</td>
              <td className="px-4 py-3 text-right font-bold text-green-700">
                {formatYen(data.operating_profit)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Member Info */}
      {data.member && (
        <>
          <SectionTitle>会員情報 (MA002)</SectionTitle>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {isAllStores ? (
              <KPICard
                title="在籍会員数"
                value={numFormat.format(data.member.total_members)}
                color={COLORS.blue}
              />
            ) : (
              <>
                <KPICard
                  title="プラン契約者数"
                  value={numFormat.format(data.member.plan_subscribers)}
                  color={COLORS.blue}
                />
                <KPICard
                  title="新規入会"
                  value={numFormat.format(data.member.new_plan_signups)}
                  color={COLORS.green}
                />
                <KPICard
                  title="退会率"
                  value={data.member.cancellation_rate || "-"}
                  color={COLORS.red}
                />
                <KPICard
                  title="プラン変更"
                  value={numFormat.format(data.member.plan_changes)}
                  color={COLORS.orange}
                />
              </>
            )}
          </div>
          {!isAllStores && (
            <div className="grid grid-cols-3 gap-4 mt-3">
              <KPICard
                title="新規申込"
                value={numFormat.format(data.member.new_plan_signups)}
                color={COLORS.teal}
              />
              <KPICard
                title="退会"
                value={numFormat.format(data.member.cancellations)}
                color={COLORS.red}
              />
              <KPICard
                title="休会"
                value={numFormat.format(data.member.suspensions)}
                color={COLORS.gray}
              />
            </div>
          )}
        </>
      )}

      {/* Budget vs Actual */}
      {!isAllStores && budgetRows.length > 0 && (
        <>
          <SectionTitle>予算 vs 実績</SectionTitle>

          {/* Budget KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {(() => {
              const revRow = budgetRows.find((r) => r.category === "売上合計");
              const laborRow = budgetRows.find((r) => r.category === "人件費");
              const expRow = budgetRows.find((r) => r.category === "経費合計");
              const profitRow = budgetRows.find((r) => r.category === "営業利益");
              return (
                <>
                  <KPICard
                    title="売上達成率"
                    value={revRow ? formatPercent(revRow.ratio) : "-"}
                    color={revRow?.isGood ? COLORS.green : COLORS.red}
                    sub={revRow ? `予算差: ${formatYen(revRow.diff)}` : undefined}
                  />
                  <KPICard
                    title="人件費予算比"
                    value={laborRow ? formatPercent(laborRow.ratio) : "-"}
                    color={laborRow?.isGood ? COLORS.green : COLORS.red}
                    sub={laborRow ? `予算差: ${formatYen(laborRow.diff)}` : undefined}
                  />
                  <KPICard
                    title="経費予算比"
                    value={expRow ? formatPercent(expRow.ratio) : "-"}
                    color={expRow?.isGood ? COLORS.green : COLORS.red}
                    sub={expRow ? `予算差: ${formatYen(expRow.diff)}` : undefined}
                  />
                  <KPICard
                    title="営業利益予算差"
                    value={profitRow ? formatYen(profitRow.diff) : "-"}
                    color={profitRow?.isGood ? COLORS.green : COLORS.red}
                    sub={
                      profitRow ? `達成率: ${formatPercent(profitRow.ratio)}` : undefined
                    }
                  />
                </>
              );
            })()}
          </div>

          {/* Budget bar chart */}
          {budgetChartData.length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm p-4 mb-4">
              <p className="text-sm font-medium text-gray-600 mb-3">
                予算 vs 実績（主要科目）
              </p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={budgetChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => formatCompact(v)}
                    fontSize={11}
                  />
                  <YAxis type="category" dataKey="name" width={80} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar dataKey="予算" fill={COLORS.gray} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="実績" fill={COLORS.blue} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Budget detail table */}
          <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    カテゴリ
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">科目</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">予算</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">実績</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">
                    予算差
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">
                    予算比
                  </th>
                </tr>
              </thead>
              <tbody>
                {budgetRows.map((row, i) => {
                  const isSummary = ["売上合計", "経費合計", "営業利益", "人件費"].includes(
                    row.category,
                  );
                  return (
                    <tr
                      key={i}
                      className={`border-b ${isSummary ? "font-bold bg-gray-50" : ""}`}
                    >
                      <td className="px-4 py-1.5 text-gray-500">{row.group}</td>
                      <td className="px-4 py-1.5">{row.category}</td>
                      <td className="px-4 py-1.5 text-right">{formatYen(row.budget)}</td>
                      <td className="px-4 py-1.5 text-right">{formatYen(row.actual)}</td>
                      <td
                        className="px-4 py-1.5 text-right"
                        style={{ color: row.isGood ? COLORS.green : COLORS.red }}
                      >
                        {formatYen(row.diff)}
                      </td>
                      <td
                        className="px-4 py-1.5 text-right"
                        style={{ color: row.isGood ? COLORS.green : COLORS.red }}
                      >
                        {row.budget !== 0 ? formatPercent(row.ratio) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ─── Period View component ──────────────────────────────────

function PeriodView({
  annualData,
  storeCompareData,
  isAllStores,
  budgetData,
  store,
}: {
  annualData: AnnualData;
  storeCompareData: StoreCompareData | null;
  isAllStores: boolean;
  budgetData: Record<string, number>;
  store: string;
}) {
  const monthly = annualData.monthly_data;

  // Period totals
  const totals = useMemo(() => {
    const rev = monthly.reduce((s, m) => s + m.revenue, 0);
    const lab = monthly.reduce((s, m) => s + m.labor_cost, 0);
    const exp = monthly.reduce((s, m) => s + m.expense, 0);
    return {
      revenue: rev,
      labor: lab,
      expense: exp,
      profit: rev - lab - exp,
    };
  }, [monthly]);

  // Chart data
  const chartData = useMemo(
    () =>
      monthly.map((m) => ({
        name: m.month_label,
        売上: m.revenue,
        人件費: m.labor_cost,
        経費: m.expense,
        営業利益: m.operating_profit,
        プラン契約者数: m.ma_plan_subscribers,
        在籍会員数: m.ma_total_members,
        新規入会: m.ma_new_signups,
        退会: m.ma_cancellations,
        休会: m.ma_suspensions,
        退会率: parseFloat(m.ma_cancel_rate.replace("%", "")) || 0,
      })),
    [monthly],
  );

  // Budget vs actual per-month chart data
  const budgetVsActualCharts = useMemo(() => {
    if (isAllStores || Object.keys(budgetData).length === 0) return null;

    // We need per-month budget — fetch from annualData's monthly entries
    // Budget data is aggregated, so we divide equally if needed
    // Actually we should have per-month budget from the annual API
    // For now, show aggregated comparison
    return {
      revenue: {
        budget: budgetData["売上合計"] ?? 0,
        actual: totals.revenue,
      },
      profit: {
        budget: budgetData["営業利益"] ?? 0,
        actual: totals.profit,
      },
      labor: {
        budget: budgetData["人件費"] ?? 0,
        actual: totals.labor,
      },
      expense: {
        budget: budgetData["経費合計"] ?? 0,
        actual: totals.expense,
      },
    };
  }, [isAllStores, budgetData, totals]);

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title="売上合計" value={formatYen(totals.revenue)} color={COLORS.blue} />
        <KPICard title="人件費合計" value={formatYen(totals.labor)} color={COLORS.red} />
        <KPICard title="経費合計" value={formatYen(totals.expense)} color={COLORS.orange} />
        <KPICard
          title="営業利益"
          value={formatYen(totals.profit)}
          color={COLORS.green}
        />
      </div>

      {/* Main charts (2x2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Revenue trend */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">売上推移</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="売上" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Member trend */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">
            {isAllStores ? "在籍会員数推移" : "プラン契約者数推移"}
          </p>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip content={<MemberTooltip />} />
              <Line
                type="monotone"
                dataKey={isAllStores ? "在籍会員数" : "プラン契約者数"}
                stroke={COLORS.blue}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue vs Labor */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">売上 vs 人件費</p>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="売上"
                stroke={COLORS.blue}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="人件費"
                stroke={COLORS.red}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Expense breakdown or store comparison */}
        {isAllStores && storeCompareData ? (
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <p className="text-sm font-medium text-gray-600 mb-3">店舗別営業利益</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={storeCompareData.stores}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="store" fontSize={10} />
                <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="profit" name="営業利益" fill={COLORS.green} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <p className="text-sm font-medium text-gray-600 mb-3">経費内訳推移</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar
                  dataKey="人件費"
                  stackId="a"
                  fill={COLORS.red}
                />
                <Bar
                  dataKey="経費"
                  stackId="a"
                  fill={COLORS.orange}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* MA002 charts */}
      <SectionTitle>会員推移 (MA002)</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">
            新規入会 / 退会 / 休会推移
          </p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip content={<MemberTooltip />} />
              <Legend />
              <Bar dataKey="新規入会" fill={COLORS.green} radius={[4, 4, 0, 0]} />
              <Bar dataKey="退会" fill={COLORS.red} radius={[4, 4, 0, 0]} />
              <Bar dataKey="休会" fill={COLORS.gray} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">退会率推移</p>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis unit="%" fontSize={11} />
              <Tooltip
                formatter={(value) => [`${Number(value).toFixed(1)}%`, "退会率"]}
              />
              <Line
                type="monotone"
                dataKey="退会率"
                stroke={COLORS.red}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Budget vs Actual charts (store != 全体) */}
      {budgetVsActualCharts && (
        <>
          <SectionTitle>予算 vs 実績</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {(
              [
                {
                  title: "売上 予算vs実績",
                  data: budgetVsActualCharts.revenue,
                  goodWhen: "above",
                },
                {
                  title: "営業利益 予算vs実績",
                  data: budgetVsActualCharts.profit,
                  goodWhen: "above",
                },
                {
                  title: "人件費 予算vs実績",
                  data: budgetVsActualCharts.labor,
                  goodWhen: "below",
                },
                {
                  title: "経費 予算vs実績",
                  data: budgetVsActualCharts.expense,
                  goodWhen: "below",
                },
              ] as const
            ).map((item) => {
              const barData = [
                { name: item.title.split(" ")[0], 予算: item.data.budget, 実績: item.data.actual },
              ];
              const isGood =
                item.goodWhen === "above"
                  ? item.data.actual >= item.data.budget
                  : item.data.actual <= item.data.budget;
              return (
                <div key={item.title} className="bg-white rounded-lg border shadow-sm p-4">
                  <p className="text-sm font-medium text-gray-600 mb-1">{item.title}</p>
                  <p
                    className="text-xs mb-3"
                    style={{ color: isGood ? COLORS.green : COLORS.red }}
                  >
                    差額: {formatYen(item.data.actual - item.data.budget)} (
                    {item.data.budget !== 0
                      ? formatPercent(item.data.actual / item.data.budget)
                      : "-"}
                    )
                  </p>
                  <ResponsiveContainer width="100%" height={80}>
                    <BarChart data={barData} layout="vertical">
                      <XAxis
                        type="number"
                        tickFormatter={(v: number) => formatCompact(v)}
                        fontSize={11}
                      />
                      <YAxis type="category" dataKey="name" width={60} fontSize={11} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Bar dataKey="予算" fill={COLORS.gray} radius={[0, 4, 4, 0]} />
                      <Bar
                        dataKey="実績"
                        fill={isGood ? COLORS.green : COLORS.red}
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Store comparison (全体 only) */}
      {isAllStores && storeCompareData && (
        <>
          <SectionTitle>店舗比較</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Revenue comparison */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別売上</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={storeCompareData.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store" fontSize={10} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="revenue" name="売上" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Labor comparison */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別人件費</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={storeCompareData.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store" fontSize={10} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="labor" name="人件費" fill={COLORS.red} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Plan subscribers */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別プラン契約者数</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={storeCompareData.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store" fontSize={10} />
                  <YAxis fontSize={11} />
                  <Tooltip content={<MemberTooltip />} />
                  <Bar
                    dataKey="plan_subscribers"
                    name="プラン契約者数"
                    fill={COLORS.teal}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Cancellation rate */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別退会率</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={storeCompareData.stores.map((s) => ({
                    ...s,
                    cancel_rate_num:
                      parseFloat(s.cancellation_rate.replace("%", "")) || 0,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store" fontSize={10} />
                  <YAxis unit="%" fontSize={11} />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(1)}%`, "退会率"]}
                  />
                  <Bar
                    dataKey="cancel_rate_num"
                    name="退会率"
                    fill={COLORS.red}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* PL Monthly Breakdown Table */}
      <SectionTitle>月次PL推移</SectionTitle>
      <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[100px]">
                科目
              </th>
              {monthly.map((m) => (
                <th
                  key={m.month_label}
                  className="text-right px-3 py-2 font-medium text-gray-600 min-w-[100px]"
                >
                  {m.month_label}
                </th>
              ))}
              <th className="text-right px-3 py-2 font-medium text-gray-700 bg-gray-100 min-w-[110px]">
                合計
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b font-bold text-blue-700">
              <td className="px-3 py-1.5 sticky left-0 bg-white">売上</td>
              {monthly.map((m, i) => (
                <td key={i} className="px-3 py-1.5 text-right">
                  {formatYen(m.revenue)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right bg-gray-50">
                {formatYen(totals.revenue)}
              </td>
            </tr>
            <tr className="border-b font-bold text-red-700">
              <td className="px-3 py-1.5 sticky left-0 bg-white">人件費</td>
              {monthly.map((m, i) => (
                <td key={i} className="px-3 py-1.5 text-right">
                  {formatYen(m.labor_cost)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right bg-gray-50">
                {formatYen(totals.labor)}
              </td>
            </tr>
            <tr className="border-b font-bold text-orange-700">
              <td className="px-3 py-1.5 sticky left-0 bg-white">経費</td>
              {monthly.map((m, i) => (
                <td key={i} className="px-3 py-1.5 text-right">
                  {formatYen(m.expense)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right bg-gray-50">
                {formatYen(totals.expense)}
              </td>
            </tr>
            <tr className="border-b font-bold text-green-700 bg-green-50/50">
              <td className="px-3 py-2 sticky left-0 bg-green-50/50">営業利益</td>
              {monthly.map((m, i) => (
                <td key={i} className="px-3 py-2 text-right">
                  {formatYen(m.operating_profit)}
                </td>
              ))}
              <td className="px-3 py-2 text-right bg-green-50">
                {formatYen(totals.profit)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Main Dashboard Page ────────────────────────────────────

export default function DashboardPage() {
  const [year, setYear] = useState(2025);
  const [period, setPeriod] = useState("通期");
  const [store, setStore] = useState("全体");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monthly data (single month selected)
  const [monthlyData, setMonthlyData] = useState<DashboardData | null>(null);

  // Annual/period data (通期/上期/下期 selected)
  const [annualData, setAnnualData] = useState<AnnualData | null>(null);
  const [storeCompareData, setStoreCompareData] = useState<StoreCompareData | null>(null);
  const [periodBudget, setPeriodBudget] = useState<Record<string, number>>({});

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
      // Fiscal year: months 10-12 belong to the selected year,
      // months 1-9 belong to year+1
      if (m >= 10) return { calYear: y, calMonth: m };
      return { calYear: y + 1, calMonth: m };
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
          const fiscalYear = year + 1; // fiscal year label

          const annualParams = new URLSearchParams({
            fiscalYear: String(fiscalYear),
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
  }, [year, period, store, isMonthly, isAllStores, getCalendarYearMonth, buildMonthsParam]);

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
        <MonthlyView data={monthlyData} isAllStores={isAllStores} />
      )}

      {!loading && !error && !isMonthly && annualData && (
        <PeriodView
          annualData={annualData}
          storeCompareData={storeCompareData}
          isAllStores={isAllStores}
          budgetData={periodBudget}
          store={store}
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
