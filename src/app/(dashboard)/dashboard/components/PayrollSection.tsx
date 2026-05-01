"use client";

import { useState, useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { STORES } from "@/lib/constants";
import {
  formatYen,
  SectionTitle,
} from "./shared";

// ─── Recalculate Button ─────────────────────────────────────

export interface RecalculateButtonProps {
  year: number;
  month: number;
  onDone: () => void;
}

export function RecalculateButton({
  year,
  month,
  onDone,
}: RecalculateButtonProps) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const doRecalc = async (allMonths: boolean) => {
    const label = allMonths ? `${year}年の全月` : `${year}年${month}月`;
    if (!confirm(`${label}の人件費データを最新の店舗マッピングで再計算します。よろしいですか？`)) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/dashboard/recalculate-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allMonths ? { year, allMonths: true } : { year, month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "エラー");
      setMsg(`${data.employees}件の店舗割り当てを再計算しました`);
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "エラーが発生しました");
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => doRecalc(false)}
        disabled={loading}
        className="text-sm bg-white border rounded-lg px-4 py-2 hover:bg-gray-50 text-gray-700 shadow-sm disabled:opacity-50"
      >
        {loading ? "再計算中..." : `🔄 ${month}月の店舗割り当てを再計算`}
      </button>
      <button
        onClick={() => doRecalc(true)}
        disabled={loading}
        className="text-sm bg-white border rounded-lg px-4 py-2 hover:bg-gray-50 text-gray-700 shadow-sm disabled:opacity-50"
      >
        {loading ? "再計算中..." : `🔄 ${year}年の全月を再計算`}
      </button>
      {msg && <span className="text-sm text-green-600">{msg}</span>}
    </div>
  );
}

// ─── Payroll Detail types & component ─────────────────────

interface PayrollEmployee {
  employeeId: string;
  employeeName: string;
  contractType: string;
  baseSalary: number;
  positionAllowance: number;
  overtimePay: number;
  commuteTaxable: number;
  commuteNontax: number;
  taxableTotal: number;
  grossTotal: number;
  scheduledHours: number;
  overtimeHours: number;
  ratio: number;
  storeName: string;
}

export interface PayrollDetailSectionProps {
  year: number;
  month: number;
  store: string;
  isAdmin: boolean;
  sessionStoreName: string | null;
}

export function PayrollDetailSection({
  year,
  month,
  store,
  isAdmin,
  sessionStoreName,
}: PayrollDetailSectionProps) {
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [loading, setLoading] = useState(true);

  // 従業員別明細は admin のみ閲覧可
  // （安蒜さんの依頼により、自店店長にも非表示にする変更）
  const canView = isAdmin;

  useEffect(() => {
    if (!canView) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          year: String(year),
          month: String(month),
          store,
        });
        const res = await fetch(`/api/dashboard/payroll-detail?${params}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (!cancelled) setEmployees(data.employees ?? []);
      } catch {
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [year, month, store, canView]);

  if (!canView) return null;

  if (loading) {
    return (
      <div className="animate-pulse mt-4">
        <div className="h-4 bg-gray-200 rounded w-32 mb-3" />
        <div className="h-48 bg-gray-100 rounded" />
      </div>
    );
  }

  if (employees.length === 0) return null;

  // Group employees by store
  const byStore: Record<string, PayrollEmployee[]> = {};
  for (const emp of employees) {
    if (!byStore[emp.storeName]) byStore[emp.storeName] = [];
    byStore[emp.storeName].push(emp);
  }

  const storeNames = Object.keys(byStore).sort();

  // 各従業員の現在の按分（複数店舗で按分されている場合の集約用）
  // employeeId をキーに、現在の店舗別比率を保持
  const employeeRatios = new Map<
    string,
    { name: string; splits: { storeName: string; ratio: number }[] }
  >();
  for (const e of employees) {
    const existing = employeeRatios.get(e.employeeId);
    if (existing) {
      existing.splits.push({ storeName: e.storeName, ratio: e.ratio });
    } else {
      employeeRatios.set(e.employeeId, {
        name: e.employeeName,
        splits: [{ storeName: e.storeName, ratio: e.ratio }],
      });
    }
  }

  return (
    <>
      <SectionTitle>従業員別明細</SectionTitle>
      {/* 月単位の按分調整セクション（admin のみ） */}
      <RatioAdjustList
        year={year}
        month={month}
        employeeRatios={employeeRatios}
        onSaved={() => {
          // 親 Section が refetch する仕組みに依存。簡易: window reload
          // TODO: onRefresh プロップを上から流すよう改修
          if (typeof window !== "undefined") window.location.reload();
        }}
      />
      <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-3 py-2 font-medium text-gray-600">店舗</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">氏名</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">契約種別</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">基本給</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">役職手当</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">残業代</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">通勤手当</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">課税支給合計</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">総支給額</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">勤務時間</th>
            </tr>
          </thead>
          <tbody>
            {storeNames.map((sn) => {
              const group = byStore[sn];
              const subtotal = {
                baseSalary: 0,
                positionAllowance: 0,
                overtimePay: 0,
                commute: 0,
                taxableTotal: 0,
                grossTotal: 0,
                hours: 0,
              };
              for (const e of group) {
                const r = e.ratio / 100;
                subtotal.baseSalary += e.baseSalary * r;
                subtotal.positionAllowance += e.positionAllowance * r;
                subtotal.overtimePay += e.overtimePay * r;
                subtotal.commute += (e.commuteTaxable + e.commuteNontax) * r;
                subtotal.taxableTotal += e.taxableTotal * r;
                subtotal.grossTotal += e.grossTotal * r;
                subtotal.hours += (e.scheduledHours + e.overtimeHours) * r;
              }
              return [
                ...group.map((e) => {
                  const r = e.ratio / 100;
                  return (
                    <tr key={`${sn}-${e.employeeId}`} className="border-b hover:bg-gray-50/50">
                      <td className="px-3 py-1.5 text-gray-600">{e.storeName}</td>
                      <td className="px-3 py-1.5 text-gray-700">{e.employeeName}</td>
                      <td className="px-3 py-1.5 text-gray-600">{e.contractType}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.baseSalary * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.positionAllowance * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.overtimePay * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round((e.commuteTaxable + e.commuteNontax) * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.taxableTotal * r))}</td>
                      <td className="px-3 py-1.5 text-right">{formatYen(Math.round(e.grossTotal * r))}</td>
                      <td className="px-3 py-1.5 text-right">{((e.scheduledHours + e.overtimeHours) * r).toFixed(1)}h</td>
                    </tr>
                  );
                }),
                <tr key={`subtotal-${sn}`} className="border-b bg-gray-50 font-bold">
                  <td className="px-3 py-2 text-gray-700">{sn}</td>
                  <td className="px-3 py-2 text-gray-700">小計（{group.length}名）</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.baseSalary))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.positionAllowance))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.overtimePay))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.commute))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.taxableTotal))}</td>
                  <td className="px-3 py-2 text-right">{formatYen(Math.round(subtotal.grossTotal))}</td>
                  <td className="px-3 py-2 text-right">{subtotal.hours.toFixed(1)}h</td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── 月単位の店舗按分調整 ─────────────────────────────────
// admin のみ閲覧可能なテーブルからアクセスされる前提。
// 「Aさんは今月だけ東日本橋50% / 春日50%」のような単発の按分を
// CSVを再アップロードせずに直接編集できる。

interface RatioAdjustListProps {
  year: number;
  month: number;
  employeeRatios: Map<
    string,
    { name: string; splits: { storeName: string; ratio: number }[] }
  >;
  onSaved: () => void;
}

function RatioAdjustList({
  year,
  month,
  employeeRatios,
  onSaved,
}: RatioAdjustListProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const employees = Array.from(employeeRatios.entries());

  // 表示数: 一覧は折りたたみ表示。誤クリック防止のため初期は閉じる。
  const [open, setOpen] = useState(false);

  return (
    <details
      className="bg-white border rounded-lg shadow-sm mb-4"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 select-none flex items-center justify-between">
        <span>
          🔧 店舗按分を調整（応援勤務・兼務の月単位調整）
        </span>
        <span className="text-xs text-gray-400">{employees.length}名</span>
      </summary>
      <div className="px-4 pb-4 pt-2 border-t">
        <p className="text-xs text-gray-500 mb-3 leading-relaxed">
          特定の従業員を、その月だけ複数店舗に按分します（合計100%）。<br />
          ここで保存した内容は <strong>その月のダッシュボード集計に即時反映</strong> されます。
          来月以降は元のルール（従業員→店舗マッピング）に戻ります。
        </p>
        <div className="border rounded divide-y">
          {employees.map(([empId, info]) => {
            const splitText = info.splits
              .map((s) => `${s.storeName} ${s.ratio}%`)
              .join(" / ");
            return (
              <div key={empId} className="px-3 py-2 flex items-center gap-2 text-sm">
                <span className="w-12 text-gray-400 text-xs tabular-nums">{empId}</span>
                <span className="flex-1 text-gray-700">{info.name}</span>
                <span className="text-xs text-gray-500">{splitText}</span>
                <button
                  onClick={() => setEditing(empId)}
                  className="ml-2 text-xs px-2 py-1 rounded bg-gray-100 hover:bg-blue-100 hover:text-blue-700 text-gray-600 transition-colors"
                >
                  編集
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {editing && (
        <RatioEditModal
          year={year}
          month={month}
          employeeId={editing}
          employeeName={employeeRatios.get(editing)?.name ?? ""}
          initialSplits={employeeRatios.get(editing)?.splits ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved();
          }}
        />
      )}
    </details>
  );
}

// ─── 按分編集モーダル ───────────────────────────────────────

interface RatioEditModalProps {
  year: number;
  month: number;
  employeeId: string;
  employeeName: string;
  initialSplits: { storeName: string; ratio: number }[];
  onClose: () => void;
  onSaved: () => void;
}

function RatioEditModal({
  year,
  month,
  employeeId,
  employeeName,
  initialSplits,
  onClose,
  onSaved,
}: RatioEditModalProps) {
  // 状態: 編集中の splits（追加・削除可能）
  const [splits, setSplits] = useState<{ storeName: string; ratio: number }[]>(
    initialSplits.length > 0
      ? initialSplits.map((s) => ({ ...s }))
      : [{ storeName: STORES[0], ratio: 100 }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = splits.reduce((s, x) => s + (x.ratio || 0), 0);
  const isValid = Math.abs(total - 100) <= 1 && splits.every((s) => s.ratio >= 0);

  // 既に splits に含まれている店舗を除外して、追加候補を計算
  const usedStores = new Set(splits.map((s) => s.storeName));
  const availableStores = STORES.filter((s) => !usedStores.has(s));

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/payroll-ratio-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          employeeId,
          splits: splits.filter((s) => s.ratio > 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "保存に失敗しました");
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-bold text-gray-800">
            {year}年{month}月 店舗按分の調整
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-sm">
            <span className="text-gray-500">従業員：</span>
            <span className="font-medium text-gray-800">
              {employeeName}（{employeeId}）
            </span>
          </div>
          <div className="space-y-2">
            {splits.map((s, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={s.storeName}
                  onChange={(e) => {
                    const next = [...splits];
                    next[idx] = { ...next[idx], storeName: e.target.value };
                    setSplits(next);
                  }}
                  className="flex-1 border rounded px-2 py-1.5 text-sm"
                >
                  <option value={s.storeName}>{s.storeName}</option>
                  {availableStores.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={s.ratio}
                  onChange={(e) => {
                    const next = [...splits];
                    next[idx] = {
                      ...next[idx],
                      ratio: parseInt(e.target.value, 10) || 0,
                    };
                    setSplits(next);
                  }}
                  className="w-16 border rounded px-2 py-1.5 text-sm text-right tabular-nums"
                />
                <span className="text-xs text-gray-400 w-3">%</span>
                {splits.length > 1 && (
                  <button
                    onClick={() => setSplits(splits.filter((_, i) => i !== idx))}
                    className="text-gray-400 hover:text-red-500"
                    aria-label="この店舗を削除"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {availableStores.length > 0 && (
            <button
              onClick={() =>
                setSplits([...splits, { storeName: availableStores[0], ratio: 0 }])
              }
              className="text-xs text-blue-600 hover:underline"
            >
              + 店舗を追加
            </button>
          )}
          <div
            className={`flex items-center justify-between py-2 px-3 rounded text-sm ${
              isValid ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            <span>合計</span>
            <span className="font-bold tabular-nums">{total}%</span>
          </div>
          {!isValid && (
            <p className="text-xs text-amber-700">
              合計が100%になるように調整してください。
            </p>
          )}
          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
              {error}
            </p>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded border bg-white hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || saving}
            className="px-4 py-1.5 text-sm rounded bg-[#567FC0] text-white hover:bg-[#4a6da8] disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
