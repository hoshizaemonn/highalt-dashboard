"use client";

import { useEffect, useState, useCallback } from "react";
import { invalidateStoreDisplayNames } from "../../dashboard/useStoreDisplayName";

interface Row {
  storeName: string;
  displayName: string;
}

/**
 * 店舗名（表示名）管理タブ。
 * - 内部 storeName（DBの紐付けキー）はそのまま
 * - 画面表示用の displayName のみ上書き
 * - 空 or storeName と同じ値にすると上書き解除
 */
export default function StoreNamesTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [storesRes, mapRes] = await Promise.all([
        fetch("/api/settings/stores"),
        fetch("/api/settings/store-display-names"),
      ]);
      const storesData = storesRes.ok ? await storesRes.json() : { stores: [] };
      const mapData = mapRes.ok ? await mapRes.json() : { mapping: {} };
      const stores: string[] = storesData.stores ?? [];
      const mapping: Record<string, string> = mapData.mapping ?? {};
      setRows(
        stores.map((s) => ({
          storeName: s,
          displayName: mapping[s] ?? "",
        })),
      );
    } catch {
      setMessage("読み込みに失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChange = (idx: number, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, displayName: value } : r)),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/store-display-names", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rows }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data?.error || "保存に失敗しました");
      } else {
        setMessage("保存しました");
        invalidateStoreDisplayNames();
      }
    } catch {
      setMessage("保存に失敗しました");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-700 mb-1">店舗名管理</h2>
        <p className="text-xs text-gray-500">
          各店舗のダッシュボード表示名を変更できます。**内部の店舗識別子（左列）は変更されない**ため、
          ハコモノCSVの取込やデータ集計の紐付けはそのまま維持されます。
          表示名を空欄にすると、内部識別子をそのまま表示します。
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">読み込み中...</p>
      ) : (
        <>
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    内部店舗名（変更不可）
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    表示名
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.storeName} className="border-b">
                    <td className="px-4 py-2 text-gray-700 font-mono text-xs">
                      {r.storeName}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={r.displayName}
                        onChange={(e) => handleChange(i, e.target.value)}
                        placeholder={r.storeName}
                        maxLength={50}
                        className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
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
