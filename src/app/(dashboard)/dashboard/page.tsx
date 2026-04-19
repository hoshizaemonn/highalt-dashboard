"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import { STORES, EXPENSE_CATEGORIES } from "@/lib/constants";
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

const PIE_COLORS = [
  "#2196F3", "#4CAF50", "#FF9800", "#9C27B0", "#009688",
  "#F44336", "#3F51B5", "#FF5722", "#607D8B", "#E91E63",
  "#00BCD4", "#8BC34A", "#FFC107", "#795548",
];

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
  budget_revenue: number;
  budget_labor: number;
  budget_expense: number;
  budget_profit: number;
}

interface PlanBreakdownEntry {
  name: string;
  count: number;
}

interface StorePlanBreakdown {
  store: string;
  plans: PlanBreakdownEntry[];
  total: number;
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

// ─── Plan Breakdown Pie Chart (monthly) ─────────────────

function PlanBreakdownPie({
  year,
  month,
  store,
}: {
  year: number;
  month: number;
  store: string;
}) {
  const [plans, setPlans] = useState<{ name: string; count: number }[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      store,
    });
    fetch(`/api/dashboard/plan-breakdown?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plans && data.plans.length > 0) {
          setPlans(data.plans.filter((p: { count: number }) => p.count > 0));
        } else {
          setPlans(null);
        }
      })
      .catch(() => setPlans(null));
  }, [year, month, store]);

  if (!plans || plans.length === 0) return null;

  const total = plans.reduce((s, p) => s + p.count, 0);

  return (
    <>
      <SectionTitle>プラン別会員数</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={plans}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label
              >
                {plans.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [
                  `${Number(value)}人（${((Number(value) / total) * 100).toFixed(1)}%）`,
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">
            合計: {total}人
          </p>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {plans.map((p, i) => (
              <div key={p.name} className="flex items-center gap-2 text-sm">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="font-medium">{p.count}人</span>
                <span className="text-gray-400 text-xs w-12 text-right">
                  {((p.count / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function RecalculateButton({
  year,
  month,
  onDone,
}: {
  year: number;
  month: number;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const doRecalc = async (allMonths: boolean) => {
    const label = allMonths ? `${year}年の全月` : `${year}年${month}月`;
    if (!confirm(`${label}の人件費データを最新の店舗マッピングで再計算します。よろしいですか？`)) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/dashboard/recalculate-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allMonths ? { year, allMonths: true } : { year, month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "エラー");
      setMsg(`${data.employees}件の店舗割り当てを再計算しました`);
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "エラーが発生しました");
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => doRecalc(false)}
        disabled={loading}
        className="text-sm bg-white border rounded-lg px-4 py-2 hover:bg-gray-50 text-gray-700 shadow-sm disabled:opacity-50"
      >
        {loading ? "再計算中..." : `🔄 ${month}月の店舗割り当てを再計算`}
      </button>
      <button
        onClick={() => doRecalc(true)}
        disabled={loading}
        className="text-sm bg-white border rounded-lg px-4 py-2 hover:bg-gray-50 text-gray-700 shadow-sm disabled:opacity-50"
      >
        {loading ? "再計算中..." : `🔄 ${year}年の全月を再計算`}
      </button>
      {msg && <span className="text-sm text-green-600">{msg}</span>}
    </div>
  );
}

// ─── Editable Member Section (MA002) ─────────────────────

interface MemberFields {
  total_members: number;
  plan_subscribers: number;
  new_plan_signups: number;
  cancellations: number;
  suspensions: number;
  cancellation_rate: string;
  plan_changes: number;
}

function EditableMemberSection({
  data,
  isAllStores,
  year,
  month,
  store,
  onSaved,
}: {
  data: DashboardData["member"];
  isAllStores: boolean;
  year: number;
  month: number;
  store: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<MemberFields>({
    total_members: 0,
    plan_subscribers: 0,
    new_plan_signups: 0,
    cancellations: 0,
    suspensions: 0,
    cancellation_rate: "",
    plan_changes: 0,
  });

  useEffect(() => {
    if (data) {
      setFields({
        total_members: data.total_members,
        plan_subscribers: data.plan_subscribers,
        new_plan_signups: data.new_plan_signups,
        cancellations: data.cancellations,
        suspensions: data.suspensions,
        cancellation_rate: data.cancellation_rate,
        plan_changes: data.plan_changes,
      });
    }
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/member-summary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          storeName: store,
          fields,
        }),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
      setEditing(false);
      onSaved();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: keyof MemberFields, value: string) => {
    setFields((prev) => ({
      ...prev,
      [key]: key === "cancellation_rate" ? value : (parseInt(value, 10) || 0),
    }));
  };

  function EditableKPI({
    title,
    fieldKey,
    color,
    isRate,
  }: {
    title: string;
    fieldKey: keyof MemberFields;
    color: string;
    isRate?: boolean;
  }) {
    const val = fields[fieldKey];
    if (!editing) {
      return (
        <KPICard
          title={title}
          value={isRate ? (String(val) || "-") : numFormat.format(Number(val))}
          color={color}
        />
      );
    }
    return (
      <div className="bg-white rounded-lg border shadow-sm p-4 ring-2 ring-blue-200">
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <input
          type={isRate ? "text" : "number"}
          value={String(val)}
          onChange={(e) => setField(fieldKey, e.target.value)}
          className="text-xl font-bold mt-1 w-full border-b-2 border-blue-300 outline-none bg-transparent"
          style={{ color }}
        />
      </div>
    );
  }

  // When in "全体" mode and no editing, show read-only
  if (isAllStores) {
    return (
      <>
        <SectionTitle>会員情報 (MA002)</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="在籍会員数"
            value={data ? numFormat.format(data.total_members) : "-"}
            color={COLORS.blue}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mt-8 mb-3">
        <h2 className="text-lg font-bold text-gray-700">会員情報 (MA002)</h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-xs bg-white border rounded px-3 py-1 hover:bg-gray-50 text-gray-600"
          >
            修正
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                if (data) {
                  setFields({
                    total_members: data.total_members,
                    plan_subscribers: data.plan_subscribers,
                    new_plan_signups: data.new_plan_signups,
                    cancellations: data.cancellations,
                    suspensions: data.suspensions,
                    cancellation_rate: data.cancellation_rate,
                    plan_changes: data.plan_changes,
                  });
                }
              }}
              className="text-xs bg-white border rounded px-3 py-1 hover:bg-gray-50 text-gray-600"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <EditableKPI title="プラン契約者数" fieldKey="plan_subscribers" color={COLORS.blue} />
        <EditableKPI title="新規入会" fieldKey="new_plan_signups" color={COLORS.green} />
        <EditableKPI title="退会率" fieldKey="cancellation_rate" color={COLORS.red} isRate />
        <EditableKPI title="プラン変更" fieldKey="plan_changes" color={COLORS.orange} />
      </div>
      <div className="grid grid-cols-3 gap-4 mt-3">
        <EditableKPI title="新規申込" fieldKey="new_plan_signups" color={COLORS.teal} />
        <EditableKPI title="退会" fieldKey="cancellations" color={COLORS.red} />
        <EditableKPI title="休会" fieldKey="suspensions" color={COLORS.gray} />
      </div>
    </>
  );
}

// ─── Promotion section (monthly) ──────────────────────────

interface PromotionData {
  trialReferral: number;
  trialNonReferral: number;
  trialTotal: number;
  trialJoinRate: number;
  trialSameDayRate: number;
  postingStaff: number;
  postingVendor: number;
  postingTotal: number;
  adGoogle: number;
  adMeta: number;
  adPosting: number;
  adDesign: number;
  adPrint: number;
  adGift: number;
  adEvent: number;
  adRecruit: number;
  adOther: number;
  adTotal: number;
  unitPrice: number;
  unitPriceBudget: number;
  optAthlete4: number;
  optAthlete8: number;
  optDrinkHyalchi: number;
  optDrinkNmn: number;
  optBoost4: number;
  optBoost8: number;
  personalRevenue: number;
  merchandiseRevenue: number;
  comment: string;
}

function PromotionSection({
  year,
  month,
  store,
}: {
  year: number;
  month: number;
  store: string;
}) {
  const [data, setData] = useState<PromotionData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const params = new URLSearchParams({
          year: String(year),
          month: String(month),
          store,
        });
        const res = await fetch(`/api/promotion?${params}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.report) setData(json.report);
        else if (!cancelled) setData(null);
      } catch {
        if (!cancelled) setData(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [year, month, store]);

  if (!data) return null;

  const adBreakdown = [
    { name: "Google", value: data.adGoogle },
    { name: "Meta", value: data.adMeta },
    { name: "ポスティング", value: data.adPosting },
    { name: "デザイン", value: data.adDesign },
    { name: "印刷", value: data.adPrint },
    { name: "ギフト", value: data.adGift },
    { name: "イベント", value: data.adEvent },
    { name: "求人", value: data.adRecruit },
    { name: "その他", value: data.adOther },
  ].filter((d) => d.value > 0);

  const trialChartData = [
    { name: "紹介", value: data.trialReferral },
    { name: "紹介以外", value: data.trialNonReferral },
  ];

  return (
    <>
      <SectionTitle>販促報告</SectionTitle>

      {/* Trial & Rates */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">体験数</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trialChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis type="category" dataKey="name" fontSize={11} width={80} />
              <Tooltip formatter={(v) => [`${v}人`, ""]} />
              <Bar dataKey="value" fill={COLORS.blue} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span>体験入会率: <strong className="text-gray-700">{data.trialJoinRate.toFixed(1)}%</strong></span>
            <span>即日入会率: <strong className="text-gray-700">{data.trialSameDayRate.toFixed(1)}%</strong></span>
          </div>
        </div>

        {/* Ad Spend Breakdown */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">
            広告宣伝費 ({formatYen(data.adTotal)})
          </p>
          {adBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={adBreakdown} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={11} tickFormatter={(v: number) => formatCompact(v)} />
                <YAxis type="category" dataKey="name" fontSize={11} width={80} />
                <Tooltip formatter={(v) => [formatYen(Number(v)), ""]} />
                <Bar dataKey="value" fill={COLORS.purple} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400">データなし</p>
          )}
        </div>
      </div>

      {/* Options + KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <KPICard
          title="客単価"
          value={formatYen(data.unitPrice)}
          color={COLORS.blue}
          sub={data.unitPriceBudget > 0 ? `予算: ${formatYen(data.unitPriceBudget)}（差: ${formatYen(data.unitPrice - data.unitPriceBudget)}）` : undefined}
        />
        <KPICard title="パーソナル売上" value={formatYen(data.personalRevenue)} color={COLORS.green} />
        <KPICard title="物販売上" value={formatYen(data.merchandiseRevenue)} color={COLORS.teal} />
      </div>

      {/* Options table */}
      {(data.optAthlete4 + data.optAthlete8 + data.optDrinkHyalchi + data.optDrinkNmn + data.optBoost4 + data.optBoost8) > 0 && (
        <div className="bg-white rounded-lg border shadow-sm p-4 mb-4">
          <p className="text-sm font-medium text-gray-600 mb-3">オプション</p>
          <table className="text-sm w-full max-w-md">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-3 py-1.5 font-medium text-gray-600">項目</th>
                <th className="text-right px-3 py-1.5 font-medium text-gray-600">件数</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "アスリート4回", val: data.optAthlete4 },
                { label: "アスリート8回", val: data.optAthlete8 },
                { label: "飲むハイアルチ8J", val: data.optDrinkHyalchi },
                { label: "NMN", val: data.optDrinkNmn },
                { label: "BOOST4回", val: data.optBoost4 },
                { label: "BOOST8回", val: data.optBoost8 },
              ]
                .filter((o) => o.val > 0)
                .map((o) => (
                  <tr key={o.label} className="border-b">
                    <td className="px-3 py-1.5 text-gray-700">{o.label}</td>
                    <td className="px-3 py-1.5 text-right">{numFormat.format(o.val)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {data.comment && (
        <div className="bg-white rounded-lg border shadow-sm p-4 mb-4">
          <p className="text-sm font-medium text-gray-600 mb-2">コメント</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{data.comment}</p>
        </div>
      )}
    </>
  );
}

// ─── Promotion section (period/annual) ────────────────────

interface PromotionMonthlyEntry {
  month: number;
  month_label: string;
  report: PromotionData | null;
}

function PromotionPeriodSection({
  fiscalYear,
  store,
  months,
}: {
  fiscalYear: number;
  store: string;
  months: number[];
}) {
  const [data, setData] = useState<PromotionMonthlyEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const params = new URLSearchParams({
          fiscalYear: String(fiscalYear),
        });
        if (store !== "全体") params.set("store", store);
        const res = await fetch(`/api/promotion/annual?${params}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) {
          const filtered = (json.monthly ?? []).filter(
            (m: PromotionMonthlyEntry) => months.includes(m.month),
          );
          setData(filtered);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fiscalYear, store, months]);

  if (!loaded) return null;

  const hasData = data.some((d) => d.report !== null);
  if (!hasData) return null;

  const trialChartData = data
    .filter((d) => d.report)
    .map((d) => ({
      name: d.month_label,
      紹介: d.report!.trialReferral,
      紹介以外: d.report!.trialNonReferral,
    }));

  const adChartData = data
    .filter((d) => d.report)
    .map((d) => ({
      name: d.month_label,
      Google: d.report!.adGoogle,
      Meta: d.report!.adMeta,
      ポスティング: d.report!.adPosting,
      デザイン: d.report!.adDesign,
      印刷: d.report!.adPrint,
      ギフト: d.report!.adGift,
      イベント: d.report!.adEvent,
      求人: d.report!.adRecruit,
      その他: d.report!.adOther,
    }));

  const AD_COLORS_MAP: Record<string, string> = {
    Google: "#2196F3",
    Meta: "#9C27B0",
    ポスティング: "#FF9800",
    デザイン: "#009688",
    印刷: "#F44336",
    ギフト: "#4CAF50",
    イベント: "#795548",
    求人: "#607D8B",
    その他: "#B0BEC5",
  };

  const adKeys = Object.keys(AD_COLORS_MAP);

  return (
    <>
      <SectionTitle>販促報告</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Trial trend */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">体験数の推移</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={trialChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => [`${v}人`, ""]} />
              <Legend />
              <Bar dataKey="紹介" stackId="a" fill={COLORS.blue} />
              <Bar dataKey="紹介以外" stackId="a" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Ad spend trend */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">広告宣伝費の推移</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={adChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip formatter={(v) => [formatYen(Number(v)), ""]} />
              <Legend />
              {adKeys.map((k) => (
                <Bar key={k} dataKey={k} stackId="a" fill={AD_COLORS_MAP[k]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

// ─── Expense Detail types & component ─────────────────────

interface ExpenseRecord {
  id: number;
  day: number;
  description: string | null;
  amount: number;
  category: string | null;
  breakdown: string;
}

interface EditedFields {
  amount?: number;
  category?: string;
  breakdown?: string;
}

function ExpenseDetailSection({
  year,
  month,
  store,
}: {
  year: number;
  month: number;
  store: string;
}) {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [edits, setEdits] = useState<Record<number, EditedFields>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setSaveMsg(null);
      setEdits({});
      try {
        const params = new URLSearchParams({
          year: String(year),
          month: String(month),
          store,
        });
        const res = await fetch(`/api/dashboard/expenses?${params}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (!cancelled) setExpenses(data.expenses ?? []);
      } catch {
        if (!cancelled) setExpenses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [year, month, store]);

  const handleEdit = (id: number, field: keyof EditedFields, value: string | number) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const hasChanges = Object.keys(edits).length > 0;

  const missingBreakdownCount = expenses.filter((e) => {
    const edited = edits[e.id];
    const bd = edited?.breakdown ?? e.breakdown;
    return !bd || bd.trim() === "";
  }).length;

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updates = Object.entries(edits).map(([id, fields]) => ({
        id: Number(id),
        ...fields,
      }));
      const res = await fetch("/api/dashboard/expenses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error("save failed");
      const result = await res.json();
      setSaveMsg(`${result.updated}件を保存しました`);
      // Apply edits to local state
      setExpenses((prev) =>
        prev.map((e) => {
          const ed = edits[e.id];
          if (!ed) return e;
          return {
            ...e,
            amount: ed.amount ?? e.amount,
            category: ed.category ?? e.category,
            breakdown: ed.breakdown ?? e.breakdown,
          };
        }),
      );
      setEdits({});
    } catch {
      setSaveMsg("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      store,
    });
    window.open(`/api/download/expense-csv?${params}`, "_blank");
  };

  if (loading) {
    return (
      <div className="animate-pulse mt-4">
        <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
        <div className="h-48 bg-gray-100 rounded" />
      </div>
    );
  }

  if (expenses.length === 0) return null;

  return (
    <>
      <SectionTitle>経費明細</SectionTitle>

      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={handleDownload}
          className="text-sm bg-white border rounded-lg px-3 py-1.5 hover:bg-gray-50 text-gray-700 shadow-sm"
        >
          📥 経費明細をダウンロード（CSV）
        </button>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 shadow-sm"
          >
            {saving ? "保存中…" : "変更を保存"}
          </button>
        )}
        {saveMsg && (
          <span className="text-sm text-green-600">{saveMsg}</span>
        )}
      </div>

      {(() => {
        const missingCatCount = expenses.filter((e) => {
          const cat = edits[e.id]?.category ?? e.category ?? "";
          return !cat;
        }).length;
        return (
          <div className="flex gap-4 mb-2">
            {missingCatCount > 0 && (
              <p className="text-sm text-red-600 font-medium">
                🔴 勘定科目 未分類: {missingCatCount}件
              </p>
            )}
            {missingBreakdownCount > 0 && (
              <p className="text-sm text-amber-600">
                🟡 内訳未入力: {missingBreakdownCount}件
              </p>
            )}
          </div>
        );
      })()}

      <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-12">日</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[160px]">摘要</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">金額</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-36">勘定科目</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[160px]">内訳</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => {
              const edited = edits[e.id] ?? {};
              const currentCategory = edited.category ?? e.category ?? "";
              const currentBreakdown = edited.breakdown ?? e.breakdown ?? "";
              const isMissingCategory = !currentCategory;
              const isMissingBreakdown = !currentBreakdown.trim();
              const rowBg = isMissingCategory
                ? "bg-red-50"
                : isMissingBreakdown
                ? "bg-yellow-50"
                : "";
              return (
                <tr key={e.id} className={`border-b hover:bg-gray-50/50 ${rowBg}`}>
                  <td className="px-3 py-1.5 text-gray-600">{e.day}</td>
                  <td className="px-3 py-1.5 text-gray-700">{e.description ?? ""}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      value={edited.amount ?? e.amount}
                      onChange={(ev) =>
                        handleEdit(e.id, "amount", Number(ev.target.value))
                      }
                      className="w-24 text-right border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={currentCategory}
                      onChange={(ev) =>
                        handleEdit(e.id, "category", ev.target.value)
                      }
                      className={`border rounded px-2 py-0.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-300 ${
                        isMissingCategory ? "border-red-400 bg-red-50 text-red-700" : ""
                      }`}
                    >
                      <option value="">🔴 未分類</option>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={currentBreakdown}
                      onChange={(ev) =>
                        handleEdit(e.id, "breakdown", ev.target.value)
                      }
                      className={`w-full border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300 ${
                        isMissingBreakdown ? "border-amber-400 bg-amber-50" : ""
                      }`}
                      placeholder="🟡 未入力"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
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
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="relative">
        <label className="block text-xs font-medium text-gray-500 mb-1">年</label>
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 appearance-none"
          style={{ WebkitAppearance: "menulist" }}
        >
          {Array.from({ length: new Date().getFullYear() - 2020 + 6 }, (_, i) => 2020 + i).map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
      </div>
      <div className="relative">
        <label className="block text-xs font-medium text-gray-500 mb-1">期間</label>
        <select
          value={period}
          onChange={(e) => onPeriodChange(e.target.value)}
          size={1}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          style={{ WebkitAppearance: "menulist" }}
        >
          {PERIOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="relative">
        <label className="block text-xs font-medium text-gray-500 mb-1">店舗</label>
        <select
          value={store}
          onChange={(e) => onStoreChange(e.target.value)}
          size={1}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          style={{ WebkitAppearance: "menulist" }}
        >
          {STORE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
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
  payrollData: { taxable_total: number; commute: number; legal_welfare: number },
  expenseByCategory: Record<string, number>,
  totalRevenue: number,
  totalExpense: number,
  operatingProfit: number,
): BudgetRow[] {
  const rows: BudgetRow[] = [];

  const REV_ITEMS = ["パーソナル・物販・その他収入", "月会費収入", "サービス収入", "自販機手数料収入"];
  const LABOR_ITEMS = ["正社員・契約社員給与", "賞与", "通勤手当", "法定福利費"];

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
    if (REV_ITEMS.includes(cat) || LABOR_ITEMS.includes(cat)) continue;
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

// ─── Payroll Detail types & component ─────────────────────

interface PayrollEmployee {
  employeeId: string;
  employeeName: string;
  contractType: string;
  baseSalary: number;
  positionAllowance: number;
  overtimePay: number;
  commuteTaxable: number;
  commuteNontax: number;
  taxableTotal: number;
  grossTotal: number;
  scheduledHours: number;
  overtimeHours: number;
  ratio: number;
  storeName: string;
}

function PayrollDetailSection({
  year,
  month,
  store,
  isAdmin,
  sessionStoreName,
}: {
  year: number;
  month: number;
  store: string;
  isAdmin: boolean;
  sessionStoreName: string | null;
}) {
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  // Only show for admin or own-store manager
  const canView = isAdmin || (sessionStoreName != null && sessionStoreName === store);

  useEffect(() => {
    if (!canView) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          year: String(year),
          month: String(month),
          store,
        });
        const res = await fetch(`/api/dashboard/payroll-detail?${params}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (!cancelled) setEmployees(data.employees ?? []);
      } catch {
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [year, month, store, canView]);

  if (!canView) return null;

  if (loading) {
    return (
      <div className="animate-pulse mt-4">
        <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
        <div className="h-48 bg-gray-100 rounded" />
      </div>
    );
  }

  if (employees.length === 0) return null;

  // Group employees by store
  const byStore: Record<string, PayrollEmployee[]> = {};
  for (const emp of employees) {
    if (!byStore[emp.storeName]) byStore[emp.storeName] = [];
    byStore[emp.storeName].push(emp);
  }

  const storeNames = Object.keys(byStore).sort();

  return (
    <>
      <SectionTitle>従業員別明細</SectionTitle>
      <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-3 py-2 font-medium text-gray-600">店舗</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">氏名</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">契約種別</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">基本給</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">役職手当</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">残業代</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">通勤手当</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">課税支給合計</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">総支給額</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">勤務時間</th>
            </tr>
          </thead>
          <tbody>
            {storeNames.map((sn) => {
              const group = byStore[sn];
              const subtotal = {
                baseSalary: 0,
                positionAllowance: 0,
                overtimePay: 0,
                commute: 0,
                taxableTotal: 0,
                grossTotal: 0,
                hours: 0,
              };
              for (const e of group) {
                const r = e.ratio / 100;
                subtotal.baseSalary += e.baseSalary * r;
                subtotal.positionAllowance += e.positionAllowance * r;
                subtotal.overtimePay += e.overtimePay * r;
                subtotal.commute += (e.commuteTaxable + e.commuteNontax) * r;
                subtotal.taxableTotal += e.taxableTotal * r;
                subtotal.grossTotal += e.grossTotal * r;
                subtotal.hours += (e.scheduledHours + e.overtimeHours) * r;
              }
              return [
                ...group.map((e) => {
                  const r = e.ratio / 100;
                  return (
                    <tr key={`${sn}-${e.employeeId}`} className="border-b hover:bg-gray-50/50">
                      <td className="px-3 py-1.5 text-gray-600">{e.storeName}</td>
                      <td className="px-3 py-1.5 text-gray-700">{e.employeeName}</td>
                      <td className="px-3 py-1.5 text-gray-600">{e.contractType}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.baseSalary * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.positionAllowance * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.overtimePay * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round((e.commuteTaxable + e.commuteNontax) * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.taxableTotal * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.grossTotal * r))}</td>
                      <td className="px-3 py-1.5 text-right">{((e.scheduledHours + e.overtimeHours) * r).toFixed(1)}h</td>
                    </tr>
                  );
                }),
                <tr key={`subtotal-${sn}`} className="border-b bg-gray-50 font-bold">
                  <td className="px-3 py-2 text-gray-700">{sn}</td>
                  <td className="px-3 py-2 text-gray-700">小計（{group.length}名）</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.baseSalary))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.positionAllowance))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.overtimePay))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.commute))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.taxableTotal))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.grossTotal))}</td>
                  <td className="px-3 py-2 text-right">{subtotal.hours.toFixed(1)}h</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Monthly View component ─────────────────────────────────

function MonthlyView({
  data,
  isAllStores,
  year,
  month,
  store,
  isAdmin,
  sessionStoreName,
  onRefresh,
}: {
  data: DashboardData;
  isAllStores: boolean;
  year: number;
  month: number;
  store: string;
  isAdmin: boolean;
  sessionStoreName: string | null;
  onRefresh: () => void;
}) {
  const budgetRows = useMemo(() => {
    if (isAllStores || Object.keys(data.budget).length === 0) return [];
    return buildBudgetRows(
      data.budget,
      data.revenue.by_category,
      data.payroll,
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
        ["売上合計", "人件費合計", "経費合計", "営業利益"].includes(r.category),
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
              <td className="px-4 py-1.5 pl-8 text-gray-600">正社員給与</td>
              <td className="px-4 py-1.5 text-right">
                {formatYen(data.payroll.fulltime_gross)}
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">契約社員給与</td>
              <td className="px-4 py-1.5 text-right">
                {formatYen(data.payroll.parttime_gross)}
              </td>
            </tr>
            {data.payroll.base_salary > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">基本給</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.base_salary)}</td>
              </tr>
            )}
            {data.payroll.position_allowance > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">役職手当</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.position_allowance)}</td>
              </tr>
            )}
            {data.payroll.overtime_pay > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">残業手当</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.overtime_pay)}</td>
              </tr>
            )}
            {data.payroll.commute > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">通勤手当</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.commute)}</td>
              </tr>
            )}
            {data.payroll.taxable_total > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">課税支給合計</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.taxable_total)}</td>
              </tr>
            )}
            {data.payroll.legal_welfare > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">法定福利費（会社負担）</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.legal_welfare)}</td>
              </tr>
            )}
            {data.payroll.total_hours > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">総勤務時間</td>
                <td className="px-4 py-1.5 text-right">{data.payroll.total_hours.toLocaleString()}h</td>
              </tr>
            )}
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

      {/* PL Charts */}
      {(data.total_revenue > 0 || data.total_labor > 0 || data.total_expense > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          {/* Revenue / Labor / Expense / Profit bar chart */}
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <p className="text-sm font-medium text-gray-600 mb-3">損益サマリ</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={[
                  { name: "売上", value: data.total_revenue, fill: COLORS.blue },
                  { name: "人件費", value: data.total_labor, fill: COLORS.red },
                  { name: "経費", value: data.total_expense, fill: COLORS.orange },
                  { name: "営業利益", value: data.operating_profit, fill: data.operating_profit >= 0 ? COLORS.green : COLORS.red },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" name="金額" radius={[4, 4, 0, 0]}>
                  {[COLORS.blue, COLORS.red, COLORS.orange, data.operating_profit >= 0 ? COLORS.green : COLORS.red].map(
                    (color, i) => (
                      <Cell key={i} fill={color} />
                    ),
                  )}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sales category breakdown (if revenue data exists) */}
          {Object.keys(data.revenue.by_category).length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">売上カテゴリ内訳</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={Object.entries(data.revenue.by_category)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amt]) => ({ name: cat, 金額: amt }))}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={80} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="金額" fill={COLORS.blue} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Expense category breakdown (if expense data exists) */}
          {Object.keys(data.expense.by_category).length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">経費カテゴリ内訳</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={Object.entries(data.expense.by_category)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amt]) => ({ name: cat, 金額: amt }))}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={80} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="金額" fill={COLORS.orange} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Labor breakdown (if payroll data exists) */}
          {data.total_labor > 0 && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">人件費内訳</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={[
                    data.payroll.fulltime_gross > 0 && { name: "正社員給与", 金額: data.payroll.fulltime_gross },
                    data.payroll.parttime_gross > 0 && { name: "契約社員給与", 金額: data.payroll.parttime_gross },
                    data.payroll.commute > 0 && { name: "通勤手当", 金額: data.payroll.commute },
                    data.payroll.legal_welfare > 0 && { name: "法定福利費", 金額: data.payroll.legal_welfare },
                  ].filter(Boolean) as { name: string; 金額: number }[]}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={90} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="金額" fill={COLORS.red} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Member Info (editable) */}
      <EditableMemberSection
        data={data.member}
        isAllStores={isAllStores}
        year={year}
        month={month}
        store={store}
        onSaved={onRefresh}
      />

      {/* Plan Breakdown Pie Chart */}
      {!isAllStores && (
        <PlanBreakdownPie year={year} month={month} store={store} />
      )}

      {/* Promotion Report */}
      {!isAllStores && (
        <PromotionSection year={year} month={month} store={store} />
      )}

      {/* Budget vs Actual */}
      {!isAllStores && budgetRows.length > 0 && (
        <>
          <SectionTitle>予算 vs 実績</SectionTitle>

          {/* Budget KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {(() => {
              const revRow = budgetRows.find((r) => r.category === "売上合計");
              const laborRow = budgetRows.find((r) => r.category === "人件費合計");
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

      {/* Recalculate store assignments (admin only) */}
      {isAdmin && (
        <div className="mt-6 flex items-center gap-3">
          <RecalculateButton year={year} month={month} onDone={onRefresh} />
        </div>
      )}

      {/* Employee Payroll Detail (admin or own-store manager) */}
      {!isAllStores && (
        <PayrollDetailSection
          year={year}
          month={month}
          store={store}
          isAdmin={isAdmin}
          sessionStoreName={sessionStoreName}
        />
      )}

      {/* Payroll Summary Download (admin only) */}
      {isAdmin && (
        <div className="mt-6">
          <button
            onClick={() => {
              const params = new URLSearchParams({
                year: String(year),
                month: String(month),
              });
              window.open(`/api/download/payroll-excel?${params}`, "_blank");
            }}
            className="text-sm bg-white border rounded-lg px-4 py-2 hover:bg-gray-50 text-gray-700 shadow-sm"
          >
            📥 人件費サマリをダウンロード
          </button>
        </div>
      )}

      {/* Expense Detail (per-store only) */}
      {!isAllStores && (
        <ExpenseDetailSection year={year} month={month} store={store} />
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
  planBreakdown,
  storePlanBreakdown,
  fiscalYear,
}: {
  annualData: AnnualData;
  storeCompareData: StoreCompareData | null;
  isAllStores: boolean;
  budgetData: Record<string, number>;
  store: string;
  planBreakdown: PlanBreakdownEntry[] | null;
  storePlanBreakdown: StorePlanBreakdown[] | null;
  fiscalYear: number;
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

  // Budget vs actual per-month chart data (using per-month budget from annual API)
  const hasBudgetData = useMemo(() => {
    if (isAllStores) return false;
    return monthly.some(
      (m) => m.budget_revenue > 0 || m.budget_labor > 0 || m.budget_expense > 0,
    );
  }, [isAllStores, monthly]);

  const budgetChartData = useMemo(() => {
    if (!hasBudgetData) return null;
    return monthly.map((m) => ({
      name: m.month_label,
      売上予算: m.budget_revenue,
      売上実績: m.revenue,
      人件費予算: m.budget_labor,
      人件費実績: m.labor_cost,
      経費予算: m.budget_expense,
      経費実績: m.expense,
      利益予算: m.budget_profit,
      利益実績: m.operating_profit,
    }));
  }, [hasBudgetData, monthly]);

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

      {/* Promotion Period Section */}
      <PromotionPeriodSection
        fiscalYear={fiscalYear}
        store={store}
        months={monthly.map((m) => m.month)}
      />

      {/* Budget vs Actual charts (store != 全体, per-month trend) */}
      {budgetChartData && (
        <>
          <SectionTitle>予算 vs 実績</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Revenue budget vs actual */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">売上 予算 vs 実績</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={budgetChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar dataKey="売上予算" name="予算" fill={COLORS.gray} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="売上実績" name="実績" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Operating profit budget vs actual */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">営業利益 予算 vs 実績</p>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={budgetChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="利益予算"
                    name="予算"
                    stroke={COLORS.gray}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="利益実績"
                    name="実績"
                    stroke={COLORS.green}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Labor budget vs actual */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">人件費 予算 vs 実績</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={budgetChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar dataKey="人件費予算" name="予算" fill={COLORS.gray} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="人件費実績" name="実績" fill={COLORS.red} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Expense budget vs actual */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">経費 予算 vs 実績</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={budgetChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar dataKey="経費予算" name="予算" fill={COLORS.gray} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="経費実績" name="実績" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
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

      {/* PL Monthly Breakdown Table (detailed) */}
      <SectionTitle>
        {monthly.length >= 12 ? "年間" : "半期"}PL一覧
      </SectionTitle>
      {(() => {
        // Collect all expense categories that appear
        const allExpCats = new Set<string>();
        for (const m of monthly) {
          for (const cat of Object.keys(m.expense_by_category)) {
            if (m.expense_by_category[cat] > 0) allExpCats.add(cat);
          }
        }
        const expCats = [...allExpCats].sort();

        // Build rows: { label, values[], total, bold?, color? }
        type PLRow = {
          label: string;
          values: (string | number)[];
          total: string | number;
          avg: string | number;
          bold?: boolean;
          color?: string;
          isHours?: boolean;
        };

        const nMonths = monthly.filter(
          (m) => m.revenue > 0 || m.labor_cost > 0 || m.expense > 0,
        ).length || 1;

        const rows: PLRow[] = [];

        // Revenue
        rows.push({
          label: "売上高",
          values: monthly.map((m) => m.revenue),
          total: totals.revenue,
          avg: Math.round(totals.revenue / nMonths),
          bold: true,
          color: "text-blue-700",
        });

        // Payroll detail
        const hasPayroll = monthly.some((m) => m.gross_total > 0);
        if (hasPayroll) {
          const ftSum = monthly.reduce((s, m) => s + (m.fulltime_gross || 0), 0);
          const ptSum = monthly.reduce((s, m) => s + (m.parttime_gross || 0), 0);
          const grossSum = monthly.reduce((s, m) => s + (m.gross_total || 0), 0);
          const welfareSum = monthly.reduce((s, m) => s + (m.legal_welfare || 0), 0);
          const hoursSum = monthly.reduce((s, m) => s + (m.total_hours || 0), 0);

          rows.push({
            label: "  正社員給与",
            values: monthly.map((m) => m.fulltime_gross || 0),
            total: ftSum,
            avg: Math.round(ftSum / nMonths),
          });
          rows.push({
            label: "  契約社員給与",
            values: monthly.map((m) => m.parttime_gross || 0),
            total: ptSum,
            avg: Math.round(ptSum / nMonths),
          });
          rows.push({
            label: "  人件費（課税支給合計）",
            values: monthly.map((m) => m.gross_total || 0),
            total: grossSum,
            avg: Math.round(grossSum / nMonths),
            bold: true,
          });
          rows.push({
            label: "  法定福利費",
            values: monthly.map((m) => m.legal_welfare || 0),
            total: welfareSum,
            avg: Math.round(welfareSum / nMonths),
          });
        }

        rows.push({
          label: "人件費合計",
          values: monthly.map((m) => m.labor_cost),
          total: totals.labor,
          avg: Math.round(totals.labor / nMonths),
          bold: true,
          color: "text-red-700",
        });

        if (hasPayroll) {
          const hoursSum = monthly.reduce((s, m) => s + (m.total_hours || 0), 0);
          rows.push({
            label: "  総勤務時間",
            values: monthly.map((m) => m.total_hours || 0),
            total: hoursSum,
            avg: hoursSum / nMonths,
            isHours: true,
          });
        }

        // Expense total
        rows.push({
          label: "経費合計",
          values: monthly.map((m) => m.expense),
          total: totals.expense,
          avg: Math.round(totals.expense / nMonths),
          bold: true,
          color: "text-orange-700",
        });

        // Expense breakdown
        for (const cat of expCats) {
          const catSum = monthly.reduce(
            (s, m) => s + (m.expense_by_category[cat] || 0),
            0,
          );
          rows.push({
            label: `  ${cat}`,
            values: monthly.map((m) => m.expense_by_category[cat] || 0),
            total: catSum,
            avg: Math.round(catSum / nMonths),
          });
        }

        // Operating profit
        rows.push({
          label: "営業利益",
          values: monthly.map((m) => m.operating_profit),
          total: totals.profit,
          avg: Math.round(totals.profit / nMonths),
          bold: true,
          color: "text-green-700",
        });

        const fmtCell = (v: string | number, isHours?: boolean) => {
          if (isHours) return typeof v === "number" ? (v > 0 ? `${v.toFixed(1)}h` : "-") : "-";
          return typeof v === "number" ? formatYen(v) : v;
        };

        return (
          <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[160px]">
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
                    {monthly.length >= 12 ? "年間合計" : "合計"}
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-gray-700 bg-gray-100 min-w-[100px]">
                    月平均
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b ${row.bold ? "font-bold" : ""} ${row.color || ""} ${row.label === "営業利益" ? "bg-green-50/50" : ""}`}
                  >
                    <td
                      className={`px-3 py-1.5 sticky left-0 ${row.label === "営業利益" ? "bg-green-50/50" : "bg-white"} whitespace-nowrap`}
                    >
                      {row.label}
                    </td>
                    {row.values.map((v, j) => (
                      <td key={j} className="px-3 py-1.5 text-right whitespace-nowrap">
                        {fmtCell(v, row.isHours)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right bg-gray-50 whitespace-nowrap">
                      {fmtCell(row.total, row.isHours)}
                    </td>
                    <td className="px-3 py-1.5 text-right bg-gray-50 whitespace-nowrap">
                      {fmtCell(row.avg, row.isHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Headcount Trend Table */}
      {monthly.some((m) => m.employee_count > 0) && (
        <>
          <SectionTitle>人員推移</SectionTitle>
          <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[100px]">
                    区分
                  </th>
                  {monthly.map((m) => (
                    <th
                      key={m.month_label}
                      className="text-right px-3 py-2 font-medium text-gray-600 min-w-[70px]"
                    >
                      {m.month_label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="px-3 py-1.5 sticky left-0 bg-white text-gray-700">正社員</td>
                  {monthly.map((m, i) => (
                    <td key={i} className="px-3 py-1.5 text-right">
                      {m.fulltime_count > 0 ? m.fulltime_count : "-"}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="px-3 py-1.5 sticky left-0 bg-white text-gray-700">アルバイト</td>
                  {monthly.map((m, i) => (
                    <td key={i} className="px-3 py-1.5 text-right">
                      {m.parttime_count > 0 ? m.parttime_count : "-"}
                    </td>
                  ))}
                </tr>
                <tr className="border-b font-bold bg-gray-50">
                  <td className="px-3 py-2 sticky left-0 bg-gray-50 text-gray-700">合計</td>
                  {monthly.map((m, i) => (
                    <td key={i} className="px-3 py-2 text-right">
                      {m.employee_count > 0 ? m.employee_count : "-"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Plan Breakdown Bar Chart */}
      {planBreakdown && planBreakdown.length > 0 && (
        <>
          <SectionTitle>プラン別会員数</SectionTitle>
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <ResponsiveContainer width="100%" height={Math.max(200, planBreakdown.length * 36)}>
              <BarChart
                data={planBreakdown}
                layout="vertical"
                margin={{ left: 20, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={11} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={160}
                  fontSize={11}
                  tick={{ fill: "#555" }}
                />
                <Tooltip
                  formatter={(value) => [`${numFormat.format(Number(value))}人`, "会員数"]}
                />
                <Bar dataKey="count" name="会員数" fill={COLORS.teal} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Store-level Plan Breakdown Pie Charts */}
      {storePlanBreakdown && storePlanBreakdown.length > 0 && (
        <>
          <SectionTitle>店舗別 プラン割合</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
            {storePlanBreakdown.map((storeData) => (
              <div key={storeData.store} className="bg-white rounded-lg border shadow-sm p-4">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  {storeData.store}
                  <span className="text-gray-400 ml-2 text-xs">({storeData.total}人)</span>
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={storeData.plans}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      innerRadius={30}
                      paddingAngle={1}
                    >
                      {storeData.plans.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [
                        `${Number(value)}人（${((Number(value) / storeData.total) * 100).toFixed(1)}%）`,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2 max-h-[120px] overflow-y-auto">
                  {storeData.plans.map((p, i) => (
                    <div key={p.name} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="font-medium">{p.count}</span>
                      <span className="text-gray-400 w-10 text-right">
                        {((p.count / storeData.total) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

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
  const [storePlanBreakdown, setStorePlanBreakdown] = useState<StorePlanBreakdown[] | null>(null);

  const isMonthly = !["通期", "上期", "下期"].includes(period);
  const isAllStores = store === "全体";

  // Build fiscal year months string for store-compare API
  const buildMonthsParam = useCallback(
    (y: number, p: string) => {
      // y = fiscal year (e.g. 2026 means 2025/10 ~ 2026/9)
      const pairs: string[] = [];
      if (p === "通期") {
        for (let m = 10; m <= 12; m++)
          pairs.push(`${y - 1}-${String(m).padStart(2, "0")}`);
        for (let m = 1; m <= 9; m++)
          pairs.push(`${y}-${String(m).padStart(2, "0")}`);
      } else if (p === "上期") {
        for (let m = 10; m <= 12; m++)
          pairs.push(`${y - 1}-${String(m).padStart(2, "0")}`);
        for (let m = 1; m <= 3; m++)
          pairs.push(`${y}-${String(m).padStart(2, "0")}`);
      } else if (p === "下期") {
        for (let m = 4; m <= 9; m++)
          pairs.push(`${y}-${String(m).padStart(2, "0")}`);
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
      setStorePlanBreakdown(null);

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
              if (isAllStores) planParams.set("byStore", "1");
              try {
                const planRes = await fetch(`/api/dashboard/plan-breakdown?${planParams}`);
                if (planRes.ok) {
                  const planJson = await planRes.json();
                  if (!cancelled) {
                    setPlanBreakdown(planJson.plans ?? null);
                    setStorePlanBreakdown(planJson.byStore ?? null);
                  }
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
          storePlanBreakdown={storePlanBreakdown}
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
