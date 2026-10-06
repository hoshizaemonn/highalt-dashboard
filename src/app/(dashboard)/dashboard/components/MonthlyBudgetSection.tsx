"use client";

import { monthlyBudgetTotals, budgetComparison } from "@/lib/monthly-budget";
import type { DashboardData } from "./shared";

interface Props {
  budget: Record<string, number>;
  revenue: number;
  labor: number;
  expense: number;
  profit: number;
  expenseByCategory: Record<string, number>;
  member: DashboardData["member"];
  year: number;
  month: number;
}
interface Row {
  label: string;
  budget: number | null;
  actual: number | null;
  lowerIsBetter?: boolean;
  unit?: "人" | "%";
}
const format = (n: number, unit?: Row["unit"]) => unit
  ? `${n.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}${unit}`
  : `${Math.round(n).toLocaleString("ja-JP")}円`;

function ComparisonTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm tabular-nums">
        <thead className="border-b bg-gray-50 text-gray-600">
          <tr>{["項目", "予算", "実績", "差額・差分", "予算比"].map((label, i) => (
            <th key={label} scope="col" className={`px-4 py-3 font-medium whitespace-nowrap ${i ? "text-right" : "text-left"}`}>{label}</th>
          ))}</tr>
        </thead>
        <tbody>{rows.map(row => {
          const { difference, ratio } = budgetComparison(row.budget, row.actual);
          const good = difference !== null && (row.lowerIsBetter ? difference <= 0 : difference >= 0);
          return (
            <tr key={row.label} className="border-b last:border-0">
              <th scope="row" className="px-4 py-3 text-left font-medium whitespace-nowrap">{row.label}</th>
              <td className="px-4 py-3 text-right whitespace-nowrap">{row.budget === null ? <span className="text-gray-400">未設定</span> : format(row.budget, row.unit)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">{row.actual === null ? "—" : format(row.actual, row.unit)}</td>
              <td className={`px-4 py-3 text-right whitespace-nowrap ${difference === null || difference === 0 ? "text-gray-500" : good ? "text-emerald-700" : "text-red-600"}`}>
                {difference === null ? "—" : `${difference > 0 ? "+" : difference < 0 ? "−" : ""}${row.unit === "%" ? `${Math.abs(difference).toFixed(1)}pt` : format(Math.abs(difference), row.unit)}`}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">{ratio === null ? "—" : `${ratio.toFixed(1)}%`}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export default function MonthlyBudgetSection(props: Props) {
  const { budget, member } = props;
  const totals = monthlyBudgetTotals(budget);
  const summary: Row[] = [
    { label: "売上合計", budget: totals.revenue, actual: props.revenue },
    { label: "人件費合計", budget: totals.labor, actual: props.labor, lowerIsBetter: true },
    { label: "経費合計", budget: totals.expense, actual: props.expense, lowerIsBetter: true },
    { label: "営業利益", budget: totals.profit, actual: props.profit },
  ];
  const pick = (...keys: string[]) => keys.map(k => budget[k]).find(v => v !== undefined) ?? null;
  const rate = member?.cancellation_rate?.trim();
  const rateNumber = rate ? Number(rate.replace(/[%％,\s]/g, "")) : NaN;
  const kpiCandidates: Row[] = [
    { label: "体験者数", budget: pick("体験者数", "新規体験者数"), actual: member?.trial_count ?? null, unit: "人" },
    { label: "新規入会数", budget: pick("新規入会数", "新規入会"), actual: member?.new_plan_signups ?? null, unit: "人" },
    { label: "退会数", budget: pick("退会数", "退会"), actual: member?.cancellations ?? null, unit: "人", lowerIsBetter: true },
    { label: "休会数", budget: pick("休会数", "休会"), actual: member?.suspensions ?? null, unit: "人", lowerIsBetter: true },
    { label: "退会率", budget: pick("退会率"), actual: Number.isFinite(rateNumber) ? rateNumber : null, unit: "%", lowerIsBetter: true },
    { label: "有効在籍数", budget: pick("有効在籍数"), actual: member?.plan_subscribers ?? null, unit: "人" },
  ];
  const kpis = kpiCandidates.filter(row => row.budget !== null);
  return (
    <section className="mb-6" aria-labelledby="monthly-budget-title">
      <h2 id="monthly-budget-title" className="text-lg font-bold text-gray-800 mb-2">月次予算と実績</h2>
      <p className="text-xs text-gray-500 mb-3">{props.year}年{props.month}月の登録済み予算と比較します。差額・差分は「実績 − 予算」、予算比は「実績 ÷ 予算」です。予算が0以下の場合、予算比は表示しません。</p>
      <p className="text-xs text-gray-500 mb-2 sm:hidden">表は横にスクロールして確認できます。</p>
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden"><ComparisonTable rows={summary} /></div>
      {!Object.keys(budget).length && <p className="mt-2 text-sm text-gray-500">この店舗・月の予算は未登録です。対象年度の予算CSVを取り込むと表示されます。</p>}
      {kpis.length > 0 && <div className="mt-4 bg-white rounded-lg border shadow-sm overflow-hidden"><ComparisonTable rows={kpis} /></div>}
      {totals.expenseCategories.length > 0 && (
        <details className="mt-3 bg-white rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">経費予算の内訳を見る</summary>
          <ComparisonTable rows={totals.expenseCategories.map(category => ({ label: category, budget: budget[category], actual: props.expenseByCategory[category] ?? 0, lowerIsBetter: true }))} />
        </details>
      )}
    </section>
  );
}
