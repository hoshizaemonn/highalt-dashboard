"use client";

import { useState, useCallback, useRef } from "react";
import {
  Upload,
  FileUp,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { STORES } from "@/lib/constants";

// ─── Types ──────────────────────────────────────────────────

export interface StatusMessage {
  type: "success" | "error" | "info";
  text: string;
}

export interface UploadLogEntry {
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

// ─── File Dropzone Component ────────────────────────────────

export function FileDropzone({
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

export function StatusBanner({ status }: { status: StatusMessage | null }) {
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

export function StoreSelect({
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

export function YearSelect({
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

export function MonthSelect({
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

export function OverwriteWarning({
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

export function ActionButton({
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

// ─── Utility Functions ──────────────────────────────────────

export function detectYearMonthFromFilename(filename: string): { year?: number; month?: number } {
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
