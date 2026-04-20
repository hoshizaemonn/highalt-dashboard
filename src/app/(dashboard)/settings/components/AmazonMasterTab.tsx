"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Constants (duplicated client-side to avoid server import) ──────
const EXPENSE_CATEGORIES = [
  "消耗品費",
  "広告宣伝費",
  "委託料",
  "通信費",
  "賃借料",
  "支払手数料",
  "雑費",
  "その他",
];

// ─── Types ──────────────────────────────────────────────────────────

interface AmazonEntry {
  id: number;
  asin: string;
  productName: string;
  amazonCategory: string;
  expenseCategory: string;
  lastSeenDate: string;
}

// ─── Component ──────────────────────────────────────────────────────

export default function AmazonMasterTab() {
  const [entries, setEntries] = useState<AmazonEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<
    Record<number, { expenseCategory?: string }>
  >({});

  // CSV import
  const [csvOpen, setCsvOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual add
  const [manualOpen, setManualOpen] = useState(false);
  const [newAsin, setNewAsin] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newExpCategory, setNewExpCategory] = useState(EXPENSE_CATEGORIES[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = search ? `?q=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/settings/amazon-master${q}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchData]);

  function toggleDelete(id: number) {
    setDeleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleEditCategory(id: number, category: string) {
    setEdits((prev) => ({
      ...prev,
      [id]: { expenseCategory: category },
    }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      for (const id of deleteIds) {
        await fetch(`/api/settings/amazon-master?id=${id}`, {
          method: "DELETE",
        });
      }
      for (const [idStr, edit] of Object.entries(edits)) {
        const id = parseInt(idStr, 10);
        if (deleteIds.has(id)) continue;
        const orig = entries.find((e) => e.id === id);
        if (!orig) continue;
        await fetch("/api/settings/amazon-master", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asin: orig.asin,
            productName: orig.productName,
            amazonCategory: orig.amazonCategory,
            expenseCategory: edit.expenseCategory ?? orig.expenseCategory,
          }),
        });
      }
      setDeleteIds(new Set());
      setEdits({});
      await fetchData();
      setMessage("保存しました");
    } catch {
      setMessage("保存に失敗しました");
    }
    setSaving(false);
  }

  async function handleCSVUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setSaving(true);
    setMessage("");
    try {
      const csvText = await file.text();
      const res = await fetch("/api/settings/amazon-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-import", csvText }),
      });
      const data = await res.json();
      await fetchData();
      setMessage(
        `${data.created}件登録、${data.skipped}件スキップしました`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setMessage("CSVインポートに失敗しました");
    }
    setSaving(false);
  }

  async function handleManualAdd() {
    if (!newAsin.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await fetch("/api/settings/amazon-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: newAsin.trim(),
          productName: newProductName.trim(),
          amazonCategory: "",
          expenseCategory: newExpCategory,
        }),
      });
      setNewAsin("");
      setNewProductName("");
      setNewExpCategory(EXPENSE_CATEGORIES[0]);
      await fetchData();
      setMessage("商品を追加しました");
    } catch {
      setMessage("追加に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div>
      {/* Search & metric */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <input
          type="text"
          placeholder="ASIN・商品名で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
        />
        <span className="text-sm text-gray-500">
          登録済み商品数: <strong>{entries.length}</strong>
        </span>
      </div>

      {message && (
        <div className="mb-4 px-4 py-2 bg-blue-50 text-blue-700 rounded text-sm">
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    ASIN
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    商品名
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    Amazonカテゴリ
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    勘定科目
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    最終取込日
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">
                    削除
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-b border-gray-100 ${deleteIds.has(e.id) ? "bg-red-50" : "hover:bg-gray-50"}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{e.asin}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate">
                      {e.productName}
                    </td>
                    <td className="px-3 py-2">{e.amazonCategory}</td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          edits[e.id]?.expenseCategory ?? e.expenseCategory
                        }
                        onChange={(ev) =>
                          handleEditCategory(e.id, ev.target.value)
                        }
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{e.lastSeenDate}</td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={deleteIds.has(e.id)}
                        onChange={() => toggleDelete(e.id)}
                        className="w-4 h-4"
                      />
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                      データがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-6 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>

          {/* CSV bulk import */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <button
              onClick={() => setCsvOpen(!csvOpen)}
              className="text-sm font-medium text-[#567FC0] hover:underline"
            >
              {csvOpen ? "▼" : "▶"} CSV一括登録
            </button>
            {csvOpen && (
              <div className="mt-3 p-4 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-2">
                  Amazon注文CSVをアップロードすると、ASINを商品マスタに登録します（既存は除外）
                </p>
                <div className="flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="text-sm"
                  />
                  <button
                    onClick={handleCSVUpload}
                    disabled={saving}
                    className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                  >
                    インポート
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Manual add */}
          <div className="mt-4 border-t border-gray-200 pt-4">
            <button
              onClick={() => setManualOpen(!manualOpen)}
              className="text-sm font-medium text-[#567FC0] hover:underline"
            >
              {manualOpen ? "▼" : "▶"} 手動追加
            </button>
            {manualOpen && (
              <div className="mt-3 p-4 bg-gray-50 rounded-lg">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    placeholder="ASIN"
                    value={newAsin}
                    onChange={(e) => setNewAsin(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm w-32 font-mono focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                  />
                  <input
                    type="text"
                    placeholder="商品名"
                    value={newProductName}
                    onChange={(e) => setNewProductName(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                  />
                  <select
                    value={newExpCategory}
                    onChange={(e) => setNewExpCategory(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-2 text-sm"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleManualAdd}
                    disabled={saving || !newAsin.trim()}
                    className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                  >
                    追加
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
