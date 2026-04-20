"use client";

import { useState, useEffect } from "react";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import {
  SectionTitle,
} from "./shared";

// ─── Types ──────────────────────────────────────────────────

interface ExpenseRecord {
  id: number;
  day: number;
  description: string | null;
  amount: number;
  category: string | null;
  breakdown: string;
}

interface EditedFields {
  amount?: number;
  category?: string;
  breakdown?: string;
}

// ─── Component ──────────────────────────────────────────────

export interface ExpenseDetailSectionProps {
  year: number;
  month: number;
  store: string;
}

export default function ExpenseDetailSection({
  year,
  month,
  store,
}: ExpenseDetailSectionProps) {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [edits, setEdits] = useState<Record<number, EditedFields>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setSaveMsg(null);
      setEdits({});
      try {
        const params = new URLSearchParams({
          year: String(year),
          month: String(month),
          store,
        });
        const res = await fetch(`/api/dashboard/expenses?${params}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (!cancelled) setExpenses(data.expenses ?? []);
      } catch {
        if (!cancelled) setExpenses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [year, month, store]);

  const handleEdit = (id: number, field: keyof EditedFields, value: string | number) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const hasChanges = Object.keys(edits).length > 0;

  const missingBreakdownCount = expenses.filter((e) => {
    const edited = edits[e.id];
    const bd = edited?.breakdown ?? e.breakdown;
    return !bd || bd.trim() === "";
  }).length;

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updates = Object.entries(edits).map(([id, fields]) => ({
        id: Number(id),
        ...fields,
      }));
      const res = await fetch("/api/dashboard/expenses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error("save failed");
      const result = await res.json();
      setSaveMsg(`${result.updated}件を保存しました`);
      // Apply edits to local state
      setExpenses((prev) =>
        prev.map((e) => {
          const ed = edits[e.id];
          if (!ed) return e;
          return {
            ...e,
            amount: ed.amount ?? e.amount,
            category: ed.category ?? e.category,
            breakdown: ed.breakdown ?? e.breakdown,
          };
        }),
      );
      setEdits({});
    } catch {
      setSaveMsg("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = () => {
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      store,
    });
    window.open(`/api/download/expense-csv?${params}`, "_blank");
  };

  if (loading) {
    return (
      <div className="animate-pulse mt-4">
        <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
        <div className="h-48 bg-gray-100 rounded" />
      </div>
    );
  }

  if (expenses.length === 0) return null;

  return (
    <>
      <SectionTitle>経費明細</SectionTitle>

      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={handleDownload}
          className="text-sm bg-white border rounded-lg px-3 py-1.5 hover:bg-gray-50 text-gray-700 shadow-sm"
        >
          📥 経費明細をダウンロード（CSV）
        </button>
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 shadow-sm"
          >
            {saving ? "保存中…" : "変更を保存"}
          </button>
        )}
        {saveMsg && (
          <span className="text-sm text-green-600">{saveMsg}</span>
        )}
      </div>

      {(() => {
        const missingCatCount = expenses.filter((e) => {
          const cat = edits[e.id]?.category ?? e.category ?? "";
          return !cat;
        }).length;
        return (
          <div className="flex gap-4 mb-2">
            {missingCatCount > 0 && (
              <p className="text-sm text-red-600 font-medium">
                🔴 勘定科目 未分類: {missingCatCount}件
              </p>
            )}
            {missingBreakdownCount > 0 && (
              <p className="text-sm text-amber-600">
                🟡 内訳未入力: {missingBreakdownCount}件
              </p>
            )}
          </div>
        );
      })()}

      <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-12">日</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[160px]">摘要</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">金額</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-36">勘定科目</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[160px]">内訳</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => {
              const edited = edits[e.id] ?? {};
              const currentCategory = edited.category ?? e.category ?? "";
              const currentBreakdown = edited.breakdown ?? e.breakdown ?? "";
              const isMissingCategory = !currentCategory;
              const isMissingBreakdown = !currentBreakdown.trim();
              const rowBg = isMissingCategory
                ? "bg-red-50"
                : isMissingBreakdown
                ? "bg-yellow-50"
                : "";
              return (
                <tr key={e.id} className={`border-b hover:bg-gray-50/50 ${rowBg}`}>
                  <td className="px-3 py-1.5 text-gray-600">{e.day}</td>
                  <td className="px-3 py-1.5 text-gray-700">{e.description ?? ""}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      value={edited.amount ?? e.amount}
                      onChange={(ev) =>
                        handleEdit(e.id, "amount", Number(ev.target.value))
                      }
                      className="w-24 text-right border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={currentCategory}
                      onChange={(ev) =>
                        handleEdit(e.id, "category", ev.target.value)
                      }
                      className={`border rounded px-2 py-0.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-300 ${
                        isMissingCategory ? "border-red-400 bg-red-50 text-red-700" : ""
                      }`}
                    >
                      <option value="">🔴 未分類</option>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={currentBreakdown}
                      onChange={(ev) =>
                        handleEdit(e.id, "breakdown", ev.target.value)
                      }
                      className={`w-full border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300 ${
                        isMissingBreakdown ? "border-amber-400 bg-amber-50" : ""
                      }`}
                      placeholder="🟡 未入力"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
