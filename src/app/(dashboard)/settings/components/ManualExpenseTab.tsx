"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import { STORES, BUDGET_ITEMS } from "@/lib/constants";

interface Row {
  id?: number;
  year: number;
  month: number;
  category: string;
  /** "" = 本部一括（均等按分 or splitRatios按分）、店舗名 = その店のみ計上 */
  storeName: string;
  totalAmount: number;
  /** 手動按分の比率（店舗→%）。null/undefined の場合は既存挙動 */
  splitRatios?: Record<string, number> | null;
  note: string | null;
  updatedByName?: string | null;
  updatedAt?: string;
}

// 店舗セレクタの選択肢（先頭が本部一括）
const HQ_OPTION = "";

/**
 * 本部一括経費の手動入力タブ（admin のみ）。
 * 電気代・水道代・家賃など本部で一括支払いし、各店の PayPay 銀行 CSV に
 * 現れない経費を月次で入力する。集計時は totalAmount / 営業店舗数 で均等按分。
 *
 * 注意: PayPay 銀行 CSV にも該当カテゴリの支払いがある場合は二重計上になるため、
 * 「本部一括分のみ」を入力する運用ルール。
 */
export default function ManualExpenseTab() {
  const now = new Date();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [filterYear, setFilterYear] = useState<number>(now.getFullYear());

  const storeCount = STORES.length;

  // 候補カテゴリ（本部一括になりやすいもの優先）
  // ※ 減価償却費・開発費償却 は CSV から自動連携されないため本タブで月次入力する（依頼⑤）
  const SUGGESTED_CATEGORIES = [
    "電気料",
    "上下水道料",
    "賃借料",
    "通信費",
    "リース料",
    "保険料",
    "委託料",
    "支払手数料",
    "減価償却費",
    "開発費償却",
  ];
  const ALL_CATEGORIES = Array.from(
    new Set([...SUGGESTED_CATEGORIES, ...BUDGET_ITEMS]),
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/manual-expense?year=${filterYear}`);
      const data = res.ok ? await res.json() : { items: [] };
      // splitRatios は DB 上 JSON 文字列で返ってくるのでオブジェクトにパースして state に保持
      const parsed: Row[] = (data.items ?? []).map((r: Row & { splitRatios?: unknown }) => {
        let split: Record<string, number> | null = null;
        if (typeof r.splitRatios === "string") {
          try {
            const o = JSON.parse(r.splitRatios);
            if (o && typeof o === "object") split = o as Record<string, number>;
          } catch {}
        } else if (r.splitRatios && typeof r.splitRatios === "object") {
          split = r.splitRatios as Record<string, number>;
        }
        return { ...r, splitRatios: split };
      });
      setRows(parsed);
    } catch {
      setMessage("読み込みに失敗しました");
    }
    setLoading(false);
  }, [filterYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        year: filterYear,
        month: now.getMonth() + 1,
        category: SUGGESTED_CATEGORIES[0],
        storeName: HQ_OPTION,
        totalAmount: 0,
        note: "",
      },
    ]);
  };

  const handleChange = <K extends keyof Row>(
    idx: number,
    key: K,
    value: Row[K],
  ) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    );
  };

  const handleRemove = async (idx: number) => {
    const row = rows[idx];
    if (row.id !== undefined) {
      const res = await fetch(`/api/settings/manual-expense?id=${row.id}`, {
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
      const res = await fetch("/api/settings/manual-expense", {
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-700 mb-1">本部一括経費 / 店舗別経費</h2>
        <p className="text-xs text-gray-500 leading-relaxed">
          電気代・水道代・家賃・減価償却費・開発費償却など、各店の PayPay 銀行 CSV に現れない経費を月次で入力します。
          計上先で <strong>「本部一括（均等按分）」</strong>を選ぶと{" "}
          <strong>金額 ÷ {storeCount}店舗</strong> で各店に均等按分、
          <strong>店舗を選ぶ</strong>とその店舗のみに計上されます（按分なし）。
          <br />
          ⚠️ PayPay 銀行 CSV にも該当カテゴリの支払いがある場合は二重計上になるため、
          CSVに無い分のみを入力してください。
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600">表示年:</label>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(parseInt(e.target.value, 10))}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中...</p>
      ) : (
        <>
          <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 w-20">
                    年
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600 w-16">
                    月
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    カテゴリ
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    計上先
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">
                    金額
                  </th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">
                    1店あたり按分
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    メモ
                  </th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="text-center text-gray-400 py-6 text-xs"
                    >
                      {filterYear}年の入力データがありません。下の「行を追加」ボタンから登録してください。
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={`${r.id ?? "new"}-${i}`} className="border-b">
                    <td className="px-3 py-2">
                      <select
                        value={r.year}
                        onChange={(e) =>
                          handleChange(i, "year", parseInt(e.target.value, 10))
                        }
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                      >
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.month}
                        onChange={(e) =>
                          handleChange(i, "month", parseInt(e.target.value, 10))
                        }
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                      >
                        {monthOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.category}
                        onChange={(e) =>
                          handleChange(i, "category", e.target.value)
                        }
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                      >
                        {ALL_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          r.storeName === HQ_OPTION && r.splitRatios
                            ? "__custom_split__"
                            : r.storeName
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "__custom_split__") {
                            handleChange(i, "storeName", HQ_OPTION);
                            // 既存比率が無ければ均等から初期化
                            if (!r.splitRatios) {
                              const initial: Record<string, number> = {};
                              const each = Math.floor(100 / STORES.length);
                              STORES.forEach((s, idx) => {
                                initial[s] =
                                  idx === STORES.length - 1
                                    ? 100 - each * (STORES.length - 1)
                                    : each;
                              });
                              handleChange(i, "splitRatios", initial);
                            }
                          } else {
                            handleChange(i, "storeName", v);
                            handleChange(i, "splitRatios", null);
                          }
                        }}
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
                      >
                        <option value={HQ_OPTION}>本部一括（均等按分）</option>
                        <option value="__custom_split__">本部一括（手動按分）</option>
                        {STORES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {r.splitRatios && (
                        <SplitRatioEditor
                          ratios={r.splitRatios}
                          onChange={(next) =>
                            handleChange(i, "splitRatios", next)
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={r.totalAmount}
                        onChange={(e) =>
                          handleChange(
                            i,
                            "totalAmount",
                            parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="w-32 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 text-xs">
                      {r.splitRatios && r.storeName === HQ_OPTION
                        ? (() => {
                            // 手動按分のサマリー: 各店配分の概算（合計が100%でない時は赤）
                            const totalRatio = Object.values(r.splitRatios).reduce(
                              (s, v) => s + v,
                              0,
                            );
                            return (
                              <span className={totalRatio !== 100 ? "text-red-600" : ""}>
                                計 {totalRatio.toFixed(0)}%
                              </span>
                            );
                          })()
                        : r.storeName === HQ_OPTION
                          ? `¥${Math.round(r.totalAmount / storeCount).toLocaleString()}`
                          : "—（店舗別）"}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.note ?? ""}
                        onChange={(e) =>
                          handleChange(i, "note", e.target.value)
                        }
                        placeholder="（任意）契約先・備考"
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleRemove(i)}
                        className="text-red-500 hover:text-red-700"
                        title="削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAddRow}
              className="flex items-center gap-1 text-sm text-[#567FC0] hover:text-[#4a6fa8] border border-[#567FC0] rounded px-3 py-1.5"
            >
              <Plus size={14} />
              行を追加
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-5 py-2 rounded text-sm font-medium disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            {message && (
              <span className="text-xs text-gray-600">{message}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Split Ratio Editor ────────────────────────────────────
// 手動按分: 各店舗の比率(%)を入力するインラインエディタ
function SplitRatioEditor({
  ratios,
  onChange,
}: {
  ratios: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const setRatio = (store: string, v: number) => {
    const next = { ...ratios, [store]: v };
    if (v <= 0) delete next[store];
    onChange(next);
  };
  return (
    <div className="mt-2 bg-gray-50 border border-gray-200 rounded p-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
      {STORES.map((s) => (
        <label key={s} className="text-xs flex items-center gap-1">
          <span className="text-gray-700 w-24 truncate">{s}</span>
          <input
            type="number"
            min={0}
            max={100}
            value={ratios[s] ?? 0}
            onChange={(e) => setRatio(s, parseFloat(e.target.value) || 0)}
            className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-xs text-right"
          />
          <span className="text-gray-400 text-xs">%</span>
        </label>
      ))}
    </div>
  );
}
