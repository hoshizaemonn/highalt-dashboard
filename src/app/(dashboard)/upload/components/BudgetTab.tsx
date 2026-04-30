"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { STORES } from "@/lib/constants";
import {
  StatusMessage,
  UploadLogEntry,
  FileDropzone,
  StatusBanner,
  StoreSelect,
  LockedStoreField,
  OverwriteWarning,
  ActionButton,
} from "./SharedComponents";

const formatYen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

// ─── Budget Tab ─────────────────────────────────────────────

export function BudgetTab({
  onSuccess,
  lockedStore,
}: {
  onSuccess?: () => void;
  lockedStore?: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [store, setStore] = useState<string>(lockedStore ?? STORES[0]);
  useEffect(() => {
    if (lockedStore) setStore(lockedStore);
  }, [lockedStore]);
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
        {lockedStore ? (
          <LockedStoreField storeName={lockedStore} />
        ) : (
          <StoreSelect value={store} onChange={setStore} />
        )}
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

      <UnitPriceBudgetForm lockedStore={lockedStore} />
    </div>
  );
}

// ─── Unit Price Budget Form ─────────────────────────────────

function UnitPriceBudgetForm({
  lockedStore,
}: {
  lockedStore?: string | null;
}) {
  const [store, setStore] = useState<string>(lockedStore ?? STORES[0]);
  useEffect(() => {
    if (lockedStore) setStore(lockedStore);
  }, [lockedStore]);
  const [fiscalYear, setFiscalYear] = useState(2026);
  const [amount, setAmount] = useState<string>("");
  const [initialAmount, setInitialAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    setStatus(null);
    setOverwriteWarning(null);
    fetch(`/api/budget/unit-price?store=${encodeURIComponent(store)}&fiscalYear=${fiscalYear}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const amounts: number[] = (data.months || []).map((m: { amount: number }) => m.amount);
        const nonZero = amounts.filter((a) => a > 0);
        // If all months share the same value, show it; otherwise show "" (mixed)
        const consistent = nonZero.length > 0 && nonZero.every((a) => a === nonZero[0]);
        const shown = consistent ? nonZero[0] : 0;
        setInitialAmount(shown);
        setAmount(shown > 0 ? String(shown) : "");
      })
      .catch(() => {
        if (!cancelled) setAmount("");
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => { cancelled = true; };
  }, [store, fiscalYear]);

  const parsed = Number(amount);
  const canSave = !loading && !fetching && amount !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed !== initialAmount;

  const doSave = async () => {
    setOverwriteWarning(null);
    setLoading(true);
    setStatus({ type: "info", text: "保存中..." });
    try {
      const res = await fetch("/api/budget/unit-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, fiscalYear, amount: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }
      setInitialAmount(parsed);
      setStatus({
        type: "success",
        text: `${store} ${fiscalYear}年度の客単価予算を保存しました（全12ヶ月に適用）`,
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

  const handleSave = () => {
    // 既存値がある場合は上書き確認ダイアログを表示する
    if (initialAmount > 0 && initialAmount !== parsed) {
      setOverwriteWarning({ from: initialAmount, to: parsed });
      return;
    }
    void doSave();
  };

  return (
    <div className="mt-8 pt-6 border-t space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-700">客単価予算（月別）</p>
        <p className="text-xs text-gray-500 mt-1">
          予算実績対比表CSVには含まれないKPIのため、単独で入力します。入力値は対象年度の全12ヶ月に同額で適用され、予算実績対比表の再アップロード時も保持されます。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {lockedStore ? (
          <LockedStoreField storeName={lockedStore} />
        ) : (
          <StoreSelect value={store} onChange={setStore} />
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">対象年度（決算年）</label>
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(parseInt(e.target.value))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
          >
            {Array.from({ length: new Date().getFullYear() - 2020 + 6 }, (_, i) => 2020 + i).map((y) => (
              <option key={y} value={y}>{y}年度</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">客単価予算（円）</label>
          <div className="relative">
            <input
              type="number"
              min={0}
              step={100}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={fetching ? "読み込み中..." : "例: 15000"}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]"
              disabled={fetching}
            />
            {fetching && (
              <Loader2 size={14} className="animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>
        </div>
      </div>

      <ActionButton onClick={handleSave} loading={loading} disabled={!canSave || !!overwriteWarning}>
        客単価予算を保存
      </ActionButton>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} ${fiscalYear}年度の客単価予算は既に ${formatYen(overwriteWarning.from)} で登録されています。${formatYen(overwriteWarning.to)} で上書きしますか？（全12ヶ月に同額で適用されます）`}
          onConfirm={doSave}
          onCancel={() => setOverwriteWarning(null)}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />
    </div>
  );
}

// ─── Upload History ─────────────────────────────────────────

/**
 * 開いているタブで関連する dataType だけに絞り込むためのマッピング。
 * filterTab を渡さなければ全件表示。
 */
const TAB_DATATYPES: Record<string, string[]> = {
  hacomono: ["hacomono_ml001", "hacomono_pl001", "hacomono_ma002", "hacomono_ps001"],
  payroll: ["payroll"],
  expense: ["expense", "amazon"],
  budget: ["budget"],
};

export function UploadHistory({ filterTab }: { filterTab?: string }) {
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
    hacomono_ps001: "商品別売上 (PS001)",
  };

  // 現在開いているタブに応じてフィルタ。タブ未指定なら全件。
  const filteredLogs = filterTab && TAB_DATATYPES[filterTab]
    ? logs.filter((log) => TAB_DATATYPES[filterTab].includes(log.dataType))
    : logs;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (filteredLogs.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        {filterTab ? "このタブのアップロード履歴はありません" : "アップロード履歴はありません"}
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
          {(showAll ? filteredLogs : filteredLogs.slice(0, INITIAL_SHOW)).map((log) => (
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
      {!showAll && filteredLogs.length > INITIAL_SHOW && (
        <div className="text-center py-3 border-t border-gray-100">
          <button
            onClick={() => setShowAll(true)}
            className="text-sm text-[#567FC0] hover:underline"
          >
            さらに表示（全{filteredLogs.length}件）
          </button>
        </div>
      )}
      {showAll && filteredLogs.length > INITIAL_SHOW && (
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
