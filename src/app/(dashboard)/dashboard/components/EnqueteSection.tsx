"use client";

import { useEffect, useState } from "react";
import {
  COLORS,
  SectionTitle,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  numFormat,
} from "./shared";

interface EnqueteData {
  total: number;
  awareness: Record<string, number>;
  purposes: Record<string, number>;
  frequency: Record<string, number>;
  has_data: boolean;
  /** 期間に関係なく、店舗（または全体）の累計回答数。0 なら本当に未取込 */
  all_total?: number;
  /** 期間に関係なく最新の回答日時 */
  latest_registered_at?: string | null;
}

interface Props {
  store: string;
  /** 単月集計時に指定（year+month）。期間集計時は months[] を使う（AttributesSectionと同じ規約）。 */
  year?: number;
  month?: number;
  /** 通期/上期/下期等の期間集計用。"YYYY-MM" の配列。 */
  months?: string[];
}

export function EnqueteSection({ store, year, month, months }: Props) {
  const [data, setData] = useState<EnqueteData | null>(null);
  const [loading, setLoading] = useState(true);
  const monthsKey = months ? months.join(",") : "";

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (monthsKey) {
      params.set("months", monthsKey);
    } else if (year !== undefined && month !== undefined) {
      params.set("year", String(year));
      params.set("month", String(month));
    }
    if (store && store !== "全体") params.set("store", store);
    fetch(`/api/dashboard/enquete?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [store, year, month, monthsKey]);

  if (loading) {
    return (
      <div className="mt-8">
        <SectionTitle>アンケート（認知経路・目的・頻度）</SectionTitle>
        <div className="bg-white rounded-lg border shadow-sm p-8 text-center text-gray-400 text-sm">
          読み込み中...
        </div>
      </div>
    );
  }

  if (!data || data.total === 0 || !data.has_data) {
    // 「未取込」（累計0件）と「この期間は回答なし／回答内容なし」（累計はある）を区別する
    const imported = (data?.all_total ?? 0) > 0;
    const periodLabel = months && months.length > 1 ? "選択した期間" : "この月";
    return (
      <div className="mt-8">
        <SectionTitle>アンケート（認知経路・目的・頻度）</SectionTitle>
        {imported ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-700 text-sm">
            <p className="font-medium">{periodLabel}は、集計できるアンケート回答がありません</p>
            <p className="mt-1 text-xs">
              {data && data.total > 0
                ? `${periodLabel}の回答 ${data.total} 件は、認知経路・目的・頻度が未回答のため集計に含まれません。`
                : `${periodLabel}の回答はまだありません。`}
              アンケートは毎朝自動で取り込まれています（累計 {numFormat.format(data?.all_total ?? 0)} 件
              {data?.latest_registered_at ? `・最新の回答 ${data.latest_registered_at.slice(0, 10)}` : ""}）。
            </p>
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 text-sm">
            <p className="font-medium">⚠️ アンケート回答が未取込です</p>
            <p className="mt-1 text-xs">
              この店舗のアンケート回答がまだ取り込まれていません。毎朝の自動取込（hacomono）の実行結果を確認するか、
              アップロード画面の「アンケート」タブから hacomono の enquete_answer CSV を取り込んでください。
            </p>
          </div>
        )}
      </div>
    );
  }

  const toBarData = (m: Record<string, number>, limit = 10) =>
    Object.entries(m)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([name, value]) => ({ name, value }));

  const awarenessData = toBarData(data.awareness);
  const purposesData = toBarData(data.purposes);
  const frequencyData = toBarData(data.frequency, 5);

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <SectionTitle>アンケート（認知経路・目的・頻度）</SectionTitle>
      </div>
      <p className="text-xs text-gray-500 mb-4 -mt-2">
        体験・入会アンケート回答の集計（hacomono CSV 由来・選択中の期間の回答のみ）。複数選択の質問は1人が複数項目にカウントされます。
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">認知経路</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={awarenessData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} allowDecimals={false} unit="件" />
              <YAxis type="category" dataKey="name" fontSize={10} width={120} />
              <Tooltip
                formatter={(v) => [`${numFormat.format(Number(v))}件`, "回答数"]}
              />
              <Bar dataKey="value" fill={COLORS.blue} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">来店目的</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={purposesData} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} allowDecimals={false} unit="件" />
              <YAxis type="category" dataKey="name" fontSize={10} width={150} interval={0} />
              <Tooltip
                formatter={(v) => [`${numFormat.format(Number(v))}件`, "回答数"]}
              />
              <Bar dataKey="value" fill={COLORS.teal} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">運動頻度</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={frequencyData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} allowDecimals={false} unit="人" />
              <YAxis type="category" dataKey="name" fontSize={11} width={100} />
              <Tooltip
                formatter={(v) => [`${numFormat.format(Number(v))}人`, "回答数"]}
              />
              <Bar dataKey="value" fill={COLORS.orange} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">対象回答数: {numFormat.format(data.total)}件</p>
    </div>
  );
}
