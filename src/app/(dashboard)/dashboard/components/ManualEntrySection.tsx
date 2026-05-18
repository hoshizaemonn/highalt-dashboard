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

type OtherSalesItem = {
  amount: number;
  note: string;
};

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
  const [autoTrial, setAutoTrial] = useState<number>(0);
  const [trialReferral, setTrialReferral] = useState<number>(0);
  const [otherSales, setOtherSales] = useState<number>(initialOtherSales ?? 0);
  const [otherItems, setOtherItems] = useState<OtherSalesItem[]>([]);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 表示する体験者数 = 手動入力 > 0 なら手動、それ以外は自動
  const effectiveTrial = trial > 0 ? trial : autoTrial;
  const nonReferral = Math.max(0, effectiveTrial - trialReferral);
  const itemsTotal = otherItems.reduce((s, r) => s + (r.amount || 0), 0);

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
        setAutoTrial(d.auto_trial_count ?? 0);
        setTrialReferral(d.trial_referral_count ?? 0);
        setOtherSales(d.other_sales_amount ?? 0);
        const items: { amount: number; note: string | null }[] =
          d.other_sales_items ?? [];
        if (items.length > 0) {
          setOtherItems(
            items.map((r) => ({ amount: r.amount, note: r.note ?? "" })),
          );
        } else if (d.other_sales_amount > 0 || d.other_sales_note) {
          // 旧データ互換: 単一値を1行のitemに変換して表示
          setOtherItems([
            {
              amount: d.other_sales_amount ?? 0,
              note: d.other_sales_note ?? "",
            },
          ]);
        } else {
          setOtherItems([]);
        }
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
      const itemsPayload = otherItems
        .filter((r) => r.amount > 0 || r.note.trim().length > 0)
        .map((r) => ({ amount: r.amount, note: r.note.trim() || null }));
      const res = await fetch("/api/dashboard/manual-entry", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          store,
          trial_count: trial,
          trial_referral_count: trialReferral,
          other_sales_items: itemsPayload,
          // 互換のため合計値も送る（items が空の時のみ使われる）
          other_sales_amount: itemsPayload.length === 0 ? 0 : itemsTotal,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setUpdatedBy(d.updated_by_name ?? null);
        setOtherSales(d.other_sales_amount ?? 0);
        const items: { amount: number; note: string | null }[] =
          d.other_sales_items ?? [];
        setOtherItems(
          items.map((r) => ({ amount: r.amount, note: r.note ?? "" })),
        );
        setEditing(false);
        onSaved?.();
      } else {
        alert("保存に失敗しました");
      }
    } finally {
      setSaving(false);
    }
  };

  const addItem = () => setOtherItems([...otherItems, { amount: 0, note: "" }]);
  const removeItem = (i: number) =>
    setOtherItems(otherItems.filter((_, idx) => idx !== i));
  const updateItem = (i: number, patch: Partial<OtherSalesItem>) => {
    setOtherItems(
      otherItems.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    );
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
            value={`${numFormat.format(effectiveTrial)}人`}
            color={COLORS.teal}
            help="hacomono の体験経由フラグ(had_trial=1)から自動算出。修正ボタンから手動で上書き可能。紹介経由は店長手動入力、紹介以外は自動計算（体験者数 − 紹介経由）。"
            sub={
              effectiveTrial > 0
                ? `紹介経由: ${trialReferral}人 / 紹介以外: ${nonReferral}人${
                    trial > 0 ? "（手動上書き中）" : "（自動算出）"
                  }`
                : trial > 0
                  ? "手動上書き中"
                  : autoTrial > 0
                    ? "自動算出（hacomono由来）"
                    : undefined
            }
          />
        ) : (
          <div className="bg-white rounded-lg border shadow-sm p-4 ring-2 ring-blue-200">
            <p className="text-xs text-gray-500 font-medium">
              体験者数
              <span className="ml-2 text-[10px] text-gray-400">
                自動: {autoTrial}人（0のままなら自動値を使用）
              </span>
            </p>
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
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 font-medium">
                うち紹介経由
                <span className="ml-2 text-[10px] text-gray-400">
                  紹介以外は自動計算: {nonReferral}人
                </span>
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={effectiveTrial}
                  value={String(trialReferral)}
                  onChange={(e) =>
                    setTrialReferral(
                      Math.max(
                        0,
                        Math.min(effectiveTrial, parseInt(e.target.value, 10) || 0),
                      ),
                    )
                  }
                  className="text-lg font-bold mt-1 w-full border-b-2 border-blue-300 outline-none bg-transparent"
                  style={{ color: COLORS.blue }}
                />
                <span className="text-sm text-gray-500">人</span>
              </div>
            </div>
          </div>
        )}

        {/* その他売上（複数請求書対応） */}
        {!editing ? (
          <div className="bg-white rounded-lg border shadow-sm p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-gray-500 font-medium">
                その他売上（請求書ベース）
              </p>
              <span
                className="text-xl font-bold"
                style={{ color: COLORS.orange }}
              >
                {formatYen(otherSales)}
              </span>
            </div>
            {otherItems.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-gray-600">
                {otherItems.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-gray-50 pb-1">
                    <span className="truncate">{r.note || "（メモなし）"}</span>
                    <span className="font-medium tabular-nums whitespace-nowrap">
                      {formatYen(r.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400 mt-2">未入力</p>
            )}
            <p className="text-[10px] text-gray-400 mt-2">
              hacomono / Square に乗らない請求書ベースの売上。売上合計に加算されます。
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border shadow-sm p-4 ring-2 ring-blue-200">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs text-gray-500 font-medium">
                その他売上（請求書ベース）
              </p>
              <span
                className="text-lg font-bold tabular-nums"
                style={{ color: COLORS.orange }}
              >
                合計 {formatYen(itemsTotal)}
              </span>
            </div>
            <div className="space-y-2">
              {otherItems.map((r, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input
                    type="text"
                    value={r.note}
                    maxLength={200}
                    placeholder="メモ（例: ◯◯社 ロッカー利用料）"
                    onChange={(e) => updateItem(i, { note: e.target.value })}
                    className="flex-1 text-xs border rounded px-2 py-1 outline-none focus:border-blue-300"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      value={String(r.amount)}
                      onChange={(e) =>
                        updateItem(i, {
                          amount: Math.max(0, parseInt(e.target.value, 10) || 0),
                        })
                      }
                      className="w-28 text-sm text-right border rounded px-2 py-1 outline-none focus:border-blue-300 tabular-nums"
                    />
                    <span className="text-xs text-gray-500">円</span>
                  </div>
                  <button
                    onClick={() => removeItem(i)}
                    className="text-xs text-red-500 hover:text-red-700 px-1"
                    title="この行を削除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addItem}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded w-full py-1 hover:bg-blue-50"
            >
              + 行を追加
            </button>
            <p className="text-[10px] text-gray-400 mt-2">
              複数件ある場合は1件ずつ行を追加。空行は保存時に除外されます。
            </p>
          </div>
        )}
      </div>
      {!isAll && updatedBy && !editing && (
        <p className="text-xs text-gray-400 mt-2">最終更新: {updatedBy}</p>
      )}
    </div>
  );
}
