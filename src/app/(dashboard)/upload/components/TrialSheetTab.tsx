"use client";

import { useState, useEffect } from "react";
import { STORES } from "@/lib/constants";
import {
  detectYearMonthFromTrialSheetFilename,
  detectStoreFromTrialSheetFilename,
} from "@/lib/trial-sheet-parse";
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
  // ファイル名から自動検出した店舗・年月（星崎さん要望 2026-09-20）。
  // あくまで各セレクタの初期値を埋めるだけで、選択欄は常に編集可能なまま残す
  // （品質ゲート: 日付・店舗の取り違え事故が過去複数あるため、無人で確定させず
  // 目視確認を必須にする）。
  const [autoDetectedNote, setAutoDetectedNote] = useState<string | null>(null);

  const isFunabashi = store === "船橋";

  // 「ファイルが選ばれていない」状態の初期値。ファイル差し替え時に検出できなかった
  // 項目をこれにリセットするために使う（前のファイルの検出結果を引きずらないため。
  // 星崎さん実機テストで発覚: 新しいファイルの店舗名が検出できないと、前のファイルで
  // 検出済みの店舗が残ったまま新ファイルに紐づき、誤った店舗に取り込まれるリスクがあった）。
  const defaultStore = lockedStore ?? STORES[0];
  const defaultYear = new Date().getFullYear();
  const defaultMonth = new Date().getMonth() + 1;

  const handleFilesAdd = (added: File[]) => {
    // 1ファイルのみ（1店舗1月1ファイル運用）
    const target = added.slice(0, 1);
    setFiles(target);
    setStatus(null);
    setResults([]);
    setConfirmStage("idle");
    setAutoDetectedNote(null);

    const file = target[0];
    if (!file) return;

    const detectedParts: string[] = [];

    // 店舗（lockedStoreがある店長ログイン時は自店舗固定なので自動判定しない）。
    // 検出できた場合はその値、できなかった場合は必ずデフォルトに戻す
    // （前のファイルで検出した値をそのまま残さない）。
    if (!lockedStore) {
      const detectedStore = detectStoreFromTrialSheetFilename(file.name);
      setStore(detectedStore ?? defaultStore);
      if (detectedStore) detectedParts.push(`店舗=${detectedStore}`);
    }

    // 年月も同様に、検出できなければ現在年月にリセットする。
    const detectedYm = detectYearMonthFromTrialSheetFilename(file.name);
    setYear(detectedYm?.year ?? defaultYear);
    setMonth(detectedYm?.month ?? defaultMonth);
    if (detectedYm) detectedParts.push(`${detectedYm.year}年${detectedYm.month}月`);

    if (detectedParts.length > 0) {
      setAutoDetectedNote(
        `ファイル名「${file.name}」から ${detectedParts.join(" / ")} を自動検出して入力しました。内容をご確認のうえ、違う場合は下の項目を修正してください。`,
      );
    } else {
      setAutoDetectedNote(
        `ファイル名「${file.name}」からは店舗・年月を自動検出できませんでした。下の項目を手動で選択してください。`,
      );
    }
  };

  const handleRemove = () => {
    setFiles([]);
    setConfirmStage("idle");
    setAutoDetectedNote(null);
  };

  // アップロード完了後、フォームを初期状態に戻す（星崎さん実機テストで発覚:
  // アップロード後も前回の店舗・年月・ファイルが残ったままで、次のアップロードと
  // 混同しやすかった）。結果メッセージ(results/status)は完了報告として残す。
  const resetFormAfterUpload = () => {
    setFiles([]);
    setStore(defaultStore);
    setYear(defaultYear);
    setMonth(defaultMonth);
    setAutoDetectedNote(null);
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
      // 完了メッセージ(status/results)は残したまま、フォーム側だけ初期状態に戻す
      // （前回の店舗・年月・ファイルが残ったまま次のアップロードと混同しないように）。
      resetFormAfterUpload();
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
          <StoreSelect
            value={store}
            onChange={(v) => {
              setStore(v);
              setAutoDetectedNote(null);
            }}
          />
        )}
        <YearSelect
          value={year}
          onChange={(v) => {
            setYear(v);
            setAutoDetectedNote(null);
          }}
        />
        <MonthSelect
          value={month}
          onChange={(v) => {
            setMonth(v);
            setAutoDetectedNote(null);
          }}
        />
      </div>

      {autoDetectedNote && (
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
          ℹ️ {autoDetectedNote}
        </p>
      )}

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
