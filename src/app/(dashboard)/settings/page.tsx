"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Settings } from "lucide-react";

// ─── Constants (duplicated client-side to avoid server import) ──────
const STORES = [
  "東日本橋",
  "春日",
  "船橋",
  "巣鴨",
  "祖師ヶ谷大蔵",
  "下北沢",
  "中目黒",
];
const HQ_STORE = "本部（除外）";
const ALL_STORES = [...STORES, HQ_STORE];

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

interface Override {
  id: number;
  employeeId: number;
  storeName: string;
  ratio: number;
  employeeName: string;
}

interface ExpenseRuleRow {
  id: number;
  keyword: string;
  category: string;
}

interface AmazonEntry {
  id: number;
  asin: string;
  productName: string;
  amazonCategory: string;
  expenseCategory: string;
  lastSeenDate: string;
}

interface UserRow {
  id: number;
  username: string;
  role: string;
  storeName: string | null;
  displayName: string | null;
  createdAt: string;
}

// ─── Helper: get session role from cookie (lightweight) ─────────────

function useSessionRole() {
  const [role, setRole] = useState<string>("store_manager");
  useEffect(() => {
    async function fetchRole() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          setRole(data.role || "store_manager");
        }
      } catch {
        // ignore
      }
    }
    fetchRole();
  }, []);
  return role;
}

// ─── Tab Definitions ────────────────────────────────────────────────

const TABS = [
  { key: "overrides", label: "従業員→店舗マッピング" },
  { key: "expense-categories", label: "勘定科目" },
  { key: "expense-rules", label: "経費分類ルール" },
  { key: "amazon-master", label: "Amazon商品マスタ" },
  { key: "users", label: "ユーザー管理" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── Main Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const role = useSessionRole();
  const [activeTab, setActiveTab] = useState<TabKey>("overrides");

  const visibleTabs =
    role === "admin" ? TABS : TABS.filter((t) => t.key !== "users");

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Settings className="text-[#567FC0]" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">設定</h1>
      </div>

      {/* Tab Bar */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-0 -mb-px">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-[#567FC0] text-[#567FC0]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        {activeTab === "overrides" && <OverridesTab />}
        {activeTab === "expense-categories" && <ExpenseCategoriesTab />}
        {activeTab === "expense-rules" && <ExpenseRulesTab />}
        {activeTab === "amazon-master" && <AmazonMasterTab />}
        {activeTab === "users" && role === "admin" && <UsersTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab 1: 従業員→店舗マッピング
// ═══════════════════════════════════════════════════════════════════

function OverridesTab() {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<
    Record<number, { storeName?: string; ratio?: number }>
  >({});
  const [message, setMessage] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"existing" | "new">("existing");

  // Sorting
  type SortKey = "employeeId" | "employeeName" | "storeName";
  const [sortKey, setSortKey] = useState<SortKey>("employeeId");
  const [sortAsc, setSortAsc] = useState(true);

  // Dual assignment (兼務) dialog
  const [dualTarget, setDualTarget] = useState<Override | null>(null);
  const [dualStore, setDualStore] = useState(STORES[0]);
  const [dualRatio, setDualRatio] = useState(50);

  // New employee form
  const [newEmpId, setNewEmpId] = useState("");
  const [newEmpName, setNewEmpName] = useState("");
  const [newStore, setNewStore] = useState(STORES[0]);
  const [newRatio, setNewRatio] = useState("100");
  const [newDual, setNewDual] = useState(false);
  const [newStore2, setNewStore2] = useState(STORES[1]);

  // Existing employee search
  const [existSearch, setExistSearch] = useState("");
  const [selectedExisting, setSelectedExisting] = useState<Override | null>(
    null,
  );
  const [existStore, setExistStore] = useState(STORES[0]);
  const [existRatio, setExistRatio] = useState("100");
  const [existDual, setExistDual] = useState(false);
  const [existStore2, setExistStore2] = useState(STORES[1]);

  // Inline error for add form
  const [addError, setAddError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/overrides");
      const data = await res.json();
      setOverrides(data.overrides || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = overrides
    .filter((o) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        String(o.employeeId).includes(s) ||
        o.employeeName.toLowerCase().includes(s) ||
        o.storeName.toLowerCase().includes(s)
      );
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === "employeeId") cmp = a.employeeId - b.employeeId;
      else if (sortKey === "employeeName") cmp = a.employeeName.localeCompare(b.employeeName, "ja");
      else if (sortKey === "storeName") cmp = a.storeName.localeCompare(b.storeName, "ja");
      return sortAsc ? cmp : -cmp;
    });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ▲" : " ▼") : "";

  function handleEdit(
    id: number,
    field: "storeName" | "ratio",
    value: string,
  ) {
    if (field === "ratio") {
      let num = parseInt(value, 10);
      if (isNaN(num)) num = 0;
      if (num < 0) num = 0;
      if (num > 100) num = 100;
      setEdits((prev) => ({
        ...prev,
        [id]: { ...prev[id], ratio: num },
      }));
    } else {
      setEdits((prev) => ({
        ...prev,
        [id]: { ...prev[id], [field]: value },
      }));
    }
  }

  function toggleDelete(id: number) {
    setDeleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    // Validate: check total ratios per employee don't exceed 100
    const ratioByEmp: Record<number, number> = {};
    for (const o of overrides) {
      if (deleteIds.has(o.id)) continue;
      const r = edits[o.id]?.ratio ?? o.ratio;
      ratioByEmp[o.employeeId] = (ratioByEmp[o.employeeId] || 0) + r;
    }
    const over100 = Object.entries(ratioByEmp).find(([, total]) => total > 100);
    if (over100) {
      const empName = overrides.find((o) => o.employeeId === Number(over100[0]))?.employeeName || over100[0];
      setMessage(`${empName}（${over100[0]}）の比率合計が${over100[1]}%で100%を超えています。修正してください。`);
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      // Delete checked items
      for (const id of deleteIds) {
        await fetch(`/api/settings/overrides?id=${id}`, { method: "DELETE" });
      }

      // Save edits + auto-delete 0% records
      for (const [idStr, edit] of Object.entries(edits)) {
        const id = parseInt(idStr, 10);
        if (deleteIds.has(id)) continue;
        const orig = overrides.find((o) => o.id === id);
        if (!orig) continue;

        const newRatioVal = edit.ratio ?? orig.ratio;

        // If ratio is 0, delete this record
        if (newRatioVal <= 0) {
          await fetch(`/api/settings/overrides?id=${id}`, { method: "DELETE" });
          // If there's a sibling, set it to 100%
          const siblings = overrides.filter(
            (o) => o.employeeId === orig.employeeId && o.id !== orig.id,
          );
          if (siblings.length === 1) {
            await fetch("/api/settings/overrides", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                employeeId: siblings[0].employeeId,
                storeName: siblings[0].storeName,
                ratio: 100,
              }),
            });
          }
          continue;
        }

        await fetch("/api/settings/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: orig.employeeId,
            storeName: edit.storeName ?? orig.storeName,
            ratio: newRatioVal,
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

  async function handleBulkRegister() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-register" }),
      });
      const data = await res.json();
      await fetchData();
      setMessage(`${data.created}件の従業員を一括登録しました`);
    } catch {
      setMessage("一括登録に失敗しました");
    }
    setSaving(false);
  }

  // Handle dual assignment (兼務) registration
  async function handleDualRegister() {
    if (!dualTarget) return;
    setSaving(true);
    setMessage("");
    try {
      // Use dual action to atomically replace all overrides for this employee
      await fetch("/api/settings/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dual",
          employeeId: dualTarget.employeeId,
          employeeName: dualTarget.employeeName,
          store1: dualTarget.storeName,
          ratio1: 100 - dualRatio,
          store2: dualStore,
          ratio2: dualRatio,
        }),
      });
      setDualTarget(null);
      await fetchData();
      setMessage("兼務登録しました");
    } catch {
      setMessage("兼務登録に失敗しました");
    }
    setSaving(false);
  }

  async function handleAddEmployee() {
    setSaving(true);
    setMessage("");
    setAddError("");
    try {
      if (addMode === "new") {
        const empId = parseInt(newEmpId, 10);
        // Check duplicate against current data
        const isDuplicate = overrides.some((o) => o.employeeId === empId);
        if (isDuplicate) {
          const dupName = overrides.find((o) => o.employeeId === empId)?.employeeName || "";
          setAddError(`従業員番号 ${empId}${dupName ? `（${dupName}）` : ""} は既に登録されています。「既存の従業員（兼務・変更）」から操作してください。`);
          setSaving(false);
          return;
        }

        const r1 = newDual ? parseInt(newRatio, 10) || 50 : parseInt(newRatio, 10) || 100;
        if (r1 > 100 || r1 < 0) {
          setAddError("比率は0〜100%の範囲で入力してください。");
          setSaving(false);
          return;
        }
        if (newDual && r1 >= 100) {
          setAddError("兼務の場合、比率は99%以下にしてください（2店舗目に割り当てる分が必要です）。");
          setSaving(false);
          return;
        }
        if (newDual) {
          await fetch("/api/settings/overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "dual",
              employeeId: empId,
              employeeName: newEmpName,
              store1: newStore,
              ratio1: r1,
              store2: newStore2,
              ratio2: 100 - r1,
            }),
          });
        } else {
          await fetch("/api/settings/overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeId: empId,
              storeName: newStore,
              ratio: r1,
              employeeName: newEmpName,
            }),
          });
        }
      } else if (selectedExisting) {
        const r1 = existDual ? parseInt(existRatio, 10) || 50 : parseInt(existRatio, 10) || 100;
        if (r1 > 100 || r1 < 0) {
          setAddError("比率は0〜100%の範囲で入力してください。");
          setSaving(false);
          return;
        }
        if (existDual && r1 >= 100) {
          setAddError("兼務の場合、比率は99%以下にしてください。");
          setSaving(false);
          return;
        }
        if (existDual) {
          await fetch("/api/settings/overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "dual",
              employeeId: selectedExisting.employeeId,
              employeeName: selectedExisting.employeeName,
              store1: existStore,
              ratio1: r1,
              store2: existStore2,
              ratio2: 100 - r1,
            }),
          });
        } else {
          // Single store change — delete old, create new
          await fetch("/api/settings/overrides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeId: selectedExisting.employeeId,
              storeName: existStore,
              ratio: r1,
              employeeName: selectedExisting.employeeName,
            }),
          });
        }
      }
      await fetchData();
      setMessage("従業員を追加しました");
      setNewEmpId("");
      setNewEmpName("");
      setNewRatio("100");
      setNewDual(false);
      setSelectedExisting(null);
      setExistRatio("100");
      setExistDual(false);
    } catch {
      setMessage("追加に失敗しました");
    }
    setSaving(false);
  }

  const existingFiltered = existSearch
    ? overrides.filter(
        (o) =>
          String(o.employeeId).includes(existSearch) ||
          o.employeeName.toLowerCase().includes(existSearch.toLowerCase()),
      )
    : [];

  // Group to show current stores for selected existing employee
  const selectedCurrentStores = selectedExisting
    ? overrides.filter(
        (o) => o.employeeId === selectedExisting.employeeId,
      )
    : [];

  // Check if employee already has dual assignment
  const hasDual = (empId: number) =>
    overrides.filter((o) => o.employeeId === empId).length > 1;

  return (
    <div>
      {/* Search & actions */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="従業員番号・氏名で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
        />
        <button
          onClick={handleBulkRegister}
          disabled={saving}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          未登録従業員を一括登録
        </button>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${
          message.includes("超えています") || message.includes("既に登録") || message.includes("失敗")
            ? "bg-red-50 text-red-700 border border-red-200"
            : "bg-blue-50 text-blue-700"
        }`}>
          {message}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th
                    onClick={() => handleSort("employeeId")}
                    className="text-left px-3 py-2 font-medium text-gray-600 cursor-pointer hover:text-blue-600 select-none"
                  >
                    従業員番号{sortIndicator("employeeId")}
                  </th>
                  <th
                    onClick={() => handleSort("employeeName")}
                    className="text-left px-3 py-2 font-medium text-gray-600 cursor-pointer hover:text-blue-600 select-none"
                  >
                    氏名{sortIndicator("employeeName")}
                  </th>
                  <th
                    onClick={() => handleSort("storeName")}
                    className="text-left px-3 py-2 font-medium text-gray-600 cursor-pointer hover:text-blue-600 select-none"
                  >
                    店舗{sortIndicator("storeName")}
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    比率(%)
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">
                    兼務
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">
                    削除
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr
                    key={o.id}
                    className={`border-b border-gray-100 ${deleteIds.has(o.id) ? "bg-red-50" : "hover:bg-gray-50"}`}
                  >
                    <td className="px-3 py-2">{o.employeeId}</td>
                    <td className="px-3 py-2">{o.employeeName}</td>
                    <td className="px-3 py-2">
                      <select
                        value={edits[o.id]?.storeName ?? o.storeName}
                        onChange={(e) =>
                          handleEdit(o.id, "storeName", e.target.value)
                        }
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        {ALL_STORES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={edits[o.id]?.ratio ?? o.ratio}
                        onChange={(e) =>
                          handleEdit(o.id, "ratio", e.target.value)
                        }
                        className="border border-gray-300 rounded px-2 py-1 text-sm w-20"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {!hasDual(o.employeeId) && (
                        <button
                          onClick={() => {
                            setDualTarget(o);
                            setDualStore(
                              STORES.find((s) => s !== o.storeName) || STORES[0],
                            );
                            setDualRatio(50);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          兼務
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={deleteIds.has(o.id)}
                        onChange={() => toggleDelete(o.id)}
                        className="w-4 h-4"
                      />
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-gray-400">
                      データがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-6 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>

          {/* Dual assignment dialog */}
          {dualTarget && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                <h3 className="text-base font-bold text-gray-800 mb-3">
                  兼務登録
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  {dualTarget.employeeName}（{dualTarget.employeeId}）を2店舗に割り当てます
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded">
                    <span className="text-sm font-medium w-16">店舗1</span>
                    <span className="text-sm flex-1">{dualTarget.storeName}</span>
                    <span className="text-sm font-bold text-blue-700">{100 - dualRatio}%</span>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded">
                    <span className="text-sm font-medium w-16">店舗2</span>
                    <select
                      value={dualStore}
                      onChange={(e) => setDualStore(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
                    >
                      {ALL_STORES.filter((s) => s !== dualTarget.storeName).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={dualRatio}
                      onChange={(e) => setDualRatio(parseInt(e.target.value, 10) || 0)}
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-16 text-right"
                    />
                    <span className="text-sm">%</span>
                  </div>
                  <p className="text-xs text-gray-500 text-right">
                    合計: {100 - dualRatio} + {dualRatio} = 100%
                  </p>
                </div>
                <div className="flex gap-2 justify-end mt-4">
                  <button
                    onClick={() => setDualTarget(null)}
                    className="text-sm bg-white border rounded px-4 py-2 hover:bg-gray-50 text-gray-600"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleDualRegister}
                    disabled={saving || dualRatio <= 0 || dualRatio >= 100}
                    className="text-sm bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "登録中..." : "兼務登録する"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Expandable: Add/Dual employee */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <button
              onClick={() => setAddOpen(!addOpen)}
              className="text-sm font-medium text-[#567FC0] hover:underline"
            >
              {addOpen ? "▼" : "▶"} 従業員の追加・兼務登録
            </button>
            {addOpen && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex gap-4 mb-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="addMode"
                      checked={addMode === "existing"}
                      onChange={() => setAddMode("existing")}
                    />
                    既存の従業員（兼務・変更）
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="addMode"
                      checked={addMode === "new"}
                      onChange={() => setAddMode("new")}
                    />
                    新規従業員
                  </label>
                </div>

                {addMode === "existing" ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="従業員番号・氏名で検索..."
                      value={existSearch}
                      onChange={(e) => {
                        setExistSearch(e.target.value);
                        setSelectedExisting(null);
                      }}
                      className="border border-gray-300 rounded px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                    />
                    {existSearch && existingFiltered.length > 0 && !selectedExisting && (
                      <div className="border border-gray-200 rounded bg-white max-h-40 overflow-y-auto">
                        {[
                          ...new Map(
                            existingFiltered.map((o) => [o.employeeId, o]),
                          ).values(),
                        ].map((o) => (
                          <button
                            key={o.employeeId}
                            onClick={() => setSelectedExisting(o)}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                          >
                            {o.employeeId} - {o.employeeName}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedExisting && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">
                          選択: {selectedExisting.employeeId} -{" "}
                          {selectedExisting.employeeName}
                        </p>
                        <div className="text-sm text-gray-600">
                          <p className="font-medium mb-1">現在の店舗割当:</p>
                          {selectedCurrentStores.map((s) => (
                            <span
                              key={s.id}
                              className="inline-block bg-gray-200 rounded px-2 py-0.5 mr-2 mb-1"
                            >
                              {s.storeName} ({s.ratio}%)
                            </span>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={existDual}
                            onChange={(e) => setExistDual(e.target.checked)}
                          />
                          兼務（2店舗に割り当て）
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          <select
                            value={existStore}
                            onChange={(e) => setExistStore(e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 text-sm"
                          >
                            {ALL_STORES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={1}
                            max={existDual ? 99 : 100}
                            value={existRatio}
                            onChange={(e) => setExistRatio(e.target.value)}
                            placeholder="比率(%)"
                            className="border border-gray-300 rounded px-2 py-1 text-sm w-24"
                          />
                          {existDual && (
                            <>
                              <span className="text-sm text-gray-500">+</span>
                              <select
                                value={existStore2}
                                onChange={(e) => setExistStore2(e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1 text-sm"
                              >
                                {ALL_STORES.filter((s) => s !== existStore).map((s) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                              <span className="text-sm font-medium text-blue-700">
                                {100 - (parseInt(existRatio, 10) || 0)}%
                              </span>
                            </>
                          )}
                          <button
                            onClick={handleAddEmployee}
                            disabled={saving}
                            className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                          >
                            追加
                          </button>
                        </div>
                        {addError && (
                          <div className="mt-2 px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded text-sm">
                            {addError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newDual}
                        onChange={(e) => setNewDual(e.target.checked)}
                      />
                      兼務（2店舗に割り当て）
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        placeholder="従業員番号"
                        value={newEmpId}
                        onChange={(e) => setNewEmpId(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                      />
                      <input
                        type="text"
                        placeholder="氏名"
                        value={newEmpName}
                        onChange={(e) => setNewEmpName(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                      />
                      <select
                        value={newStore}
                        onChange={(e) => setNewStore(e.target.value)}
                        className="border border-gray-300 rounded px-2 py-2 text-sm"
                      >
                        {ALL_STORES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={newDual ? 99 : 100}
                        value={newRatio}
                        onChange={(e) => setNewRatio(e.target.value)}
                        placeholder="比率(%)"
                        className="border border-gray-300 rounded px-2 py-2 text-sm w-24"
                      />
                      {newDual && (
                        <>
                          <span className="text-sm text-gray-500">+</span>
                          <select
                            value={newStore2}
                            onChange={(e) => setNewStore2(e.target.value)}
                            className="border border-gray-300 rounded px-2 py-2 text-sm"
                          >
                            {ALL_STORES.filter((s) => s !== newStore).map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <span className="text-sm font-medium text-blue-700">
                            {100 - (parseInt(newRatio, 10) || 0)}%
                          </span>
                        </>
                      )}
                      <button
                        onClick={handleAddEmployee}
                        disabled={saving || !newEmpId}
                        className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                      >
                        追加
                      </button>
                    </div>
                    {addError && (
                      <div className="mt-2 px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded text-sm">
                        {addError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab: 勘定科目マスタ
// ═══════════════════════════════════════════════════════════════════

interface ExpenseCategoryRow {
  id: number;
  name: string;
  description: string;
  examples: string;
  categoryType: string;
}

function ExpenseCategoriesTab() {
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());

  // New category form
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newExamples, setNewExamples] = useState("");
  const [newType, setNewType] = useState("expense");

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/expense-categories");
      const data = await res.json();
      setCategories(data.categories || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function toggleDelete(id: number) {
    setDeleteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      for (const id of deleteIds) {
        await fetch(`/api/settings/expense-categories?id=${id}`, { method: "DELETE" });
      }
      setDeleteIds(new Set());
      await fetchData();
      setMessage("保存しました");
    } catch {
      setMessage("保存に失敗しました");
    }
    setSaving(false);
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await fetch("/api/settings/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          examples: newExamples.trim(),
          categoryType: newType,
        }),
      });
      setNewName("");
      setNewDesc("");
      setNewExamples("");
      await fetchData();
      setMessage("追加しました");
    } catch {
      setMessage("追加に失敗しました");
    }
    setSaving(false);
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setMessage("");

    try {
      const text = await file.text();
      const lines = text.split("\n").map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));

      // Skip header rows (first 2 lines)
      const dataLines = lines.slice(2).filter((cols) => cols[0] && cols[0] !== "");

      // Detect category type from section headers
      let currentType = "expense";
      const parsed: { name: string; description: string; examples: string; categoryType: string }[] = [];

      for (const cols of dataLines) {
        const name = cols[0] || "";
        // Section headers like 【売上】【経費】
        if (name.startsWith("【") || name.startsWith("（")) {
          if (name.includes("売上")) currentType = "revenue";
          else if (name.includes("経費")) currentType = "expense";
          else if (name.includes("人件費")) currentType = "labor";
          continue;
        }
        if (!name) continue;
        parsed.push({
          name,
          description: cols[1] || "",
          examples: cols[2] || "",
          categoryType: currentType,
        });
      }

      if (parsed.length === 0) {
        setMessage("CSVから勘定科目を検出できませんでした");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/settings/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: parsed }),
      });
      const data = await res.json();
      await fetchData();
      setMessage(`${data.created}件追加、${data.updated}件更新しました`);
    } catch {
      setMessage("CSVの読み込みに失敗しました");
    }
    setSaving(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  const typeLabel = (t: string) => {
    if (t === "revenue") return "売上";
    if (t === "labor") return "人件費";
    return "経費";
  };

  const typeColor = (t: string) => {
    if (t === "revenue") return "text-blue-600 bg-blue-50";
    if (t === "labor") return "text-red-600 bg-red-50";
    return "text-orange-600 bg-orange-50";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={saving}
          className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
        >
          CSVから一括インポート
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          onChange={handleCsvImport}
          className="hidden"
        />
        <span className="text-xs text-gray-400">勘定科目一覧表CSVをアップロード</span>
      </div>

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">勘定科目</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">区分</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">内容</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">具体例</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">削除</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr
                    key={cat.id}
                    className={`border-b border-gray-100 ${deleteIds.has(cat.id) ? "bg-red-50" : "hover:bg-gray-50"}`}
                  >
                    <td className="px-3 py-2 font-medium">{cat.name}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${typeColor(cat.categoryType)}`}>
                        {typeLabel(cat.categoryType)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{cat.description}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{cat.examples}</td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={deleteIds.has(cat.id)}
                        onChange={() => toggleDelete(cat.id)}
                        className="w-4 h-4"
                      />
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-gray-400">
                      勘定科目がありません。CSVからインポートしてください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {deleteIds.size > 0 && (
            <div className="mt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded text-sm font-medium disabled:opacity-50"
              >
                {saving ? "削除中..." : `${deleteIds.size}件を削除`}
              </button>
            </div>
          )}

          {/* Manual add */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">手動で追加</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">勘定科目名</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="消耗品費"
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-40"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">区分</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-2 text-sm"
                >
                  <option value="expense">経費</option>
                  <option value="revenue">売上</option>
                  <option value="labor">人件費</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">内容</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="文房具やPC周辺機器など"
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-48"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">具体例</label>
                <input
                  type="text"
                  value={newExamples}
                  onChange={(e) => setNewExamples(e.target.value)}
                  placeholder="Amazon・アスクル発注分"
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-48"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={saving || !newName.trim()}
                className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              >
                追加
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab 2: 経費分類ルール
// ═══════════════════════════════════════════════════════════════════

function ExpenseRulesTab() {
  const [rules, setRules] = useState<ExpenseRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, { category?: string }>>({});
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState(EXPENSE_CATEGORIES[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/expense-rules");
      const data = await res.json();
      setRules(data.rules || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
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
    setEdits((prev) => ({ ...prev, [id]: { category } }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage("");
    try {
      for (const id of deleteIds) {
        await fetch(`/api/settings/expense-rules?id=${id}`, {
          method: "DELETE",
        });
      }
      for (const [idStr, edit] of Object.entries(edits)) {
        const id = parseInt(idStr, 10);
        if (deleteIds.has(id)) continue;
        const orig = rules.find((r) => r.id === id);
        if (!orig) continue;
        await fetch("/api/settings/expense-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyword: orig.keyword,
            category: edit.category ?? orig.category,
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
      setNewCategory(EXPENSE_CATEGORIES[0]);
      await fetchData();
      setMessage("ルールを追加しました");
    } catch {
      setMessage("追加に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div>
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
                    キーワード
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    勘定科目
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">
                    削除
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-gray-100 ${deleteIds.has(r.id) ? "bg-red-50" : "hover:bg-gray-50"}`}
                  >
                    <td className="px-3 py-2">{r.keyword}</td>
                    <td className="px-3 py-2">
                      <select
                        value={edits[r.id]?.category ?? r.category}
                        onChange={(e) =>
                          handleEditCategory(r.id, e.target.value)
                        }
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        {EXPENSE_CATEGORIES_WITH_REVENUE.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={deleteIds.has(r.id)}
                        onChange={() => toggleDelete(r.id)}
                        className="w-4 h-4"
                      />
                    </td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
                      ルールがありません
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

          {/* Add new rule */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              新しいルールを追加
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="キーワード"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                className="border border-gray-300 rounded px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="border border-gray-300 rounded px-2 py-2 text-sm"
              >
                {EXPENSE_CATEGORIES_WITH_REVENUE.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddRule}
                disabled={saving || !newKeyword.trim()}
                className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              >
                追加
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tab 3: Amazon商品マスタ
// ═══════════════════════════════════════════════════════════════════

function AmazonMasterTab() {
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

// ═══════════════════════════════════════════════════════════════════
// Tab 4: ユーザー管理 (admin only)
// ═══════════════════════════════════════════════════════════════════

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Edit user form
  const [editId, setEditId] = useState<number | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  // New user form
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newStoreName, setNewStoreName] = useState(STORES[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function getRoleLabel(role: string) {
    switch (role) {
      case "admin":
        return "管理者";
      case "store_manager":
        return "店舗マネージャー";
      case "viewer":
        return "閲覧者";
      default:
        return role;
    }
  }

  async function handleDeleteUser() {
    if (!deleteId) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/settings/users?id=${deleteId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "削除に失敗しました");
      } else {
        setDeleteId(null);
        await fetchData();
        setMessage("ユーザーを削除しました");
      }
    } catch {
      setMessage("削除に失敗しました");
    }
    setSaving(false);
  }

  async function handleCreateUser() {
    if (!newUsername || !newPassword) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newDisplayName || null,
          storeName: newStoreName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "作成に失敗しました");
      } else {
        setNewUsername("");
        setNewPassword("");
        setNewDisplayName("");
        setNewStoreName(STORES[0]);
        await fetchData();
        setMessage("ユーザーを作成しました");
      }
    } catch {
      setMessage("作成に失敗しました");
    }
    setSaving(false);
  }

  return (
    <div>
      {message && (
        <div className="mb-4 px-4 py-2 bg-blue-50 text-blue-700 rounded text-sm">
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-sm">読み込み中...</p>
      ) : (
        <>
          {/* User list */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    ID
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    ユーザー名
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    表示名
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    権限
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    担当店舗
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-3 py-2">{u.id}</td>
                    <td className="px-3 py-2">{u.username}</td>
                    <td className="px-3 py-2">{u.displayName || "-"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {getRoleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{u.storeName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Change password / display name */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              パスワード・表示名の変更
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={editId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? parseInt(e.target.value, 10) : null;
                  setEditId(id);
                  setEditPassword("");
                  const u = users.find((u) => u.id === id);
                  setEditDisplayName(u?.displayName || "");
                }}
                className="border border-gray-300 rounded px-2 py-2 text-sm"
              >
                <option value="">ユーザーを選択</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.displayName || getRoleLabel(u.role)})
                  </option>
                ))}
              </select>
              {editId && (
                <>
                  <input
                    type="text"
                    placeholder="新しい表示名"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                  />
                  <input
                    type="password"
                    placeholder="新しいパスワード（変更時のみ）"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                  />
                  <button
                    onClick={async () => {
                      setSaving(true);
                      setMessage("");
                      try {
                        const res = await fetch("/api/settings/users", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: editId,
                            password: editPassword || undefined,
                            displayName: editDisplayName,
                          }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          setMessage(data.error || "変更に失敗しました");
                        } else {
                          setEditId(null);
                          setEditPassword("");
                          setEditDisplayName("");
                          await fetchData();
                          setMessage("ユーザー情報を更新しました");
                        }
                      } catch {
                        setMessage("変更に失敗しました");
                      }
                      setSaving(false);
                    }}
                    disabled={saving}
                    className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    変更を保存
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Delete user */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              ユーザー削除
            </p>
            <div className="flex items-center gap-3">
              <select
                value={deleteId ?? ""}
                onChange={(e) =>
                  setDeleteId(e.target.value ? parseInt(e.target.value, 10) : null)
                }
                className="border border-gray-300 rounded px-2 py-2 text-sm"
              >
                <option value="">選択してください</option>
                {users
                  .filter((u) => u.role !== "admin")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username} ({u.displayName || u.storeName || "-"})
                    </option>
                  ))}
              </select>
              <button
                onClick={handleDeleteUser}
                disabled={saving || !deleteId}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
              >
                削除
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              ※管理者ユーザーは削除できません
            </p>
          </div>

          {/* Add store manager */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-700 mb-3">
              店舗マネージャーを追加
            </p>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="ユーザー名"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                />
                <input
                  type="password"
                  placeholder="パスワード"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                />
                <input
                  type="text"
                  placeholder="表示名"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
                />
                <select
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-2 text-sm"
                >
                  {ALL_STORES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCreateUser}
                  disabled={saving || !newUsername || !newPassword}
                  className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  作成
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
