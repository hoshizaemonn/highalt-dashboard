"use client";

import { useEffect, useState } from "react";
import {
  COLORS,
  SectionTitle,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  numFormat,
} from "./shared";

interface AttributesData {
  total: number;
  gender_breakdown: Record<string, number>;
  age_breakdown: Record<string, number>;
  has_data: boolean;
}

interface Props {
  year: number;
  month: number;
  store: string;
  /** true: 新規体験者属性のみ（had_trial=1）、false: 会員属性 */
  trialOnly: boolean;
  title: string;
  helpText: string;
}

const GENDER_COLORS: Record<string, string> = {
  男性: COLORS.blue,
  女性: COLORS.red,
  その他: COLORS.orange,
  未登録: COLORS.gray,
};

export function AttributesSection({
  year,
  month,
  store,
  trialOnly,
  title,
  helpText,
}: Props) {
  const [data, setData] = useState<AttributesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      ...(store && store !== "全体" && { store }),
      ...(trialOnly && { trialOnly: "1" }),
    });
    fetch(`/api/dashboard/attributes?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [year, month, store, trialOnly]);

  if (loading) {
    return (
      <div className="mt-8">
        <SectionTitle>{title}</SectionTitle>
        <div className="bg-white rounded-lg border shadow-sm p-8 text-center text-gray-400 text-sm">
          読み込み中...
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className="mt-8">
        <SectionTitle>{title}</SectionTitle>
        <div className="bg-white rounded-lg border shadow-sm p-8 text-center text-gray-400 text-sm">
          対象データがありません
        </div>
      </div>
    );
  }

  if (!data.has_data) {
    return (
      <div className="mt-8">
        <SectionTitle>{title}</SectionTitle>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 text-sm">
          <p className="font-medium">⚠️ 属性データが未取込です</p>
          <p className="mt-1 text-xs">
            hacomono CSV に「性別」「生年月日」列が含まれていません。次回アップロード時にこれらの列を含めると自動で集計されます。
          </p>
          <p className="mt-1 text-xs text-gray-600">
            （対象会員: {numFormat.format(data.total)}人）
          </p>
        </div>
      </div>
    );
  }

  const genderData = Object.entries(data.gender_breakdown)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const ageData = Object.entries(data.age_breakdown).map(([name, value]) => ({
    name,
    value,
  }));

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <SectionTitle>{title}</SectionTitle>
      </div>
      <p className="text-xs text-gray-500 mb-4 -mt-2">{helpText}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">男女構成比</p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={genderData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(entry) => {
                  const total = genderData.reduce((s, d) => s + d.value, 0);
                  const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0";
                  return `${entry.name} ${pct}%`;
                }}
              >
                {genderData.map((d, i) => (
                  <Cell key={i} fill={GENDER_COLORS[d.name] ?? COLORS.gray} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [
                  `${numFormat.format(Number(value))}人`,
                  String(name),
                ]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">年代別構成比</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ageData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} allowDecimals={false} unit="人" />
              <YAxis type="category" dataKey="name" fontSize={11} width={70} />
              <Tooltip
                formatter={(value) => [`${numFormat.format(Number(value))}人`, "人数"]}
              />
              <Bar dataKey="value" fill={COLORS.teal} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        対象: {numFormat.format(data.total)}人
      </p>
    </div>
  );
}
