"use client";

import { useState } from "react";
import {
  FileUp,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Loader2,
} from "lucide-react";
import { STORES } from "@/lib/constants";
import {
  FileDropzone,
  ActionButton,
  detectYearMonthFromFilename,
} from "./SharedComponents";

// ─── Types ──────────────────────────────────────────────────

interface FileWithYM {
  file: File;
  year: number;
  month: number;
}

// ─── Unresolved Employee Section ───────────────────────────

function UnresolvedEmployeeSection({
  employees,
  onRegistered,
}: {
  employees: { employeeId: string; employeeName: string; contractType: string; grossTotal: number }[];
  onRegistered: () => void;
}) {
  const THOUSAND_DIGIT_MAP: Record<number, string> = {
    1: "東日本橋", 2: "春日", 3: "船橋", 4: "巣鴨",
    5: "東日本橋", 6: "祖師ヶ谷大蔵", 7: "下北沢", 8: "中目黒",
  };

  // Auto-detect store from employee ID thousand digit
  const detectStore = (empId: string) => {
    const num = parseInt(empId, 10);
    if (isNaN(num)) return "";
    const thousandDigit = Math.floor(num / 1000);
    return THOUSAND_DIGIT_MAP[thousandDigit] || "";
  };

  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const emp of employees) {
      init[emp.employeeId] = detectStore(emp.employeeId);
    }
    return init;
  });
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const allAssigned = Object.values(assignments).every((s) => s !== "");

  const handleRegister = async () => {
    setSaving(true);
    try {
      const overrides = Object.entries(assignments)
        .filter(([, store]) => store !== "")
        .map(([empId, store]) => ({
          employeeId: parseInt(empId, 10),
          storeName: store,
          ratio: 100,
        }));

      const res = await fetch("/api/settings/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });

      if (!res.ok) throw new Error("登録に失敗しました");
      setConfirming(false);
      onRegistered();
    } catch {
      alert("登録に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-yellow-800">
          店舗未登録の従業員 ({employees.length}名)
        </h4>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs bg-white border border-yellow-300 rounded px-3 py-1 hover:bg-yellow-50 text-yellow-700"
          >
            編集
          </button>
        )}
      </div>
      <p className="text-xs text-yellow-600 mb-3">
        {editing
          ? "店舗を選択してから「この内容で登録する」を押してください。"
          : "設定画面から店舗オーバーライドを登録してから再アップロードしてください。"}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-yellow-200">
              <th className="text-left py-1 px-2">ID</th>
              <th className="text-left py-1 px-2">氏名</th>
              <th className="text-left py-1 px-2">雇用形態</th>
              <th className="text-right py-1 px-2">総支給額</th>
              {editing && <th className="text-left py-1 px-2">店舗</th>}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.employeeId} className="border-b border-yellow-100">
                <td className="py-1 px-2">{emp.employeeId}</td>
                <td className="py-1 px-2">{emp.employeeName}</td>
                <td className="py-1 px-2">{emp.contractType}</td>
                <td className="py-1 px-2 text-right">
                  {emp.grossTotal.toLocaleString()}円
                </td>
                {editing && (
                  <td className="py-1 px-2">
                    <select
                      value={assignments[emp.employeeId] || ""}
                      onChange={(e) =>
                        setAssignments((prev) => ({
                          ...prev,
                          [emp.employeeId]: e.target.value,
                        }))
                      }
                      className={`border rounded px-2 py-0.5 text-xs w-full ${
                        assignments[emp.employeeId] ? "" : "border-red-300 bg-red-50"
                      }`}
                    >
                      <option value="">-- 選択 --</option>
                      {STORES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setConfirming(true)}
            disabled={!allAssigned}
            className="text-xs bg-blue-600 text-white rounded px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            この内容で登録する
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-xs bg-white border rounded px-3 py-1.5 hover:bg-gray-50 text-gray-600"
          >
            キャンセル
          </button>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirming && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-base font-bold text-gray-800 mb-3">
              以下の内容で登録しますか？
            </h3>
            <div className="bg-gray-50 rounded p-3 mb-4 max-h-48 overflow-y-auto">
              {employees.map((emp) => (
                <div key={emp.employeeId} className="flex justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                  <span>{emp.employeeName}（{emp.employeeId}）</span>
                  <span className="font-medium text-blue-700">
                    {assignments[emp.employeeId]}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-4">
              登録後、人件費データを再アップロードして店舗に反映します。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                className="text-sm bg-white border rounded px-4 py-2 hover:bg-gray-50 text-gray-600"
              >
                戻る
              </button>
              <button
                onClick={handleRegister}
                disabled={saving}
                className="text-sm bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "登録中..." : "登録する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Payroll Tab ───────────────────────────────────────────

export function PayrollTab({ onSuccess }: { onSuccess?: () => void }) {
  const [fileEntries, setFileEntries] = useState<FileWithYM[]>([]);
  // Keep a derived files array for FileDropzone compatibility
  const files = fileEntries.map((e) => e.file);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    fileName: string;
    year: number;
    month: number;
    records: number;
    error?: string;
    unresolved: { employeeId: string; employeeName: string; contractType: string; grossTotal: number }[];
  }[]>([]);
  const [overwriteWarning, setOverwriteWarning] = useState<{
    existing: { fileName: string; year: number; month: number; count: number }[];
  } | null>(null);

  // Name conflict state
  const [nameConflicts, setNameConflicts] = useState<{
    file: File;
    conflicts: { employeeId: string; csvName: string; existingName: string }[];
  } | null>(null);
  const [nameResolutions, setNameResolutions] = useState<Record<string, string>>({});
  // Pending entries after name conflict resolution
  const [pendingEntries, setPendingEntries] = useState<FileWithYM[]>([]);

  const uploadSingleFile = async (entry: FileWithYM, resolutions?: Record<string, string>) => {
    const { file, year, month } = entry;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("year", String(year));
    formData.append("month", String(month));
    if (resolutions) {
      formData.append("forceNames", "true");
      formData.append("nameResolutions", JSON.stringify(resolutions));
    }

    const res = await fetch("/api/upload/payroll", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        fileName: file.name,
        year,
        month,
        records: 0,
        error: data.error || "エラー",
        unresolved: [] as { employeeId: string; employeeName: string; contractType: string; grossTotal: number }[],
        nameConflicts: [] as { employeeId: string; csvName: string; existingName: string }[],
        needsConfirmation: false,
      };
    }

    return {
      fileName: file.name,
      year,
      month,
      records: data.records as number,
      unresolved: (data.unresolved || []) as { employeeId: string; employeeName: string; contractType: string; grossTotal: number }[],
      nameConflicts: (data.nameConflicts || []) as { employeeId: string; csvName: string; existingName: string }[],
      needsConfirmation: !!data.needsConfirmation,
    };
  };

  const doUploadAll = async (entriesToUpload?: FileWithYM[]) => {
    const targetEntries = entriesToUpload || fileEntries;
    setLoading(true);
    setResults([]);
    setOverwriteWarning(null);

    const allResults: typeof results = [];
    for (let i = 0; i < targetEntries.length; i++) {
      const entry = targetEntries[i];
      const result = await uploadSingleFile(entry);

      // If name conflicts detected, pause and show dialog
      if (result.needsConfirmation && result.nameConflicts.length > 0) {
        setNameConflicts({ file: entry.file, conflicts: result.nameConflicts });
        const defaults: Record<string, string> = {};
        for (const c of result.nameConflicts) {
          defaults[c.employeeId] = c.csvName;
        }
        setNameResolutions(defaults);
        setPendingEntries(targetEntries.slice(i));
        setResults(allResults);
        setLoading(false);
        return;
      }

      allResults.push({
        fileName: result.fileName,
        year: result.year,
        month: result.month,
        records: result.records,
        error: result.records === 0 && !result.needsConfirmation ? result.error : undefined,
        unresolved: result.unresolved,
      });
    }

    setResults(allResults);
    setLoading(false);
    onSuccess?.();
  };

  // Continue upload after name conflict resolution
  const handleNameConflictResolve = async () => {
    if (!nameConflicts || pendingEntries.length === 0) return;
    setLoading(true);

    // Re-upload current entry with resolutions
    const currentEntry = pendingEntries[0];
    const result = await uploadSingleFile(currentEntry, nameResolutions);

    const currentResults = [...results, {
      fileName: result.fileName,
      year: result.year,
      month: result.month,
      records: result.records,
      unresolved: result.unresolved,
    }];

    setNameConflicts(null);
    setResults(currentResults);

    // Continue with remaining entries
    const remaining = pendingEntries.slice(1);
    if (remaining.length > 0) {
      const moreResults = [...currentResults];
      for (let i = 0; i < remaining.length; i++) {
        const r = await uploadSingleFile(remaining[i]);
        if (r.needsConfirmation && r.nameConflicts.length > 0) {
          setNameConflicts({ file: remaining[i].file, conflicts: r.nameConflicts });
          const defaults: Record<string, string> = {};
          for (const c of r.nameConflicts) defaults[c.employeeId] = c.csvName;
          setNameResolutions(defaults);
          setPendingEntries(remaining.slice(i));
          setResults(moreResults);
          setLoading(false);
          return;
        }
        moreResults.push({
          fileName: r.fileName, year: r.year, month: r.month,
          records: r.records, unresolved: r.unresolved,
        });
      }
      setResults(moreResults);
    }

    setPendingEntries([]);
    setLoading(false);
    onSuccess?.();
  };

  const handleUpload = async () => {
    if (fileEntries.length === 0) return;
    setLoading(true);
    setResults([]);
    setOverwriteWarning(null);

    // Check all files for existing data first
    const existingList: { fileName: string; year: number; month: number; count: number }[] = [];
    for (const entry of fileEntries) {
      try {
        const checkRes = await fetch(`/api/upload/payroll?year=${entry.year}&month=${entry.month}`);
        const checkData = await checkRes.json();
        if (checkData.exists) {
          existingList.push({ fileName: entry.file.name, year: entry.year, month: entry.month, count: checkData.count });
        }
      } catch { /* proceed */ }
    }

    if (existingList.length > 0) {
      setOverwriteWarning({ existing: existingList });
      setLoading(false);
      return;
    }

    await doUploadAll();
  };

  // Collect all unresolved from all results
  const allUnresolved = results.flatMap((r) => r.unresolved);
  // Deduplicate by employeeId
  const uniqueUnresolved = allUnresolved.filter(
    (emp, i, arr) => arr.findIndex((e) => e.employeeId === emp.employeeId) === i,
  );

  const totalRecords = results.reduce((s, r) => s + r.records, 0);
  const hasErrors = results.some((r) => r.error);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        クラウド給与から出力した支給控除一覧表（CSV）をアップロード（複数選択可）
      </p>

      {/* File list with year/month selectors */}
      {fileEntries.length > 0 && (
        <div className="space-y-2">
          {fileEntries.map((entry, i) => (
            <div key={`${entry.file.name}-${i}`} className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <FileUp size={18} className="text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-800 truncate">{entry.file.name}</p>
                <p className="text-xs text-blue-600">{(entry.file.size / 1024).toFixed(1)} KB</p>
              </div>
              <select
                value={entry.year}
                onChange={(e) => {
                  const y = parseInt(e.target.value, 10);
                  setFileEntries((prev) => prev.map((fe, idx) => idx === i ? { ...fe, year: y } : fe));
                }}
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
              >
                {Array.from({ length: new Date().getFullYear() - 2020 + 6 }, (_, i) => 2020 + i).map((y) => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
              <select
                value={entry.month}
                onChange={(e) => {
                  const m = parseInt(e.target.value, 10);
                  setFileEntries((prev) => prev.map((fe, idx) => idx === i ? { ...fe, month: m } : fe));
                }}
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
              >
                {Array.from({ length: 12 }, (_, j) => j + 1).map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
              <button
                onClick={() => {
                  setFileEntries((prev) => prev.filter((_, idx) => idx !== i));
                  setResults([]);
                }}
                className="text-blue-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <FileDropzone
            accept=".csv,.xlsx,.xls"
            multiple
            files={[]}
            onFilesSelect={(newFiles) => {
              const newEntries = newFiles.map((f) => {
                const d = detectYearMonthFromFilename(f.name);
                return {
                  file: f,
                  year: d.year || new Date().getFullYear(),
                  month: d.month || (new Date().getMonth() + 1),
                };
              });
              setFileEntries((prev) => [...prev, ...newEntries]);
              setResults([]);
            }}
          />
        </div>
      )}

      {/* Empty dropzone when no files */}
      {fileEntries.length === 0 && (
        <FileDropzone
          accept=".csv,.xlsx,.xls"
          multiple
          files={[]}
          onFilesSelect={(newFiles) => {
            const newEntries = newFiles.map((f) => {
              const d = detectYearMonthFromFilename(f.name);
              return {
                file: f,
                year: d.year || new Date().getFullYear(),
                month: d.month || (new Date().getMonth() + 1),
              };
            });
            setFileEntries(newEntries);
            setResults([]);
          }}
        />
      )}

      <div className="flex gap-2">
        <ActionButton onClick={handleUpload} loading={loading} disabled={fileEntries.length === 0 || !!overwriteWarning}>
          {fileEntries.length <= 1 ? "解析して保存する" : `${fileEntries.length}件を一括アップロード`}
        </ActionButton>
      </div>

      {overwriteWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 mb-2">
            ⚠️ 以下の月は既にデータがあります。上書きしますか？
          </p>
          <ul className="text-sm text-amber-700 mb-3 space-y-1">
            {overwriteWarning.existing.map((e, i) => (
              <li key={i}>
                {e.year}年{e.month}月 — 既存{e.count}件（{e.fileName}）
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => doUploadAll()}
              disabled={loading}
              className="text-sm bg-amber-600 text-white rounded px-4 py-1.5 hover:bg-amber-700 disabled:opacity-50"
            >
              {loading ? "アップロード中..." : "上書きする"}
            </button>
            <button
              onClick={() => setOverwriteWarning(null)}
              className="text-sm bg-white border rounded px-4 py-1.5 hover:bg-gray-50 text-gray-600"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Name conflict dialog */}
      {nameConflicts && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-base font-bold text-gray-800 mb-2">
              従業員名が異なります
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              同じ従業員番号で名前が異なるデータがあります。どちらが正しいですか？
            </p>
            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
              {nameConflicts.conflicts.map((c) => (
                <div key={c.employeeId} className="border rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-2">従業員番号: {c.employeeId}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setNameResolutions((prev) => ({ ...prev, [c.employeeId]: c.csvName }))}
                      className={`flex-1 text-sm rounded px-3 py-2 border-2 transition-colors ${
                        nameResolutions[c.employeeId] === c.csvName
                          ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <span className="text-xs text-gray-500 block">CSVの名前</span>
                      {c.csvName}
                    </button>
                    <button
                      onClick={() => setNameResolutions((prev) => ({ ...prev, [c.employeeId]: c.existingName }))}
                      className={`flex-1 text-sm rounded px-3 py-2 border-2 transition-colors ${
                        nameResolutions[c.employeeId] === c.existingName
                          ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <span className="text-xs text-gray-500 block">既存の名前</span>
                      {c.existingName}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setNameConflicts(null);
                  setPendingEntries([]);
                }}
                className="text-sm bg-white border rounded px-4 py-2 hover:bg-gray-50 text-gray-600"
              >
                キャンセル
              </button>
              <button
                onClick={handleNameConflictResolve}
                disabled={loading}
                className="text-sm bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "処理中..." : "この名前で保存する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 p-3 rounded-lg border text-sm ${
                r.error
                  ? "bg-red-50 border-red-200 text-red-700"
                  : "bg-green-50 border-green-200 text-green-700"
              }`}
            >
              {r.error ? (
                <AlertCircle size={16} className="shrink-0" />
              ) : (
                <CheckCircle2 size={16} className="shrink-0" />
              )}
              <span className="flex-1">
                {r.year}年{r.month}月 — {r.error || `${r.records}件保存`}
                {r.unresolved.length > 0 && ` (未登録${r.unresolved.length}名)`}
              </span>
              <span className="text-xs opacity-70 truncate max-w-[200px]">{r.fileName}</span>
            </div>
          ))}
          {!hasErrors && totalRecords > 0 && (
            <p className="text-sm font-medium text-green-700">
              合計 {totalRecords}件のデータを保存しました
            </p>
          )}
        </div>
      )}

      {uniqueUnresolved.length > 0 && (
        <UnresolvedEmployeeSection
          employees={uniqueUnresolved}
          onRegistered={() => {
            handleUpload();
          }}
        />
      )}
    </div>
  );
}
