import { budgetComparison } from "@/lib/monthly-budget";

export interface CardBudget {
  amount: number | null;
  actual: number | null;
  unit?: "人" | "%";
  lowerIsBetter?: boolean;
}

/** 既存カード内の予算表示。undefinedなら従来のカードを変えない。 */
export default function BudgetIndicator({ amount, actual, unit, lowerIsBetter }: CardBudget) {
  const { ratio, difference } = budgetComparison(amount, actual);
  const good = difference !== null && (lowerIsBetter ? difference <= 0 : difference >= 0);
  const text = amount === null ? "未設定" : `${amount.toLocaleString("ja-JP", { maximumFractionDigits: unit === "%" ? 1 : 0 })}${unit ?? "円"}`;
  return (
    <div className="mt-2 pt-2 border-t border-gray-100 text-xs space-y-1">
      <div className="flex flex-wrap justify-between gap-x-2 gap-y-1">
        <span className="text-gray-500">予算</span>
        <span className="font-medium text-gray-700 tabular-nums">{text}</span>
      </div>
      {amount !== null && (
        <div className="flex flex-wrap justify-between gap-x-2 gap-y-1">
          <span className="text-gray-500">予算比</span>
          <span className={`font-semibold tabular-nums ${ratio === null || difference === 0 ? "text-gray-500" : good ? "text-emerald-700" : "text-red-600"}`} title="実績 ÷ 予算。予算が0以下の場合は表示しません。">
            {ratio === null ? "—" : `${ratio.toFixed(1)}%`}
          </span>
        </div>
      )}
    </div>
  );
}
