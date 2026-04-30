"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import {
  COLORS,
  formatYen,
  formatCompact,
  formatPercent,
  signedYen,
  KPICard,
  HelpHint,
  SectionTitle,
  ChartTooltip,
  DashboardData,
  buildBudgetRows,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "./shared";
import { EditableMemberSection, PlanBreakdownPie } from "./MemberSection";
import { PromotionSection } from "./PromotionSection";
import ExpenseDetailSection from "./ExpenseDetailSection";
import { RecalculateButton, PayrollDetailSection } from "./PayrollSection";

export interface MonthlyViewProps {
  data: DashboardData;
  isAllStores: boolean;
  year: number;
  month: number;
  store: string;
  isAdmin: boolean;
  sessionStoreName: string | null;
  onRefresh: () => void;
}

export default function MonthlyView({
  data,
  isAllStores,
  year,
  month,
  store,
  isAdmin,
  sessionStoreName,
  onRefresh,
}: MonthlyViewProps) {
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
        <KPICard
          title="売上合計"
          value={formatYen(data.total_revenue)}
          color={COLORS.blue}
          help="月会費・パーソナル・物販・体験・スポット等の売上合計（Square含む）。"
        />
        <KPICard
          title="人件費合計"
          value={formatYen(data.total_labor)}
          color={COLORS.red}
          help="正社員・契約社員給与の課税支給合計＋法定福利費＋通勤手当の合計。"
        />
        <KPICard
          title="経費合計"
          value={formatYen(data.total_expense)}
          color={COLORS.orange}
          help="広告宣伝費・賃借料・水道光熱費・消耗品費など、人件費以外の経費の合計。"
        />
        <KPICard
          title="営業利益"
          value={formatYen(data.operating_profit)}
          // 赤字（営業利益マイナス）の場合は赤色で警告。緑固定だとミスリード。
          color={data.operating_profit >= 0 ? COLORS.green : COLORS.red}
          help="売上合計 − 人件費合計 − 経費合計。プラスなら黒字、マイナスなら赤字。"
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
                <td className="px-4 py-1.5 pl-8 text-gray-600">
                  <span className="inline-flex items-center gap-1">
                    課税支給合計
                    <HelpHint text="所得税の課税対象となる支給額の合計。基本給+役職手当+残業代+通勤手当（課税分）。" />
                  </span>
                </td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.taxable_total)}</td>
              </tr>
            )}
            {data.payroll.legal_welfare > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">
                  <span className="inline-flex items-center gap-1">
                    法定福利費（会社負担）
                    <HelpHint text="健康保険・厚生年金・雇用保険など、法律で会社負担が定められた社会保険料。" />
                  </span>
                </td>
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
      {!isAllStores && (() => {
        // 客単価（実績）= 月会費売上合計 ÷ プラン契約者数
        // PS001（商品別売上）が取り込まれていればそちらを優先利用し、
        // なければ PL001 の摘要キーワード分類による月会費を使う。
        const monthlyFee =
          data.revenue.monthly_fee_ps001 ?? data.revenue.by_category["月会費"] ?? 0;
        const planSubscribers = data.member?.plan_subscribers ?? 0;
        const unitPriceActual =
          planSubscribers > 0 ? Math.round(monthlyFee / planSubscribers) : null;
        return (
          <PromotionSection
            year={year}
            month={month}
            store={store}
            unitPriceBudget={data.budget["客単価"] ?? 0}
            unitPriceActual={unitPriceActual}
          />
        );
      })()}

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
                    sub={revRow ? `予算差: ${signedYen(revRow.diff)}` : undefined}
                    help="売上の達成率（実績÷予算）。100%以上で予算達成。予算差は「実績−予算」で、プラスなら予算超過達成。"
                  />
                  <KPICard
                    title="人件費予算比"
                    value={laborRow ? formatPercent(laborRow.ratio) : "-"}
                    color={laborRow?.isGood ? COLORS.green : COLORS.red}
                    sub={laborRow ? `予算差: ${signedYen(laborRow.diff)}` : undefined}
                    help="人件費の予算比（実績÷予算）。100%以下が望ましい（予算内に収まっている）。予算差はマイナスだと予算節約。"
                  />
                  <KPICard
                    title="経費予算比"
                    value={expRow ? formatPercent(expRow.ratio) : "-"}
                    color={expRow?.isGood ? COLORS.green : COLORS.red}
                    sub={expRow ? `予算差: ${signedYen(expRow.diff)}` : undefined}
                    help="経費の予算比（実績÷予算）。100%以下が望ましい（予算内に収まっている）。予算差はマイナスだと予算節約。"
                  />
                  <KPICard
                    title="営業利益予算差"
                    value={profitRow ? signedYen(profitRow.diff) : "-"}
                    color={profitRow?.isGood ? COLORS.green : COLORS.red}
                    sub={
                      profitRow ? `達成率: ${formatPercent(profitRow.ratio)}` : undefined
                    }
                    help="営業利益の予算差（実績−予算）。プラスなら予算超過達成、マイナスなら予算未達。達成率は実績÷予算。"
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
                    <span className="inline-flex items-center gap-1">
                      予算差
                      <HelpHint text="実績 − 予算。売上・利益はプラスが良い、人件費・経費はマイナスが良い。" />
                    </span>
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      予算比
                      <HelpHint text="実績 ÷ 予算 × 100%。売上・利益は100%以上が達成、人件費・経費は100%以下が予算内。" />
                    </span>
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
                        className="px-4 py-1.5 text-right tabular-nums"
                        style={{ color: row.isGood ? COLORS.green : COLORS.red }}
                      >
                        {signedYen(row.diff)}
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
            className="text-sm bg-white border rounded-lg px-4 py-2 hover:bg-gray-50 text-gray-700 shadow-sm inline-flex items-center gap-2"
          >
            <Download size={16} />
            人件費サマリをダウンロード
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
