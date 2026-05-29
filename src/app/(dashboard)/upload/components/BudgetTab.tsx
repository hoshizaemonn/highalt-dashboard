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
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  // 取込前の確認（同店舗・同年度の既存予算は置き換わるため）
  const handleUpload = () => {
    if (files.length === 0) return;
    setConfirming(true);
  };

  const doUpload = async () => {
    if (files.length === 0) return;
    setConfirming(false);
    setLoading(true);
    setStatus({ type: "info", text: "解析・保存中..." });
    setResults([]);

    const msgs: string[] = [];
    let ok = 0;
    for (const f of files) {
      try {
        // 判別はサーバー側に一本化（クライアントの文字コード誤判定を避ける）。
        // /api/upload/budget が中身を見て 予算実績対比表 / 販促報告 を自動振り分け。
        // 店舗・年度・期はファイル名からサーバーが自動判別するので送らない
        const formData = new FormData();
        formData.append("file", f);

        const res = await fetch("/api/upload/budget", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          msgs.push(`${f.name}: ${data.error || "エラー"}`);
          continue;
        }
        // サーバーがファイル名から判別した店舗・年度（手動選択と違っていてもこちらを採用）
        const dst = data.store ? `${data.store} ` : "";
        const dy = data.fiscalYear ? `${data.fiscalYear}年度 ` : "";
        if (data.detected === "promotion") {
          msgs.push(
            `${f.name}: ${dst}${dy}販促報告KPI予算 ${data.records}件（${(data.categories || []).join("・")}）`,
          );
        } else {
          msgs.push(
            `${f.name}: ${dst}${dy}予算実績対比表 ${data.records}件 / ${data.categories?.length || 0}カテゴリ`,
          );
        }
        ok++;
      } catch (e) {
        msgs.push(`${f.name}: ${e instanceof Error ? e.message : "エラー"}`);
      }
    }
    setResults(msgs);
    setStatus({
      type: ok > 0 ? "success" : "error",
      text: `${ok}件のCSVを保存しました（全${files.length}件中）`,
    });
    setLoading(false);
    if (ok > 0) onSuccess?.();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        予算CSVをアップロード（複数まとめて可）。
        <strong>予算実績対比表</strong>（売上・経費）と
        <strong>販促報告</strong>（体験者数・入会数・退会数のKPI）を自動判別して取り込みます。
        <strong>店舗・年度・期はファイル名から自動判別</strong>するので、選択は不要です
        （例: <code>2026_9期…（東日本橋スタジオ）.csv</code>）。複数店舗をまとめてドロップでき、
        同じ年度の予算は再アップロードで置き換わります。
      </p>

      <FileDropzone
        accept=".csv"
        multiple
        files={files}
        onFilesSelect={(added) => {
          setFiles((prev) => [...prev, ...added]);
          setStatus(null);
          setResults([]);
        }}
        onRemoveFile={(idx) => setFiles((prev) => prev.filter((_, i) => i !== idx))}
      />

      {!confirming && (
        <ActionButton onClick={handleUpload} loading={loading} disabled={files.length === 0}>
          {files.length <= 1 ? "解析して保存する" : `${files.length}件を解析して保存`}
        </ActionButton>
      )}

      {confirming && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-3">
          <p className="text-sm text-amber-800 font-medium">
            ⚠️ {files.length}件のCSVを取り込みます。
            同じ店舗・同じ年度の既存予算は<strong>置き換え</strong>られます。よろしいですか？
          </p>
          <div className="flex gap-2">
            <button
              onClick={doUpload}
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            >
              取り込む（上書き）
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <p
              key={i}
              className={`text-sm ${r.includes("エラー") ? "text-red-600" : "text-green-600"}`}
            >
              {r}
            </p>
          ))}
        </div>
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
  hacomono: [
    "hacomono_ml001",
    "hacomono_pl001",
    "hacomono_ma002",
    "hacomono_ps001",
    "hacomono_enquete_answer",
  ],
  payroll: ["payroll"],
  // 旧 expense タブ向けの互換マッピング（amazon-expense / paypay-expense に分割後も両方を見せる）
  expense: ["expense", "amazon"],
  "amazon-expense": ["amazon"],
  "paypay-expense": ["expense"],
  budget: ["budget", "promotion_budget"],
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
    promotion_budget: "KPI予算(販促報告)",
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
