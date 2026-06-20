"use client";

import { useEffect, useState } from "react";
import { formatYen, SectionTitle } from "./shared";

interface MonthCell {
  month: number;
  label: string;
  current: number;
  prev: number;
  yoy: number | null;
}
interface CategoryComp {
  category: string;
  monthly: MonthCell[];
  currentTotal: number;
  prevTotal: number;
  yoyTotal: number | null;
}
interface CompResponse {
  fiscalYear: number;
  store: string | null;
  needsStore?: boolean;
  hasData?: boolean;
  months: string[];
  categories: CategoryComp[];
}

function yoyText(yoy: number | null): string {
  if (yoy === null) return "—";
  return `${Math.round(yoy * 1000) / 10}%`;
}
// 経費系は前年比が低い（=前年より減った）方が良い → 100%以下を緑、超過を赤。
function yoyClass(yoy: number | null): string {
  if (yoy === null) return "text-gray-400";
  return yoy <= 1 ? "text-green-700" : "text-red-600";
}

/**
 * 前年比比較（人件費・消耗品費・広告宣伝費）— クライアント公式PL（pl_actuals）由来。
 * 当年 vs 前年を同一ソースで比較する独立ブロック。
 */
export function PlComparisonSection({
  store,
  fiscalYear,
  isAllStores,
}: {
  store: string;
  fiscalYear: number;
  isAllStores: boolean;
}) {
  const [data, setData] = useState<CompResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          fiscalYear: String(fiscalYear),
        });
        if (!isAllStores) params.set("store", store);
        const res = await fetch(`/api/dashboard/pl-comparison?${params}`);
        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [store, fiscalYear, isAllStores]);

  if (loading) {
    return (
      <div className="animate-pulse mt-8">
        <div className="h-4 bg-gray-200 rounded w-48 mb-3" />
        <div className="h-40 bg-gray-100 rounded" />
      </div>
    );
  }

  // 全体ビューや店舗未指定時 → 店舗選択を促す
  if (!data || data.needsStore || !data.store) {
    return (
      <>
        <SectionTitle>前年比比較（人件費・消耗品費・広告宣伝費）</SectionTitle>
        <p className="text-sm text-gray-500 bg-white rounded-lg border shadow-sm p-4">
          前年比比較は店舗別に表示します。上の「店舗」で店舗を選択してください。
        </p>
      </>
    );
  }

  if (data.hasData === false) {
    return (
      <>
        <SectionTitle>前年比比較（人件費・消耗品費・広告宣伝費）</SectionTitle>
        <p className="text-sm text-gray-500 bg-white rounded-lg border shadow-sm p-4">
          {data.store} のPLデータが未取込です。「アップロード →
          前年比PL」から開業PLのCSVを取り込むと表示されます。
        </p>
      </>
    );
  }

  return (
    <>
      <SectionTitle>前年比比較（人件費・消耗品費・広告宣伝費）</SectionTitle>
      <p className="text-xs text-gray-500 mb-2">
        クライアント様の「開業からのPL」由来。当年・前年とも同一ソースで比較しています（単位：円）。
      </p>
      <div className="space-y-6">
        {data.categories.map((cat) => (
          <div
            key={cat.category}
            className="bg-white rounded-lg border shadow-sm overflow-x-auto"
          >
            <div className="px-4 py-2 border-b bg-gray-50 font-bold text-gray-700">
              {cat.category}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50/50 min-w-[88px]">
                    区分
                  </th>
                  {data.months.map((m) => (
                    <th
                      key={m}
                      className="text-right px-3 py-2 font-medium text-gray-600 min-w-[84px]"
                    >
                      {m}
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 font-medium text-gray-700 bg-gray-100 min-w-[96px]">
                    合計
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="px-3 py-1.5 sticky left-0 bg-white text-gray-700">
                    当年
                  </td>
                  {cat.monthly.map((c) => (
                    <td key={c.month} className="px-3 py-1.5 text-right whitespace-nowrap">
                      {c.current ? formatYen(c.current) : "-"}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right bg-gray-50 font-medium whitespace-nowrap">
                    {formatYen(cat.currentTotal)}
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-3 py-1.5 sticky left-0 bg-white text-gray-500">
                    前年
                  </td>
                  {cat.monthly.map((c) => (
                    <td
                      key={c.month}
                      className="px-3 py-1.5 text-right text-gray-500 whitespace-nowrap"
                    >
                      {c.prev ? formatYen(c.prev) : "-"}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right bg-gray-50 text-gray-500 whitespace-nowrap">
                    {formatYen(cat.prevTotal)}
                  </td>
                </tr>
                <tr className="border-b font-medium">
                  <td className="px-3 py-1.5 sticky left-0 bg-white text-gray-700">
                    前年比
                  </td>
                  {cat.monthly.map((c) => (
                    <td
                      key={c.month}
                      className={`px-3 py-1.5 text-right whitespace-nowrap ${yoyClass(c.yoy)}`}
                    >
                      {yoyText(c.yoy)}
                    </td>
                  ))}
                  <td
                    className={`px-3 py-1.5 text-right bg-gray-50 whitespace-nowrap ${yoyClass(cat.yoyTotal)}`}
                  >
                    {yoyText(cat.yoyTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
