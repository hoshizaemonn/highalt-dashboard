"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { STORES } from "@/lib/constants";
import {
  StatusMessage,
  FileDropzone,
  StatusBanner,
  StoreSelect,
  YearSelect,
  MonthSelect,
  ActionButton,
} from "./SharedComponents";

// ─── Types ──────────────────────────────────────────────────

type DetectedType = "ml001" | "pl001" | "ma002" | "ps001" | "unknown";

interface DetectedFile {
  file: File;
  type: DetectedType;
  // 既存データのチェック結果（dryRun 後に埋まる）
  existingCount?: number;
  detectedYear?: number | null;
  detectedMonth?: number | null;
  /** スキップ対象としてマークされているか（既存と被っている時に「除外して取込」を選んだ場合） */
  skip?: boolean;
}

const TYPE_LABEL: Record<DetectedType, string> = {
  ml001: "会員 (ML001)",
  pl001: "売上明細 (PL001)",
  ma002: "月次サマリ (MA002)",
  ps001: "商品別売上 (PS001)",
  unknown: "不明",
};

// CSV 1 行目（ヘッダー）の文字列から種別を判定する
async function detectFileType(file: File): Promise<DetectedType> {
  // 先頭 4KB だけ読めばヘッダー行は十分カバーできる
  const slice = file.slice(0, 4096);
  const buffer = await slice.arrayBuffer();
  // hacomono は Shift-JIS 出力。先頭でデコード判定する
  let text = "";
  try {
    text = new TextDecoder("shift-jis").decode(buffer);
  } catch {
    text = new TextDecoder("utf-8").decode(buffer);
  }
  // BOM 除去
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";

  if (firstLine.includes("商品コード") && firstLine.includes("商品名")) return "ps001";
  if (firstLine.includes("メンバーID")) return "ml001";
  if (firstLine.includes("対象年月") && firstLine.includes("プラン契約者数")) return "ma002";
  if (firstLine.includes("売上ID") || firstLine.includes("精算日時")) return "pl001";
  return "unknown";
}

// ─── Hacomono Bulk Upload Tab ───────────────────────────────

export function HacomonoTab({ onSuccess }: { onSuccess?: () => void }) {
  const [store, setStore] = useState<string>(STORES[0]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [files, setFiles] = useState<DetectedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [confirmStage, setConfirmStage] = useState<"idle" | "review">("idle");

  const hasPS001 = files.some((f) => f.type === "ps001");
  const hasUnknown = files.some((f) => f.type === "unknown");
  const overwriteFiles = files.filter((f) => (f.existingCount ?? 0) > 0);

  // ファイル追加時に種別を判定
  const handleFilesAdd = async (added: File[]) => {
    setStatus(null);
    setResults([]);
    setConfirmStage("idle");

    const detected: DetectedFile[] = await Promise.all(
      added.map(async (file) => ({
        file,
        type: await detectFileType(file),
      })),
    );
    setFiles((prev) => [...prev, ...detected]);
  };

  const handleRemove = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setConfirmStage("idle");
  };

  // 既存データのチェック（dryRun）
  const runDryRun = async () => {
    setChecking(true);
    const updated: DetectedFile[] = [];
    for (const df of files) {
      if (df.type === "unknown") {
        updated.push(df);
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", df.file);
        formData.append("type", df.type);
        formData.append("store", store);
        formData.append("year", String(year));
        formData.append("month", String(month));
        formData.append("dryRun", "true");
        const res = await fetch("/api/upload/hacomono", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          updated.push({ ...df, existingCount: 0 });
          continue;
        }
        const data = await res.json();
        updated.push({
          ...df,
          existingCount: data.existingCount ?? 0,
          detectedYear: data.year ?? null,
          detectedMonth: data.month ?? null,
        });
      } catch {
        updated.push({ ...df, existingCount: 0 });
      }
    }
    setFiles(updated);
    setChecking(false);
    return updated;
  };

  // 取込開始（チェック→確認→実行 の起点）
  const handleStart = async () => {
    if (files.length === 0) return;
    if (hasUnknown) {
      setStatus({
        type: "error",
        text: "種別を判別できないファイルがあります。除外してから再度実行してください。",
      });
      return;
    }
    setStatus(null);
    setResults([]);
    const updated = await runDryRun();
    const anyExisting = updated.some((f) => (f.existingCount ?? 0) > 0);
    if (anyExisting) {
      setConfirmStage("review");
      return;
    }
    await doUpload(updated);
  };

  // 実アップロード
  const doUpload = async (target: DetectedFile[]) => {
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);

    const msgs: string[] = [];
    let processed = 0;
    for (const df of target) {
      if (df.skip) {
        msgs.push(`${df.file.name}: スキップ（既存データを保持）`);
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", df.file);
        formData.append("type", df.type);
        formData.append("store", store);
        formData.append("year", String(year));
        formData.append("month", String(month));
        const res = await fetch("/api/upload/hacomono", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          msgs.push(`${df.file.name}: ${data.error || "エラー"}`);
          continue;
        }
        const lbl = TYPE_LABEL[df.type] || df.type;
        const ymStr =
          data.year && data.month ? ` ${data.year}年${data.month}月` : "";
        msgs.push(
          `${lbl}${ymStr} ${data.records}件取込（${df.file.name}）`,
        );
        processed++;
      } catch (e) {
        msgs.push(
          `${df.file.name}: ${e instanceof Error ? e.message : "エラー"}`,
        );
      }
    }
    setResults(msgs);
    setStatus({
      type: processed > 0 ? "success" : "error",
      text: `${processed}件のファイルを取込しました（全${target.length}件中）`,
    });
    setConfirmStage("idle");
    setLoading(false);
    onSuccess?.();
  };

  // 上書き確認画面でのアクション
  const confirmOverwriteAll = () => {
    doUpload(files.map((f) => ({ ...f, skip: false })));
  };

  const confirmSkipDuplicates = () => {
    doUpload(
      files.map((f) =>
        (f.existingCount ?? 0) > 0 ? { ...f, skip: true } : f,
      ),
    );
  };

  const cancelOverwrite = () => {
    setConfirmStage("idle");
    setStatus(null);
  };

  // 年月セレクタは PS001 が含まれる場合に必須として表示
  // （ML001/PL001/MA002 は CSV 内の日付から自動検出）
  const showYearMonth = hasPS001;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        hacomono の CSV
        を複数まとめてドロップできます。ファイル種別（会員 / 売上明細 / 月次サマリ /
        商品別売上）は自動で判別されます。
      </p>

      {/* Store + Year/Month selector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <StoreSelect value={store} onChange={setStore} />
        {showYearMonth && (
          <>
            <YearSelect value={year} onChange={setYear} />
            <MonthSelect value={month} onChange={setMonth} />
          </>
        )}
      </div>
      {showYearMonth && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠️ 商品別売上 (PS001) には年月情報が含まれていないため、上記の対象年月に紐付けて保存します。
        </p>
      )}

      {/* Drop zone */}
      <FileDropzone
        accept=".csv"
        multiple
        files={files.map((f) => f.file)}
        onFilesSelect={handleFilesAdd}
        onRemoveFile={handleRemove}
      />

      {/* Detected file list with type badges */}
      {files.length > 0 && (
        <div className="space-y-1.5 text-xs">
          {files.map((df, i) => (
            <div
              key={`${df.file.name}-${i}`}
              className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                    df.type === "unknown"
                      ? "bg-red-100 text-red-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {TYPE_LABEL[df.type]}
                </span>
                <span className="text-gray-700 truncate">{df.file.name}</span>
              </div>
              {df.existingCount !== undefined && df.existingCount > 0 && (
                <span className="text-amber-700 text-[11px]">
                  既存 {df.existingCount} 件
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action button (idle state) */}
      {confirmStage === "idle" && (
        <ActionButton
          onClick={handleStart}
          loading={loading || checking}
          disabled={files.length === 0 || hasUnknown}
        >
          {checking
            ? "既存データ確認中..."
            : files.length <= 1
            ? "取り込む"
            : `${files.length}件を取り込む`}
        </ActionButton>
      )}

      {/* Overwrite confirmation */}
      {confirmStage === "review" && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-3">
          <p className="text-sm text-amber-800 font-medium">
            ⚠️ 既にデータが登録されているファイルがあります。どう取込みますか？
          </p>
          <ul className="text-xs text-amber-900 space-y-1 pl-4 list-disc">
            {overwriteFiles.map((f, i) => (
              <li key={i}>
                {TYPE_LABEL[f.type]}: {f.file.name}（既存 {f.existingCount}{" "}
                件 → 上書きで置き換え）
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={confirmOverwriteAll}
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              すべて上書きして取込
            </button>
            <button
              onClick={confirmSkipDuplicates}
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm font-medium bg-white text-amber-700 border border-amber-400 hover:bg-amber-50 transition-colors disabled:opacity-50"
            >
              重複は除いて取込
            </button>
            <button
              onClick={cancelOverwrite}
              disabled={loading}
              className="px-4 py-2 rounded-md text-sm font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Per-file results */}
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <p
              key={i}
              className={`text-sm ${
                r.includes("エラー")
                  ? "text-red-600"
                  : r.includes("スキップ")
                  ? "text-gray-500"
                  : "text-green-600"
              }`}
            >
              {r}
            </p>
          ))}
        </div>
      )}

      <StatusBanner status={status} />
    </div>
  );
}
