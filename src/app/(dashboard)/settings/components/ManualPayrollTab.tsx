"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { STORES } from "@/lib/constants";

interface Row {
  id?: number;
  year: number;
  month: number;
  storeName: string;
  employeeName: string | null;
  contractType: string | null;
  amount: number;
  note: string | null;
  updatedByName?: string | null;
}

const CONTRACT_TYPES = ["正社員", "アルバイト"];

/**
 * 手動人件費タブ（admin / manager のみ）。
 * クラウド給与の支給控除一覧表（CSV）に載らない社員（役員・業務委託・未登録者など）の
 * 給与総額を月次で登録する。集計時に該当店舗・月の人件費へ加算される（松尾さん依頼⑥）。
 */
export default function ManualPayrollTab() {
  const now = new Date();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [filterYear, setFilterYear] = useState<number>(now.getFullYear());

  // 年度が変わるたびに再取得。effect 内で同期的に setState しない
  // （cascading-render lint 回避）ため、await 後にのみ状態更新する。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/settings/manual-payroll?year=${filterYear}`);
        const data = res.ok ? await res.json() : { items: [] };
        if (!cancelled) setRows(data.items ?? []);
      } catch {
        if (!cancelled) setMessage("読み込みに失敗しました");
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filterYear]);

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        year: filterYear,
        month: now.getMonth() + 1,
        storeName: STORES[0],
        employeeName: "",
        contractType: CONTRACT_TYPES[0],
        amount: 0,
        note: "",
      },
    ]);
  };

  const handleChange = <K extends keyof Row>(idx: number, key: K, value: Row[K]) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };

  const handleRemove = async (idx: number) => {
    const row = rows[idx];
    if (row.id !== undefined) {
      const res = await fetch(`/api/settings/manual-payroll?id=${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setMessage("削除に失敗しました");
        return;
      }
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/manual-payroll", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rows }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data?.error || "保存に失敗しました");
      } else {
        const data = await res.json();
        setRows(data.items ?? []);
        setMessage("保存しました");
      }
    } catch {
      setMessage("保存に失敗しました");
    }
    setSaving(false);
  };

  const yearOptions: number[] = [];
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 3; y--) {
    yearOptions.push(y);
  }
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-700 mb-1">手動人件費（CSV外の社員）</h2>
        <p className="text-xs text-gray-500 leading-relaxed">
          クラウド給与の支給控除一覧表（CSV）に載らない社員（役員・業務委託・未登録者など）の
          <strong>給与総額</strong>を登録します。登録した金額は、該当する<strong>店舗・月の人件費に加算</strong>されます。
          <br />
          ※ 2026年4月以前は損益計算書の人件費を正としているため、加算は5月以降の月に反映されます。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">年度</label>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(parseInt(e.target.value, 10))}
          className="border rounded px-2 py-1 text-sm"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-gray-500 text-left">
                <th className="py-2 pr-2 font-medium">月</th>
                <th className="py-2 pr-2 font-medium">店舗</th>
                <th className="py-2 pr-2 font-medium">氏名</th>
                <th className="py-2 pr-2 font-medium">区分</th>
                <th className="py-2 pr-2 font-medium text-right">給与総額(円)</th>
                <th className="py-2 pr-2 font-medium">メモ</th>
                <th className="py-2 pr-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gray-400">
                    登録がありません。「行を追加」から入力してください。
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id ?? `new-${idx}`} className="border-b">
                    <td className="py-1 pr-2">
                      <select
                        value={r.month}
                        onChange={(e) => handleChange(idx, "month", parseInt(e.target.value, 10))}
                        className="border rounded px-1 py-1"
                      >
                        {monthOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}月
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        value={r.storeName}
                        onChange={(e) => handleChange(idx, "storeName", e.target.value)}
                        className="border rounded px-1 py-1"
                      >
                        {STORES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="text"
                        value={r.employeeName ?? ""}
                        onChange={(e) => handleChange(idx, "employeeName", e.target.value)}
                        placeholder="氏名"
                        className="border rounded px-2 py-1 w-28"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        value={r.contractType ?? CONTRACT_TYPES[0]}
                        onChange={(e) => handleChange(idx, "contractType", e.target.value)}
                        className="border rounded px-1 py-1"
                      >
                        {CONTRACT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <input
                        type="number"
                        value={r.amount}
                        onChange={(e) => handleChange(idx, "amount", parseInt(e.target.value, 10) || 0)}
                        className="border rounded px-2 py-1 w-32 text-right"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="text"
                        value={r.note ?? ""}
                        onChange={(e) => handleChange(idx, "note", e.target.value)}
                        placeholder="メモ"
                        className="border rounded px-2 py-1 w-32"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <button
                        onClick={() => handleRemove(idx)}
                        className="text-red-500 hover:text-red-700"
                        title="削除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t font-medium">
                  <td colSpan={4} className="py-2 pr-2 text-right text-gray-600">
                    合計
                  </td>
                  <td className="py-2 pr-2 text-right">
                    ¥{totalAmount.toLocaleString("ja-JP")}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleAddRow}
          className="inline-flex items-center gap-1 text-sm text-[#567FC0] hover:text-[#3d5f95]"
        >
          <Plus size={16} /> 行を追加
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto bg-[#567FC0] text-white text-sm px-4 py-2 rounded hover:bg-[#3d5f95] disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      {message && (
        <p
          className={`text-sm ${
            message.includes("失敗") ? "text-red-500" : "text-green-600"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
