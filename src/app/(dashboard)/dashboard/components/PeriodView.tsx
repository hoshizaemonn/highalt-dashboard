"use client";

import { useMemo } from "react";
import {
  COLORS,
  formatYen,
  formatCompact,
  numFormat,
  KPICard,
  SectionTitle,
  ChartTooltip,
  MemberTooltip,
  AnnualData,
  StoreCompareData,
  MonthlyEntry,
  PlanBreakdownEntry,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "./shared";
import { PromotionPeriodSection } from "./PromotionSection";

export interface PeriodViewProps {
  annualData: AnnualData;
  storeCompareData: StoreCompareData | null;
  isAllStores: boolean;
  budgetData: Record<string, number>;
  store: string;
  planBreakdown: PlanBreakdownEntry[] | null;
  fiscalYear: number;
}

export default function PeriodView({
  annualData,
  storeCompareData,
  isAllStores,
  budgetData,
  store,
  planBreakdown,
  fiscalYear,
}: PeriodViewProps) {
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
      monthly.map((m) => {
        const advertising = m.expense_by_category["広告宣伝費"] ?? 0;
        const supplies = m.expense_by_category["消耗品費"] ?? 0;
        // 月次の獲得コスト = 広告宣伝費 ÷ 新規入会数（入会1名を獲得するためにいくら広告費を使ったか）
        const acquisitionCost =
          m.ma_new_signups > 0 ? Math.round(advertising / m.ma_new_signups) : 0;
        return {
          name: m.month_label,
          売上: m.revenue,
          人件費: m.labor_cost,
          経費: m.expense,
          広告宣伝費: advertising,
          消耗品費: supplies,
          営業利益: m.operating_profit,
          獲得コスト: acquisitionCost,
          プラン契約者数: m.ma_plan_subscribers,
          在籍会員数: m.ma_total_members,
          新規入会数: m.ma_new_signups,
          退会数: m.ma_cancellations,
          休会数: m.ma_suspensions,
          退会率: parseFloat(m.ma_cancel_rate.replace("%", "")) || 0,
        };
      }),
    [monthly],
  );

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title="売上合計" value={formatYen(totals.revenue)} color={COLORS.blue} />
        <KPICard
          title="人件費合計"
          value={formatYen(totals.labor)}
          color={COLORS.red}
          salesRatioOf={{ numerator: totals.labor, revenue: totals.revenue }}
        />
        <KPICard
          title="経費合計"
          value={formatYen(totals.expense)}
          color={COLORS.orange}
          salesRatioOf={{ numerator: totals.expense, revenue: totals.revenue }}
        />
        <KPICard
          title="営業利益"
          value={formatYen(totals.profit)}
          color={totals.profit >= 0 ? COLORS.green : COLORS.red}
          salesRatioOf={{ numerator: totals.profit, revenue: totals.revenue }}
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
              <YAxis fontSize={11} unit="人" />
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

        {/* Expense breakdown or store comparison */}
        {isAllStores && storeCompareData ? (
          <div className="bg-white rounded-lg border shadow-sm p-4">
            {/* 「店舗別営業利益」→「店舗別営業損益」: 赤字店舗の可能性があるため "損益" 表記。
                個別バーは利益マイナスなら赤色で警告（Cell で個別塗り） */}
            <p className="text-sm font-medium text-gray-600 mb-3">店舗別営業損益</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={storeCompareData.stores}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="store" fontSize={10} />
                <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="profit" name="営業損益" radius={[4, 4, 0, 0]}>
                  {storeCompareData.stores.map((s, i) => (
                    <Cell key={i} fill={s.profit >= 0 ? COLORS.green : COLORS.red} />
                  ))}
                </Bar>
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

      {/* コスト・利益推移（全社×月次）
          坪井さん要望: 人件費だけでなく、広告宣伝費・消耗品費・営業利益も個別に推移を見たい。
          + 月次の獲得コスト推移（広告宣伝費 ÷ 新規入会数） */}
      <SectionTitle>コスト・利益推移</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">人件費推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="人件費" fill={COLORS.red} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">広告宣伝費推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="広告宣伝費" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">消耗品費推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="消耗品費" fill={COLORS.teal} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">営業利益推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="営業利益" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.営業利益 >= 0 ? COLORS.green : COLORS.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4 lg:col-span-2">
          <p className="text-sm font-medium text-gray-600 mb-3">
            <span className="inline-flex items-center gap-2">
              月次の獲得コスト推移
              <span className="text-xs text-gray-400 font-normal">（広告宣伝費 ÷ 新規入会数）</span>
            </span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip
                formatter={(value) => [
                  Number(value) > 0 ? formatYen(Number(value)) + "/人" : "-",
                  "獲得コスト",
                ]}
              />
              <Line
                type="monotone"
                dataKey="獲得コスト"
                stroke={COLORS.orange}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* MA002 charts — 桁の違いを見やすくするため新規入会/退会/休会は個別グラフに分割 */}
      <SectionTitle>会員数推移 (MA002)</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">新規入会数 推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} unit="人" />
              <Tooltip content={<MemberTooltip />} />
              <Bar dataKey="新規入会数" fill={COLORS.green} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">退会数 推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} unit="人" />
              <Tooltip content={<MemberTooltip />} />
              <Bar dataKey="退会数" fill={COLORS.red} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* 退会数の隣に退会率を並べる（坪井さん要望: 比較しやすくするため） */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">退会率推移</p>
          <ResponsiveContainer width="100%" height={220}>
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
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">休会数 推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} unit="人" />
              <Tooltip content={<MemberTooltip />} />
              <Bar dataKey="休会数" fill={COLORS.gray} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Promotion Period Section */}
      <PromotionPeriodSection
        fiscalYear={fiscalYear}
        store={store}
        months={monthly.map((m) => m.month)}
      />

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

            {/* 店舗別営業損益（坪井さん要望: 「店舗別人件費」は削除して損益に差替） */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別営業損益</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={storeCompareData.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store" fontSize={10} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="profit" name="営業損益" radius={[4, 4, 0, 0]}>
                    {storeCompareData.stores.map((s, i) => (
                      <Cell key={i} fill={s.profit >= 0 ? COLORS.green : COLORS.red} />
                    ))}
                  </Bar>
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
    </>
  );
}
