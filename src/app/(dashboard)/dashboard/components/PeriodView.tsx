"use client";

import { useMemo } from "react";

/**
 * 期間ラベル（通期/上期/下期）から会計年度内の月範囲を fromYM / toYM に変換。
 * fiscalYear=2026 のとき:
 *   通期 → 2025-10 〜 2026-09
 *   上期 → 2025-10 〜 2026-03
 *   下期 → 2026-04 〜 2026-09
 */
function periodToRange(
  period: string,
  fiscalYear: number,
): { fromYM: string; toYM: string } | null {
  if (period === "通期") {
    return { fromYM: `${fiscalYear - 1}-10`, toYM: `${fiscalYear}-09` };
  }
  if (period === "上期") {
    return { fromYM: `${fiscalYear - 1}-10`, toYM: `${fiscalYear}-03` };
  }
  if (period === "下期") {
    return { fromYM: `${fiscalYear}-04`, toYM: `${fiscalYear}-09` };
  }
  return null;
}
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
  ComposedChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LabelList,
} from "./shared";
import { PromotionPeriodSection } from "./PromotionSection";
import { useStoreDisplayName } from "../useStoreDisplayName";
import { AttributesSection } from "./AttributesSection";
import { EnqueteSection } from "./EnqueteSection";

export interface PeriodViewProps {
  annualData: AnnualData;
  storeCompareData: StoreCompareData | null;
  isAllStores: boolean;
  budgetData: Record<string, number>;
  store: string;
  planBreakdown: PlanBreakdownEntry[] | null;
  fiscalYear: number;
  /** 表示中の期間: "通期" / "上期" / "下期" */
  period: string;
}

export default function PeriodView({
  annualData,
  storeCompareData,
  isAllStores,
  budgetData,
  store,
  planBreakdown,
  fiscalYear,
  period,
}: PeriodViewProps) {
  const monthly = annualData.monthly_data;
  const { display: displayStore } = useStoreDisplayName();

  // 店舗比較データの XAxis 表示用に、displayName を埋め込んだコピーを作る。
  // データ紐付けは store フィールドのまま、表示は store_display を使う。
  const storeCompareDisplayed = useMemo(() => {
    if (!storeCompareData) return null;
    return {
      ...storeCompareData,
      stores: storeCompareData.stores.map((s) => ({
        ...s,
        store_display: displayStore(s.store),
      })),
    };
  }, [storeCompareData, displayStore]);

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
        // 獲得コスト予算 = 広告宣伝費予算 ÷ 新規入会数予算（予算ベースの目標獲得単価）
        const acquisitionCostBudget =
          m.budget_new_signups > 0
            ? Math.round(m.budget_advertising / m.budget_new_signups)
            : 0;
        // 客単価 = 月会費売上 ÷ プラン契約者数（1人あたりの月会費収入）
        const monthlyFee = m.monthly_fee_ps001 ?? m.sales_by_category["月会費"] ?? 0;
        const unitPrice =
          m.ma_plan_subscribers > 0 ? Math.round(monthlyFee / m.ma_plan_subscribers) : 0;
        return {
          name: m.month_label,
          売上: m.revenue,
          会費売上: m.sales_membership,
          パーソナル売上: m.sales_personal,
          物販売上: m.sales_product,
          その他売上: m.sales_other,
          人件費: m.labor_cost,
          経費: m.expense,
          広告宣伝費: advertising,
          消耗品費: supplies,
          営業利益: m.operating_profit,
          獲得コスト: acquisitionCost,
          獲得コスト予算: acquisitionCostBudget,
          プラン契約者数: m.ma_plan_subscribers,
          在籍会員数: m.ma_total_members,
          新規入会数: m.ma_new_signups,
          退会数: m.ma_cancellations,
          休会数: m.ma_suspensions,
          退会率: parseFloat(m.ma_cancel_rate.replace("%", "")) || 0,
          // 予算（坪井さん要望: 各推移グラフに予算を折れ線で重ねる）
          売上予算: m.budget_revenue,
          人件費予算: m.budget_labor,
          経費予算: m.budget_expense,
          営業利益予算: m.budget_profit,
          広告宣伝費予算: m.budget_advertising,
          消耗品費予算: m.budget_supplies,
          客単価: unitPrice,
          客単価予算: m.budget_unit_price,
          体験者数: m.trial_count,
          紹介経由: m.trial_referral_count,
          紹介以外: m.trial_non_referral_count,
          // 入会率 = 新規入会数 ÷ 体験者数（体験から会員化した割合、坪井さん要望#10）
          入会率: m.trial_count > 0 ? (m.ma_new_signups / m.trial_count) * 100 : 0,
          // 会員系予算（坪井さん要望: 推移グラフに予算折れ線重ね）
          新規入会数予算: m.budget_new_signups,
          退会数予算: m.budget_cancellations,
          休会数予算: m.budget_suspensions,
          退会率予算: m.budget_cancellation_rate,
          体験者数予算: m.budget_trial_count,
          // 売上4分類の予算
          会費売上予算: m.budget_sales_membership,
          パーソナル売上予算: m.budget_sales_personal,
          物販売上予算: m.budget_sales_product,
          その他売上予算: m.budget_sales_other,
        };
      }),
    [monthly],
  );

  // 表示中の period に応じた経費CSV / PL CSV ダウンロード
  // 「通期のところで反映している部分だけ吐き出せる」ように、period から会計年度内の月範囲を組み立てる
  const handleDownloadExpense = () => {
    const range = periodToRange(period, fiscalYear);
    if (!range) return;
    const params = new URLSearchParams({
      fromYM: range.fromYM,
      toYM: range.toYM,
      store,
    });
    window.open(`/api/download/expense-csv?${params}`, "_blank");
  };
  const handleDownloadPlCsv = () => {
    const params = new URLSearchParams({
      year: String(fiscalYear),
      store,
    });
    // 上期/下期は period=h1|h2 で API 側で月絞り込み
    if (period === "上期") params.set("period", "h1");
    else if (period === "下期") params.set("period", "h2");
    window.open(`/api/download/pl-csv?${params}`, "_blank");
  };

  return (
    <>
      {/* ダウンロードボタン: 表示中の期間（通期/上期/下期）でCSV出力 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={handleDownloadExpense}
          className="text-sm bg-white border rounded-lg px-3 py-1.5 hover:bg-gray-50 text-gray-700 shadow-sm"
          title={`表示中の${period}（月別ZIP）で経費明細をダウンロード`}
        >
          📥 経費明細をダウンロード（{period}・ZIP）
        </button>
        <button
          onClick={handleDownloadPlCsv}
          className="text-sm bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-100 text-emerald-800 shadow-sm"
          title={`表示中の${period}で損益計算書をダウンロード`}
        >
          📊 損益計算書（PL書式・CSV・{period}）
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="売上合計"
          value={formatYen(totals.revenue)}
          color={COLORS.blue}
          current={totals.revenue}
          previousYear={annualData.previous_period_totals?.revenue}
          previousYearLabel="前年比"
        />
        <KPICard
          title="人件費合計"
          value={formatYen(totals.labor)}
          color={COLORS.red}
          salesRatioOf={{ numerator: totals.labor, revenue: totals.revenue }}
          current={totals.labor}
          previousYear={annualData.previous_period_totals?.labor}
          previousYearLabel="前年比"
          lowerIsBetter
        />
        <KPICard
          title="経費合計"
          value={formatYen(totals.expense)}
          color={COLORS.orange}
          help="人件費を除く店舗経費の合計（広告宣伝費・消耗品費・賃借料・通信費・支払手数料・本部一括経費 等）。仕入高・売上原価は含みません。"
          salesRatioOf={{ numerator: totals.expense, revenue: totals.revenue }}
          current={totals.expense}
          previousYear={annualData.previous_period_totals?.expense}
          previousYearLabel="前年比"
          lowerIsBetter
        />
        <KPICard
          title="営業利益"
          value={formatYen(totals.profit)}
          color={totals.profit >= 0 ? COLORS.green : COLORS.red}
          salesRatioOf={{ numerator: totals.profit, revenue: totals.revenue }}
          current={totals.profit}
          previousYear={annualData.previous_period_totals?.profit}
          previousYearLabel="前年比"
        />
      </div>

      {/* 前年比比較グラフ（坪井さん要望: 前期 vs 今期 を項目別に並べて見たい） */}
      {annualData.previous_period_totals && (
        <>
          <SectionTitle>前年比比較グラフ</SectionTitle>
          <div className="bg-white rounded-lg border shadow-sm p-4 mb-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={(() => {
                  const prev = annualData.previous_period_totals!;
                  const adv = chartData.reduce((s, d) => s + d.広告宣伝費, 0);
                  const sup = chartData.reduce((s, d) => s + d.消耗品費, 0);

                  const items = isAllStores
                    ? [
                        { 項目: "売上", 前期: prev.revenue, 今期: totals.revenue },
                        { 項目: "人件費", 前期: prev.labor, 今期: totals.labor },
                        { 項目: "広告宣伝費", 前期: prev.advertising, 今期: adv },
                        { 項目: "消耗品費", 前期: prev.supplies, 今期: sup },
                        { 項目: "営業利益", 前期: prev.profit, 今期: totals.profit },
                      ]
                    : [
                        { 項目: "会費", 前期: prev.sales_membership, 今期: chartData.reduce((s, d) => s + d.会費売上, 0) },
                        { 項目: "パーソナル", 前期: prev.sales_personal, 今期: chartData.reduce((s, d) => s + d.パーソナル売上, 0) },
                        { 項目: "物販", 前期: prev.sales_product, 今期: chartData.reduce((s, d) => s + d.物販売上, 0) },
                        { 項目: "その他", 前期: prev.sales_other, 今期: chartData.reduce((s, d) => s + d.その他売上, 0) },
                        { 項目: "人件費", 前期: prev.labor, 今期: totals.labor },
                        { 項目: "広告宣伝費", 前期: prev.advertising, 今期: adv },
                        { 項目: "消耗品費", 前期: prev.supplies, 今期: sup },
                        { 項目: "営業利益", 前期: prev.profit, 今期: totals.profit },
                      ];
                  return items.map((d) => ({
                    ...d,
                    前年比: d.前期 > 0 ? ((d.今期 / d.前期) * 100).toFixed(1) + "%" : "-",
                  }));
                })()}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="項目" fontSize={11} />
                <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === "前年比") return [String(value), "前年比"];
                    return [formatYen(Number(value)), String(name)];
                  }}
                />
                <Legend />
                {/* 前期=薄い色、今期=濃い色（坪井さん要望3） */}
                <Bar dataKey="前期" fill="#BFDBFE" radius={[4, 4, 0, 0]} />
                <Bar dataKey="今期" fill="#1E40AF" radius={[4, 4, 0, 0]}>
                  {/* 今期バーの上に「前年比 ◯%」を常時表示（仕様書通り） */}
                  <LabelList
                    dataKey="前年比"
                    position="top"
                    formatter={(v: unknown) =>
                      typeof v === "string" && v !== "-" ? `前年比 ${v}` : ""
                    }
                    style={{ fontSize: 10, fill: "#1E40AF", fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-400 mt-2">
              ※ 経費・人件費の前年データが取り込まれていない期間は 0 表示。
            </p>
          </div>
        </>
      )}

      {/* Main charts (2x2): 売上・営業損益・会員数 推移 */}
      <SectionTitle>売上・営業損益・会員数 推移</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Revenue trend with budget overlay */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">売上推移</p>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="売上" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
              <Line
                type="monotone"
                dataKey="売上予算"
                name="売上予算"
                stroke="#374151"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={{ r: 3, fill: "#374151" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* 営業損益推移（坪井さん要望: 在籍会員数推移と位置入れ替え。右上に配置） */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">営業損益推移</p>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="営業利益" name="営業損益" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.営業利益 >= 0 ? COLORS.green : COLORS.red} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="営業利益予算" name="営業損益予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Member trend（在籍会員数推移を左下へ） */}
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

        {/* 経費内訳推移（人件費＋経費の積み上げ） */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">経費内訳推移</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar dataKey="人件費" stackId="a" fill={COLORS.red} />
              <Bar dataKey="経費" stackId="a" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 売上4分類推移（店舗ビュー時のみ）
          坪井さん要望: 各店については、「会費」「パーソナル」「物販」「その他」に分けたい。 */}
      {!isAllStores && (
        <>
          <SectionTitle>売上内訳推移</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">会費売上推移</p>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="会費売上" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="会費売上予算" name="会費売上予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">パーソナル売上推移</p>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="パーソナル売上" fill={COLORS.teal} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="パーソナル売上予算" name="パーソナル売上予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">物販売上推移</p>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="物販売上" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="物販売上予算" name="物販売上予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">その他売上推移</p>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="その他売上" fill={COLORS.gray} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="その他売上予算" name="その他売上予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* コスト推移（全社×月次）
          坪井さん要望: 利益(営業損益推移)は上部「売上・営業損益・会員数 推移」へ移動したため
          見出しは「コスト推移」。人件費・広告宣伝費・消耗品費・獲得コストを個別に推移表示。 */}
      <SectionTitle>コスト推移</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">人件費推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="人件費" fill={COLORS.red} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="人件費予算" name="人件費予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">広告宣伝費推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="広告宣伝費" fill={COLORS.orange} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="広告宣伝費予算" name="広告宣伝費予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">消耗品費推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="消耗品費" fill={COLORS.teal} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="消耗品費予算" name="消耗品費予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
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
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
              <Tooltip
                formatter={(value, name) => [
                  Number(value) > 0 ? formatYen(Number(value)) + "/人" : "-",
                  String(name),
                ]}
              />
              <Line
                type="monotone"
                dataKey="獲得コスト"
                name="獲得コスト"
                stroke={COLORS.orange}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="獲得コスト予算"
                name="獲得コスト予算"
                stroke="#374151"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={{ r: 3, fill: "#374151" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* MA002 charts — 桁の違いを見やすくするため新規入会/退会/休会は個別グラフに分割 */}
      <SectionTitle>会員数推移 (MA002)</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* 体験者数 推移（hacomono自動 + 手動上書き）+ 内訳スタック表示 */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">
            <span className="inline-flex items-center gap-2">
              体験者数 推移
              <span className="text-xs text-gray-400 font-normal">
                （内訳: 紹介経由 / 紹介以外）
              </span>
            </span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} unit="人" />
              <Tooltip content={<MemberTooltip />} />
              {/* スタックで紹介経由＋紹介以外を積み上げ、合計=体験者数 */}
              <Bar dataKey="紹介経由" stackId="trial" fill={COLORS.blue} radius={[0, 0, 0, 0]} />
              <Bar dataKey="紹介以外" stackId="trial" fill={COLORS.teal} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="体験者数予算" name="体験者数予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* 入会率 推移（新規入会÷体験者数、坪井さん要望#10） */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">
            <span className="inline-flex items-center gap-2">
              入会率推移
              <span className="text-xs text-gray-400 font-normal">（新規入会数 ÷ 体験者数）</span>
            </span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis unit="%" fontSize={11} />
              <Tooltip
                formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
              />
              <Line
                type="monotone"
                dataKey="入会率"
                stroke={COLORS.green}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* 入会数 推移（坪井さん要望: 文言から「新規」を削除、グラフは残す） */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">入会数 推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} unit="人" />
              <Tooltip content={<MemberTooltip />} />
              <Bar dataKey="新規入会数" name="入会数" fill={COLORS.green} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="新規入会数予算" name="入会数予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">休会数 推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} unit="人" />
              <Tooltip content={<MemberTooltip />} />
              <Bar dataKey="休会数" fill={COLORS.gray} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="休会数予算" name="休会数予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">退会数 推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} unit="人" />
              <Tooltip content={<MemberTooltip />} />
              <Bar dataKey="退会数" fill={COLORS.red} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="退会数予算" name="退会数予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">退会率推移</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis unit="%" fontSize={11} />
              <Tooltip
                formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
              />
              <Line
                type="monotone"
                dataKey="退会率"
                stroke={COLORS.red}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
              <Line type="monotone" dataKey="退会率予算" name="退会率予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* 客単価推移（坪井さん要望: 月会費売上÷プラン契約者数、予算折れ線重ね） */}
        <div className="bg-white rounded-lg border shadow-sm p-4 lg:col-span-2">
          <p className="text-sm font-medium text-gray-600 mb-3">
            <span className="inline-flex items-center gap-2">
              客単価推移
              <span className="text-xs text-gray-400 font-normal">（月会費売上 ÷ プラン契約者数）</span>
            </span>
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              {/* Y軸の上限に余裕を持たせる（坪井さん指摘: ギリギリで見づらかった） */}
              <YAxis
                tickFormatter={(v: number) => formatCompact(v)}
                fontSize={11}
                domain={[0, (dataMax: number) => Math.ceil((dataMax * 1.2) / 1000) * 1000]}
              />
              <Tooltip
                formatter={(value, name) => [formatYen(Number(value)), String(name)]}
              />
              <Bar dataKey="客単価" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="客単価予算" name="客単価予算" stroke="#374151" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3, fill: "#374151" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
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
      {isAllStores && storeCompareDisplayed && (
        <>
          <SectionTitle>店舗比較</SectionTitle>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Revenue comparison（坪井さん要望: 平均予算ライン→店舗ごとの予算を折れ線で） */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別売上</p>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={storeCompareDisplayed.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store_display" fontSize={10} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="revenue" name="売上" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="budget_revenue"
                    name="予算"
                    stroke="#374151"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    dot={{ r: 3, fill: "#374151" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* 店舗別営業損益（坪井さん要望: 平均ではなく店舗ごとの予算を折れ線で） */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別営業損益</p>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={storeCompareDisplayed.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store_display" fontSize={10} />
                  <YAxis tickFormatter={(v: number) => formatCompact(v)} fontSize={11} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="profit" name="営業損益" radius={[4, 4, 0, 0]}>
                    {storeCompareDisplayed.stores.map((s, i) => (
                      <Cell key={i} fill={s.profit >= 0 ? COLORS.green : COLORS.red} />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="budget_profit"
                    name="予算"
                    stroke="#374151"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    dot={{ r: 3, fill: "#374151" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* 店舗別新規体験者数（坪井さん要望: 店舗ごとの予算を折れ線で） */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別新規体験者数</p>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={storeCompareDisplayed.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store_display" fontSize={10} />
                  <YAxis fontSize={11} allowDecimals={false} unit="人" />
                  <Tooltip
                    formatter={(value, name) => [`${Number(value)}人`, String(name)]}
                  />
                  <Bar
                    dataKey="trial_count"
                    name="新規体験者数"
                    fill={COLORS.purple}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    type="monotone"
                    dataKey="budget_trial_count"
                    name="予算"
                    stroke="#374151"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    dot={{ r: 3, fill: "#374151" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* 店舗別入会率（坪井さん要望: 店舗ごとの予算を折れ線で） */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別入会率</p>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={storeCompareDisplayed.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store_display" fontSize={10} />
                  <YAxis unit="%" fontSize={11} />
                  <Tooltip
                    formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]}
                  />
                  <Bar
                    dataKey="signup_rate"
                    name="入会率"
                    fill={COLORS.orange}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    type="monotone"
                    dataKey="budget_signup_rate"
                    name="予算"
                    stroke="#374151"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    dot={{ r: 3, fill: "#374151" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Plan subscribers */}
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <p className="text-sm font-medium text-gray-600 mb-3">店舗別在籍会員数（プラン契約者数）</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={storeCompareDisplayed.stores}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store_display" fontSize={10} />
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
                  data={storeCompareDisplayed.stores.map((s) => ({
                    ...s,
                    cancel_rate_num:
                      parseFloat(s.cancellation_rate.replace("%", "")) || 0,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="store_display" fontSize={10} />
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
          isPerHour?: boolean;
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

        // タイムバリュー（営業利益 ÷ 総勤務時間。1時間あたりの稼ぎ）
        // 総勤務時間が記録されている月のみ計算（無い月は "-"）
        if (hasPayroll) {
          const tvValues: (number | string)[] = monthly.map((m) =>
            (m.total_hours ?? 0) > 0
              ? Math.round(m.operating_profit / m.total_hours)
              : "-",
          );
          const hoursSum = monthly.reduce((s, m) => s + (m.total_hours || 0), 0);
          const tvTotal: number | string =
            hoursSum > 0 ? Math.round(totals.profit / hoursSum) : "-";
          // 月平均は時間あり月のみで平均する
          const tvNumeric = tvValues.filter(
            (v): v is number => typeof v === "number",
          );
          const tvAvg: number | string =
            tvNumeric.length > 0
              ? Math.round(tvNumeric.reduce((s, v) => s + v, 0) / tvNumeric.length)
              : "-";
          rows.push({
            label: "  タイムバリュー",
            values: tvValues,
            total: tvTotal,
            avg: tvAvg,
            isPerHour: true,
          });
        }

        const fmtCell = (
          v: string | number,
          isHours?: boolean,
          isPerHour?: boolean,
        ) => {
          if (isHours) return typeof v === "number" ? (v > 0 ? `${v.toFixed(1)}h` : "-") : "-";
          if (isPerHour) return typeof v === "number" ? `${formatYen(v)}/h` : "-";
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
                        {fmtCell(v, row.isHours, row.isPerHour)}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right bg-gray-50 whitespace-nowrap">
                      {fmtCell(row.total, row.isHours, row.isPerHour)}
                    </td>
                    <td className="px-3 py-1.5 text-right bg-gray-50 whitespace-nowrap">
                      {fmtCell(row.avg, row.isHours, row.isPerHour)}
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

      {/* 会員属性（坪井さん要望13）: 男女構成比・年代別構成比 */}
      {/* ML001 時点スナップショットのため期間は無関係（現アクティブ会員を集計） */}
      <AttributesSection
        store={store}
        trialOnly={false}
        title="会員属性"
        helpText="現時点でアクティブな会員の男女構成比と年代別構成比（hacomono CSV 由来・ML001時点スナップショット）"
        months={annualData.effective_periods ?? annualData.periods ?? []}
      />

      {/* 新規体験者属性（坪井さん要望14）: アンケート3問の集計 */}
      {/* MonthlyView と同じ EnqueteSection を流用。アンケート回答も時点スナップショットのため期間不問。 */}
      <EnqueteSection store={store} />
    </>
  );
}
