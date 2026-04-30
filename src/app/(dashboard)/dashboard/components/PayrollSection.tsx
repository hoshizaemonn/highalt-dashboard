"use client";

import { useState, useEffect } from "react";
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

  return (
    <>
      <SectionTitle>従業員別明細</SectionTitle>
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
