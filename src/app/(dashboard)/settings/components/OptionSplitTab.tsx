"use client";

import { useState, useEffect, useCallback } from "react";

// オプション売上の店舗按分ルール（システム管理者のみ）。
// 按分は金額に直結するため、変更前に必ず内容を確認すること。
// 有効化すると、開始年月以降の該当商品の売上が「所属店舗 → 按分先店舗」へ付け替えられる（総額は不変）。
// ルールは何件でも追加・編集・無効化・削除できる（コード変更は不要）。

interface Target {
  store: string;
  ratio: number;
}

interface Rule {
  /** 保存済みなら DB の id。新規（未保存）は null */
  id: number | null;
  /** 画面内でのキー（未保存行の識別用） */
  key: string;
  matchName: string;
  targets: Target[];
  startYear: number | null;
  startMonth: number | null;
  enabled: boolean;
  updatedByName: string | null;
  legacyCode: string | null;
}

interface ApiRule {
  id: number;
  matchName: string;
  targets: Target[];
  startYear: number | null;
  startMonth: number | null;
  enabled: boolean;
  updatedByName: string | null;
  legacyCode: string | null;
}

interface Unsplittable {
  year: number;
  month: number;
  storeName: string;
  count: number;
}

interface ApiResponse {
  rules: ApiRule[];
  stores: string[];
  minStart: { year: number; month: number };
  maxRules: number;
  unsplittable: Unsplittable[];
}

const ENDPOINT = "/api/settings/option-sales-split";

function fromApi(r: ApiRule, minStart: { year: number; month: number }): Rule {
  return {
    id: r.id,
    key: `id-${r.id}`,
    matchName: r.matchName,
    targets: r.targets.length ? r.targets : [{ store: "", ratio: 50 }],
    // 開始年月は仕様どおり 2026年10月を既定にする（データが入った月から反映される運用）
    startYear: r.startYear ?? minStart.year,
    startMonth: r.startMonth ?? minStart.month,
    enabled: r.enabled,
    updatedByName: r.updatedByName,
    legacyCode: r.legacyCode,
  };
}

export default function OptionSplitTab() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const apply = useCallback((json: ApiResponse) => {
    setData(json);
    setRules(json.rules.map((r) => fromApi(r, json.minStart)));
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) {
        setMessage("読み込みに失敗しました（システム管理者のみ操作できます）");
        return;
      }
      apply(await res.json());
    } catch {
      setMessage("読み込みに失敗しました");
    }
  }, [apply]);

  useEffect(() => {
    // 初回読み込み（非同期の取得結果のみで state を更新する）
    fetch(ENDPOINT)
      .then(async (res) => {
        if (!res.ok) {
          setMessage("読み込みに失敗しました（システム管理者のみ操作できます）");
          return;
        }
        apply(await res.json());
      })
      .catch(() => setMessage("読み込みに失敗しました"));
  }, [apply]);

  if (!data) {
    return <p className="text-sm text-gray-500">{message || "読み込み中..."}</p>;
  }

  const patchRule = (key: string, patch: Partial<Rule>) =>
    setRules((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const patchTarget = (key: string, idx: number, patch: Partial<Target>) =>
    setRules((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, targets: r.targets.map((t, i) => (i === idx ? { ...t, ...patch } : t)) } : r,
      ),
    );

  const addTarget = (key: string) =>
    setRules((prev) =>
      prev.map((r) => (r.key === key ? { ...r, targets: [...r.targets, { store: "", ratio: 10 }] } : r)),
    );

  const removeTarget = (key: string, idx: number) =>
    setRules((prev) =>
      prev.map((r) =>
        r.key === key && r.targets.length > 1 ? { ...r, targets: r.targets.filter((_, i) => i !== idx) } : r,
      ),
    );

  const addRule = () => {
    if (rules.length >= data.maxRules) {
      setMessage(`ルールは${data.maxRules}件までです`);
      return;
    }
    setRules((prev) => [
      ...prev,
      {
        id: null,
        key: `new-${Date.now()}`,
        matchName: "",
        targets: [{ store: "", ratio: 50 }],
        startYear: data.minStart.year,
        startMonth: data.minStart.month,
        enabled: false,
        updatedByName: null,
        legacyCode: null,
      },
    ]);
  };

  const save = async (r: Rule) => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(ENDPOINT, {
        method: r.id == null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: r.id,
          matchName: r.matchName,
          targets: r.targets,
          startYear: r.startYear,
          startMonth: r.startMonth,
          enabled: r.enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error || "保存に失敗しました");
      } else {
        setMessage("保存しました（集計結果には次回の表示から反映されます）");
        await reload();
      }
    } catch {
      setMessage("保存に失敗しました");
    }
    setSaving(false);
  };

  const remove = async (r: Rule) => {
    if (r.id == null) {
      setRules((prev) => prev.filter((x) => x.key !== r.key));
      return;
    }
    const label = r.matchName || r.legacyCode || "このルール";
    if (!window.confirm(`「${label}」の按分ルールを削除します。\n削除すると、この商品の売上は按分されず元の店舗の数値に戻ります（売上データ自体は変わりません）。よろしいですか？`)) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`${ENDPOINT}?id=${r.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error || "削除に失敗しました");
      } else {
        setMessage("削除しました");
        await reload();
      }
    } catch {
      setMessage("削除に失敗しました");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-gray-700 space-y-1">
        <div>
          <strong>オプション売上の店舗按分</strong>: 対象商品の売上を「所属店舗」から「按分先店舗」へ比率分だけ付け替えます。
          総額は変わらず、総売上と内訳の両方に同じ比率で反映されます。
        </div>
        <div>
          開始年月より前の月は変更されません（{data.minStart.year}年{data.minStart.month}月以降のみ指定可）。
          「有効」にしない限り集計には影響しません。
        </div>
        <div>
          按分先は複数指定できます（比率の合計は100%まで。残りは所属店舗に残ります）。
          1つの売上に複数のルールが一致した場合は、<strong>商品名がより長く具体的なルール1件だけ</strong>が適用されます（二重には按分されません）。
        </div>
      </div>

      {message && <div className="px-4 py-2 bg-blue-50 text-blue-700 rounded text-sm">{message}</div>}

      <div className="border border-gray-200 rounded p-4">
        <div className="text-sm font-medium text-gray-800 mb-2">按分できなかった売上（要確認）</div>
        <p className="text-xs text-gray-500 mb-2">
          対象商品を含む売上明細が、他の商品と1行にまとまっているため、按分せず元の店舗に残している件数です。
          金額を按分したい場合は、hacomono側で商品ごとに分けて取り込んでください。
        </p>
        {data.unsplittable.length === 0 ? (
          <p className="text-xs text-gray-600">該当なし</p>
        ) : (
          <table className="text-xs w-full">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-1 pr-3">年月</th>
                <th className="py-1 pr-3">店舗</th>
                <th className="py-1">件数</th>
              </tr>
            </thead>
            <tbody>
              {data.unsplittable.map((u) => (
                <tr key={`${u.year}-${u.month}-${u.storeName}`} className="border-b border-gray-100">
                  <td className="py-1 pr-3">
                    {u.year}年{u.month}月
                  </td>
                  <td className="py-1 pr-3">{u.storeName}</td>
                  <td className="py-1">{u.count}件</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rules.length === 0 && <p className="text-sm text-gray-500">ルールはまだありません。「ルールを追加」から登録してください。</p>}

      {rules.map((d) => {
        const total = d.targets.reduce((s, t) => s + (Number.isFinite(t.ratio) ? t.ratio : 0), 0);
        const over = total > 100;
        return (
          <div key={d.key} className="border border-gray-200 rounded p-4 space-y-3">
            <div className="text-sm font-medium text-gray-800">
              {d.matchName || (d.legacyCode ? `（旧形式 ${d.legacyCode}）` : "（新規ルール）")}
              <span
                className={`ml-3 inline-block px-2 py-0.5 rounded text-xs ${
                  d.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {d.enabled ? "有効" : "無効"}
              </span>
              {d.id == null && <span className="ml-2 text-xs text-amber-700">未保存</span>}
              {d.updatedByName && <span className="ml-2 text-xs text-gray-500">最終更新: {d.updatedByName}</span>}
            </div>
            {d.legacyCode && !d.matchName && (
              <p className="text-xs text-amber-700">
                旧形式のルールです（hacomono の商品コード {d.legacyCode} で照合中）。商品名を入力して保存すると、商品名での照合に切り替わります。
              </p>
            )}

            <label className="flex flex-wrap items-center gap-2 text-sm">
              商品名（売上の摘要に含まれる名前）
              <input
                type="text"
                value={d.matchName}
                maxLength={100}
                placeholder="例: HYROXオプション下北沢(月4回)"
                onChange={(e) => patchRule(d.key, { matchName: e.target.value })}
                className="border border-gray-300 rounded px-2 py-1 w-96 max-w-full"
              />
            </label>
            <p className="text-xs text-gray-500">
              全角・半角（括弧・英数）やスペースの違い、英字の大小は区別せずに照合します。商品名の一部でも一致しますが、
              他の商品名にも含まれる短い名前にすると、意図しない商品まで按分されます（3文字以上必須）。
            </p>

            <div className="space-y-2">
              {d.targets.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    按分先店舗
                    <select
                      value={t.store}
                      onChange={(e) => patchTarget(d.key, i, { store: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1"
                    >
                      <option value="">未設定</option>
                      {data.stores.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1">
                    比率（%）
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={Number.isFinite(t.ratio) ? t.ratio : ""}
                      onChange={(e) => patchTarget(d.key, i, { ratio: Number(e.target.value) })}
                      className="border border-gray-300 rounded px-2 py-1 w-20"
                    />
                  </label>
                  {d.targets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTarget(d.key, i)}
                      className="text-xs text-gray-500 hover:text-red-600 underline"
                    >
                      この按分先を外す
                    </button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => addTarget(d.key)}
                  disabled={d.targets.length >= data.stores.length}
                  className="text-[#567FC0] hover:underline disabled:opacity-40"
                >
                  ＋ 按分先を追加
                </button>
                <span className={over ? "text-red-600" : "text-gray-600"}>
                  按分合計 {total}%（所属店舗に残る分 {Math.max(0, 100 - total)}%）
                  {over && " ／ 合計が100%を超えています"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                開始年
                <input
                  type="number"
                  value={d.startYear ?? ""}
                  onChange={(e) => patchRule(d.key, { startYear: e.target.value === "" ? null : Number(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 w-24"
                />
              </label>
              <label className="flex items-center gap-1">
                開始月
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={d.startMonth ?? ""}
                  onChange={(e) => patchRule(d.key, { startMonth: e.target.value === "" ? null : Number(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 w-20"
                />
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  onChange={(e) => patchRule(d.key, { enabled: e.target.checked })}
                />
                有効にする
              </label>
              <button
                onClick={() => save(d)}
                disabled={saving}
                className="bg-[#567FC0] hover:bg-[#4a6fa8] text-white px-4 py-1.5 rounded text-sm disabled:opacity-50"
              >
                保存
              </button>
              <button
                onClick={() => remove(d)}
                disabled={saving}
                className="border border-red-300 text-red-600 hover:bg-red-50 px-4 py-1.5 rounded text-sm disabled:opacity-50"
              >
                {d.id == null ? "取り消し" : "削除"}
              </button>
            </div>
          </div>
        );
      })}

      <button
        onClick={addRule}
        disabled={saving}
        className="border border-[#567FC0] text-[#567FC0] hover:bg-blue-50 px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        ＋ ルールを追加
      </button>
    </div>
  );
}
