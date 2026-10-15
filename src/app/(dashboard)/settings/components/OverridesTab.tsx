"use client";

import { useState, useEffect, useCallback } from "react";
import {
  assignmentsForMonth,
  periodLabel,
  validatePeriods,
  type EmployeeMapping,
  type MappingPeriod,
  type StoreAssignment,
} from "@/lib/payroll-allocation";

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
const YEARS = [2024, 2025, 2026, 2027, 2028];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// ─── Types ──────────────────────────────────────────────────────────

interface EmployeeSummary {
  employeeId: number;
  employeeName: string;
  source: "periods" | "legacy";
  baseStore: string | null;
  periods: MappingPeriod[];
}

/** 画面で編集中の期間（年月は select の値をそのまま文字列で持つ。空＝最初から／継続中） */
interface DraftPeriod {
  startYear: string;
  startMonth: string;
  endYear: string;
  endMonth: string;
  stores: StoreAssignment[];
}

const toDraft = (p: MappingPeriod): DraftPeriod => ({
  startYear: p.startYear != null ? String(p.startYear) : "",
  startMonth: p.startMonth != null ? String(p.startMonth) : "",
  endYear: p.endYear != null ? String(p.endYear) : "",
  endMonth: p.endMonth != null ? String(p.endMonth) : "",
  stores: p.stores.map((s) => ({ ...s })),
});

const fromDraft = (d: DraftPeriod) => ({
  startYear: d.startYear ? parseInt(d.startYear, 10) : null,
  startMonth: d.startMonth ? parseInt(d.startMonth, 10) : null,
  endYear: d.endYear ? parseInt(d.endYear, 10) : null,
  endMonth: d.endMonth ? parseInt(d.endMonth, 10) : null,
  stores: d.stores,
});

const storesText = (stores: StoreAssignment[]) =>
  stores.map((s) => `${s.storeName} ${s.ratio}%`).join("・");

// ─── Component ──────────────────────────────────────────────────────

export default function OverridesTab() {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // Sorting
  type SortKey = "employeeId" | "employeeName";
  const [sortKey, setSortKey] = useState<SortKey>("employeeId");
  const [sortAsc, setSortAsc] = useState(true);

  // 期間の編集ダイアログ
  const [target, setTarget] = useState<EmployeeSummary | null>(null);
  const [drafts, setDrafts] = useState<DraftPeriod[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [baseStore, setBaseStore] = useState<string>("");
  const [dialogError, setDialogError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  // New employee form
  const [newEmpId, setNewEmpId] = useState("");
  const [newEmpName, setNewEmpName] = useState("");
  const [newStore, setNewStore] = useState(STORES[0]);
  const [newRatio, setNewRatio] = useState("100");
  const [newDual, setNewDual] = useState(false);
  const [newStore2, setNewStore2] = useState(STORES[1]);
  const [addError, setAddError] = useState("");

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/overrides");
      const data = await res.json();
      setEmployees(data.employees || []);
    } catch {
      setMessage("データの取得に失敗しました");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = employees
    .filter((e) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        String(e.employeeId).includes(s) ||
        e.employeeName.toLowerCase().includes(s) ||
        e.periods.some((p) => p.stores.some((x) => x.storeName.includes(search)))
      );
    })
    .sort((a, b) => {
      const cmp =
        sortKey === "employeeId"
          ? a.employeeId - b.employeeId
          : a.employeeName.localeCompare(b.employeeName, "ja");
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

  /** 今月の割当（一覧表示用） */
  function currentAssignment(e: EmployeeSummary): string {
    const mapping: EmployeeMapping = { periods: e.periods, baseStore: e.baseStore };
    const a = assignmentsForMonth(mapping, null, thisYear, thisMonth);
    return a.length > 0 ? storesText(a) : "—";
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

  // ─── 期間の編集ダイアログ ──────────────────────────────────────

  function openDialog(e: EmployeeSummary) {
    setTarget(e);
    setDrafts(e.periods.map(toDraft));
    setEditingIdx(null);
    // 空＝社員番号のルールで決める（従来どおり）
    setBaseStore(e.baseStore || "");
    setDialogError("");
    setConfirmRemove(false);
  }

  function closeDialog() {
    setTarget(null);
    setDrafts([]);
    setEditingIdx(null);
    setConfirmRemove(false);
  }

  function updateDraft(idx: number, patch: Partial<DraftPeriod>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function addPeriod() {
    // 直前の期間の終了月の翌月から始める（無ければ今月から）
    const last = drafts[drafts.length - 1];
    let y = thisYear;
    let m = thisMonth;
    if (last?.endYear && last?.endMonth) {
      y = parseInt(last.endYear, 10);
      m = parseInt(last.endMonth, 10) + 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    const next: DraftPeriod = {
      startYear: String(y),
      startMonth: String(m),
      endYear: "",
      endMonth: "",
      stores: [{ storeName: baseStore || drafts[0]?.stores[0]?.storeName || STORES[0], ratio: 100 }],
    };
    setDrafts((prev) => [...prev, next]);
    setEditingIdx(drafts.length);
  }

  function removePeriod(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
    setEditingIdx(null);
  }

  const draftCheck = validatePeriods(drafts.map(fromDraft));

  async function handleSavePeriods() {
    if (!target) return;
    if (!draftCheck.ok) {
      setDialogError(draftCheck.error);
      return;
    }
    setSaving(true);
    setDialogError("");
    try {
      const res = await fetch("/api/settings/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "periods",
          employeeId: target.employeeId,
          employeeName: target.employeeName,
          baseStore: baseStore || null,
          periods: draftCheck.periods,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDialogError(data.error || "保存に失敗しました");
        setSaving(false);
        return;
      }
      closeDialog();
      await fetchData();
      setMessage("期間を保存しました（取り込み済みの人件費も組み直しました）");
    } catch {
      setDialogError("保存に失敗しました");
    }
    setSaving(false);
  }

  async function handleRemoveEmployee() {
    if (!target) return;
    setSaving(true);
    setDialogError("");
    try {
      const res = await fetch("/api/settings/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove-employee", employeeId: target.employeeId }),
      });
      if (!res.ok) throw new Error();
      closeDialog();
      await fetchData();
      setMessage("割当を解除しました（社員番号のルールで店舗を判定します）");
    } catch {
      setDialogError("解除に失敗しました");
    }
    setSaving(false);
  }

  // ─── 新規従業員の追加 ──────────────────────────────────────────

  async function handleAddEmployee() {
    setSaving(true);
    setMessage("");
    setAddError("");
    try {
      const empId = parseInt(newEmpId, 10);
      if (isNaN(empId)) {
        setAddError("従業員番号を数字で入力してください。");
        setSaving(false);
        return;
      }
      const dup = employees.find((e) => e.employeeId === empId);
      if (dup) {
        setAddError(`従業員番号 ${empId}${dup.employeeName ? `（${dup.employeeName}）` : ""} は既に登録されています。一覧の「期間を編集」から変更してください。`);
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
      await fetch("/api/settings/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          newDual
            ? {
                action: "dual",
                employeeId: empId,
                employeeName: newEmpName,
                store1: newStore,
                ratio1: r1,
                store2: newStore2,
                ratio2: 100 - r1,
              }
            : { employeeId: empId, storeName: newStore, ratio: r1, employeeName: newEmpName },
        ),
      });
      await fetchData();
      setMessage("従業員を追加しました");
      setNewEmpId("");
      setNewEmpName("");
      setNewRatio("100");
      setNewDual(false);
    } catch {
      setMessage("追加に失敗しました");
    }
    setSaving(false);
  }

  // ─── 期間の編集フォーム（1期間分） ──────────────────────────────

  function renderPeriodEditor(d: DraftPeriod, idx: number) {
    const total = d.stores.reduce((s, x) => s + (x.ratio || 0), 0);
    const available = ALL_STORES.filter((s) => !d.stores.some((x) => x.storeName === s));
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-medium text-gray-600 w-8">開始</span>
          <select
            value={d.startYear}
            onChange={(e) => updateDraft(idx, { startYear: e.target.value, startMonth: e.target.value ? d.startMonth || "1" : "" })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">最初から</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          {d.startYear && (
            <select
              value={d.startMonth}
              onChange={(e) => updateDraft(idx, { startMonth: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>{m}月</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-medium text-gray-600 w-8">終了</span>
          <select
            value={d.endYear}
            onChange={(e) => updateDraft(idx, { endYear: e.target.value, endMonth: e.target.value ? d.endMonth || "12" : "" })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">継続中（終了なし）</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          {d.endYear && (
            <select
              value={d.endMonth}
              onChange={(e) => updateDraft(idx, { endMonth: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              {MONTHS.map((m) => (
                <option key={m} value={m}>{m}月</option>
              ))}
            </select>
          )}
        </div>
        {d.stores.map((sp, sIdx) => (
          <div key={sIdx} className="flex items-center gap-2">
            <select
              value={sp.storeName}
              onChange={(e) =>
                updateDraft(idx, {
                  stores: d.stores.map((x, i) => (i === sIdx ? { ...x, storeName: e.target.value } : x)),
                })
              }
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
            >
              <option value={sp.storeName}>{sp.storeName}</option>
              {available.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={100}
              value={sp.ratio}
              onChange={(e) =>
                updateDraft(idx, {
                  stores: d.stores.map((x, i) =>
                    i === sIdx ? { ...x, ratio: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) } : x,
                  ),
                })
              }
              className="border border-gray-300 rounded px-2 py-1 text-sm w-16 text-right"
            />
            <span className="text-sm">%</span>
            {d.stores.length > 1 && (
              <button
                onClick={() => updateDraft(idx, { stores: d.stores.filter((_, i) => i !== sIdx) })}
                className="text-gray-400 hover:text-red-500 text-sm px-1"
                aria-label="この店舗を外す"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between">
          {available.length > 0 ? (
            <button
              onClick={() => updateDraft(idx, { stores: [...d.stores, { storeName: available[0], ratio: 0 }] })}
              className="text-xs text-blue-600 hover:underline"
            >
              ＋ 店舗を追加
            </button>
          ) : (
            <span />
          )}
          <span className={`text-xs ${Math.abs(total - 100) <= 1 ? "text-green-600" : "text-amber-600"}`}>
            合計: {total}%{Math.abs(total - 100) <= 1 ? "" : "（100%にしてください）"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Search & actions */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          type="text"
          placeholder="従業員番号・氏名・店舗で検索..."
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

      <div className="mb-4 px-4 py-3 rounded bg-gray-50 border border-gray-200 text-xs text-gray-600 leading-relaxed">
        <p>・<span className="font-medium">2店舗を受け持つ・異動するなど、しばらく同じ割当が続くとき</span>は、ここで「期間」を登録します（例：2026年10月〜2027年2月は東日本橋50%・船橋50%）。</p>
        <p>・<span className="font-medium">ヘルプでその月だけ別の店舗に行ったとき</span>は、ここではなく ダッシュボードの「従業員別明細」でその月だけ調整してください（そちらが優先されます）。</p>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${
          message.includes("既に登録") || message.includes("失敗")
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
                    className="text-left px-3 py-2 font-medium text-gray-600 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  >
                    従業員番号{sortIndicator("employeeId")}
                  </th>
                  <th
                    onClick={() => handleSort("employeeName")}
                    className="text-left px-3 py-2 font-medium text-gray-600 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                  >
                    氏名{sortIndicator("employeeName")}
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">
                    今月（{thisMonth}月）の店舗
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">
                    期間ごとの店舗と比率
                  </th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600 whitespace-nowrap">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.employeeId} className="border-b border-gray-100 hover:bg-gray-50 align-top">
                    <td className="px-3 py-2">{e.employeeId}</td>
                    <td className="px-3 py-2">{e.employeeName}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{currentAssignment(e)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {e.periods.map((p, i) => (
                        <div key={i}>
                          <span className="text-gray-500">{periodLabel(p)}</span>：{storesText(p.stores)}
                        </div>
                      ))}
                      {e.periods.some((p) => p.startYear != null || p.endYear != null) && e.baseStore && (
                        <div className="text-gray-400">上記以外の月：{e.baseStore} 100%</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => openDialog(e)}
                        className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                      >
                        期間を編集
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-gray-400">
                      データがありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 期間の編集ダイアログ */}
          {target && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h3 className="text-base font-bold text-gray-800 mb-1">
                  店舗の割当（期間）
                </h3>
                <p className="text-sm text-gray-600 mb-3">
                  {target.employeeName}（{target.employeeId}）
                </p>
                <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                  期間ごとに、どの店舗に何%つけるかを登録します。終了を「継続中」にすると、その月以降ずっと同じ割当になります。
                  その月だけのヘルプは、ダッシュボードの「従業員別明細」で調整してください。
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left px-2 py-2 font-medium text-gray-600 whitespace-nowrap">開始</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-600 whitespace-nowrap">終了</th>
                        <th className="text-left px-2 py-2 font-medium text-gray-600">店舗と比率</th>
                        <th className="text-center px-2 py-2 font-medium text-gray-600 whitespace-nowrap">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((d, idx) =>
                        editingIdx === idx ? (
                          <tr key={idx} className="border-b border-gray-100 bg-blue-50/40">
                            <td colSpan={3} className="px-2 py-2">
                              {renderPeriodEditor(d, idx)}
                            </td>
                            <td className="px-2 py-2 text-center align-top">
                              <button
                                onClick={() => setEditingIdx(null)}
                                className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                              >
                                閉じる
                              </button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="px-2 py-2 whitespace-nowrap">
                              {d.startYear ? `${d.startYear}年${d.startMonth}月` : "最初から"}
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              {d.endYear ? `${d.endYear}年${d.endMonth}月` : "継続中"}
                            </td>
                            <td className="px-2 py-2">{storesText(d.stores)}</td>
                            <td className="px-2 py-2 text-center whitespace-nowrap">
                              <button
                                onClick={() => setEditingIdx(idx)}
                                className="text-xs text-blue-600 hover:underline mr-3"
                              >
                                編集
                              </button>
                              <button
                                onClick={() => removePeriod(idx)}
                                className="text-xs text-red-600 hover:underline"
                              >
                                削除
                              </button>
                            </td>
                          </tr>
                        ),
                      )}
                      {drafts.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-2 py-3 text-center text-gray-400 text-xs">
                            期間がありません。「＋ 期間を追加」から登録してください。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={addPeriod}
                  className="mt-2 text-sm text-blue-600 hover:underline"
                >
                  ＋ 期間を追加
                </button>

                <div className="mt-4 border-t border-gray-100 pt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-gray-600">どの期間にも入らない月の店舗</span>
                  <select
                    value={baseStore}
                    onChange={(e) => setBaseStore(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="">社員番号のルールで決める</option>
                    {ALL_STORES.map((s) => (
                      <option key={s} value={s}>{s} 100%</option>
                    ))}
                  </select>
                </div>

                {(dialogError || (!draftCheck.ok && drafts.length > 0)) && (
                  <div className="mt-3 px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded text-sm">
                    {dialogError || (!draftCheck.ok ? draftCheck.error : "")}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 justify-between items-center mt-4">
                  <div>
                    {confirmRemove ? (
                      <span className="text-xs text-gray-700">
                        この人の割当をすべて解除し、社員番号のルールに戻します。よろしいですか？
                        <button
                          onClick={handleRemoveEmployee}
                          disabled={saving}
                          className="ml-2 text-xs bg-red-600 text-white rounded px-2 py-1 hover:bg-red-700 disabled:opacity-50"
                        >
                          解除する
                        </button>
                        <button
                          onClick={() => setConfirmRemove(false)}
                          className="ml-1 text-xs border rounded px-2 py-1 hover:bg-gray-50"
                        >
                          やめる
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmRemove(true)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        割当をすべて解除
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={closeDialog}
                      className="text-sm bg-white border rounded px-4 py-2 hover:bg-gray-50 text-gray-600"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={handleSavePeriods}
                      disabled={saving || !draftCheck.ok}
                      className="text-sm bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 新規従業員の追加 */}
          <div className="mt-6 border-t border-gray-200 pt-4">
            <button
              onClick={() => setAddOpen(!addOpen)}
              className="text-sm font-medium text-[#567FC0] hover:underline"
            >
              {addOpen ? "▼" : "▶"} 新しい従業員を追加
            </button>
            {addOpen && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-3">
                <p className="text-xs text-gray-500">
                  登録済みの従業員の変更は、一覧の「期間を編集」から行ってください。
                </p>
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
        </>
      )}
    </div>
  );
}
