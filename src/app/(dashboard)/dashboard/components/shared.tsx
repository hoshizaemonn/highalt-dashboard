"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

// ─── Re-export recharts for use in components ──────────────
export {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
};

// ─── Constants ──────────────────────────────────────────────

export const COLORS = {
  blue: "#2196F3",
  red: "#F44336",
  orange: "#FF9800",
  green: "#4CAF50",
  gray: "#B0BEC5",
  purple: "#9C27B0",
  teal: "#009688",
};

export const PIE_COLORS = [
  "#2196F3", "#4CAF50", "#FF9800", "#9C27B0", "#009688",
  "#F44336", "#3F51B5", "#FF5722", "#607D8B", "#E91E63",
  "#00BCD4", "#8BC34A", "#FFC107", "#795548",
];

export const FISCAL_MONTHS = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export const PERIOD_OPTIONS = [
  { value: "通期", label: "通期（10〜9月）" },
  { value: "上期", label: "上期（10〜3月）" },
  { value: "下期", label: "下期（4〜9月）" },
  ...FISCAL_MONTHS.map((m) => ({ value: String(m), label: `${m}月` })),
];

// ─── Number formatting ─────────────────────────────────────

const yenFormat = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

export const numFormat = new Intl.NumberFormat("ja-JP");

export function formatYen(n: number): string {
  return yenFormat.format(n);
}

/**
 * グラフ軸用のコンパクト表記。日本の経営文脈に合わせて「万」基準で統一。
 * （旧仕様は 1000万円以上で "M" 表記が混ざっていたが、円文脈で英語単位は不自然）
 *   1000万円以上 → "1.2億"
 *   1万円以上    → "1,234万"
 *   それ以下     → そのまま
 */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億`;
  if (abs >= 10_000) return `${numFormat.format(Math.round(n / 10_000))}万`;
  return numFormat.format(n);
}

export function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * 数値の符号を表すマーク。色だけに頼らず形でも判別できるようにする
 * （色覚多様性: 男性の約5%が緑↔赤の判別が苦手）。
 *   plus → ▲（増加・プラス）
 *   minus → ▼（減少・マイナス）
 *   zero → ＝
 */
export function signMark(n: number): string {
  if (n > 0) return "▲";
  if (n < 0) return "▼";
  return "＝";
}

/**
 * 金額に符号マーク＋¥金額（絶対値）を返す。
 * 例: signedYen(-12000) → "▼¥12,000"
 */
export function signedYen(n: number): string {
  return `${signMark(n)}${formatYen(Math.abs(n))}`;
}

// ─── Types ──────────────────────────────────────────────────

export interface DashboardData {
  year: number;
  month: number | null;
  store: string | null;
  payroll: {
    total_labor_cost: number;
    fulltime_gross: number;
    parttime_gross: number;
    base_salary: number;
    position_allowance: number;
    overtime_pay: number;
    commute: number;
    taxable_total: number;
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
    /** PS001 商品別売上から算出した月会費合計（PS001未取込時は null） */
    monthly_fee_ps001: number | null;
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
  /** 前月の合計KPI（KPIカードの前月比表示に使用、データなしの場合 null） */
  prev_month_totals?: {
    revenue: number;
    labor: number;
    expense: number;
    profit: number;
  } | null;
  /** 前年同月の合計KPI（同上） */
  prev_year_totals?: {
    revenue: number;
    labor: number;
    expense: number;
    profit: number;
  } | null;
  total_revenue: number;
  total_labor: number;
  total_expense: number;
  operating_profit: number;
}

export interface MonthlyEntry {
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
  fulltime_count: number;
  parttime_count: number;
  employee_count: number;
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

export interface PlanBreakdownEntry {
  name: string;
  count: number;
}

export interface AnnualData {
  store: string | null;
  monthly_data: MonthlyEntry[];
}

export interface StoreCompareEntry {
  store: string;
  revenue: number;
  labor: number;
  expense: number;
  profit: number;
  plan_subscribers: number;
  cancellation_rate: string;
}

export interface StoreCompareData {
  stores: StoreCompareEntry[];
}

// ─── Shared components ─────────────────────────────────────

export function Skeleton() {
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

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
      <p className="font-medium">エラーが発生しました</p>
      <p className="text-sm mt-1">{message}</p>
    </div>
  );
}

export function KPICard({
  title,
  value,
  color,
  sub,
  help,
  current,
  previousMonth,
  previousYear,
  /** 数値が低いほど良い指標（人件費・経費）の場合は true。delta の色判定が反転する。 */
  lowerIsBetter,
}: {
  title: string;
  value: string;
  color: string;
  sub?: string;
  /** 用語の意味を ? アイコンホバーで補助表示する。 */
  help?: string;
  /** 前月比/前年同月比の計算に使う。指定すると delta バッジを自動表示。 */
  current?: number;
  previousMonth?: number | null;
  previousYear?: number | null;
  lowerIsBetter?: boolean;
}) {
  const showDelta = current !== undefined && (
    (previousMonth !== undefined && previousMonth !== null) ||
    (previousYear !== undefined && previousYear !== null)
  );
  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
        <span>{title}</span>
        {help && <HelpHint text={help} />}
      </p>
      <p className="text-xl font-bold mt-1" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      {showDelta && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col gap-0.5">
          {previousMonth !== undefined && previousMonth !== null && (
            <DeltaRow
              label="前月比"
              current={current!}
              previous={previousMonth}
              lowerIsBetter={lowerIsBetter}
            />
          )}
          {previousYear !== undefined && previousYear !== null && (
            <DeltaRow
              label="前年同月比"
              current={current!}
              previous={previousYear}
              lowerIsBetter={lowerIsBetter}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 前月比/前年同月比の1行。
 * ▲▼記号 + 増減率 + 増減額（絶対値） を表示し、色は良し悪しで切替。
 */
function DeltaRow({
  label,
  current,
  previous,
  lowerIsBetter,
}: {
  label: string;
  current: number;
  previous: number;
  lowerIsBetter?: boolean;
}) {
  const diff = current - previous;
  const ratio = previous !== 0 ? diff / previous : 0;
  // 数値が増えたか減ったか
  const isUp = diff > 0;
  // 増減が「良い」かどうか（人件費・経費は減ったほうが良い）
  const isGood = lowerIsBetter ? !isUp : isUp;
  const sign = isUp ? "▲" : diff < 0 ? "▼" : "＝";
  // パッと見で「良い/悪い」が分かるよう色をはっきり付ける（背景バッジ＋濃い文字色）
  const palette = diff === 0
    ? { bg: "#f3f4f6", text: "#6b7280" }              // gray
    : isGood
      ? { bg: "#dcfce7", text: "#15803d" }            // green-100 + green-700
      : { bg: "#fee2e2", text: "#b91c1c" };           // red-100 + red-700
  const ratioText = previous === 0
    ? "—"
    : `${(Math.abs(ratio) * 100).toFixed(1)}%`;
  return (
    <div className="text-[10px] flex items-center justify-between gap-1">
      <span className="text-gray-500">{label}</span>
      <span
        className="tabular-nums font-semibold px-1.5 py-0.5 rounded"
        style={{ backgroundColor: palette.bg, color: palette.text }}
      >
        {sign} {ratioText}
      </span>
    </div>
  );
}

/**
 * 用語解説用の小さな ? アイコン。ホバー/タップでカスタムツールチップを即時表示。
 * ブラウザ標準の title 属性は表示まで1〜2秒かかり、文字も小さく可読性が低いため、
 * 自前のツールチップ要素で 200ms 程度で表示する。
 *
 * 会計用語（予算比、客単価、課税支給合計 など）の理解を支援する。
 */
export function HelpHint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group/help align-middle">
      <button
        type="button"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[10px] font-bold cursor-help hover:bg-blue-100 hover:text-blue-700 transition-colors"
        aria-label={`説明: ${text}`}
        // タップでもツールチップを出すため、focusを当てる
        onClick={(e) => e.preventDefault()}
      >
        ?
      </button>
      {/* ツールチップ本体。group-hover/group-focus で即時表示 */}
      <span
        role="tooltip"
        className="
          pointer-events-none
          absolute left-1/2 -translate-x-1/2 bottom-full mb-2
          whitespace-normal w-64
          bg-gray-900 text-white text-xs leading-relaxed font-normal
          rounded-md px-3 py-2 shadow-lg
          opacity-0 invisible
          group-hover/help:opacity-100 group-hover/help:visible
          group-focus-within/help:opacity-100 group-focus-within/help:visible
          transition-opacity duration-150
          z-50
        "
      >
        {text}
        {/* 三角形の矢印 */}
        <span
          className="absolute top-full left-1/2 -translate-x-1/2 -mt-px
                     border-4 border-transparent border-t-gray-900"
          aria-hidden="true"
        />
      </span>
    </span>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-gray-700 mt-8 mb-3">{children}</h2>;
}

// Custom tooltip for charts
export function ChartTooltip({
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

export function MemberTooltip({
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

// ─── Budget helpers ────────────────────────────────────────

export interface BudgetRow {
  group: string;
  category: string;
  budget: number;
  actual: number;
  diff: number;
  ratio: number;
  isGood: boolean;
}

export function buildBudgetRows(
  budget: Record<string, number>,
  revenueByCategory: Record<string, number>,
  payrollData: { taxable_total: number; commute: number; legal_welfare: number },
  expenseByCategory: Record<string, number>,
  totalRevenue: number,
  totalExpense: number,
  operatingProfit: number,
): BudgetRow[] {
  const rows: BudgetRow[] = [];

  const REV_ITEMS = ["パーソナル・物販・その他収入", "月会費収入", "サービス収入", "自販機手数料収入"];
  const LABOR_ITEMS = ["正社員・契約社員給与", "賞与", "通勤手当", "法定福利費"];
  // Non-monetary KPI budgets stored in budget_data that must not roll up into the expense bucket
  const KPI_ITEMS = ["客単価"];

  // Build actuals mapping for budget items
  const actuals: Record<string, number> = {
    "月会費収入": revenueByCategory["月会費"] ?? 0,
    "パーソナル・物販・その他収入": (revenueByCategory["パーソナル"] ?? 0) + (revenueByCategory["オプション"] ?? 0) + (revenueByCategory["スポット"] ?? 0) + (revenueByCategory["入会金"] ?? 0) + (revenueByCategory["ロッカー"] ?? 0) + (revenueByCategory["その他"] ?? 0),
    "サービス収入": revenueByCategory["体験"] ?? 0,
    "自販機手数料収入": 0,
    "正社員・契約社員給与": payrollData.taxable_total ?? 0,
    "通勤手当": payrollData.commute ?? 0,
    "法定福利費": payrollData.legal_welfare ?? 0,
    ...expenseByCategory,
  };

  // Revenue items
  for (const item of REV_ITEMS) {
    const b = budget[item] ?? 0;
    const a = actuals[item] ?? 0;
    if (b === 0 && a === 0) continue;
    rows.push({ group: "売上", category: item, budget: b, actual: a, diff: a - b, ratio: b !== 0 ? a / b : 0, isGood: a >= b });
  }

  // Revenue total
  const revBudget = REV_ITEMS.reduce((s, i) => s + (budget[i] ?? 0), 0);
  rows.push({ group: "売上", category: "売上合計", budget: revBudget, actual: totalRevenue, diff: totalRevenue - revBudget, ratio: revBudget !== 0 ? totalRevenue / revBudget : 0, isGood: totalRevenue >= revBudget });

  // Labor items
  for (const item of LABOR_ITEMS) {
    const b = budget[item] ?? 0;
    const a = actuals[item] ?? 0;
    if (b === 0 && a === 0) continue;
    rows.push({ group: "人件費", category: item, budget: b, actual: a, diff: a - b, ratio: b !== 0 ? a / b : 0, isGood: a <= b });
  }

  // Labor total
  const laborBudget = LABOR_ITEMS.reduce((s, i) => s + (budget[i] ?? 0), 0);
  const laborActual = LABOR_ITEMS.reduce((s, i) => s + (actuals[i] ?? 0), 0);
  rows.push({ group: "人件費", category: "人件費合計", budget: laborBudget, actual: laborActual, diff: laborActual - laborBudget, ratio: laborBudget !== 0 ? laborActual / laborBudget : 0, isGood: laborActual <= laborBudget });

  // Expense rows — all budget items not in REV or LABOR
  let expBudgetSum = 0;
  for (const [cat, b] of Object.entries(budget)) {
    if (REV_ITEMS.includes(cat) || LABOR_ITEMS.includes(cat) || KPI_ITEMS.includes(cat)) continue;
    expBudgetSum += b;
    const a = actuals[cat] ?? expenseByCategory[cat] ?? 0;
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

  // Expense total (sum of individual expense budget items)
  rows.push({
    group: "経費",
    category: "経費合計",
    budget: expBudgetSum,
    actual: totalExpense,
    diff: totalExpense - expBudgetSum,
    ratio: expBudgetSum !== 0 ? totalExpense / expBudgetSum : 0,
    isGood: totalExpense <= expBudgetSum,
  });

  // Operating profit (calculated: revenue budget - labor budget - expense budget)
  const profitBudget = revBudget - laborBudget - expBudgetSum;
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
