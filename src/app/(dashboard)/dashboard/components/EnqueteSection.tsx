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
}

interface Props {
  store: string;
}

export function EnqueteSection({ store }: Props) {
  const [data, setData] = useState<EnqueteData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (store && store !== "全体") params.set("store", store);
    fetch(`/api/dashboard/enquete?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [store]);

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
    return (
      <div className="mt-8">
        <SectionTitle>アンケート（認知経路・目的・頻度）</SectionTitle>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 text-sm">
          <p className="font-medium">⚠️ アンケート回答が未取込です</p>
          <p className="mt-1 text-xs">
            アップロード画面の「アンケート」タブから hacomono の enquete_answer
            CSV を取り込むと、ここに認知経路・目的・頻度の構成比が表示されます。
          </p>
        </div>
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
        体験・入会アンケート回答の集計（hacomono CSV 由来）。複数選択の質問は1人が複数項目にカウントされます。
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
            <BarChart data={purposesData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} allowDecimals={false} unit="件" />
              <YAxis type="category" dataKey="name" fontSize={10} width={120} />
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
