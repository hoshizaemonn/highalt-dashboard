"use client";

import { STORES } from "@/lib/constants";
import { PERIOD_OPTIONS, HelpHint } from "./shared";

const STORE_OPTIONS = [...STORES, "全体"] as const;

// 会計年度（10月始まり）→ 期数（社内では「8期」「9期」と呼んでいる）の換算。
// ハイアルチの起算年: 2018/10 = 1期。決算年（fiscalYear）に対し
//   periodNumber = fiscalYear - 2018 + 1
// 例: fiscalYear=2026 → 9期（2025/10〜2026/9）
const FISCAL_BASE_YEAR = 2018;

function fiscalYearLabel(fy: number): string {
  const periodNumber = fy - FISCAL_BASE_YEAR + 1;
  return `${fy}年度（${periodNumber}期 ${fy - 1}/10〜${fy}/9）`;
}

export interface PeriodSelectorProps {
  year: number;
  period: string;
  store: string;
  onYearChange: (y: number) => void;
  onPeriodChange: (p: string) => void;
  onStoreChange: (s: string) => void;
}

export default function PeriodSelector({
  year,
  period,
  store,
  onYearChange,
  onPeriodChange,
  onStoreChange,
}: PeriodSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="relative">
        <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
          <span>年度（決算年）</span>
          <HelpHint text="ハイアルチは10月始まりの会計年度。「2026年度」は2025年10月〜2026年9月（9期）を指します。" />
        </label>
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 appearance-none"
          style={{ WebkitAppearance: "menulist" }}
        >
          {Array.from({ length: new Date().getFullYear() - 2020 + 6 }, (_, i) => 2020 + i).map((y) => (
            <option key={y} value={y}>{fiscalYearLabel(y)}</option>
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
