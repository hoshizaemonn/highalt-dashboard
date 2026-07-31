"use client";

import { useState, useEffect } from "react";
import { STORES } from "@/lib/constants";
import {
  FileDropzone,
  StoreSelect,
  LockedStoreField,
  ActionButton,
  StatusBanner,
  OverwriteWarning,
  StatusMessage,
} from "./SharedComponents";

/**
 * 開業からの実績累計（PL）CSV を取り込むタブ。
 * 前年比比較（人件費・消耗品費・広告宣伝費）専用のデータ源 pl_actuals に保存する。
 * PLは店舗別ファイルなので、店舗を選んでから1ファイルずつ取り込む。
 */
export function PlActualTab({
  onSuccess,
  lockedStore,
}: {
  onSuccess: () => void;
  lockedStore?: string | null;
}) {
  const [store, setStore] = useState<string>(lockedStore ?? STORES[0]);
  useEffect(() => {
    if (lockedStore) setStore(lockedStore);
  }, [lockedStore]);

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [overwrite, setOverwrite] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setOverwrite(null);
  };

  const doUpload = async () => {
    if (!file) return;
    setLoading(true);
    setStatus({ type: "info", text: "取り込み中..." });
    setOverwrite(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("store", store);
      const res = await fetch("/api/upload/pl-actual", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取り込みに失敗しました");
      setStatus({
        type: "success",
        text: `${store}：${data.recordCount}件（${data.yearRange}）を取り込みました。`,
      });
      reset();
      onSuccess();
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setLoading(false);
    }
  };

  // アップロード前に既存データの有無をチェック（上書き確認）
  const handleUploadClick = async () => {
    if (!file) {
      setStatus({ type: "error", text: "CSVファイルを選択してください" });
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("store", store);
      fd.append("dryRun", "true");
      const res = await fetch("/api/upload/pl-actual", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析に失敗しました");
      if (data.exists) {
        setOverwrite(
          `${store} の既存PLデータ（${data.existingCount}件）があります。上書きされますが、よろしいですか？`,
        );
        setLoading(false);
        return;
      }
      // 既存なし → そのまま取込
      await doUpload();
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-1">
          前年比PL（損益計算書 / 開業からの実績累計PL）
        </h3>
        <p className="text-xs text-gray-600 leading-relaxed">
          クライアント様の「予算実績対比表」の<strong>「損益計算書」シート</strong>または<strong>「開業からの実績累計（PL）」シート</strong>をCSVにして取り込みます（シート種別は自動判定）。
          前年比比較に使用します（単位は千円→自動で円換算）。
          <br />
          ・<strong>損益計算書</strong>シート：消耗品費・賃借料・減価償却費など費目ごとに正確に取り込みます（推奨）。
          ・<strong>開業からの実績累計PL</strong>シート：人件費・消耗品費・広告宣伝費の3費目を取り込みます。
          <br />
          ※ 店舗別ファイルです。<strong>店舗を選んでから、その店舗のCSVを1つずつ</strong>取り込んでください（ファイルの店舗名と選択店舗が一致しない場合はエラーになります）。
        </p>
      </div>

      <div className="max-w-xs">
        {lockedStore ? (
          <LockedStoreField storeName={lockedStore} />
        ) : (
          <StoreSelect value={store} onChange={setStore} />
        )}
      </div>

      <FileDropzone
        accept=".csv"
        file={file}
        onFileSelect={(f) => {
          setFile(f);
          setStatus(null);
          setOverwrite(null);
        }}
        onClear={reset}
      />

      <StatusBanner status={status} />

      {overwrite ? (
        <OverwriteWarning
          message={overwrite}
          loading={loading}
          onConfirm={doUpload}
          onCancel={() => setOverwrite(null)}
        />
      ) : (
        <ActionButton onClick={handleUploadClick} loading={loading} disabled={!file}>
          取り込む
        </ActionButton>
      )}
    </div>
  );
}
