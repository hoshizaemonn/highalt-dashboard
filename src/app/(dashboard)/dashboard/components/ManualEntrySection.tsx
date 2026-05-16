"use client";

import { useEffect, useState } from "react";
import { COLORS, KPICard, formatYen, numFormat } from "./shared";

interface Props {
  year: number;
  month: number;
  /** 店舗名。「全体」だと編集不可（全店合算表示のみ） */
  store: string;
  /** 編集権限を持つか（admin = 任意の店、店長 = 自店舗のみ） */
  canEdit: boolean;
  /** 親側で受け取る合算データ。集計値の表示用 */
  initialTrialCount?: number;
  initialOtherSales?: number;
  /** 保存時に親へ再フェッチを依頼 */
  onSaved?: () => void;
}

export function ManualEntrySection({
  year,
  month,
  store,
  canEdit,
  initialTrialCount,
  initialOtherSales,
  onSaved,
}: Props) {
  const isAll = store === "全体" || !store;
  const [trial, setTrial] = useState<number>(initialTrialCount ?? 0);
  const [otherSales, setOtherSales] = useState<number>(initialOtherSales ?? 0);
  const [otherNote, setOtherNote] = useState<string>("");
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 全体ビューは API 取得しない（合算値はparentから受け取る）
    if (isAll) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/dashboard/manual-entry?year=${year}&month=${month}&store=${encodeURIComponent(store)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setTrial(d.trial_count ?? 0);
        setOtherSales(d.other_sales_amount ?? 0);
        setOtherNote(d.other_sales_note ?? "");
        setUpdatedBy(d.updated_by_name ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [year, month, store, isAll]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/manual-entry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          store,
          trial_count: trial,
          other_sales_amount: otherSales,
          other_sales_note: otherNote || null,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setUpdatedBy(d.updated_by_name ?? null);
        setEditing(false);
        onSaved?.();
      } else {
        alert("保存に失敗しました");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-bold text-gray-700">店長手動追記</h2>
        {!isAll && canEdit && !editing && loaded && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs bg-white border rounded px-3 py-1 hover:bg-gray-50 text-gray-600"
          >
            修正
          </button>
        )}
        {!isAll && editing && (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs bg-white border rounded px-3 py-1 hover:bg-gray-50 text-gray-600"
            >
              キャンセル
            </button>
          </div>
        )}
        {isAll && (
          <span className="text-xs text-gray-400">
            全体ビュー: 店舗の入力値を合算表示（編集は各店ビューで）
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 体験者数 */}
        {!editing ? (
          <KPICard
            title="体験者数"
            value={`${numFormat.format(trial)}人`}
            color={COLORS.teal}
            help="店長が手動で入力。入会率 = 新規入会数 ÷ 体験者数 の分母になる。"
          />
        ) : (
          <div className="bg-white rounded-lg border shadow-sm p-4 ring-2 ring-blue-200">
            <p className="text-xs text-gray-500 font-medium">体験者数</p>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={String(trial)}
                onChange={(e) => setTrial(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="text-xl font-bold mt-1 w-full border-b-2 border-blue-300 outline-none bg-transparent"
                style={{ color: COLORS.teal }}
              />
              <span className="text-sm text-gray-500">人</span>
            </div>
          </div>
        )}

        {/* その他売上 */}
        {!editing ? (
          <KPICard
            title="その他売上（請求書ベース）"
            value={formatYen(otherSales)}
            color={COLORS.orange}
            help="hacomono / Square に乗らない請求書ベースの売上を店長が手動入力。売上合計に加算される。"
            sub={otherNote || undefined}
          />
        ) : (
          <div className="bg-white rounded-lg border shadow-sm p-4 ring-2 ring-blue-200">
            <p className="text-xs text-gray-500 font-medium">その他売上（請求書ベース）</p>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={String(otherSales)}
                onChange={(e) => setOtherSales(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="text-xl font-bold mt-1 w-full border-b-2 border-blue-300 outline-none bg-transparent"
                style={{ color: COLORS.orange }}
              />
              <span className="text-sm text-gray-500">円</span>
            </div>
            <input
              type="text"
              value={otherNote}
              maxLength={500}
              placeholder="メモ（任意、例: ◯◯社請求 30,000円）"
              onChange={(e) => setOtherNote(e.target.value)}
              className="mt-2 w-full text-xs border rounded px-2 py-1 outline-none focus:border-blue-300"
            />
          </div>
        )}
      </div>
      {!isAll && updatedBy && !editing && (
        <p className="text-xs text-gray-400 mt-2">最終更新: {updatedBy}</p>
      )}
    </div>
  );
}
