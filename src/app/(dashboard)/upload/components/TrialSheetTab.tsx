"use client";

import { useState, useEffect } from "react";
import { STORES } from "@/lib/constants";
import {
  StatusMessage,
  FileDropzone,
  StatusBanner,
  StoreSelect,
  LockedStoreField,
  YearSelect,
  MonthSelect,
  OverwriteWarning,
  ActionButton,
} from "./SharedComponents";

/**
 * 体験シート（各店舗運用の Google スプレッドシート → CSV エクスポート）アップロードタブ。
 *
 * hacomono(ML001)は「最終的に入会した人」しか含まれないため、体験者数・入会率が
 * 構造的に不正確（山本様要望 2026-09-20）。各店舗の体験シートを正本として取り込み、
 * 体験者数の分母を正確にする。
 *
 * 船橋のみ列名・列順が大きく異なる専用フォーマット（実物確認済み・2026-09-20）のため、
 * 店舗選択で自動的に専用パーサーに切り替わる（サーバー側で store==="船橋" 判定）。
 */
export function TrialSheetTab({
  onSuccess,
  lockedStore,
}: {
  onSuccess?: () => void;
  lockedStore?: string | null;
}) {
  const [store, setStore] = useState<string>(lockedStore ?? STORES[0]);
  useEffect(() => {
    if (lockedStore) setStore(lockedStore);
  }, [lockedStore]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [existingCount, setExistingCount] = useState(0);
  const [confirmStage, setConfirmStage] = useState<"idle" | "review">("idle");

  const isFunabashi = store === "船橋";

  const handleFilesAdd = (added: File[]) => {
    // 1ファイルのみ（1店舗1月1ファイル運用）
    setFiles(added.slice(0, 1));
    setStatus(null);
    setResults([]);
    setConfirmStage("idle");
  };

  const handleRemove = () => {
    setFiles([]);
    setConfirmStage("idle");
  };

  const runDryRun = async (): Promise<{
    ok: boolean;
    existing: number;
    records?: number;
  }> => {
    if (files.length === 0) return { ok: false, existing: 0 };
    setChecking(true);
    setStatus(null);
    try {
      const formData = new FormData();
      formData.append("file", files[0]);
      formData.append("store", store);
      formData.append("year", String(year));
      formData.append("month", String(month));
      formData.append("dryRun", "true");
      const res = await fetch("/api/upload/trial-sheet", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "解析に失敗しました" });
        setChecking(false);
        return { ok: false, existing: 0 };
      }
      setExistingCount(data.existingCount ?? 0);
      setChecking(false);
      return { ok: true, existing: data.existingCount ?? 0, records: data.records };
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "解析に失敗しました",
      });
      setChecking(false);
      return { ok: false, existing: 0 };
    }
  };

  const handleStart = async () => {
    if (files.length === 0) return;
    setResults([]);
    const dry = await runDryRun();
    if (!dry.ok) return;
    if (dry.existing > 0) {
      setConfirmStage("review");
      return;
    }
    await doUpload();
  };

  const doUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus({ type: "info", text: "取込中..." });
    setResults([]);
    try {
      const formData = new FormData();
      formData.append("file", files[0]);
      formData.append("store", store);
      formData.append("year", String(year));
      formData.append("month", String(month));
      const res = await fetch("/api/upload/trial-sheet", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "取込に失敗しました" });
        setLoading(false);
        setConfirmStage("idle");
        return;
      }
      const s = data.summary;
      setResults([
        `体験者 ${s.trialCount}件（即日入会 ${s.immediateCount} / 後日入会 ${s.laterCount} / 入会しない ${s.noJoinCount}${
          s.pendingCount > 0 ? ` / 検討中 ${s.pendingCount}` : ""
        }）`,
        ...(data.warnings ?? []).map((w: string) => `⚠️ ${w}`),
      ]);
      setStatus({
        type: "success",
        text: `${store} ${year}年${month}月の体験シートを取り込みました（${data.records}件）`,
      });
      onSuccess?.();
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "取込に失敗しました",
      });
    }
    setConfirmStage("idle");
    setLoading(false);
  };

  const cancelOverwrite = () => {
    setConfirmStage("idle");
    setStatus(null);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        各店舗の<strong>体験シート</strong>（Google スプレッドシートを CSV
        エクスポートしたもの）をアップロードします。hacomono(ML001)は最終的に入会した人しか
        含まれないため、体験者数・入会率の正確な分母としてこちらを使います。
        列（日付・氏名・即日入会・後日入会・入会しない）は多少の表記ゆれを許容して自動判定します。
      </p>
      {isFunabashi && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠️ 船橋は専用フォーマットとして解析します。「入会」列（〇=入会/空欄=未入会）を
          優先し、即日・後日列は入会=〇の場合の内訳としてのみ使います。
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {lockedStore ? (
          <LockedStoreField storeName={lockedStore} />
        ) : (
          <StoreSelect value={store} onChange={setStore} />
        )}
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

      <FileDropzone
        accept=".csv"
        multiple
        files={files}
        onFilesSelect={handleFilesAdd}
        onRemoveFile={handleRemove}
      />

      {confirmStage === "idle" && (
        <ActionButton
          onClick={handleStart}
          loading={loading || checking}
          disabled={files.length === 0}
        >
          {checking ? "既存データ確認中..." : "取り込む"}
        </ActionButton>
      )}

      {confirmStage === "review" && (
        <OverwriteWarning
          message={`⚠️ ${store} ${year}年${month}月の体験シートは既に${existingCount}件登録されています。上書きしてよろしいですか？`}
          onConfirm={doUpload}
          onCancel={cancelOverwrite}
          loading={loading}
        />
      )}

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <p
              key={i}
              className={`text-sm ${r.startsWith("⚠️") ? "text-amber-600" : "text-gray-700"}`}
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
