"use client";

import { useState } from "react";

interface Props {
  onSuccess: () => void;
}

interface UploadResult {
  ok: boolean;
  message: string;
  detail?: string;
}

export function EnqueteTab({ onSuccess }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(e.target.files ?? []));
    setResults([]);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    const out: UploadResult[] = [];
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/upload/enquete", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) {
          out.push({
            ok: false,
            message: `${f.name}: 失敗`,
            detail: data?.error ?? "",
          });
        } else {
          out.push({
            ok: true,
            message: `${f.name}: ${data.records}件取込`,
            detail: `アンケート: ${(data.codes ?? []).join(", ")} / 退会スキップ: ${data.skippedWithdraw} / 会員なしスキップ: ${data.skippedNoMember}`,
          });
        }
      } catch (err) {
        out.push({
          ok: false,
          message: `${f.name}: 送信エラー`,
          detail: String(err),
        });
      }
    }
    setResults(out);
    setUploading(false);
    onSuccess();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-700 mb-1">
          アンケート回答（hacomono enquete_answer）
        </h2>
        <p className="text-xs text-gray-500">
          hacomono の「アンケート回答ダウンロード」からエクスポートしたCSVをアップロード。
          体験・入会アンケートのみ取り込み、退会アンケートは自動でスキップします。
          複数ファイル同時選択可。
        </p>
      </div>

      <div>
        <input
          type="file"
          accept=".csv"
          multiple
          onChange={handleFileChange}
          className="block text-sm text-gray-700"
        />
        {files.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            選択中: {files.length}件 ({files.map((f) => f.name).join(", ")})
          </p>
        )}
      </div>

      <button
        onClick={handleUpload}
        disabled={uploading || files.length === 0}
        className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-5 py-2 rounded text-sm font-medium disabled:opacity-50"
      >
        {uploading ? "アップロード中..." : "アップロード"}
      </button>

      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          {results.map((r, i) => (
            <div
              key={i}
              className={`p-3 rounded text-sm ${r.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}
            >
              <p className="font-medium">{r.message}</p>
              {r.detail && <p className="text-xs mt-1">{r.detail}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
