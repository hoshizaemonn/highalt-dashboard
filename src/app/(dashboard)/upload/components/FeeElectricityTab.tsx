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
 * 対象年月と各ファイル（任意）を選び、店舗別・月次で本部一括経費に反映する。
 */
interface PreviewRow {
  store: string;
  category: string;
  amount: number;
  existing: number | null;
}

const now = new Date();

export function FeeElectricityTab({ onSuccess }: { onSuccess: () => void }) {
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 前月運用が多いが既定は当月
  const [payjp, setPayjp] = useState<File | null>(null);
  const [fincode, setFincode] = useState<File | null>(null);
  const [sinenergy, setSinenergy] = useState<File | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);

  const buildForm = (dryRun: boolean) => {
    const fd = new FormData();
    fd.append("year", String(year));
    fd.append("month", String(month));
    if (dryRun) fd.append("dryRun", "true");
    if (payjp) fd.append("payjp", payjp);
    if (fincode) fd.append("fincode", fincode);
    if (sinenergy) fd.append("sinenergy", sinenergy);
    return fd;
  };

  const handlePreview = async () => {
    if (!payjp && !fincode && !sinenergy) {
      setStatus({ type: "error", text: "いずれかのファイルを選択してください" });
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
      setPayjp(null);
      setFincode(null);
      setSinenergy(null);
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
          対象年月を選び、お持ちのファイルを入れて「内容を確認」→ プレビューを見て「取り込む」。
          <br />
          <span className="text-amber-700">
            ※ 既に同じ月・店舗の手数料/電気料が入っている場合は上書きされます（プレビューで既存額を表示）。
          </span>
        </p>
      </div>

      <div className="flex gap-3 max-w-md">
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">PAY.JP 決済手数料（CSV）</label>
          <FileDropzone accept=".csv" file={payjp} onFileSelect={(f) => { setPayjp(f); setPreview(null); }} onClear={() => setPayjp(null)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">fincode 決済手数料（CSV）</label>
          <FileDropzone accept=".csv" file={fincode} onFileSelect={(f) => { setFincode(f); setPreview(null); }} onClear={() => setFincode(null)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">シンエナジー 電気料（Excel）</label>
          <FileDropzone accept=".xlsx" file={sinenergy} onFileSelect={(f) => { setSinenergy(f); setPreview(null); }} onClear={() => setSinenergy(null)} />
        </div>
      </div>

      <StatusBanner status={status} />

      {preview && preview.length > 0 && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b text-sm font-medium text-gray-700">
            取り込みプレビュー（{year}年{month}月）
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-gray-600">
                <th className="text-left px-3 py-1.5 font-medium">勘定科目</th>
                <th className="text-left px-3 py-1.5 font-medium">店舗</th>
                <th className="text-right px-3 py-1.5 font-medium">取込額</th>
                <th className="text-right px-3 py-1.5 font-medium">既存（上書き前）</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{r.category}</td>
                  <td className="px-3 py-1.5">{r.store}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{yen(r.amount)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">
                    {r.existing != null ? (
                      <span className="text-amber-600">{yen(r.existing)} → 上書き</span>
                    ) : (
                      "—"
                    )}
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

      {!preview && (
        <ActionButton onClick={handlePreview} loading={loading} disabled={!payjp && !fincode && !sinenergy}>
          内容を確認
        </ActionButton>
      )}
    </div>
  );
}
