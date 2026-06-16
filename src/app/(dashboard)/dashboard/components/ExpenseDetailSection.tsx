"use client";

import React, { useState, useEffect } from "react";
import { EXPENSE_CATEGORIES, REVENUE_CATEGORIES, STORES } from "@/lib/constants";
import {
  SectionTitle,
} from "./shared";

// ─── Types ──────────────────────────────────────────────────

interface CategorySplitItem {
  category: string;
  amount: number;
  splitRatios?: Record<string, number> | null;
}

interface ExpenseRecord {
  id: number;
  day: number;
  description: string | null;
  amount: number;
  deposit: number;
  category: string | null;
  breakdown: string;
  isRevenue: number;
  splitRatios?: Record<string, number> | null;
  categorySplits?: CategorySplitItem[] | null;
}

interface EditedFields {
  amount?: number;
  deposit?: number;
  category?: string;
  breakdown?: string;
  splitRatios?: Record<string, number> | null;
  categorySplits?: CategorySplitItem[] | null;
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

  // 行ごとの按分エディタ表示状態
  const [splitEditorRowId, setSplitEditorRowId] = useState<number | null>(null);
  const setRowSplitRatios = (
    id: number,
    next: Record<string, number> | null,
  ) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], splitRatios: next },
    }));
  };
  const setRowCategorySplits = (
    id: number,
    next: CategorySplitItem[] | null,
  ) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], categorySplits: next },
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
          const newCategory = ed.category ?? e.category;
          // 収入カテゴリが選ばれていれば isRevenue=1 にローカル反映（DB側でもAPI PUTで同期）
          const newIsRevenue =
            newCategory && REVENUE_CATEGORIES.includes(
              newCategory as typeof REVENUE_CATEGORIES[number],
            )
              ? 1
              : e.isRevenue;
          return {
            ...e,
            amount: ed.amount ?? e.amount,
            deposit: ed.deposit ?? e.deposit,
            category: newCategory,
            breakdown: ed.breakdown ?? e.breakdown,
            isRevenue: newIsRevenue,
            splitRatios:
              ed.splitRatios !== undefined ? ed.splitRatios : e.splitRatios,
            categorySplits:
              ed.categorySplits !== undefined
                ? ed.categorySplits
                : e.categorySplits,
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

      <div className="flex items-center gap-3 mb-3 flex-wrap">
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
          return !cat || cat === "_収入";
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
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">出金</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">入金</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-44">勘定科目</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 min-w-[160px]">内訳</th>
              <th className="text-center px-2 py-2 font-medium text-gray-600 w-24">按分</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => {
              const edited = edits[e.id] ?? {};
              const currentCategoryRaw = edited.category ?? e.category ?? "";
              // "_収入" プレースホルダは未分類扱い
              const currentCategory =
                currentCategoryRaw === "_収入" ? "" : currentCategoryRaw;
              const currentBreakdown = edited.breakdown ?? e.breakdown ?? "";
              const isMissingCategory = !currentCategory;
              const isMissingBreakdown = !currentBreakdown.trim();
              const isRevenueRow =
                e.isRevenue === 1 || (e.deposit > 0 && e.amount === 0);
              const rowBg = isMissingCategory
                ? isRevenueRow
                  ? "bg-blue-50"
                  : "bg-red-50"
                : isMissingBreakdown
                ? "bg-yellow-50"
                : isRevenueRow
                ? "bg-blue-50/40"
                : "";
              return (
                <React.Fragment key={e.id}>
                <tr className={`border-b hover:bg-gray-50/50 ${rowBg}`}>
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
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      value={edited.deposit ?? e.deposit}
                      onChange={(ev) =>
                        handleEdit(e.id, "deposit", Number(ev.target.value))
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
                        isMissingCategory
                          ? isRevenueRow
                            ? "border-blue-400 bg-blue-50 text-blue-700"
                            : "border-red-400 bg-red-50 text-red-700"
                          : ""
                      }`}
                    >
                      <option value="">
                        {isRevenueRow ? "🔵 収入（未分類）" : "🔴 未分類"}
                      </option>
                      <optgroup label="収入">
                        {REVENUE_CATEGORIES.map((c) => (
                          <option key={`r-${c}`} value={c}>
                            {c}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="経費">
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={`e-${c}`} value={c}>
                            {c}
                          </option>
                        ))}
                      </optgroup>
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
                  <td className="px-2 py-1.5 text-center">
                    {(() => {
                      // 編集中の按分: edits 側にあればそれ、なければ DB 値
                      const editedSplit = edits[e.id]?.splitRatios;
                      const currentSplit =
                        editedSplit !== undefined
                          ? editedSplit
                          : e.splitRatios ?? null;
                      const editedCs = edits[e.id]?.categorySplits;
                      const currentCs =
                        editedCs !== undefined ? editedCs : e.categorySplits ?? null;
                      const hasAny = !!currentSplit || (currentCs && currentCs.length > 0);
                      const isExpanded = splitEditorRowId === e.id;
                      return (
                        <button
                          onClick={() =>
                            setSplitEditorRowId(isExpanded ? null : e.id)
                          }
                          className={`text-xs px-2 py-0.5 rounded border ${
                            hasAny
                              ? "bg-purple-100 border-purple-300 text-purple-700"
                              : "bg-white border-gray-300 text-gray-500 hover:bg-gray-50"
                          }`}
                          title={
                            hasAny
                              ? "按分／分解設定済（クリックで編集）"
                              : "店舗按分・科目分解"
                          }
                        >
                          {hasAny ? "🔀 設定済" : "按分/分解"}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
                {splitEditorRowId === e.id && (
                  <tr className="border-b bg-purple-50/40">
                    <td colSpan={7} className="px-4 py-2">
                      <ExpenseRowSplitEditor
                        ratios={
                          (edits[e.id]?.splitRatios !== undefined
                            ? edits[e.id]!.splitRatios
                            : e.splitRatios) ?? null
                        }
                        amount={edited.amount ?? e.amount}
                        onChange={(next) => setRowSplitRatios(e.id, next)}
                      />
                      <CategorySplitEditor
                        rowAmount={edited.amount ?? e.amount}
                        splits={
                          edits[e.id]?.categorySplits !== undefined
                            ? edits[e.id]!.categorySplits ?? null
                            : e.categorySplits ?? null
                        }
                        onChange={(next) => setRowCategorySplits(e.id, next)}
                      />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── 行ごとの按分エディタ ─────────────────────────────
// 1行の金額を複数店舗に手動の比率で按分する。
// ratios が null のときは「単店計上（按分なし）」モード。
function ExpenseRowSplitEditor({
  ratios,
  amount,
  onChange,
}: {
  ratios: Record<string, number> | null;
  amount: number;
  onChange: (next: Record<string, number> | null) => void;
}) {
  const active = ratios !== null;
  const totalRatio = ratios
    ? Object.values(ratios).reduce((s, v) => s + v, 0)
    : 0;

  const enableSplit = () => {
    const each = Math.floor(100 / STORES.length);
    const initial: Record<string, number> = {};
    STORES.forEach((s, idx) => {
      initial[s] =
        idx === STORES.length - 1
          ? 100 - each * (STORES.length - 1)
          : each;
    });
    onChange(initial);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(ev) => (ev.target.checked ? enableSplit() : onChange(null))}
            className="accent-purple-600"
          />
          <span className="font-medium text-gray-700">
            複数店舗に按分する（PayPay銀行で一括支払い時）
          </span>
        </label>
        {active && (
          <span className={totalRatio !== 100 ? "text-red-600" : "text-gray-500"}>
            合計 {totalRatio.toFixed(0)}% {totalRatio !== 100 && "（100%にしてください）"}
          </span>
        )}
      </div>
      {active && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-1.5 bg-white border border-purple-200 rounded p-2">
          {STORES.map((s) => (
            <label key={s} className="text-xs flex items-center gap-1">
              <span className="text-gray-700 w-24 truncate">{s}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={ratios?.[s] ?? 0}
                onChange={(ev) => {
                  const v = parseFloat(ev.target.value) || 0;
                  const next = { ...(ratios ?? {}), [s]: v };
                  if (v <= 0) delete next[s];
                  onChange(next);
                }}
                className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right"
              />
              <span className="text-gray-400">%</span>
              <span className="text-gray-500 ml-1">
                ≈ ¥
                {Math.round(((ratios?.[s] ?? 0) * amount) / 100).toLocaleString()}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 科目別分解エディタ（PayPay一括出金の家賃+電気代等を分ける） ───
function CategorySplitEditor({
  rowAmount,
  splits,
  onChange,
}: {
  rowAmount: number;
  splits: CategorySplitItem[] | null;
  onChange: (next: CategorySplitItem[] | null) => void;
}) {
  const active = !!(splits && splits.length > 0);
  const sumAmount = active
    ? splits!.reduce((s, it) => s + (it.amount || 0), 0)
    : 0;
  const diff = rowAmount - sumAmount;

  const enable = () => {
    // 1行目に元金額を初期値として入れる
    onChange([{ category: EXPENSE_CATEGORIES[0], amount: rowAmount, splitRatios: null }]);
  };

  const updateItem = (idx: number, patch: Partial<CategorySplitItem>) => {
    if (!splits) return;
    onChange(splits.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeItem = (idx: number) => {
    if (!splits) return;
    const next = splits.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : null);
  };

  const addItem = () => {
    const remaining = Math.max(diff, 0);
    onChange([
      ...(splits ?? []),
      { category: EXPENSE_CATEGORIES[0], amount: remaining, splitRatios: null },
    ]);
  };

  return (
    <div className="mt-3 pt-3 border-t border-purple-200">
      <div className="flex items-center gap-3 text-xs mb-2">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={active}
            onChange={(ev) => (ev.target.checked ? enable() : onChange(null))}
            className="accent-purple-600"
          />
          <span className="font-medium text-gray-700">
            この行を科目別に分解する（PayPay一括出金で家賃+電気代等が混ざっている時）
          </span>
        </label>
        {active && (
          <span className={diff !== 0 ? "text-red-600" : "text-gray-500"}>
            元金額 ¥{rowAmount.toLocaleString()} / 分解合計 ¥{sumAmount.toLocaleString()}
            {diff !== 0 && ` （差分 ¥${diff.toLocaleString()}）`}
          </span>
        )}
      </div>
      {active && (
        <div className="space-y-2 bg-white border border-purple-200 rounded p-2">
          {splits!.map((it, idx) => (
            <div key={idx} className="space-y-1 border-b border-gray-100 pb-2 last:border-b-0 last:pb-0">
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={it.category}
                  onChange={(e) => updateItem(idx, { category: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-0.5 text-xs w-40"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={it.amount}
                  onChange={(e) =>
                    updateItem(idx, { amount: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-28 border border-gray-300 rounded px-2 py-0.5 text-xs text-right"
                  placeholder="金額"
                />
                <button
                  onClick={() => removeItem(idx)}
                  className="text-red-500 hover:text-red-700 text-xs"
                  title="削除"
                >
                  ✕
                </button>
              </div>
              <ExpenseRowSplitEditor
                ratios={it.splitRatios ?? null}
                amount={it.amount}
                onChange={(next) => updateItem(idx, { splitRatios: next })}
              />
            </div>
          ))}
          <button
            onClick={addItem}
            className="text-xs text-purple-700 hover:text-purple-900 mt-1"
          >
            ＋ 分解行を追加
          </button>
        </div>
      )}
    </div>
  );
}
