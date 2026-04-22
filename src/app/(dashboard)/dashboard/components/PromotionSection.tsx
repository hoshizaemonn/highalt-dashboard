"use client";

import { useState, useEffect } from "react";
import {
  COLORS,
  formatYen,
  formatCompact,
  numFormat,
  KPICard,
  SectionTitle,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "./shared";

// ─── Promotion types ──────────────────────────────────────

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

// ─── Promotion section (monthly) ──────────────────────────

export interface PromotionSectionProps {
  year: number;
  month: number;
  store: string;
  unitPriceBudget?: number;
  /** 実績客単価（PL001 月会費合計 / プラン契約者数）。指定時は販促報告の unitPrice より優先 */
  unitPriceActual?: number | null;
}

export function PromotionSection({
  year,
  month,
  store,
  unitPriceBudget = 0,
  unitPriceActual = null,
}: PromotionSectionProps) {
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

  // Actual unit price: prefer auto-calculated value; fall back to manually entered value in the promotion report
  const resolvedUnitPriceActual =
    unitPriceActual != null && unitPriceActual > 0
      ? unitPriceActual
      : data?.unitPrice && data.unitPrice > 0
        ? data.unitPrice
        : null;

  if (!data) {
    if (unitPriceBudget <= 0 && !resolvedUnitPriceActual) return null;
    return (
      <UnitPriceSection budget={unitPriceBudget} actual={resolvedUnitPriceActual} />
    );
  }

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
      <UnitPriceSection budget={unitPriceBudget} actual={resolvedUnitPriceActual} />

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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

// ─── Unit price section (budget / actual / diff) ──────────

function UnitPriceSection({
  budget,
  actual,
}: {
  budget: number;
  actual: number | null;
}) {
  const hasBudget = budget > 0;
  const hasActual = actual !== null && actual > 0;

  if (!hasBudget && !hasActual) return null;

  // Budget only — actual not yet entered
  if (hasBudget && !hasActual) {
    return (
      <>
        <SectionTitle>客単価</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <KPICard
            title="客単価（予算）"
            value={formatYen(budget)}
            color={COLORS.gray}
            sub="実績未入力"
          />
        </div>
      </>
    );
  }

  // Actual only — no budget set yet
  if (!hasBudget && hasActual) {
    return (
      <>
        <SectionTitle>客単価</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <KPICard title="客単価" value={formatYen(actual as number)} color={COLORS.blue} />
        </div>
      </>
    );
  }

  // Both present — show budget / actual+ratio / diff
  const a = actual as number;
  const diff = a - budget;
  const ratio = budget !== 0 ? a / budget : 0;
  const isGood = a >= budget;
  return (
    <>
      <SectionTitle>客単価</SectionTitle>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <KPICard title="客単価（予算）" value={formatYen(budget)} color={COLORS.gray} />
        <KPICard
          title="客単価（実績）"
          value={formatYen(a)}
          color={COLORS.blue}
          sub={`達成率 ${(ratio * 100).toFixed(1)}%`}
        />
        <KPICard
          title="予実差"
          value={formatYen(diff)}
          color={isGood ? COLORS.green : COLORS.red}
        />
      </div>
    </>
  );
}

// ─── Promotion section (period/annual) ────────────────────

interface PromotionMonthlyEntry {
  month: number;
  month_label: string;
  report: PromotionData | null;
}

export interface PromotionPeriodSectionProps {
  fiscalYear: number;
  store: string;
  months: number[];
}

export function PromotionPeriodSection({
  fiscalYear,
  store,
  months,
}: PromotionPeriodSectionProps) {
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
