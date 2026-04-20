"use client";

import { useState } from "react";
import { STORES } from "@/lib/constants";
import {
  StatusMessage,
  FileDropzone,
  StatusBanner,
  StoreSelect,
  ActionButton,
} from "./SharedComponents";

// ─── Types ──────────────────────────────────────────────────

type SalesSubTab = "ml001" | "pl001" | "ma002" | "square";

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono「メンバー一覧」CSVをアップロード（複数選択可）
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

// ─── PL001 Section ──────────────────────────────────────────

function PL001Section({ onSuccess }: { onSuccess?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [store, setStore] = useState<string>(STORES[0]);
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono「売上明細」PL001 CSVをアップロード（複数選択可・年月は自動検出）
      </p>
      <div className="grid grid-cols-1 gap-4">
        <StoreSelect value={store} onChange={setStore} />
      </div>
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

// ─── MA002 Section ──────────────────────────────────────────

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
