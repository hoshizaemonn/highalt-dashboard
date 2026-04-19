"use client";

import { useState, useEffect, useCallback } from "react";
import { ClipboardList } from "lucide-react";

const STORES = [
  "東日本橋",
  "春日",
  "船橋",
  "巣鴨",
  "祖師ヶ谷大蔵",
  "下北沢",
  "中目黒",
];

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

interface FormData {
  trialReferral: number;
  trialNonReferral: number;
  trialJoinRate: number;
  trialSameDayRate: number;
  postingStaff: number;
  postingVendor: number;
  adGoogle: number;
  adMeta: number;
  adPosting: number;
  adDesign: number;
  adPrint: number;
  adGift: number;
  adEvent: number;
  adRecruit: number;
  adOther: number;
  unitPrice: number;
  unitPriceBudget: number;
  optAthlete4: number;
  optAthlete8: number;
  optDrinkHyalchi: number;
  optDrinkNmn: number;
  optBoost4: number;
  optBoost8: number;
  personalRevenue: number;
  merchandiseRevenue: number;
  comment: string;
}

const EMPTY_FORM: FormData = {
  trialReferral: 0,
  trialNonReferral: 0,
  trialJoinRate: 0,
  trialSameDayRate: 0,
  postingStaff: 0,
  postingVendor: 0,
  adGoogle: 0,
  adMeta: 0,
  adPosting: 0,
  adDesign: 0,
  adPrint: 0,
  adGift: 0,
  adEvent: 0,
  adRecruit: 0,
  adOther: 0,
  unitPrice: 0,
  unitPriceBudget: 0,
  optAthlete4: 0,
  optAthlete8: 0,
  optDrinkHyalchi: 0,
  optDrinkNmn: 0,
  optBoost4: 0,
  optBoost8: 0,
  personalRevenue: 0,
  merchandiseRevenue: 0,
  comment: "",
};

function InputField({
  label,
  value,
  onChange,
  type = "number",
  suffix,
  placeholder,
}: {
  label: string;
  value: number | string;
  onChange: (v: string) => void;
  type?: "number" | "text";
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          type={type}
          value={value === 0 && type === "number" ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "0"}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]/40 focus:border-[#567FC0]"
        />
        {suffix && (
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export default function PromotionPage() {
  const [store, setStore] = useState(STORES[0]);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [form, setForm] = useState<FormData>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hasExisting, setHasExisting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
        store,
      });
      const res = await fetch(`/api/promotion?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      if (data.report) {
        const r = data.report;
        setForm({
          trialReferral: r.trialReferral ?? 0,
          trialNonReferral: r.trialNonReferral ?? 0,
          trialJoinRate: r.trialJoinRate ?? 0,
          trialSameDayRate: r.trialSameDayRate ?? 0,
          postingStaff: r.postingStaff ?? 0,
          postingVendor: r.postingVendor ?? 0,
          adGoogle: r.adGoogle ?? 0,
          adMeta: r.adMeta ?? 0,
          adPosting: r.adPosting ?? 0,
          adDesign: r.adDesign ?? 0,
          adPrint: r.adPrint ?? 0,
          adGift: r.adGift ?? 0,
          adEvent: r.adEvent ?? 0,
          adRecruit: r.adRecruit ?? 0,
          adOther: r.adOther ?? 0,
          unitPrice: r.unitPrice ?? 0,
          unitPriceBudget: r.unitPriceBudget ?? 0,
          optAthlete4: r.optAthlete4 ?? 0,
          optAthlete8: r.optAthlete8 ?? 0,
          optDrinkHyalchi: r.optDrinkHyalchi ?? 0,
          optDrinkNmn: r.optDrinkNmn ?? 0,
          optBoost4: r.optBoost4 ?? 0,
          optBoost8: r.optBoost8 ?? 0,
          personalRevenue: r.personalRevenue ?? 0,
          merchandiseRevenue: r.merchandiseRevenue ?? 0,
          comment: r.comment ?? "",
        });
        setHasExisting(true);
      } else {
        setForm({ ...EMPTY_FORM });
        setHasExisting(false);
      }
    } catch {
      setForm({ ...EMPTY_FORM });
      setHasExisting(false);
    } finally {
      setLoading(false);
    }
  }, [year, month, store]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setField = (key: keyof FormData, raw: string) => {
    if (key === "comment") {
      setForm((f) => ({ ...f, comment: raw }));
      return;
    }
    const val =
      key === "trialJoinRate" || key === "trialSameDayRate"
        ? parseFloat(raw) || 0
        : parseInt(raw, 10) || 0;
    setForm((f) => ({ ...f, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/promotion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, storeName: store, ...form }),
      });
      if (!res.ok) throw new Error("save failed");
      setMsg("保存しました");
      setHasExisting(true);
    } catch {
      setMsg("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const adTotal =
    form.adGoogle +
    form.adMeta +
    form.adPosting +
    form.adDesign +
    form.adPrint +
    form.adGift +
    form.adEvent +
    form.adRecruit +
    form.adOther;

  const yenFmt = new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList className="text-[#567FC0]" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">販促報告</h1>
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]/40"
        >
          {STORES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]/40"
        >
          {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map(
            (y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ),
          )}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(parseInt(e.target.value, 10))}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]/40"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        {hasExisting && (
          <span className="self-center text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
            データあり
          </span>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1. 体験数 */}
          <section className="bg-white rounded-lg border shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 border-b pb-2">
              体験数
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <InputField
                label="紹介からの体験数"
                value={form.trialReferral}
                onChange={(v) => setField("trialReferral", v)}
                suffix="人"
              />
              <InputField
                label="紹介以外からの体験数"
                value={form.trialNonReferral}
                onChange={(v) => setField("trialNonReferral", v)}
                suffix="人"
              />
              <InputField
                label="体験入会率"
                value={form.trialJoinRate}
                onChange={(v) => setField("trialJoinRate", v)}
                suffix="%"
              />
              <InputField
                label="即日入会率"
                value={form.trialSameDayRate}
                onChange={(v) => setField("trialSameDayRate", v)}
                suffix="%"
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              体験合計: {form.trialReferral + form.trialNonReferral}人
            </p>
          </section>

          {/* 2. ポスティング */}
          <section className="bg-white rounded-lg border shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 border-b pb-2">
              ポスティング
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <InputField
                label="スタッフ部数"
                value={form.postingStaff}
                onChange={(v) => setField("postingStaff", v)}
                suffix="部"
              />
              <InputField
                label="業者部数"
                value={form.postingVendor}
                onChange={(v) => setField("postingVendor", v)}
                suffix="部"
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              合計: {(form.postingStaff + form.postingVendor).toLocaleString()}部
            </p>
          </section>

          {/* 3. 広告宣伝費 */}
          <section className="bg-white rounded-lg border shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 border-b pb-2">
              広告宣伝費
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <InputField
                label="Google"
                value={form.adGoogle}
                onChange={(v) => setField("adGoogle", v)}
                suffix="円"
              />
              <InputField
                label="Meta"
                value={form.adMeta}
                onChange={(v) => setField("adMeta", v)}
                suffix="円"
              />
              <InputField
                label="ポスティング"
                value={form.adPosting}
                onChange={(v) => setField("adPosting", v)}
                suffix="円"
              />
              <InputField
                label="デザイン"
                value={form.adDesign}
                onChange={(v) => setField("adDesign", v)}
                suffix="円"
              />
              <InputField
                label="印刷"
                value={form.adPrint}
                onChange={(v) => setField("adPrint", v)}
                suffix="円"
              />
              <InputField
                label="ギフト券"
                value={form.adGift}
                onChange={(v) => setField("adGift", v)}
                suffix="円"
              />
              <InputField
                label="イベント"
                value={form.adEvent}
                onChange={(v) => setField("adEvent", v)}
                suffix="円"
              />
              <InputField
                label="求人"
                value={form.adRecruit}
                onChange={(v) => setField("adRecruit", v)}
                suffix="円"
              />
              <InputField
                label="その他"
                value={form.adOther}
                onChange={(v) => setField("adOther", v)}
                suffix="円"
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              広告宣伝費合計: {yenFmt.format(adTotal)}
            </p>
          </section>

          {/* 4. 客単価 */}
          <section className="bg-white rounded-lg border shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 border-b pb-2">
              客単価
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <InputField
                label="客単価（実績）"
                value={form.unitPrice}
                onChange={(v) => setField("unitPrice", v)}
                suffix="円"
              />
              <InputField
                label="客単価（予算）"
                value={form.unitPriceBudget}
                onChange={(v) => setField("unitPriceBudget", v)}
                suffix="円"
              />
            </div>
            {form.unitPriceBudget > 0 && form.unitPrice > 0 && (
              <p className={`text-xs mt-2 ${form.unitPrice >= form.unitPriceBudget ? "text-green-600" : "text-red-500"}`}>
                予実差: {yenFmt.format(form.unitPrice - form.unitPriceBudget)}
                （{((form.unitPrice / form.unitPriceBudget) * 100).toFixed(1)}%）
              </p>
            )}
          </section>

          {/* 5. オプション */}
          <section className="bg-white rounded-lg border shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 border-b pb-2">
              オプション
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <InputField
                label="アスリート4回"
                value={form.optAthlete4}
                onChange={(v) => setField("optAthlete4", v)}
                suffix="件"
              />
              <InputField
                label="アスリート8回"
                value={form.optAthlete8}
                onChange={(v) => setField("optAthlete8", v)}
                suffix="件"
              />
              <InputField
                label="飲むハイアルチ8J"
                value={form.optDrinkHyalchi}
                onChange={(v) => setField("optDrinkHyalchi", v)}
                suffix="件"
              />
              <InputField
                label="NMN"
                value={form.optDrinkNmn}
                onChange={(v) => setField("optDrinkNmn", v)}
                suffix="件"
              />
              <InputField
                label="BOOST4回"
                value={form.optBoost4}
                onChange={(v) => setField("optBoost4", v)}
                suffix="件"
              />
              <InputField
                label="BOOST8回"
                value={form.optBoost8}
                onChange={(v) => setField("optBoost8", v)}
                suffix="件"
              />
            </div>
          </section>

          {/* 6. パーソナル・物販 */}
          <section className="bg-white rounded-lg border shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 border-b pb-2">
              パーソナル・物販売上高
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <InputField
                label="パーソナル売上高"
                value={form.personalRevenue}
                onChange={(v) => setField("personalRevenue", v)}
                suffix="円"
              />
              <InputField
                label="物販売上高"
                value={form.merchandiseRevenue}
                onChange={(v) => setField("merchandiseRevenue", v)}
                suffix="円"
              />
            </div>
          </section>

          {/* 7. コメント */}
          <section className="bg-white rounded-lg border shadow-sm p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 border-b pb-2">
              コメント
            </h2>
            <textarea
              value={form.comment}
              onChange={(e) => setField("comment", e.target.value)}
              rows={4}
              placeholder="コメントを入力..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#567FC0]/40 focus:border-[#567FC0]"
            />
          </section>

          {/* Save button */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#567FC0] text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-[#4a6fa8] disabled:opacity-50 transition-colors"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            {msg && (
              <span
                className={`text-sm ${
                  msg.includes("失敗")
                    ? "text-red-600"
                    : "text-green-600"
                }`}
              >
                {msg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
