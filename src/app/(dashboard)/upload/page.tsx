"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Upload,
  FileUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Clock,
} from "lucide-react";
import { STORES, EXPENSE_CATEGORIES } from "@/lib/constants";

// ─── Types ──────────────────────────────────────────────────

type TabId = "payroll" | "expense" | "sales" | "budget";
type SalesSubTab = "ml001" | "pl001" | "ma002" | "square";

interface UploadLogEntry {
  id: number;
  userName: string;
  dataType: string;
  storeName: string | null;
  year: number | null;
  month: number | null;
  fileName: string | null;
  recordCount: number;
  note: string | null;
  createdAt: string;
}

interface StatusMessage {
  type: "success" | "error" | "info";
  text: string;
}

// ─── File Dropzone Component ────────────────────────────────

function FileDropzone({
  accept,
  onFileSelect,
  file,
  onClear,
  multiple,
  files,
  onFilesSelect,
  onRemoveFile,
}: {
  accept: string;
  onFileSelect?: (file: File) => void;
  file?: File | null;
  onClear?: () => void;
  multiple?: boolean;
  files?: File[];
  onFilesSelect?: (files: File[]) => void;
  onRemoveFile?: (index: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    },
    [],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (multiple && onFilesSelect) {
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length > 0) onFilesSelect(dropped);
      } else {
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile && onFileSelect) onFileSelect(droppedFile);
      }
    },
    [multiple, onFileSelect, onFilesSelect],
  );

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (multiple && onFilesSelect) {
      const selected = Array.from(e.target.files || []);
      if (selected.length > 0) onFilesSelect(selected);
    } else {
      const selected = e.target.files?.[0];
      if (selected && onFileSelect) onFileSelect(selected);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  // Multi-file display
  if (multiple && files && files.length > 0) {
    return (
      <div className="space-y-2">
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <FileUp size={18} className="text-blue-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-800 truncate">{f.name}</p>
              <p className="text-xs text-blue-600">{(f.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={() => onRemoveFile?.(i)}
              className="text-blue-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={handleClick}
          className="text-xs text-blue-600 hover:text-blue-800 underline"
        >
          + ファイルを追加
        </button>
        <input ref={inputRef} type="file" accept={accept} multiple onChange={handleChange} className="hidden" />
      </div>
    );
  }

  // Single file display
  if (!multiple && file) {
    return (
      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <FileUp size={20} className="text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-800 truncate">
            {file.name}
          </p>
          <p className="text-xs text-blue-600">
            {(file.size / 1024).toFixed(1)} KB
          </p>
        </div>
        <button
          onClick={onClear}
          className="text-blue-400 hover:text-red-500 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
        ${isDragging ? "border-[#567FC0] bg-blue-50" : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
      />
      <Upload size={32} className="mx-auto text-gray-400 mb-2" />
      <p className="text-sm text-gray-600">
        ファイルをドラッグ&ドロップ、またはクリックして選択
      </p>
      <p className="text-xs text-gray-400 mt-1">
        {accept}{multiple ? "（複数選択可）" : ""}
      </p>
    </div>
  );
}

// ─── Status Message Component ───────────────────────────────

function StatusBanner({ status }: { status: StatusMessage | null }) {
  if (!status) return null;

  const styles = {
    success: "bg-green-50 border-green-200 text-green-800",
    error: "bg-red-50 border-red-200 text-red-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  };

  const icons = {
    success: <CheckCircle2 size={18} className="text-green-600 shrink-0" />,
    error: <AlertCircle size={18} className="text-red-600 shrink-0" />,
    info: <Loader2 size={18} className="text-blue-600 shrink-0 animate-spin" />,
  };

  return (
    <div className={`flex items-start gap-2 p-3 border rounded-lg ${styles[status.type]}`}>
      {icons[status.type]}
      <p className="text-sm whitespace-pre-wrap">{status.text}</p>
    </div>
  );
}

// ─── Select Components ──────────────────────────────────────

function StoreSelect({
  value,
  onChange,
  includeAll,
}: {
  value: string;
  onChange: (v: string) => void;
  includeAll?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        対象店舗
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
      >
        {includeAll && <option value="">全店舗</option>}
        {STORES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

function YearSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        対象年
      </label>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
      >
        {Array.from({ length: new Date().getFullYear() - 2020 + 6 }, (_, i) => 2020 + i).map((y) => (
          <option key={y} value={y}>
            {y}年
          </option>
        ))}
      </select>
    </div>
  );
}

function MonthSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        対象月
      </label>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {m}月
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Overwrite Warning Component ────────────────────────────

function OverwriteWarning({
  message,
  onConfirm,
  onCancel,
  loading,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
      <p className="text-sm text-amber-800 font-medium mb-3">{message}</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={loading}
          className="px-4 py-2 rounded-md text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          はい（上書き保存）
        </button>
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 rounded-md text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          いいえ（キャンセル）
        </button>
      </div>
    </div>
  );
}

// ─── Action Buttons ─────────────────────────────────────────

function ActionButton({
  onClick,
  loading,
  disabled,
  variant = "primary",
  children,
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  children: React.ReactNode;
}) {
  const base =
    "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-[#567FC0] text-white hover:bg-[#4568a5]",
    secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${styles[variant]}`}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

// ─── Payroll Tab ────────────────────────────────────────────

function detectYearMonthFromFilename(filename: string): { year?: number; month?: number } {
  // Match patterns like: 2026年02月, 2026_02, 202602, 2026-02
  const patterns = [
    /(\d{4})[年_\-](\d{1,2})[月]?/,
    /(\d{4})(\d{2})/,
  ];
  for (const p of patterns) {
    const m = filename.match(p);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      if (y >= 2020 && y <= 2030 && mo >= 1 && mo <= 12) {
        return { year: y, month: mo };
      }
    }
  }
  return {};
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

interface FileWithYM {
  file: File;
  year: number;
  month: number;
}

function PayrollTab({ onSuccess }: { onSuccess?: () => void }) {
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

// ─── Expense Tab ────────────────────────────────────────────

function ExpenseTab({ onSuccess }: { onSuccess?: () => void }) {
  const [amazonDone, setAmazonDone] = useState(false);
  const [skipAmazon, setSkipAmazon] = useState(false);

  const amazonReady = amazonDone || skipAmazon;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        ① Amazon注文履歴 → ② PayPay銀行CSV の順にアップロード
      </p>

      {/* Step 1: Amazon */}
      <div className="border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-2">① Amazon注文履歴（内訳データ）</h3>

        {!amazonDone && (
          <label className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              checked={skipAmazon}
              onChange={(e) => setSkipAmazon(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-600">Amazonデータをスキップ（内訳不要の場合）</span>
          </label>
        )}

        {!skipAmazon && !amazonDone && (
          <AmazonExpenseSection onSuccess={() => { setAmazonDone(true); onSuccess?.(); }} />
        )}

        {amazonDone && (
          <div className="bg-green-50 border border-green-200 rounded px-4 py-2 text-sm text-green-700">
            ✅ Amazon注文データ取込完了
          </div>
        )}

        {skipAmazon && !amazonDone && (
          <div className="bg-blue-50 border border-blue-200 rounded px-4 py-2 text-sm text-blue-700">
            Amazonデータはスキップされます
          </div>
        )}
      </div>

      {/* Step 2: PayPay */}
      <div className={`border rounded-lg p-4 ${amazonReady ? "border-gray-200" : "border-gray-100 opacity-50"}`}>
        <h3 className="text-sm font-bold text-gray-700 mb-2">② PayPay銀行CSV</h3>

        {!amazonReady ? (
          <p className="text-sm text-yellow-600">
            先に①のAmazonデータを取り込むか、スキップにチェックを入れてください。
          </p>
        ) : (
          <PayPayExpenseSection onSuccess={onSuccess} />
        )}
      </div>
    </div>
  );
}

function PayPayExpenseSection({ onSuccess }: { onSuccess?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [store, setStore] = useState<string>(STORES[0]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [autoDetected, setAutoDetected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ count: number } | null>(null);
  const [parsedRecords, setParsedRecords] = useState<
    {
      year: number;
      month: number;
      day: number;
      description: string;
      amount: number;
      deposit: number;
      category: string | null;
      isAutoClassified: boolean;
      isRevenue: boolean;
      breakdown: string;
    }[]
  >([]);
  const [parseStats, setParseStats] = useState<{ classified: number; unclassified: number } | null>(null);

  const doParse = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "解析中..." });
    setOverwriteWarning(null);
    setParsedRecords([]);
    setParseStats(null);

    try {
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("store", store);
      formData.append("year", String(year));
      formData.append("month", String(month));

      const res = await fetch("/api/upload/expense", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setParsedRecords(data.records);
      setParseStats({ classified: data.classified, unclassified: data.unclassified });
      setStatus({
        type: "success",
        text: `${data.records.length}件の取引を検出（分類済み ${data.classified}件 / 未分類 ${data.unclassified}件）`,
      });
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async () => {
    if (!file) return;
    setLoading(true);
    setStatus(null);

    try {
      const checkRes = await fetch(`/api/upload/expense?year=${year}&month=${month}&store=${encodeURIComponent(store)}`);
      const checkData = await checkRes.json();

      if (checkData.exists) {
        setOverwriteWarning({ count: checkData.count });
        setLoading(false);
        return;
      }
    } catch {
      // Check failed, proceed with parse anyway
    }

    await doParse();
  };

  const handleSave = async () => {
    if (parsedRecords.length === 0) return;
    setSaving(true);
    setStatus({ type: "info", text: "保存中..." });

    try {
      const res = await fetch("/api/upload/expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          records: parsedRecords,
          store,
          year,
          month,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setStatus({
        type: "success",
        text: `${store} ${year}年${month}月の経費データを保存しました（${data.saved}件）`,
      });
      onSuccess?.();
      setParsedRecords([]);
      setParseStats(null);
      setFile(null);
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateRecordCategory = (index: number, category: string) => {
    setParsedRecords((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], category: category || null };
      return next;
    });
  };

  const currentUnclassified = parsedRecords.filter((r) => !r.category).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        PayPay銀行 入出金明細CSV（Shift-JIS）をアップロード
      </p>

      <div className="grid grid-cols-3 gap-4">
        <StoreSelect value={store} onChange={setStore} />
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

      <FileDropzone
        accept=".csv"
        file={file}
        onFileSelect={(f) => {
          setFile(f);
          setParsedRecords([]);
          setParseStats(null);
          if (f) {
            const detected = detectYearMonthFromFilename(f.name);
            if (detected.year) { setYear(detected.year); setAutoDetected(true); }
            if (detected.month) { setMonth(detected.month); setAutoDetected(true); }
          }
        }}
        onClear={() => {
          setFile(null);
          setStatus(null);
          setOverwriteWarning(null);
          setAutoDetected(false);
          setParsedRecords([]);
          setParseStats(null);
        }}
      />
      {autoDetected && file && (
        <p className="text-sm text-green-600">
          ファイル名から <strong>{year}年{month}月</strong> を自動検出しました
        </p>
      )}

      <div className="flex gap-2">
        <ActionButton onClick={handleParse} loading={loading} disabled={!file || !!overwriteWarning || parsedRecords.length > 0}>
          解析する
        </ActionButton>
        {parsedRecords.length > 0 && (
          <ActionButton onClick={handleSave} loading={saving} variant="primary">
            保存する
          </ActionButton>
        )}
      </div>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} ${year}年${month}月の経費データが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={async () => {
            setOverwriteWarning(null);
            await doParse();
          }}
          onCancel={() => { setOverwriteWarning(null); setLoading(false); }}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />

      {parsedRecords.length > 0 && currentUnclassified > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
          <p className="text-sm text-yellow-800 font-medium">
            {"\u26A0\uFE0F"} 未分類: {currentUnclassified}件 -- 下のドロップダウンから勘定科目を選択してください
          </p>
        </div>
      )}

      {parsedRecords.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">日</th>
                  <th className="text-left py-2 px-3 font-medium">摘要</th>
                  <th className="text-right py-2 px-3 font-medium">出金</th>
                  <th className="text-right py-2 px-3 font-medium">入金</th>
                  <th className="text-left py-2 px-3 font-medium">勘定科目</th>
                </tr>
              </thead>
              <tbody>
                {parsedRecords.map((rec, i) => (
                  <tr
                    key={i}
                    className={`border-t border-gray-100 ${
                      rec.isRevenue ? "bg-blue-50/50" : !rec.category ? "bg-yellow-50/50" : ""
                    }`}
                  >
                    <td className="py-1.5 px-3 whitespace-nowrap">{rec.month}/{rec.day}</td>
                    <td className="py-1.5 px-3 max-w-[250px] truncate" title={rec.description}>
                      {rec.description}
                    </td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      {rec.amount > 0 ? rec.amount.toLocaleString() : ""}
                    </td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      {rec.deposit > 0 ? rec.deposit.toLocaleString() : ""}
                    </td>
                    <td className="py-1.5 px-3">
                      {rec.isRevenue ? (
                        <span className="text-xs text-blue-600 font-medium">収入</span>
                      ) : (
                        <select
                          value={rec.category || ""}
                          onChange={(e) => updateRecordCategory(i, e.target.value)}
                          className={`text-xs border rounded px-1.5 py-1 w-full ${
                            rec.category
                              ? "border-green-300 bg-green-50"
                              : "border-yellow-300 bg-yellow-50"
                          }`}
                        >
                          <option value="">未分類</option>
                          {EXPENSE_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AmazonExpenseSection({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  // Only unregistered (new) products to confirm
  const [newRecords, setNewRecords] = useState<
    {
      asin: string;
      productName: string;
      shortName: string;
      amazonCategory: string;
      expenseCategory: string;
    }[]
  >([]);
  const [allParsedRecords, setAllParsedRecords] = useState<
    {
      asin: string;
      productName: string;
      shortName: string;
      amazonCategory: string;
      expenseCategory: string;
    }[]
  >([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [allRegistered, setAllRegistered] = useState(false);

  // Map Amazon categories to expense categories as initial suggestion
  const amazonCategoryToExpense: Record<string, string> = {
    "ABIS_HEALTH_AND_BEAUTY": "消耗品費",
    "ABIS_DRUGSTORE": "消耗品費",
    "ABIS_OFFICE_PRODUCTS": "消耗品費",
    "ABIS_KITCHEN": "消耗品費",
    "ABIS_HOME": "消耗品費",
    "ABIS_GROCERY": "消耗品費",
    "ABIS_SPORTS": "消耗品費",
    "ABIS_TOOLS": "消耗品費",
    "ABIS_ELECTRONICS": "消耗品費",
    "ABIS_COMPUTER": "消耗品費",
    "ABIS_APPAREL": "消耗品費",
    "ABIS_SHOES": "消耗品費",
    "ABIS_PET_SUPPLIES": "消耗品費",
    "ABIS_BABY_PRODUCTS": "消耗品費",
  };

  const handleParse = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus({ type: "info", text: "解析中..." });
    setAllRegistered(false);

    try {
      // Upload all files and merge results
      let allRecords: { asin: string; productName: string; shortName: string; amazonCategory: string; expenseCategory: string }[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/amazon", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          setStatus({ type: "error", text: data.error || `${file.name}: エラー` });
          return;
        }
        allRecords = allRecords.concat(data.records || []);
      }

      const data = { records: allRecords };
      if (!data.records || data.records.length === 0) {
        setStatus({ type: "error", text: "データが見つかりませんでした" });
        return;
      }

      // Deduplicate by ASIN and categorize
      const seenAsins = new Set<string>();
      const unregistered: typeof newRecords = [];
      const allDeduped: typeof newRecords = [];
      let registered = 0;

      for (const rec of data.records) {
        if (seenAsins.has(rec.asin)) continue;
        seenAsins.add(rec.asin);

        const entry = {
          asin: rec.asin,
          productName: rec.productName,
          shortName: rec.shortName,
          amazonCategory: rec.amazonCategory,
          expenseCategory: rec.expenseCategory || "",
        };

        allDeduped.push(entry);

        if (rec.expenseCategory) {
          registered++;
        } else {
          // Apply auto-set from Amazon category
          unregistered.push(entry);
        }
      }

      setAllParsedRecords(allDeduped);
      setSkippedCount(registered);
      setNewRecords(unregistered);

      if (unregistered.length === 0) {
        // All ASINs already registered — still save to update product names
        setAllRegistered(true);
        setStatus({
          type: "info",
          text: `全商品が登録済み（${registered}件）。商品名を最新に更新します...`,
        });
        // Auto-save to update product names
        const saveRes = await fetch("/api/upload/amazon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: allDeduped, action: "save" }),
        });
        if (saveRes.ok) {
          setStatus({
            type: "success",
            text: `全商品が登録済みです（${registered}件の商品名を最新に更新しました）`,
          });
        }
        onSuccess?.();
      } else {
        setStatus({
          type: "success",
          text: `新規 ${unregistered.length}件 / 登録済み ${registered}件`,
        });
      }
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (newRecords.length === 0) return;
    setSaving(true);
    setStatus({ type: "info", text: "商品マスタに登録中..." });

    try {
      const res = await fetch("/api/upload/amazon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [...newRecords, ...allParsedRecords.filter(r => r.expenseCategory && !newRecords.find(n => n.asin === r.asin))], action: "save" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setStatus({
        type: "success",
        text: `商品マスタに ${data.saved ?? newRecords.length}件 登録しました`,
      });
      onSuccess?.();
      setNewRecords([]);
      setSkippedCount(0);
      setFiles([]);
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateRecordCategory = (index: number, category: string) => {
    setNewRecords((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], expenseCategory: category };
      return next;
    });
  };

  const parsed = newRecords.length > 0 || allRegistered;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Amazonビジネス注文履歴CSVをアップロード（商品マスタ登録用）
      </p>

      <FileDropzone
        accept=".csv"
        multiple
        files={files}
        onFilesSelect={(newFiles) => {
          setFiles((prev) => [...prev, ...newFiles]);
          setNewRecords([]);
          setSkippedCount(0);
          setAllRegistered(false);
        }}
        onRemoveFile={(i) => {
          setFiles((prev) => prev.filter((_, idx) => idx !== i));
          setNewRecords([]);
          setSkippedCount(0);
          setAllRegistered(false);
        }}
      />

      <div className="flex gap-2">
        <ActionButton onClick={handleParse} loading={loading} disabled={files.length === 0 || parsed}>
          解析する
        </ActionButton>
        {newRecords.length > 0 && (
          <ActionButton onClick={handleSave} loading={saving} variant="primary">
            この内容で商品マスタに登録する
          </ActionButton>
        )}
      </div>

      <StatusBanner status={status} />

      {newRecords.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">ASIN</th>
                  <th className="text-left py-2 px-3 font-medium">商品名</th>
                  <th className="text-left py-2 px-3 font-medium">Amazonカテゴリ</th>
                  <th className="text-left py-2 px-3 font-medium">勘定科目</th>
                </tr>
              </thead>
              <tbody>
                {newRecords.map((rec, i) => (
                  <tr key={rec.asin} className="border-t border-gray-100">
                    <td className="py-1.5 px-3 whitespace-nowrap font-mono text-[10px]">{rec.asin}</td>
                    <td className="py-1.5 px-3 max-w-[250px] truncate" title={rec.productName}>
                      {rec.shortName}
                    </td>
                    <td className="py-1.5 px-3 whitespace-nowrap text-gray-500 text-[10px]">{rec.amazonCategory}</td>
                    <td className="py-1.5 px-3">
                      <select
                        value={rec.expenseCategory}
                        onChange={(e) => updateRecordCategory(i, e.target.value)}
                        className={`text-xs border rounded px-1.5 py-1 w-full ${
                          rec.expenseCategory
                            ? "border-green-300 bg-green-50"
                            : "border-yellow-300 bg-yellow-50"
                        }`}
                      >
                        <option value="">未分類</option>
                        {EXPENSE_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sales Tab ──────────────────────────────────────────────

function SalesTab({ onSuccess }: { onSuccess?: () => void }) {
  const [subTab, setSubTab] = useState<SalesSubTab>("ml001");

  const subTabs: { id: SalesSubTab; label: string }[] = [
    { id: "ml001", label: "会員 (ML001)" },
    { id: "pl001", label: "売上明細 (PL001)" },
    { id: "ma002", label: "月次サマリ (MA002)" },
    { id: "square", label: "Square" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              subTab === t.id
                ? "bg-white text-gray-800 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "ml001" && <ML001Section onSuccess={onSuccess} />}
      {subTab === "pl001" && <PL001Section onSuccess={onSuccess} />}
      {subTab === "ma002" && <MA002Section onSuccess={onSuccess} />}
      {subTab === "square" && <SquareSection />}
    </div>
  );
}

function ML001Section({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);

    try {
      const msgs: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", "ml001");
        formData.append("store", "");

        const res = await fetch("/api/upload/hacomono", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          msgs.push(`${file.name}: ${data.error || "エラー"}`);
          continue;
        }
        const stores = data.detectedStores?.join(", ") || data.store || "";
        msgs.push(`${stores} ${data.records}名取込（${file.name}）`);
      }
      setResults(msgs);
      setStatus({ type: "success", text: `${files.length}件のファイルを処理しました` });
      onSuccess?.();
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : "エラー" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono「メンバー一覧」CSVをアップロード（複数選択可・店舗は自動検出）
      </p>
      <FileDropzone accept=".csv" multiple files={files}
        onFilesSelect={(f) => { setFiles((prev) => [...prev, ...f]); setResults([]); }}
        onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />
      <ActionButton onClick={handleUpload} loading={loading} disabled={files.length === 0}>
        {files.length <= 1 ? "取り込む" : `${files.length}件を取り込む`}
      </ActionButton>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <p key={i} className={`text-sm ${r.includes("エラー") ? "text-red-600" : "text-green-600"}`}>{r}</p>
          ))}
        </div>
      )}

      <StatusBanner status={status} />
    </div>
  );
}

function PL001Section({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);

    try {
      const msgs: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", "pl001");
        formData.append("store", "");
        formData.append("year", "0");
        formData.append("month", "0");

        const res = await fetch("/api/upload/hacomono", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          msgs.push(`${file.name}: ${data.error || "エラー"}`);
          continue;
        }
        const stores = data.detectedStores?.join(", ") || data.store || "";
        msgs.push(`${stores} ${data.year}年${data.month}月 ${data.records}件`);
      }
      setResults(msgs);
      setStatus({ type: "success", text: `${files.length}件のファイルを処理しました` });
      onSuccess?.();
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : "エラー" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono「売上明細」PL001 CSVをアップロード（複数選択可・店舗&年月は自動検出）
      </p>
      <FileDropzone accept=".csv" multiple files={files}
        onFilesSelect={(f) => { setFiles((prev) => [...prev, ...f]); setResults([]); }}
        onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />
      <ActionButton onClick={doUpload} loading={loading} disabled={files.length === 0}>
        {files.length <= 1 ? "取り込む" : `${files.length}件を取り込む`}
      </ActionButton>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <p key={i} className={`text-sm ${r.includes("エラー") ? "text-red-600" : "text-green-600"}`}>{r}</p>
          ))}
        </div>
      )}
      <StatusBanner status={status} />
    </div>
  );
}

function MA002Section({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [store, setStore] = useState<string>(STORES[0]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);

    try {
      const msgs: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", "ma002");
        formData.append("store", store);
        formData.append("year", "0");
        formData.append("month", "0");

        const res = await fetch("/api/upload/hacomono", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          msgs.push(`${file.name}: ${data.error || "エラー"}`);
          continue;
        }
        msgs.push(`${store} ${data.records}件取込（${file.name}）`);
      }
      setResults(msgs);
      setStatus({ type: "success", text: `${files.length}件のファイルを処理しました` });
      onSuccess?.();
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : "エラー" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono「月次サマリ」MA002 CSVをアップロード（複数選択可・年月は自動検出）
      </p>
      <div className="grid grid-cols-1 gap-4">
        <StoreSelect value={store} onChange={setStore} />
      </div>
      <FileDropzone accept=".csv" multiple files={files}
        onFilesSelect={(f) => { setFiles((prev) => [...prev, ...f]); setResults([]); }}
        onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />
      <ActionButton onClick={handleUpload} loading={loading} disabled={files.length === 0}>
        {files.length <= 1 ? "取り込む" : `${files.length}件を取り込む`}
      </ActionButton>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <p key={i} className={`text-sm ${r.includes("エラー") ? "text-red-600" : "text-green-600"}`}>{r}</p>
          ))}
        </div>
      )}
      <StatusBanner status={status} />
    </div>
  );
}

function SquareSection() {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-gray-500">
        Square売上データの取込機能は準備中です。
      </p>
    </div>
  );
}

// ─── Budget Tab ─────────────────────────────────────────────

function BudgetTab({ onSuccess }: { onSuccess?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [store, setStore] = useState<string>(STORES[0]);
  const [fiscalYear, setFiscalYear] = useState(2026);
  const [period, setPeriod] = useState(9);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ count: number } | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "解析・保存中..." });
    setOverwriteWarning(null);

    try {
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("store", store);
      formData.append("fiscalYear", String(fiscalYear));
      formData.append("period", String(period));

      const res = await fetch("/api/upload/budget", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setStatus({
        type: "success",
        text: `${store} ${fiscalYear}年度 第${period}期の予算データを保存しました（${data.records}件 / ${data.categories?.length || 0}カテゴリ）`,
      });
      onSuccess?.();
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setStatus(null);

    try {
      const checkRes = await fetch(`/api/upload/budget?store=${encodeURIComponent(store)}&fiscalYear=${fiscalYear}`);
      const checkData = await checkRes.json();

      if (checkData.exists) {
        setOverwriteWarning({ count: checkData.count });
        setLoading(false);
        return;
      }
    } catch {
      // Check failed, proceed with upload anyway
    }

    await doUpload();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        予算実績対比表 CSVをアップロード（各月の予算列を取り込みます）
      </p>

      <div className="grid grid-cols-3 gap-4">
        <StoreSelect value={store} onChange={setStore} />
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            対象年度（決算年）
          </label>
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(parseInt(e.target.value))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
          >
            {Array.from({ length: new Date().getFullYear() - 2020 + 6 }, (_, i) => 2020 + i).map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            第○期
          </label>
          <select
            value={period}
            onChange={(e) => setPeriod(parseInt(e.target.value))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                第{m}期
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        {fiscalYear}年/第{period}期 = {fiscalYear - 1}年10月〜{fiscalYear}年9月
      </p>

      <FileDropzone
        accept=".csv"
        file={file}
        onFileSelect={setFile}
        onClear={() => {
          setFile(null);
          setStatus(null);
          setOverwriteWarning(null);
        }}
      />

      <ActionButton onClick={handleUpload} loading={loading} disabled={!file || !!overwriteWarning}>
        解析して保存する
      </ActionButton>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} ${fiscalYear}年度 第${period}期の予算データが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwriteWarning(null)}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />
    </div>
  );
}

// ─── Upload History ─────────────────────────────────────────

function UploadHistory() {
  const [logs, setLogs] = useState<UploadLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const INITIAL_SHOW = 10;

  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await fetch("/api/upload-logs");
        const data = await res.json();
        setLogs(data.logs || []);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchLogs();
  }, []);

  const dataTypeLabels: Record<string, string> = {
    payroll: "人件費",
    expense: "経費",
    amazon: "Amazon",
    budget: "予算",
    hacomono_ml001: "会員 (ML001)",
    hacomono_pl001: "売上明細 (PL001)",
    hacomono_ma002: "月次サマリ (MA002)",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        アップロード履歴はありません
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left py-2 px-3 font-medium">日時</th>
            <th className="text-left py-2 px-3 font-medium">実行者</th>
            <th className="text-left py-2 px-3 font-medium">種別</th>
            <th className="text-left py-2 px-3 font-medium">店舗</th>
            <th className="text-left py-2 px-3 font-medium">対象</th>
            <th className="text-left py-2 px-3 font-medium">ファイル</th>
            <th className="text-right py-2 px-3 font-medium">件数</th>
            <th className="text-left py-2 px-3 font-medium">備考</th>
          </tr>
        </thead>
        <tbody>
          {(showAll ? logs : logs.slice(0, INITIAL_SHOW)).map((log) => (
            <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="py-1.5 px-3 whitespace-nowrap">
                {new Date(log.createdAt).toLocaleString("ja-JP", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="py-1.5 px-3 whitespace-nowrap">{log.userName || "-"}</td>
              <td className="py-1.5 px-3">
                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-medium">
                  {dataTypeLabels[log.dataType] || log.dataType}
                </span>
              </td>
              <td className="py-1.5 px-3">{log.storeName || "-"}</td>
              <td className="py-1.5 px-3 whitespace-nowrap">
                {log.year && log.month ? `${log.year}/${log.month}` : "-"}
              </td>
              <td className="py-1.5 px-3 max-w-[150px] truncate" title={log.fileName || ""}>
                {log.fileName || "-"}
              </td>
              <td className="py-1.5 px-3 text-right">{log.recordCount}</td>
              <td className="py-1.5 px-3 max-w-[200px] truncate text-gray-500" title={log.note || ""}>
                {log.note || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!showAll && logs.length > INITIAL_SHOW && (
        <div className="text-center py-3 border-t border-gray-100">
          <button
            onClick={() => setShowAll(true)}
            className="text-sm text-[#567FC0] hover:underline"
          >
            さらに表示（全{logs.length}件）
          </button>
        </div>
      )}
      {showAll && logs.length > INITIAL_SHOW && (
        <div className="text-center py-3 border-t border-gray-100">
          <button
            onClick={() => setShowAll(false)}
            className="text-sm text-gray-500 hover:underline"
          >
            折りたたむ
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Upload Page ───────────────────────────────────────

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<TabId>("payroll");
  const [historyKey, setHistoryKey] = useState(0);
  const refreshHistory = () => setHistoryKey((k) => k + 1);

  const tabs: { id: TabId; label: string }[] = [
    { id: "payroll", label: "人件費" },
    { id: "expense", label: "経費" },
    { id: "sales", label: "売上" },
    { id: "budget", label: "予算" },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Upload className="text-[#567FC0]" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">アップロード</h1>
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-t-lg shadow-sm border-b border-gray-200">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 px-4 py-3 text-sm font-medium transition-colors relative
                ${
                  activeTab === tab.id
                    ? "text-[#567FC0]"
                    : "text-gray-500 hover:text-gray-700"
                }
              `}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#567FC0]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-b-lg shadow-sm p-6">
        {activeTab === "payroll" && <PayrollTab onSuccess={refreshHistory} />}
        {activeTab === "expense" && <ExpenseTab onSuccess={refreshHistory} />}
        {activeTab === "sales" && <SalesTab onSuccess={refreshHistory} />}
        {activeTab === "budget" && <BudgetTab onSuccess={refreshHistory} />}
      </div>

      {/* Upload History */}
      <div className="mt-6 bg-white rounded-lg shadow-sm">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-200">
          <Clock size={16} className="text-gray-400" />
          <h2 className="text-sm font-medium text-gray-700">アップロード履歴</h2>
        </div>
        <div className="p-4">
          <UploadHistory key={historyKey} />
        </div>
      </div>
    </div>
  );
}
