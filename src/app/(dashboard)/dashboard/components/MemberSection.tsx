"use client";

import { useState, useEffect } from "react";
import {
  COLORS,
  PIE_COLORS,
  numFormat,
  KPICard,
  SectionTitle,
  DashboardData,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "./shared";

// ─── Plan Breakdown Pie Chart (monthly) ─────────────────

export interface PlanBreakdownPieProps {
  year: number;
  month: number;
  store: string;
}

export function PlanBreakdownPie({
  year,
  month,
  store,
}: PlanBreakdownPieProps) {
  const [plans, setPlans] = useState<{ name: string; count: number }[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      store,
    });
    fetch(`/api/dashboard/plan-breakdown?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plans && data.plans.length > 0) {
          setPlans(data.plans.filter((p: { count: number }) => p.count > 0));
        } else {
          setPlans(null);
        }
      })
      .catch(() => setPlans(null));
  }, [year, month, store]);

  if (!plans || plans.length === 0) return null;

  const total = plans.reduce((s, p) => s + p.count, 0);

  return (
    <>
      <SectionTitle>プラン別会員数</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={plans}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label
              >
                {plans.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [
                  `${Number(value)}人（${((Number(value) / total) * 100).toFixed(1)}%）`,
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg border shadow-sm p-4">
          <p className="text-sm font-medium text-gray-600 mb-3">
            合計: {total}人
          </p>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {plans.map((p, i) => (
              <div key={p.name} className="flex items-center gap-2 text-sm">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="font-medium">{p.count}人</span>
                <span className="text-gray-400 text-xs w-12 text-right">
                  {((p.count / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Editable Member Section (MA002) ─────────────────────

interface MemberFields {
  total_members: number;
  plan_subscribers: number;
  new_plan_signups: number;
  cancellations: number;
  suspensions: number;
  cancellation_rate: string;
  plan_changes: number;
}

export interface EditableMemberSectionProps {
  data: DashboardData["member"];
  isAllStores: boolean;
  year: number;
  month: number;
  store: string;
  onSaved: () => void;
}

export function EditableMemberSection({
  data,
  isAllStores,
  year,
  month,
  store,
  onSaved,
}: EditableMemberSectionProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<MemberFields>({
    total_members: 0,
    plan_subscribers: 0,
    new_plan_signups: 0,
    cancellations: 0,
    suspensions: 0,
    cancellation_rate: "",
    plan_changes: 0,
  });

  useEffect(() => {
    if (data) {
      setFields({
        total_members: data.total_members,
        plan_subscribers: data.plan_subscribers,
        new_plan_signups: data.new_plan_signups,
        cancellations: data.cancellations,
        suspensions: data.suspensions,
        cancellation_rate: data.cancellation_rate,
        plan_changes: data.plan_changes,
      });
    }
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/member-summary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          storeName: store,
          fields,
        }),
      });
      if (!res.ok) throw new Error("保存に失敗しました");
      setEditing(false);
      onSaved();
    } catch {
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const setField = (key: keyof MemberFields, value: string) => {
    setFields((prev) => ({
      ...prev,
      [key]: key === "cancellation_rate" ? value : (parseInt(value, 10) || 0),
    }));
  };

  function EditableKPI({
    title,
    fieldKey,
    color,
    isRate,
  }: {
    title: string;
    fieldKey: keyof MemberFields;
    color: string;
    isRate?: boolean;
  }) {
    const val = fields[fieldKey];
    if (!editing) {
      return (
        <KPICard
          title={title}
          value={isRate ? (String(val) || "-") : numFormat.format(Number(val))}
          color={color}
        />
      );
    }
    return (
      <div className="bg-white rounded-lg border shadow-sm p-4 ring-2 ring-blue-200">
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <input
          type={isRate ? "text" : "number"}
          value={String(val)}
          onChange={(e) => setField(fieldKey, e.target.value)}
          className="text-xl font-bold mt-1 w-full border-b-2 border-blue-300 outline-none bg-transparent"
          style={{ color }}
        />
      </div>
    );
  }

  // When in "全体" mode and no editing, show read-only
  if (isAllStores) {
    return (
      <>
        <SectionTitle>会員情報 (MA002)</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="在籍会員数"
            value={data ? numFormat.format(data.total_members) : "-"}
            color={COLORS.blue}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mt-8 mb-3">
        <h2 className="text-lg font-bold text-gray-700">会員情報 (MA002)</h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-xs bg-white border rounded px-3 py-1 hover:bg-gray-50 text-gray-600"
          >
            修正
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                if (data) {
                  setFields({
                    total_members: data.total_members,
                    plan_subscribers: data.plan_subscribers,
                    new_plan_signups: data.new_plan_signups,
                    cancellations: data.cancellations,
                    suspensions: data.suspensions,
                    cancellation_rate: data.cancellation_rate,
                    plan_changes: data.plan_changes,
                  });
                }
              }}
              className="text-xs bg-white border rounded px-3 py-1 hover:bg-gray-50 text-gray-600"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <EditableKPI title="プラン契約者数" fieldKey="plan_subscribers" color={COLORS.blue} />
        <EditableKPI title="新規入会" fieldKey="new_plan_signups" color={COLORS.green} />
        <EditableKPI title="退会率" fieldKey="cancellation_rate" color={COLORS.red} isRate />
        <EditableKPI title="プラン変更" fieldKey="plan_changes" color={COLORS.orange} />
      </div>
      <div className="grid grid-cols-3 gap-4 mt-3">
        <EditableKPI title="新規申込" fieldKey="new_plan_signups" color={COLORS.teal} />
        <EditableKPI title="退会" fieldKey="cancellations" color={COLORS.red} />
        <EditableKPI title="休会" fieldKey="suspensions" color={COLORS.gray} />
      </div>
    </>
  );
}
