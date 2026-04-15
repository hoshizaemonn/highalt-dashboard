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
import { STORES } from "@/lib/constants";

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
}: {
  accept: string;
  onFileSelect: (file: File) => void;
  file: File | null;
  onClear: () => void;
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
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) onFileSelect(droppedFile);
    },
    [onFileSelect],
  );

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) onFileSelect(selected);
  };

  if (file) {
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
        onChange={handleChange}
        className="hidden"
      />
      <Upload size={32} className="mx-auto text-gray-400 mb-2" />
      <p className="text-sm text-gray-600">
        ファイルをドラッグ&ドロップ、またはクリックして選択
      </p>
      <p className="text-xs text-gray-400 mt-1">{accept}</p>
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
        {[2024, 2025, 2026, 2027].map((y) => (
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

function PayrollTab({ onSuccess }: { onSuccess?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [autoDetected, setAutoDetected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [result, setResult] = useState<{
    records: number;
    unresolved: { employeeId: string; employeeName: string; contractType: string; grossTotal: number }[];
  } | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ count: number } | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "解析・保存中..." });
    setResult(null);
    setOverwriteWarning(null);

    try {
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("year", String(year));
      formData.append("month", String(month));

      const res = await fetch("/api/upload/payroll", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setResult(data);
      setStatus({
        type: "success",
        text: `${year}年${month}月の人件費データを保存しました（${data.records}件）${data.unresolved.length > 0 ? `\n未登録従業員: ${data.unresolved.length}名` : ""}`,
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
    setResult(null);

    try {
      const checkRes = await fetch(`/api/upload/payroll?year=${year}&month=${month}`);
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
        クラウド給与から出力した支給控除一覧表（CSV）をアップロード
      </p>

      <div className="grid grid-cols-2 gap-4">
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

      <FileDropzone
        accept=".csv,.xlsx,.xls"
        file={file}
        onFileSelect={(f) => {
          setFile(f);
          if (f) {
            const detected = detectYearMonthFromFilename(f.name);
            if (detected.year) { setYear(detected.year); setAutoDetected(true); }
            if (detected.month) { setMonth(detected.month); setAutoDetected(true); }
          }
        }}
        onClear={() => {
          setFile(null);
          setResult(null);
          setStatus(null);
          setAutoDetected(false);
        }}
      />
      {autoDetected && file && (
        <p className="text-sm text-green-600">
          ファイル名から <strong>{year}年{month}月</strong> を自動検出しました
        </p>
      )}

      <div className="flex gap-2">
        <ActionButton onClick={handleUpload} loading={loading} disabled={!file || !!overwriteWarning}>
          解析して保存する
        </ActionButton>
      </div>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${year}年${month}月の人件費データが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwriteWarning(null)}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />

      {result && result.unresolved.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-yellow-800 mb-2">
            店舗未登録の従業員 ({result.unresolved.length}名)
          </h4>
          <p className="text-xs text-yellow-600 mb-3">
            設定画面から店舗オーバーライドを登録してから再アップロードしてください。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-yellow-200">
                  <th className="text-left py-1 px-2">ID</th>
                  <th className="text-left py-1 px-2">氏名</th>
                  <th className="text-left py-1 px-2">雇用形態</th>
                  <th className="text-right py-1 px-2">総支給額</th>
                </tr>
              </thead>
              <tbody>
                {result.unresolved.map((emp) => (
                  <tr key={emp.employeeId} className="border-b border-yellow-100">
                    <td className="py-1 px-2">{emp.employeeId}</td>
                    <td className="py-1 px-2">{emp.employeeName}</td>
                    <td className="py-1 px-2">{emp.contractType}</td>
                    <td className="py-1 px-2 text-right">
                      {emp.grossTotal.toLocaleString()}円
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

      setStatus({
        type: "success",
        text: `${store} ${year}年${month}月の経費データを保存しました\n${data.records}件（分類済み ${data.classified}件 / 未分類 ${data.unclassified}件）`,
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
      const checkRes = await fetch(`/api/upload/expense?year=${year}&month=${month}&store=${encodeURIComponent(store)}`);
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
        }}
      />
      {autoDetected && file && (
        <p className="text-sm text-green-600">
          ファイル名から <strong>{year}年{month}月</strong> を自動検出しました
        </p>
      )}

      <ActionButton onClick={handleUpload} loading={loading} disabled={!file || !!overwriteWarning}>
        解析して保存する
      </ActionButton>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} ${year}年${month}月の経費データが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwriteWarning(null)}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />
    </div>
  );
}

function AmazonExpenseSection({ onSuccess }: { onSuccess?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [parsedRecords, setParsedRecords] = useState<
    {
      orderDate: string;
      orderId: string;
      storeName: string;
      productName: string;
      shortName: string;
      asin: string;
      amazonCategory: string;
      expenseCategory: string;
      amount: number;
      quantity: number;
      accountUser: string;
      deliveryAddress: string;
      paymentDate: string;
      orderTotal: number;
      taxAmount: number;
      taxRate: string;
      invoiceNumber: string;
    }[]
  >([]);

  const handleParse = async () => {
    if (!file) return;
    setLoading(true);
    setStatus({ type: "info", text: "解析中..." });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload/amazon", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setParsedRecords(data.records);
      setStatus({
        type: "success",
        text: `${data.records.length}件のAmazon注文を検出しました（自動分類: ${data.autoClassified}件）`,
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

  const handleSave = async () => {
    if (parsedRecords.length === 0) return;
    setSaving(true);
    setStatus({ type: "info", text: "保存中..." });

    try {
      const res = await fetch("/api/upload/amazon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: parsedRecords }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setStatus({
        type: "success",
        text: `${data.saved}件のAmazon注文データを保存しました`,
      });
      onSuccess?.();
      setParsedRecords([]);
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
      next[index] = { ...next[index], expenseCategory: category };
      return next;
    });
  };

  const EXPENSE_CATS = [
    "消耗品費",
    "広告宣伝費",
    "委託料",
    "通信費",
    "賃借料",
    "支払手数料",
    "雑費",
    "その他",
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Amazonビジネス注文履歴CSVをアップロード
      </p>

      <FileDropzone
        accept=".csv"
        file={file}
        onFileSelect={setFile}
        onClear={() => {
          setFile(null);
          setStatus(null);
          setParsedRecords([]);
        }}
      />

      <div className="flex gap-2">
        <ActionButton onClick={handleParse} loading={loading} disabled={!file}>
          解析する
        </ActionButton>
        {parsedRecords.length > 0 && (
          <ActionButton onClick={handleSave} loading={saving} variant="primary">
            保存する
          </ActionButton>
        )}
      </div>

      <StatusBanner status={status} />

      {parsedRecords.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-2 px-3 font-medium">注文日</th>
                <th className="text-left py-2 px-3 font-medium">店舗</th>
                <th className="text-left py-2 px-3 font-medium">商品名</th>
                <th className="text-left py-2 px-3 font-medium">ASIN</th>
                <th className="text-right py-2 px-3 font-medium">金額</th>
                <th className="text-center py-2 px-3 font-medium">数量</th>
                <th className="text-left py-2 px-3 font-medium">勘定科目</th>
              </tr>
            </thead>
            <tbody>
              {parsedRecords.map((rec, i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="py-1.5 px-3 whitespace-nowrap">{rec.orderDate}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap">{rec.storeName || "未検出"}</td>
                  <td className="py-1.5 px-3 max-w-[200px] truncate" title={rec.productName}>
                    {rec.shortName}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap font-mono">{rec.asin}</td>
                  <td className="py-1.5 px-3 text-right whitespace-nowrap">
                    {rec.amount.toLocaleString()}円
                  </td>
                  <td className="py-1.5 px-3 text-center">{rec.quantity}</td>
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
                      {EXPENSE_CATS.map((cat) => (
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
  const [file, setFile] = useState<File | null>(null);
  const [store, setStore] = useState<string>(STORES[0]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ count: number } | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setOverwriteWarning(null);

    try {
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("type", "ml001");
      formData.append("store", store);

      const res = await fetch("/api/upload/hacomono", {
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
        text: `${store} の会員データを取り込みました（${data.records}名）`,
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
      const checkRes = await fetch(`/api/upload/hacomono?type=ml001&store=${encodeURIComponent(store)}`);
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
        hacomono「メンバー一覧」CSVをアップロード -- 常に最新データに上書きされます
      </p>

      <div className="grid grid-cols-1 gap-4">
        <StoreSelect value={store} onChange={setStore} />
      </div>

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
        取り込む
      </ActionButton>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store}の会員データが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwriteWarning(null)}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />
    </div>
  );
}

function PL001Section({ onSuccess }: { onSuccess?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [store, setStore] = useState<string>(STORES[0]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ count: number } | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setOverwriteWarning(null);

    try {
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("type", "pl001");
      formData.append("store", store);
      formData.append("year", String(year));
      formData.append("month", String(month));

      const res = await fetch("/api/upload/hacomono", {
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
        text: `${store} ${data.year}年${data.month}月の売上明細を取り込みました（${data.records}件）`,
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
      const checkRes = await fetch(`/api/upload/hacomono?type=pl001&store=${encodeURIComponent(store)}&year=${year}&month=${month}`);
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
        hacomono「売上明細」PL001 CSVをアップロード
      </p>

      <div className="grid grid-cols-3 gap-4">
        <StoreSelect value={store} onChange={setStore} />
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

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
        取り込む
      </ActionButton>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} ${year}年${month}月の売上明細データが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwriteWarning(null)}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />
    </div>
  );
}

function MA002Section({ onSuccess }: { onSuccess?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [store, setStore] = useState<string>(STORES[0]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ count: number } | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setOverwriteWarning(null);

    try {
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("type", "ma002");
      formData.append("store", store);
      formData.append("year", String(year));
      formData.append("month", String(month));

      const res = await fetch("/api/upload/hacomono", {
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
        text: `${store} の月次サマリを取り込みました（${data.records}件）`,
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
      const checkRes = await fetch(`/api/upload/hacomono?type=ma002&store=${encodeURIComponent(store)}&year=${year}&month=${month}`);
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
        hacomono「月次サマリ」MA002 CSVをアップロード（複数月データ対応）
      </p>

      <div className="grid grid-cols-3 gap-4">
        <StoreSelect value={store} onChange={setStore} />
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

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
        取り込む
      </ActionButton>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} ${year}年${month}月の月次サマリデータが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwriteWarning(null)}
          loading={loading}
        />
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
        text: `${store} ${fiscalYear}年度の予算データを保存しました（${data.records}件 / ${data.categories?.length || 0}カテゴリ）`,
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
            会計年度
          </label>
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(parseInt(e.target.value))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
          >
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            期首月
          </label>
          <select
            value={period}
            onChange={(e) => setPeriod(parseInt(e.target.value))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>
      </div>

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
          message={`\u26A0\uFE0F ${store} ${fiscalYear}年度の予算データが既に${overwriteWarning.count}件あります。上書きしますか？`}
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
