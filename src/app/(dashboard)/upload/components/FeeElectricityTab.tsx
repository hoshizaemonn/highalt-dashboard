"use client";

import { useState } from "react";
import {
  FileDropzone,
  YearSelect,
  MonthSelect,
  ActionButton,
  StatusBanner,
  StatusMessage,
} from "./SharedComponents";

/**
 * 決済手数料（PAY.JP + fincode 合算）・電気料（シンエナジー）の一括取込タブ（admin限定）。
 * ファイルは1つのドロップゾーンにまとめて入れ、サーバー側が中身から
 * PAY.JP / fincode / シンエナジー を自動判別する。
 */
interface PreviewRow {
  store: string;
  category: string;
  amount: number;
  existing: number | null;
  after: number;
  mode: "add" | "update";
}
interface Detected {
  name: string;
  type: string;
}

const now = new Date();

export function FeeElectricityTab({ onSuccess }: { onSuccess: () => void }) {
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 前月運用が多いが既定は当月
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [detected, setDetected] = useState<Detected[]>([]);

  // 同名ファイルの重複を避けつつ追加
  const addFiles = (incoming: File[]) => {
    setPreview(null);
    setFiles((prev) => {
      const map = new Map(prev.map((f) => [f.name, f]));
      for (const f of incoming) map.set(f.name, f);
      return [...map.values()];
    });
  };
  const removeFile = (idx: number) => {
    setPreview(null);
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const buildForm = (dryRun: boolean) => {
    const fd = new FormData();
    fd.append("year", String(year));
    fd.append("month", String(month));
    if (dryRun) fd.append("dryRun", "true");
    for (const f of files) fd.append("files", f);
    return fd;
  };

  const handlePreview = async () => {
    if (files.length === 0) {
      setStatus({ type: "error", text: "ファイルを1つ以上選択してください" });
      return;
    }
    setLoading(true);
    setStatus({ type: "info", text: "解析中..." });
    setPreview(null);
    try {
      const res = await fetch("/api/upload/fee-electricity", {
        method: "POST",
        body: buildForm(true),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析に失敗しました");
      setPreview(data.preview as PreviewRow[]);
      setDetected((data.detected as Detected[]) ?? []);
      setStatus(null);
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : "エラーが発生しました" });
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "取り込み中..." });
    try {
      const res = await fetch("/api/upload/fee-electricity", {
        method: "POST",
        body: buildForm(false),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取り込みに失敗しました");
      setStatus({
        type: "success",
        text: `${year}年${month}月：${data.recordCount}件を取り込みました。`,
      });
      setPreview(null);
      setDetected([]);
      setFiles([]);
      onSuccess();
    } catch (e) {
      setStatus({ type: "error", text: e instanceof Error ? e.message : "エラーが発生しました" });
    } finally {
      setLoading(false);
    }
  };

  const yen = (n: number) => `¥${n.toLocaleString()}`;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-1">
          決済手数料・電気料の一括取込
        </h3>
        <p className="text-xs text-gray-600 leading-relaxed">
          毎月の <strong>PAY.JP</strong>・<strong>fincode</strong> の決済手数料（合算して「支払手数料」）と、
          <strong>シンエナジー</strong>の電気料金明細（「電気料」）を、店舗別・月次でまとめて取り込みます。
          <br />
          対象年月を選び、<strong>3ファイルをまとめて</strong>下の枠に入れてください（PAY.JP・fincodeのCSV、シンエナジーのExcel）。
          種類は自動で判別します。「内容を確認」→ プレビューを見て「取り込む」。
          <br />
          <span className="text-amber-700">
            ※ 月2回の入金など、分けて取り込んでも<strong>合算</strong>されます（別ファイルは加算、同じファイルの再取込は更新）。プレビューで現在額・取込後の合計を確認できます。
          </span>
        </p>
      </div>

      <div className="flex gap-3 max-w-md">
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          ファイル（PAY.JP / fincode の .csv、シンエナジーの .xlsx をまとめて）
        </label>
        <FileDropzone
          accept=".csv,.xlsx,.xls"
          multiple
          files={files}
          onFilesSelect={addFiles}
          onRemoveFile={removeFile}
        />
      </div>

      <StatusBanner status={status} />

      {preview && (
        <div className="space-y-3">
          {detected.length > 0 && (
            <div className="text-xs text-gray-600 bg-gray-50 border rounded-lg p-3">
              <span className="font-medium text-gray-700">判別結果：</span>
              <ul className="mt-1 space-y-0.5">
                {detected.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="inline-block px-1.5 rounded bg-blue-100 text-blue-700">
                      {d.type}
                    </span>
                    <span className="text-gray-500 truncate">{d.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.length > 0 && (
            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b text-sm font-medium text-gray-700">
                取り込みプレビュー（{year}年{month}月）
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-gray-600">
                    <th className="text-left px-3 py-1.5 font-medium">勘定科目</th>
                    <th className="text-left px-3 py-1.5 font-medium">店舗</th>
                    <th className="text-right px-3 py-1.5 font-medium">今回取込額</th>
                    <th className="text-right px-3 py-1.5 font-medium">現在の登録額</th>
                    <th className="text-right px-3 py-1.5 font-medium">取込後の合計</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5">{r.category}</td>
                      <td className="px-3 py-1.5">{r.store}</td>
                      <td className="px-3 py-1.5 text-right font-medium">
                        {yen(r.amount)}
                        <span
                          className={`ml-1 text-[10px] px-1 rounded ${
                            r.mode === "update"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {r.mode === "update" ? "更新" : "加算"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-500">
                        {r.existing != null ? yen(r.existing) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium text-gray-800">
                        {yen(r.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-3 flex gap-2">
                <ActionButton onClick={handleCommit} loading={loading}>
                  この内容で取り込む
                </ActionButton>
                <button
                  onClick={() => setPreview(null)}
                  className="text-sm px-4 py-2 rounded-md border text-gray-600 hover:bg-gray-50"
                >
                  やめる
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!preview && (
        <ActionButton onClick={handlePreview} loading={loading} disabled={files.length === 0}>
          内容を確認
        </ActionButton>
      )}
    </div>
  );
}
