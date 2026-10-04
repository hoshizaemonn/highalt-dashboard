"use client";

import { useEffect, useState } from "react";

// 各データの最終更新日（管理者のみ）。古いものは警告表示する。
// 日次の自動取込が「成功表示のまま中身が古い」状態を、人の目でも気づけるようにする。

interface Item {
  key: string;
  label: string;
  store: string | null;
  latest: string | null;
  ageDays: number | null;
  thresholdDays: number;
  status: "ok" | "stale" | "missing";
  basis: string;
}

interface Res {
  generatedAt: string;
  summary: { ok: number; stale: number; missing: number };
  items: Item[];
}

function fmtAge(i: Item): string {
  if (i.latest == null) return "記録なし";
  if (i.key === "electricity") return i.ageDays != null && i.ageDays > 0 ? `${Math.round(i.ageDays / 30)}か月前` : "当月";
  if (i.ageDays == null) return "";
  return i.ageDays === 0 ? "今日" : `${i.ageDays}日前`;
}

export default function DataFreshnessTab() {
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/data-freshness")
      .then(async (r) => {
        if (!r.ok) {
          setError("読み込みに失敗しました");
          return;
        }
        setData(await r.json());
      })
      .catch(() => setError("読み込みに失敗しました"));
  }, []);

  if (!data) return <p className="text-sm text-gray-500">{error || "読み込み中..."}</p>;

  const problems = data.items.filter((i) => i.status !== "ok");
  // 項目（label）ごとにまとめて表示する
  const groups = new Map<string, Item[]>();
  for (const i of data.items) groups.set(i.label, [...(groups.get(i.label) ?? []), i]);

  return (
    <div className="space-y-4">
      {problems.length > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
          <strong>更新が止まっている可能性があるデータが {problems.length} 件あります。</strong>
          <ul className="mt-1 text-xs list-disc pl-5">
            {problems.map((p) => (
              <li key={`${p.key}-${p.store ?? ""}`}>
                {p.label}
                {p.store ? `（${p.store}）` : ""}: 最終更新 {p.latest ?? "記録なし"}（{fmtAge(p)}）
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">自動取込（GitHub Actions）の実行結果を確認してください。復旧するまで、該当データを使った数字は古い可能性があります。</p>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800">すべてのデータが期待どおりに更新されています。</div>
      )}

      <p className="text-xs text-gray-500">
        売上明細は「最新の売上日」、取込は「最後に取り込まれた日」、電気料は「取込済みの最新の請求月」です（日本時間）。
        日次の項目は2日以上更新が無いと警告します。確認時刻: {new Date(data.generatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
      </p>

      {[...groups.entries()].map(([label, rows]) => (
        <div key={label} className="border border-gray-200 rounded p-3">
          <div className="text-sm font-medium text-gray-800 mb-2">{label}</div>
          <div className="flex flex-wrap gap-2">
            {rows.map((r) => (
              <span
                key={`${r.key}-${r.store ?? ""}`}
                className={`text-xs px-2 py-1 rounded border ${
                  r.status === "ok" ? "bg-gray-50 border-gray-200 text-gray-700" : "bg-red-50 border-red-300 text-red-700 font-medium"
                }`}
              >
                {r.store ? `${r.store}: ` : ""}
                {r.latest ?? "記録なし"}（{fmtAge(r)}）{r.status !== "ok" && " ⚠"}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
