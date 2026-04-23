"use client";

import { useState } from "react";
import { STORES } from "@/lib/constants";
import {
  StatusMessage,
  FileDropzone,
  StatusBanner,
  StoreSelect,
  OverwriteWarning,
  ActionButton,
} from "./SharedComponents";

// ─── Types ──────────────────────────────────────────────────

type SalesSubTab = "ml001" | "pl001" | "ma002" | "square";

interface OverwriteCheck {
  totalExisting: number;
  details: string[];
}

// 各ファイルについて dryRun で既存件数を取得し、合計を返す。
// 1件以上の既存データがあれば警告を出す。
async function checkHacomonoOverwrite(
  type: "ml001" | "pl001" | "ma002",
  files: File[],
  store: string,
): Promise<OverwriteCheck> {
  let total = 0;
  const details: string[] = [];
  for (const file of files) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      formData.append("store", store);
      formData.append("year", "0");
      formData.append("month", "0");
      formData.append("dryRun", "true");
      const res = await fetch("/api/upload/hacomono", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.exists && data.existingCount > 0) {
        total += data.existingCount;
        if (type === "ml001") {
          details.push(`${file.name}: ${store} 会員データ ${data.existingCount}件`);
        } else if (type === "pl001") {
          details.push(
            `${file.name}: ${store} ${data.year}年${data.month}月 売上明細 ${data.existingCount}件`,
          );
        } else {
          details.push(
            `${file.name}: ${store} ${data.periodCount ?? 1}ヶ月分 月次サマリ ${data.existingCount}件`,
          );
        }
      }
    } catch {
      // Ignore check failures; user can still upload
    }
  }
  return { totalExisting: total, details };
}

// ─── Sales Tab ──────────────────────────────────────────────

export function SalesTab({ onSuccess }: { onSuccess?: () => void }) {
  const [subTab, setSubTab] = useState<SalesSubTab>("ml001");

  const subTabs: { id: SalesSubTab; label: string }[] = [
    { id: "ml001", label: "会員 (ML001)" },
    { id: "pl001", label: "売上明細 (PL001)" },
    { id: "ma002", label: "月次サマリ (MA002)" },
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

// ─── ML001 Section ──────────────────────────────────────────

function ML001Section({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [store, setStore] = useState<string>(STORES[0]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState<OverwriteCheck | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);
    setOverwrite(null);

    try {
      const msgs: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", "ml001");
        formData.append("store", store);

        const res = await fetch("/api/upload/hacomono", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          msgs.push(`${file.name}: ${data.error || "エラー"}`);
          continue;
        }
        msgs.push(`${store} ${data.records}名取込（${file.name}）`);
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

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      const check = await checkHacomonoOverwrite("ml001", files, store);
      if (check.totalExisting > 0) {
        setOverwrite(check);
        setLoading(false);
        return;
      }
    } catch {
      // pre-check failure はそのまま通常アップロードに進める
    }
    await doUpload();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono「メンバー一覧」CSVをアップロード（複数選択可）
      </p>
      <div className="grid grid-cols-1 gap-4">
        <StoreSelect value={store} onChange={setStore} />
      </div>
      <FileDropzone accept=".csv" multiple files={files}
        onFilesSelect={(f) => { setFiles((prev) => [...prev, ...f]); setResults([]); setOverwrite(null); }}
        onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />
      <ActionButton onClick={handleUpload} loading={loading} disabled={files.length === 0 || !!overwrite}>
        {files.length <= 1 ? "取り込む" : `${files.length}件を取り込む`}
      </ActionButton>
      {overwrite && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} の会員データが既に ${overwrite.totalExisting}件 登録されています。ML001 は店舗単位で全件置き換えになります。上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwrite(null)}
          loading={loading}
        />
      )}
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

// ─── PL001 Section ──────────────────────────────────────────

function PL001Section({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [store, setStore] = useState<string>(STORES[0]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState<OverwriteCheck | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);
    setOverwrite(null);

    try {
      const msgs: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", "pl001");
        formData.append("store", store);
        formData.append("year", "0");
        formData.append("month", "0");

        const res = await fetch("/api/upload/hacomono", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          msgs.push(`${file.name}: ${data.error || "エラー"}`);
          continue;
        }
        msgs.push(`${store} ${data.year}年${data.month}月 ${data.records}件`);
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

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      const check = await checkHacomonoOverwrite("pl001", files, store);
      if (check.totalExisting > 0) {
        setOverwrite(check);
        setLoading(false);
        return;
      }
    } catch {
      // pre-check failure はそのまま通常アップロードに進める
    }
    await doUpload();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono「売上明細」PL001 CSVをアップロード（複数選択可・年月は自動検出）
      </p>
      <div className="grid grid-cols-1 gap-4">
        <StoreSelect value={store} onChange={setStore} />
      </div>
      <FileDropzone accept=".csv" multiple files={files}
        onFilesSelect={(f) => { setFiles((prev) => [...prev, ...f]); setResults([]); setOverwrite(null); }}
        onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />
      <ActionButton onClick={handleUpload} loading={loading} disabled={files.length === 0 || !!overwrite}>
        {files.length <= 1 ? "取り込む" : `${files.length}件を取り込む`}
      </ActionButton>
      {overwrite && (
        <OverwriteWarning
          message={`\u26A0\uFE0F 既存の売上明細 ${overwrite.totalExisting}件 が上書きされます。\n${overwrite.details.join("\n")}\n\n上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwrite(null)}
          loading={loading}
        />
      )}
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

// ─── MA002 Section ──────────────────────────────────────────

function MA002Section({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [store, setStore] = useState<string>(STORES[0]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState<OverwriteCheck | null>(null);

  const doUpload = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);
    setOverwrite(null);

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

  const handleUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      const check = await checkHacomonoOverwrite("ma002", files, store);
      if (check.totalExisting > 0) {
        setOverwrite(check);
        setLoading(false);
        return;
      }
    } catch {
      // pre-check failure はそのまま通常アップロードに進める
    }
    await doUpload();
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
        onFilesSelect={(f) => { setFiles((prev) => [...prev, ...f]); setResults([]); setOverwrite(null); }}
        onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />
      <ActionButton onClick={handleUpload} loading={loading} disabled={files.length === 0 || !!overwrite}>
        {files.length <= 1 ? "取り込む" : `${files.length}件を取り込む`}
      </ActionButton>
      {overwrite && (
        <OverwriteWarning
          message={`\u26A0\uFE0F 既存の月次サマリ ${overwrite.totalExisting}件 が上書きされます。\n${overwrite.details.join("\n")}\n\n上書きしますか？`}
          onConfirm={doUpload}
          onCancel={() => setOverwrite(null)}
          loading={loading}
        />
      )}
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

// ─── Square Section ─────────────────────────────────────────

function SquareSection() {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-gray-500">
        Square売上データの取込機能は準備中です。
      </p>
    </div>
  );
}
