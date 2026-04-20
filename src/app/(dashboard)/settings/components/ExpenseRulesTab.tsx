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
const EXPENSE_CATEGORIES_WITH_REVENUE = [...EXPENSE_CATEGORIES, "_収入"];

// ─── Types ──────────────────────────────────────────────────────────

interface ExpenseRuleRow {
  id: number;
  keyword: string;
  category: string;
}

interface ExpenseCategoryRow {
  id: number;
  name: string;
  description: string;
  examples: string;
  categoryType: string;
}

// ─── Component ──────────────────────────────────────────────────────

export default function ExpenseRulesTab() {
  // --- Rules state ---
  const [rules, setRules] = useState<ExpenseRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, { category?: string }>>({});
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState("");

  // --- Categories state ---
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [catDeleteIds, setCatDeleteIds] = useState<Set<number>>(new Set());
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [newCatExamples, setNewCatExamples] = useState("");
  const [newCatType, setNewCatType] = useState("expense");
  const catFileRef = useRef<HTMLInputElement>(null);

  // Sub-section toggle
  const [showCategories, setShowCategories] = useState(false);

  // Derived: category names for dropdowns
  const categoryNames = categories.length > 0
    ? categories.map((c) => c.name)
    : [...EXPENSE_CATEGORIES_WITH_REVENUE];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, catsRes] = await Promise.all([
        fetch("/api/settings/expense-rules"),
        fetch("/api/settings/expense-categories"),
      ]);
      const rulesData = await rulesRes.json();
      const catsData = await catsRes.json();
      setRules(rulesData.rules || []);
      setCategories(catsData.categories || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Set default new category
  useEffect(() => {
    if (categoryNames.length > 0 && !newCategory) {
      setNewCategory(categoryNames[0]);
    }
  }, [categoryNames, newCategory]);

  // --- Rules handlers ---
  function toggleDelete(id: number) {
    setDeleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleEditCategory(id: number, category: string) {
    setEdits((prev) => ({ ...prev, [id]: { category } }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      for (const id of deleteIds) {
        await fetch(`/api/settings/expense-rules?id=${id}`, { method: "DELETE" });
      }
      for (const [idStr, edit] of Object.entries(edits)) {
        const id = parseInt(idStr, 10);
        if (deleteIds.has(id)) continue;
        const orig = rules.find((r) => r.id === id);
        if (!orig) continue;
        await fetch("/api/settings/expense-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: orig.keyword, category: edit.category ?? orig.category }),
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

  async function handleAddRule() {
    if (!newKeyword.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await fetch("/api/settings/expense-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: newKeyword.trim(), category: newCategory }),
      });
      setNewKeyword("");
      await fetchData();
      setMessage("ルールを追加しました");
    } catch {
      setMessage("追加に失敗しました");
    }
    setSaving(false);
  }

  // --- Category handlers ---
  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setMessage("");
    try {
      const text = await file.text();
      const lines = text.split("\n").map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
      const dataLines = lines.slice(2).filter((cols) => cols[0] && cols[0] !== "");
      let currentType = "expense";
      const parsed: { name: string; description: string; examples: string; categoryType: string }[] = [];
      for (const cols of dataLines) {
        const name = cols[0] || "";
        if (name.startsWith("【") || name.startsWith("（")) {
          if (name.includes("売上")) currentType = "revenue";
          else if (name.includes("経費")) currentType = "expense";
          else if (name.includes("人件費")) currentType = "labor";
          continue;
        }
        if (!name) continue;
        parsed.push({ name, description: cols[1] || "", examples: cols[2] || "", categoryType: currentType });
      }
      if (parsed.length === 0) { setMessage("CSVから勘定科目を検出できませんでした"); setSaving(false); return; }
      const res = await fetch("/api/settings/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: parsed }),
      });
      const data = await res.json();
      await fetchData();
      setMessage(`勘定科目: ${data.created}件追加、${data.updated}件更新${data.rulesCreated > 0 ? `、経費分類ルール ${data.rulesCreated}件を自動生成` : ""}`);
    } catch {
      setMessage("CSVの読み込みに失敗しました");
    }
    setSaving(false);
    if (catFileRef.current) catFileRef.current.value = "";
  }

  async function handleAddCategory() {
    if (!newCatName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/settings/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim(), description: newCatDesc, examples: newCatExamples, categoryType: newCatType }),
      });
      setNewCatName(""); setNewCatDesc(""); setNewCatExamples("");
      await fetchData();
      setMessage("勘定科目を追加しました");
    } catch { setMessage("追加に失敗しました"); }
    setSaving(false);
  }

  async function handleDeleteCategories() {
    setSaving(true);
    try {
      for (const id of catDeleteIds) {
        await fetch(`/api/settings/expense-categories?id=${id}`, { method: "DELETE" });
      }
      setCatDeleteIds(new Set());
      await fetchData();
      setMessage("勘定科目を削除しました");
    } catch { setMessage("削除に失敗しました"); }
    setSaving(false);
  }

  const typeLabel = (t: string) => t === "revenue" ? "売上" : t === "labor" ? "人件費" : "経費";
  const typeColor = (t: string) => t === "revenue" ? "text-blue-600 bg-blue-50" : t === "labor" ? "text-red-600 bg-red-50" : "text-orange-600 bg-orange-50";

  return (
    <div>
      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${
          message.includes("失敗") ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
        }`}>
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : (
        <>
          {/* ── 勘定科目マスタセクション ── */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setShowCategories(!showCategories)}
                className="text-sm font-medium text-[#567FC0] hover:underline"
              >
                {showCategories ? "▼" : "▶"} 勘定科目マスタ（{categories.length}件）
              </button>
              <button
                onClick={() => catFileRef.current?.click()}
                disabled={saving}
                className="text-xs bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-3 py-1.5 rounded disabled:opacity-50"
              >
                CSVインポート
              </button>
              <input ref={catFileRef} type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
            </div>

            {showCategories && (
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-medium text-gray-600">勘定科目</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">区分</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">内容</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-600">具体例</th>
                        <th className="text-center px-3 py-2 font-medium text-gray-600">削除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((cat) => (
                        <tr key={cat.id} className={`border-b border-gray-100 ${catDeleteIds.has(cat.id) ? "bg-red-50" : ""}`}>
                          <td className="px-3 py-1.5 font-medium">{cat.name}</td>
                          <td className="px-3 py-1.5">
                            <span className={`text-xs px-2 py-0.5 rounded ${typeColor(cat.categoryType)}`}>{typeLabel(cat.categoryType)}</span>
                          </td>
                          <td className="px-3 py-1.5 text-gray-600 text-xs">{cat.description}</td>
                          <td className="px-3 py-1.5 text-gray-500 text-xs">{cat.examples}</td>
                          <td className="px-3 py-1.5 text-center">
                            <input type="checkbox" checked={catDeleteIds.has(cat.id)} onChange={() => {
                              setCatDeleteIds((prev) => { const n = new Set(prev); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n; });
                            }} className="w-4 h-4" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {catDeleteIds.size > 0 && (
                  <button onClick={handleDeleteCategories} disabled={saving}
                    className="mt-2 bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                    {catDeleteIds.size}件を削除
                  </button>
                )}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="text" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="科目名"
                    className="border rounded px-2 py-1.5 text-sm w-32" />
                  <select value={newCatType} onChange={(e) => setNewCatType(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
                    <option value="expense">経費</option><option value="revenue">売上</option><option value="labor">人件費</option>
                  </select>
                  <input type="text" value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} placeholder="内容"
                    className="border rounded px-2 py-1.5 text-sm w-40" />
                  <input type="text" value={newCatExamples} onChange={(e) => setNewCatExamples(e.target.value)} placeholder="具体例"
                    className="border rounded px-2 py-1.5 text-sm w-40" />
                  <button onClick={handleAddCategory} disabled={saving || !newCatName.trim()}
                    className="bg-[#567FC0] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">追加</button>
                </div>
              </div>
            )}
          </div>

          {/* ── 経費分類ルール ── */}
          <h3 className="text-sm font-bold text-gray-700 mb-3">経費分類ルール</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">キーワード</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">勘定科目</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">削除</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className={`border-b border-gray-100 ${deleteIds.has(r.id) ? "bg-red-50" : "hover:bg-gray-50"}`}>
                    <td className="px-3 py-2">{r.keyword}</td>
                    <td className="px-3 py-2">
                      <select value={edits[r.id]?.category ?? r.category} onChange={(e) => handleEditCategory(r.id, e.target.value)}
                        className="border border-gray-300 rounded px-2 py-1 text-sm">
                        {categoryNames.map((c) => (<option key={c} value={c}>{c}</option>))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={deleteIds.has(r.id)} onChange={() => toggleDelete(r.id)} className="w-4 h-4" />
                    </td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-gray-400">ルールがありません</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <button onClick={handleSave} disabled={saving}
              className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-6 py-2 rounded text-sm font-medium disabled:opacity-50">
              {saving ? "保存中..." : "保存"}
            </button>
          </div>

          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">新しいルールを追加</p>
            <div className="flex items-center gap-3">
              <input type="text" placeholder="キーワード" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                className="border border-gray-300 rounded px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[#567FC0]" />
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                className="border border-gray-300 rounded px-2 py-2 text-sm">
                {categoryNames.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
              <button onClick={handleAddRule} disabled={saving || !newKeyword.trim()}
                className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">追加</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
