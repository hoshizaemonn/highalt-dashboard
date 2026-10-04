"use client";

import { useState, useEffect, useCallback } from "react";

// オプション売上の店舗按分ルール（システム管理者のみ）。
// 按分は金額に直結するため、変更前に必ず内容を確認すること。
// 有効化すると、開始年月以降の該当商品の売上が「所属店舗 → 按分先店舗」へ付け替えられる（総額は不変）。

interface Item {
  productCode: string;
  productName: string | null;
  /** 画面で入力した商品名（摘要に含まれる名前）。空なら hacomono の商品名で照合 */
  matchName: string;
  targetStore: string;
  ratioPercent: number;
  startYear: number | null;
  startMonth: number | null;
  enabled: boolean;
}

interface Unsplittable {
  year: number;
  month: number;
  storeName: string;
  count: number;
}

interface ApiResponse {
  items: Item[];
  stores: string[];
  minStart: { year: number; month: number };
  unsplittable: Unsplittable[];
}

// 開始年月は仕様どおり 2026年10月を既定にする（データが入った月から反映される運用）
function withDefaultStart(item: Item, minStart: { year: number; month: number }): Item {
  return {
    ...item,
    startYear: item.startYear ?? minStart.year,
    startMonth: item.startMonth ?? minStart.month,
  };
}

export default function OptionSplitTab() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Item>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/option-sales-split");
      if (!res.ok) {
        setMessage("読み込みに失敗しました（システム管理者のみ操作できます）");
        return;
      }
      const json: ApiResponse = await res.json();
      setData(json);
      setDrafts(Object.fromEntries(json.items.map((i) => [i.productCode, withDefaultStart(i, json.minStart)])));
    } catch {
      setMessage("読み込みに失敗しました");
    }
  }, []);

  useEffect(() => {
    // 初回読み込み（非同期の取得結果のみで state を更新する）
    fetch("/api/settings/option-sales-split")
      .then(async (res) => {
        if (!res.ok) {
          setMessage("読み込みに失敗しました（システム管理者のみ操作できます）");
          return;
        }
        const json: ApiResponse = await res.json();
        setData(json);
        setDrafts(Object.fromEntries(json.items.map((i) => [i.productCode, withDefaultStart(i, json.minStart)])));
      })
      .catch(() => setMessage("読み込みに失敗しました"));
  }, []);

  if (!data) {
    return <p className="text-sm text-gray-500">{message || "読み込み中..."}</p>;
  }

  const update = (code: string, patch: Partial<Item>) =>
    setDrafts((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));

  const save = async (code: string) => {
    const d = drafts[code];
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/option-sales-split", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: code,
          matchName: d.matchName,
          targetStore: d.targetStore,
          ratioPercent: d.ratioPercent,
          startYear: d.startYear,
          startMonth: d.startMonth,
          enabled: d.enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error || "保存に失敗しました");
      } else {
        setMessage("保存しました（集計結果には次回の表示から反映されます）");
        await reload();
      }
    } catch {
      setMessage("保存に失敗しました");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-gray-700">
        <strong>オプション売上の店舗按分</strong>: 対象商品の売上を「所属店舗」から「按分先店舗」へ比率分だけ付け替えます。
        総額は変わらず、総売上と内訳の両方に同じ比率で反映されます。
        開始年月より前の月は変更されません（{data.minStart.year}年{data.minStart.month}月以降のみ指定可）。
        「有効」にしない限り集計には影響しません。
      </div>

      {message && (
        <div className="px-4 py-2 bg-blue-50 text-blue-700 rounded text-sm">{message}</div>
      )}

      <div className="border border-gray-200 rounded p-4">
        <div className="text-sm font-medium text-gray-800 mb-2">按分できなかった売上（要確認）</div>
        <p className="text-xs text-gray-500 mb-2">
          対象商品を含む売上明細が、他の商品と1行にまとまっているため、按分せず元の店舗に残している件数です。
          金額を按分したい場合は、hacomono側で商品ごとに分けて取り込んでください。
        </p>
        {data.unsplittable.length === 0 ? (
          <p className="text-xs text-gray-600">該当なし</p>
        ) : (
          <table className="text-xs w-full">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-1 pr-3">年月</th>
                <th className="py-1 pr-3">店舗</th>
                <th className="py-1">件数</th>
              </tr>
            </thead>
            <tbody>
              {data.unsplittable.map((u) => (
                <tr key={`${u.year}-${u.month}-${u.storeName}`} className="border-b border-gray-100">
                  <td className="py-1 pr-3">{u.year}年{u.month}月</td>
                  <td className="py-1 pr-3">{u.storeName}</td>
                  <td className="py-1">{u.count}件</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.items.map((item) => {
        const d = drafts[item.productCode] ?? item;
        return (
          <div key={item.productCode} className="border border-gray-200 rounded p-4 space-y-3">
            <div className="text-sm font-medium text-gray-800">
              {item.productName ?? "（商品名未取込）"}
              <span className="ml-2 text-xs text-gray-500">{item.productCode}</span>
              <span
                className={`ml-3 inline-block px-2 py-0.5 rounded text-xs ${
                  item.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {item.enabled ? "有効" : "無効"}
              </span>
            </div>
            <div className="mb-3">
              <label className="flex flex-wrap items-center gap-2 text-sm">
                商品名（売上の摘要に含まれる名前）
                <input
                  type="text"
                  value={d.matchName}
                  maxLength={100}
                  placeholder={
                    item.productCode === "NAME1"
                      ? "例: HYROXオプション下北沢(月4回)"
                      : "空欄なら hacomono の商品名で照合"
                  }
                  onChange={(e) => update(item.productCode, { matchName: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-1 w-96 max-w-full"
                />
              </label>
              <p className="text-xs text-gray-500 mt-1">
                全角・半角（括弧・英数）やスペースの違い、英字の大小は区別せずに照合します。商品名の一部（例: 「下北沢(月4回)」）でも一致しますが、
                他の商品名にも含まれる短い名前にすると、意図しない商品まで按分されます。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                按分先店舗
                <select
                  value={d.targetStore}
                  onChange={(e) => update(item.productCode, { targetStore: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-1"
                >
                  <option value="">未設定</option>
                  {data.stores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                按分比率（按分先への %）
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={d.ratioPercent}
                  onChange={(e) => update(item.productCode, { ratioPercent: Number(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 w-20"
                />
              </label>
              <label className="flex items-center gap-1">
                開始年
                <input
                  type="number"
                  value={d.startYear ?? ""}
                  onChange={(e) =>
                    update(item.productCode, {
                      startYear: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="border border-gray-300 rounded px-2 py-1 w-24"
                />
              </label>
              <label className="flex items-center gap-1">
                開始月
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={d.startMonth ?? ""}
                  onChange={(e) =>
                    update(item.productCode, {
                      startMonth: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="border border-gray-300 rounded px-2 py-1 w-20"
                />
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => update(item.productCode, { enabled: e.target.checked })}
                />
                有効にする
              </label>
              <button
                onClick={() => save(item.productCode)}
                disabled={saving}
                className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-1.5 rounded text-sm disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
