"use client";

import { useMemo, useState, useEffect } from "react";
import { Download } from "lucide-react";
import {
  COLORS,
  formatYen,
  formatCompact,
  KPICard,
  HelpHint,
  SectionTitle,
  ChartTooltip,
  MaskedAmount,
  DashboardData,
  buildBudgetRows,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "./shared";
import { EditableMemberSection, PlanBreakdownPie } from "./MemberSection";
import { PromotionSection } from "./PromotionSection";
import ExpenseDetailSection from "./ExpenseDetailSection";
import { RecalculateButton, PayrollDetailSection } from "./PayrollSection";
import { ManualEntrySection } from "./ManualEntrySection";
import { PlComparisonSection } from "./PlComparisonSection";
import { AttributesSection } from "./AttributesSection";
import { EnqueteSection } from "./EnqueteSection";

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

  // 予算 vs 実績セクション削除済み（坪井さん指示）。
  // budgetRows は予算データのフェッチを残してあるが、UI 表示は無し。
  void budgetRows;

  // 社員給与の黒塗り（安蒜さん依頼）: 店長など非admin には社員の給与額を見せない。
  // サーバ側で payroll_masked が立ち、対象金額は 0 に伏せて返ってくる。
  const payrollMasked = data.payroll_masked === true || !isAdmin;

  // 前年比は「クライアント公式PL」を正とする（坪井さん決定）。
  // 当月の人件費をPLに差し替え、KPI（人件費合計・営業利益）と前年同月比をPL基準に揃える。
  // ※ PL未取込・全体ビュー時は従来の granular 値にフォールバック。
  const fiscalYear = month >= 10 ? year + 1 : year;
  const [plComp, setPlComp] = useState<{
    hasData?: boolean;
    categories?: { category: string; monthly: { month: number; current: number; prev: number }[] }[];
  } | null>(null);
  useEffect(() => {
    if (isAllStores) {
      setPlComp(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/dashboard/pl-comparison?fiscalYear=${fiscalYear}&store=${encodeURIComponent(store)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setPlComp(d); })
      .catch(() => { if (!cancelled) setPlComp(null); });
    return () => { cancelled = true; };
  }, [store, fiscalYear, isAllStores]);

  const plLaborMonth = (cal: number, key: "current" | "prev"): number | null => {
    if (!plComp || plComp.hasData === false || !plComp.categories) return null;
    const c = plComp.categories.find((x) => x.category === "人件費");
    const mm = c?.monthly.find((m) => m.month === cal);
    return mm ? mm[key] : null;
  };
  const plLaborCur = plLaborMonth(month, "current");
  const usePl = plLaborCur !== null && plLaborCur !== 0;
  const prevCalMonth = month === 1 ? 12 : month - 1;
  const laborValue = usePl ? plLaborCur! : data.total_labor;
  const laborPrevMonth = usePl ? plLaborMonth(prevCalMonth, "current") ?? undefined : data.prev_month_totals?.labor;
  const laborPrevYear = usePl ? plLaborMonth(month, "prev") ?? undefined : data.prev_year_totals?.labor;
  const profitValue = usePl ? data.total_revenue - laborValue - data.total_expense : data.operating_profit;

  return (
    <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="売上合計"
          value={formatYen(data.total_revenue)}
          color={COLORS.blue}
          help="月会費・パーソナル・物販・体験・スポット等の売上合計（Square含む）。"
          current={data.total_revenue}
          previousMonth={data.prev_month_totals?.revenue}
          previousYear={data.prev_year_totals?.revenue}
        />
        <KPICard
          title="人件費合計"
          value={formatYen(laborValue)}
          color={COLORS.red}
          help={usePl ? "クライアント公式PL基準（正社員・契約社員給与＋賞与＋通勤手当＋法定福利費）。前年同月比もPL同士で比較。" : "正社員・契約社員給与の課税支給合計＋法定福利費＋通勤手当の合計。"}
          current={laborValue}
          previousMonth={laborPrevMonth}
          previousYear={laborPrevYear}
          lowerIsBetter
          salesRatioOf={{ numerator: laborValue, revenue: data.total_revenue }}
        />
        <KPICard
          title="経費合計"
          value={formatYen(data.total_expense)}
          color={COLORS.orange}
          help="広告宣伝費・賃借料・水道光熱費・消耗品費など、人件費以外の経費の合計。"
          current={data.total_expense}
          previousMonth={data.prev_month_totals?.expense}
          previousYear={data.prev_year_totals?.expense}
          lowerIsBetter
          salesRatioOf={{ numerator: data.total_expense, revenue: data.total_revenue }}
        />
        <KPICard
          title="営業利益"
          value={formatYen(profitValue)}
          // 赤字（営業利益マイナス）の場合は赤色で警告。緑固定だとミスリード。
          color={profitValue >= 0 ? COLORS.green : COLORS.red}
          help="売上合計 − 人件費合計 − 経費合計。プラスなら黒字、マイナスなら赤字。"
          current={profitValue}
          previousMonth={data.prev_month_totals?.profit}
          previousYear={data.prev_year_totals?.profit}
          salesRatioOf={{ numerator: profitValue, revenue: data.total_revenue }}
        />
      </div>

      {/* PL Table */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionTitle>損益計算書 (PL)</SectionTitle>
        <button
          onClick={() => {
            // 暦上の (year, month) から会計年度（10月始まり）を逆算
            const fiscalYear = month >= 10 ? year + 1 : year;
            const params = new URLSearchParams({
              year: String(fiscalYear),
              store,
            });
            window.open(`/api/download/pl-csv?${params}`, "_blank");
          }}
          className="text-sm bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-100 text-emerald-800 shadow-sm inline-flex items-center gap-1.5"
          title="既存PL様式（10月〜9月の月次＋合計、千円単位）で当該会計年度の損益計算書をCSVダウンロード"
        >
          <Download size={14} />
          損益計算書（PL書式・CSV）
        </button>
      </div>
      <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-2 font-medium text-gray-600">科目</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">金額</th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue — 坪井さん要望: 会費 / パーソナル / 物販 / その他 の4分類で表示 */}
            <tr className="border-b bg-blue-50/50">
              <td className="px-4 py-2 font-bold text-blue-700" colSpan={2}>
                売上
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">
                <span className="inline-flex items-center gap-1">
                  会費
                  <HelpHint text="月会費 + 入会金。hacomono の売上明細から集計。" />
                </span>
              </td>
              <td className="px-4 py-1.5 text-right">{formatYen(data.revenue.membership)}</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">パーソナル</td>
              <td className="px-4 py-1.5 text-right">{formatYen(data.revenue.personal)}</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">
                <span className="inline-flex items-center gap-1">
                  物販
                  <HelpHint text="Square POS 売上（物販想定）。" />
                </span>
              </td>
              <td className="px-4 py-1.5 text-right">{formatYen(data.revenue.product)}</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">
                <span className="inline-flex items-center gap-1">
                  その他
                  <HelpHint text="スポット・体験・ロッカー・オプション等、会費・パーソナル・物販以外。" />
                </span>
              </td>
              <td className="px-4 py-1.5 text-right">{formatYen(data.revenue.other)}</td>
            </tr>
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
                {payrollMasked ? (
                  <MaskedAmount />
                ) : (
                  formatYen(data.payroll.fulltime_gross)
                )}
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-1.5 pl-8 text-gray-600">契約社員給与</td>
              <td className="px-4 py-1.5 text-right">
                {formatYen(data.payroll.parttime_gross)}
              </td>
            </tr>
            {/* 社員給与の内訳（基本給・役職手当・残業手当・課税支給合計）は
                店長権限では非表示。正社員給与を黒塗りにしているため、内訳も伏せる。 */}
            {!payrollMasked && data.payroll.base_salary > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">基本給</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.base_salary)}</td>
              </tr>
            )}
            {!payrollMasked && data.payroll.position_allowance > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 pl-8 text-gray-600">役職手当</td>
                <td className="px-4 py-1.5 text-right">{formatYen(data.payroll.position_allowance)}</td>
              </tr>
            )}
            {!payrollMasked && data.payroll.overtime_pay > 0 && (
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
                    <HelpHint text="基本給+役職手当+残業代の合計（通勤手当は別行で表示）。" />
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
            <tr className={data.operating_profit >= 0 ? "bg-green-50" : "bg-red-50"}>
              <td className={`px-4 py-3 font-bold ${data.operating_profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                {data.operating_profit >= 0 ? "営業利益" : "営業損失"}
              </td>
              <td className={`px-4 py-3 text-right font-bold ${data.operating_profit >= 0 ? "text-green-700" : "text-red-700"}`}>
                {formatYen(data.operating_profit)}
              </td>
            </tr>

            {/* タイムバリュー（営業利益 ÷ 総勤務時間 = 1時間あたりの稼ぎ） */}
            {data.payroll.total_hours > 0 && (
              <tr className="border-b">
                <td className="px-4 py-1.5 text-gray-600">
                  <span className="inline-flex items-center gap-1">
                    タイムバリュー
                    <HelpHint text="営業利益 ÷ 総勤務時間。1時間の労働あたり、いくらの営業利益を生んでいるかを示す。" />
                  </span>
                </td>
                <td className="px-4 py-1.5 text-right">
                  {formatYen(Math.round(data.operating_profit / data.payroll.total_hours))}/h
                </td>
              </tr>
            )}
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

          {/* 売上カテゴリ内訳: 坪井さん要望#6 で4分類に統合
              （会費=月会費+入会金 / パーソナル / 物販=Square / その他=スポット+体験+ロッカー他） */}
          {(data.revenue.membership + data.revenue.personal + data.revenue.product + data.revenue.other) > 0 && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">売上カテゴリ内訳</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={[
                    { name: "会費", 金額: data.revenue.membership },
                    { name: "パーソナル", 金額: data.revenue.personal },
                    { name: "物販", 金額: data.revenue.product },
                    { name: "その他", 金額: data.revenue.other },
                  ]}
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
                    !payrollMasked && data.payroll.fulltime_gross > 0 && { name: "正社員給与", 金額: data.payroll.fulltime_gross },
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

      {/* 店長手動追記（坪井さん要望15）: 体験者数・その他売上 */}
      <ManualEntrySection
        year={year}
        month={month}
        store={store}
        // admin = 任意店舗で編集可、店長 = 自店舗のみ編集可
        canEdit={isAdmin || (sessionStoreName !== null && sessionStoreName === store)}
        initialTrialCount={data.member?.trial_count ?? 0}
        onSaved={onRefresh}
      />

      {/* 会員属性（坪井さん要望13）: 男女構成比・年代別構成比 */}
      <AttributesSection
        year={year}
        month={month}
        store={store}
        trialOnly={false}
        title="会員属性"
        helpText="アクティブ会員の男女構成比と年代別構成比（hacomono CSV 由来）"
      />

      {/* 新規体験者属性（坪井さん要望14）: hacomono のhad_trial=1で集計 */}
      <AttributesSection
        year={year}
        month={month}
        store={store}
        trialOnly={true}
        title="新規体験者属性"
        helpText="当月体験を受講した会員の男女構成比と年代別構成比（hacomono CSV 由来）"
      />

      {/* アンケート（認知経路・目的・頻度） */}
      <EnqueteSection store={store} />

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

      {/* 前年比比較（人件費・消耗品費・広告宣伝費）— クライアント公式PL由来。
          単月画面でも、選択中の会計年度の前年比を表示する（年次比較表）。 */}
      <PlComparisonSection
        store={store}
        fiscalYear={month >= 10 ? year + 1 : year}
        isAllStores={isAllStores}
      />

      {/* 「予算 vs 実績」セクションは削除（坪井さん指示）。
          予算情報は各推移グラフの折れ線オーバーレイで確認する運用。 */}

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
          onRefresh={onRefresh}
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
