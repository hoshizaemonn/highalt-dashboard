"use client";

import { useState, useEffect, useCallback } from "react";

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

// ─── Types ──────────────────────────────────────────────────────────

interface Override {
  id: number;
  employeeId: number;
  storeName: string;
  ratio: number;
  employeeName: string;
}

// ─── Component ──────────────────────────────────────────────────────

export default function OverridesTab() {
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
      {/* 注意喚起バナー — このマスタを誤って変更すると人件費の店舗判定が崩れるため */}
      <div className="mb-5 bg-amber-50 border border-amber-300 rounded-lg p-4">
        <p className="text-sm font-bold text-amber-800 mb-1">
          ⚠️ 操作前に必ずお読みください
        </p>
        <p className="text-xs text-amber-700 leading-relaxed">
          ここは人件費の店舗振り分けルールを管理する場所です。誤って変更すると、
          その従業員の人件費が間違った店舗に集計されます。<br />
          内容が分からない場合は変更せず、管理者（鈴木さん）にお問い合わせください。
        </p>
      </div>

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
