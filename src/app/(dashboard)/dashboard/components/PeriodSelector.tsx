"use client";

import { STORES } from "@/lib/constants";
import { PERIOD_OPTIONS } from "./shared";

const STORE_OPTIONS = [...STORES, "全体"] as const;

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
