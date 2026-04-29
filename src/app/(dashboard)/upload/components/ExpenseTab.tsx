"use client";

import { useState, useEffect } from "react";
import { STORES, EXPENSE_CATEGORIES } from "@/lib/constants";
import {
  StatusMessage,
  FileDropzone,
  StatusBanner,
  StoreSelect,
  YearSelect,
  MonthSelect,
  OverwriteWarning,
  ActionButton,
  detectYearMonthFromFilename,
} from "./SharedComponents";

// ─── Expense Tab ────────────────────────────────────────────

export function ExpenseTab({
  onSuccess,
  lockedStore,
}: {
  onSuccess?: () => void;
  lockedStore?: string | null;
}) {
  const [amazonDone, setAmazonDone] = useState(false);
  const [skipAmazon, setSkipAmazon] = useState(false);

  const amazonReady = amazonDone || skipAmazon;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        ① Amazon注文履歴 → ② PayPay銀行CSV の順にアップロード
      </p>

      {/* Step 1: Amazon */}
      <div className="border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-2">① Amazon注文履歴（内訳データ）</h3>

        {!amazonDone && (
          <label className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              checked={skipAmazon}
              onChange={(e) => setSkipAmazon(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-600">Amazonデータをスキップ（内訳不要の場合）</span>
          </label>
        )}

        {!skipAmazon && !amazonDone && (
          <AmazonExpenseSection
            onSuccess={() => { setAmazonDone(true); onSuccess?.(); }}
            lockedStore={lockedStore}
          />
        )}

        {amazonDone && (
          <div className="bg-green-50 border border-green-200 rounded px-4 py-2 text-sm text-green-700">
            ✅ Amazon注文データ取込完了
          </div>
        )}

        {skipAmazon && !amazonDone && (
          <div className="bg-blue-50 border border-blue-200 rounded px-4 py-2 text-sm text-blue-700">
            Amazonデータはスキップされます
          </div>
        )}
      </div>

      {/* Step 2: PayPay */}
      <div className={`border rounded-lg p-4 ${amazonReady ? "border-gray-200" : "border-gray-100 opacity-50"}`}>
        <h3 className="text-sm font-bold text-gray-700 mb-2">② PayPay銀行CSV</h3>

        {!amazonReady ? (
          <p className="text-sm text-yellow-600">
            先に①のAmazonデータを取り込むか、スキップにチェックを入れてください。
          </p>
        ) : (
          <PayPayExpenseSection onSuccess={onSuccess} lockedStore={lockedStore} />
        )}
      </div>
    </div>
  );
}

// ─── PayPay Expense Section ─────────────────────────────────

function PayPayExpenseSection({
  onSuccess,
  lockedStore,
}: {
  onSuccess?: () => void;
  lockedStore?: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [store, setStore] = useState<string>(lockedStore ?? STORES[0]);
  useEffect(() => {
    if (lockedStore) setStore(lockedStore);
  }, [lockedStore]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [autoDetected, setAutoDetected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [overwriteWarning, setOverwriteWarning] = useState<{ count: number } | null>(null);
  const [parsedRecords, setParsedRecords] = useState<
    {
      year: number;
      month: number;
      day: number;
      description: string;
      amount: number;
      deposit: number;
      category: string | null;
      isAutoClassified: boolean;
      isRevenue: boolean;
      breakdown: string;
    }[]
  >([]);
  const [parseStats, setParseStats] = useState<{ classified: number; unclassified: number } | null>(null);

  const doParse = async () => {
    setLoading(true);
    setStatus({ type: "info", text: "解析中..." });
    setOverwriteWarning(null);
    setParsedRecords([]);
    setParseStats(null);

    try {
      const formData = new FormData();
      formData.append("file", file!);
      formData.append("store", store);
      formData.append("year", String(year));
      formData.append("month", String(month));

      const res = await fetch("/api/upload/expense", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setParsedRecords(data.records);
      setParseStats({ classified: data.classified, unclassified: data.unclassified });
      setStatus({
        type: "success",
        text: `${data.records.length}件の取引を検出（分類済み ${data.classified}件 / 未分類 ${data.unclassified}件）`,
      });
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleParse = async () => {
    if (!file) return;
    setLoading(true);
    setStatus(null);

    try {
      const checkRes = await fetch(`/api/upload/expense?year=${year}&month=${month}&store=${encodeURIComponent(store)}`);
      const checkData = await checkRes.json();

      if (checkData.exists) {
        setOverwriteWarning({ count: checkData.count });
        setLoading(false);
        return;
      }
    } catch {
      // Check failed, proceed with parse anyway
    }

    await doParse();
  };

  const handleSave = async () => {
    if (parsedRecords.length === 0) return;
    setSaving(true);
    setStatus({ type: "info", text: "保存中..." });

    try {
      const res = await fetch("/api/upload/expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          records: parsedRecords,
          store,
          year,
          month,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setStatus({
        type: "success",
        text: `${store} ${year}年${month}月の経費データを保存しました（${data.saved}件）`,
      });
      onSuccess?.();
      setParsedRecords([]);
      setParseStats(null);
      setFile(null);
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateRecordCategory = (index: number, category: string) => {
    setParsedRecords((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], category: category || null };
      return next;
    });
  };

  const currentUnclassified = parsedRecords.filter((r) => !r.category).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        PayPay銀行 入出金明細CSV（Shift-JIS）をアップロード
      </p>

      <div className="grid grid-cols-3 gap-4">
        {lockedStore ? (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              対象店舗
            </label>
            <div className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-md text-gray-700">
              {lockedStore}
            </div>
          </div>
        ) : (
          <StoreSelect value={store} onChange={setStore} />
        )}
        <YearSelect value={year} onChange={setYear} />
        <MonthSelect value={month} onChange={setMonth} />
      </div>

      <FileDropzone
        accept=".csv"
        file={file}
        onFileSelect={(f) => {
          setFile(f);
          setParsedRecords([]);
          setParseStats(null);
          if (f) {
            const detected = detectYearMonthFromFilename(f.name);
            if (detected.year) { setYear(detected.year); setAutoDetected(true); }
            if (detected.month) { setMonth(detected.month); setAutoDetected(true); }
          }
        }}
        onClear={() => {
          setFile(null);
          setStatus(null);
          setOverwriteWarning(null);
          setAutoDetected(false);
          setParsedRecords([]);
          setParseStats(null);
        }}
      />
      {autoDetected && file && (
        <p className="text-sm text-green-600">
          ファイル名から <strong>{year}年{month}月</strong> を自動検出しました
        </p>
      )}

      <div className="flex gap-2">
        <ActionButton onClick={handleParse} loading={loading} disabled={!file || !!overwriteWarning || parsedRecords.length > 0}>
          解析する
        </ActionButton>
        {parsedRecords.length > 0 && (
          <ActionButton onClick={handleSave} loading={saving} variant="primary">
            保存する
          </ActionButton>
        )}
      </div>

      {overwriteWarning && (
        <OverwriteWarning
          message={`\u26A0\uFE0F ${store} ${year}年${month}月の経費データが既に${overwriteWarning.count}件あります。上書きしますか？`}
          onConfirm={async () => {
            setOverwriteWarning(null);
            await doParse();
          }}
          onCancel={() => { setOverwriteWarning(null); setLoading(false); }}
          loading={loading}
        />
      )}

      <StatusBanner status={status} />

      {parsedRecords.length > 0 && currentUnclassified > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
          <p className="text-sm text-yellow-800 font-medium">
            {"\u26A0\uFE0F"} 未分類: {currentUnclassified}件 -- 下のドロップダウンから勘定科目を選択してください
          </p>
        </div>
      )}

      {parsedRecords.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">日</th>
                  <th className="text-left py-2 px-3 font-medium">摘要</th>
                  <th className="text-right py-2 px-3 font-medium">出金</th>
                  <th className="text-right py-2 px-3 font-medium">入金</th>
                  <th className="text-left py-2 px-3 font-medium">勘定科目</th>
                </tr>
              </thead>
              <tbody>
                {parsedRecords.map((rec, i) => (
                  <tr
                    key={i}
                    className={`border-t border-gray-100 ${
                      rec.isRevenue ? "bg-blue-50/50" : !rec.category ? "bg-yellow-50/50" : ""
                    }`}
                  >
                    <td className="py-1.5 px-3 whitespace-nowrap">{rec.month}/{rec.day}</td>
                    <td className="py-1.5 px-3 max-w-[250px] truncate" title={rec.description}>
                      {rec.description}
                    </td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      {rec.amount > 0 ? rec.amount.toLocaleString() : ""}
                    </td>
                    <td className="py-1.5 px-3 text-right whitespace-nowrap">
                      {rec.deposit > 0 ? rec.deposit.toLocaleString() : ""}
                    </td>
                    <td className="py-1.5 px-3">
                      {rec.isRevenue ? (
                        <span className="text-xs text-blue-600 font-medium">収入</span>
                      ) : (
                        <select
                          value={rec.category || ""}
                          onChange={(e) => updateRecordCategory(i, e.target.value)}
                          className={`text-xs border rounded px-1.5 py-1 w-full ${
                            rec.category
                              ? "border-green-300 bg-green-50"
                              : "border-yellow-300 bg-yellow-50"
                          }`}
                        >
                          <option value="">未分類</option>
                          {EXPENSE_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Amazon Expense Section ─────────────────────────────────

function AmazonExpenseSection({
  onSuccess,
}: {
  onSuccess?: () => void;
  /** 店長ロール時の自店舗（Amazon側は配送先から自動判定するためここでは未使用） */
  lockedStore?: string | null;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  // Only unregistered (new) products to confirm
  const [newRecords, setNewRecords] = useState<
    {
      asin: string;
      productName: string;
      shortName: string;
      amazonCategory: string;
      expenseCategory: string;
    }[]
  >([]);
  const [allParsedRecords, setAllParsedRecords] = useState<
    {
      asin: string;
      productName: string;
      shortName: string;
      amazonCategory: string;
      expenseCategory: string;
    }[]
  >([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [allRegistered, setAllRegistered] = useState(false);

  // Map Amazon categories to expense categories as initial suggestion
  const amazonCategoryToExpense: Record<string, string> = {
    "ABIS_HEALTH_AND_BEAUTY": "消耗品費",
    "ABIS_DRUGSTORE": "消耗品費",
    "ABIS_OFFICE_PRODUCTS": "消耗品費",
    "ABIS_KITCHEN": "消耗品費",
    "ABIS_HOME": "消耗品費",
    "ABIS_GROCERY": "消耗品費",
    "ABIS_SPORTS": "消耗品費",
    "ABIS_TOOLS": "消耗品費",
    "ABIS_ELECTRONICS": "消耗品費",
    "ABIS_COMPUTER": "消耗品費",
    "ABIS_APPAREL": "消耗品費",
    "ABIS_SHOES": "消耗品費",
    "ABIS_PET_SUPPLIES": "消耗品費",
    "ABIS_BABY_PRODUCTS": "消耗品費",
  };

  const handleParse = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setStatus({ type: "info", text: "解析中..." });
    setAllRegistered(false);

    try {
      // Upload all files and merge results
      let allRecords: { asin: string; productName: string; shortName: string; amazonCategory: string; expenseCategory: string }[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/amazon", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) {
          setStatus({ type: "error", text: data.error || `${file.name}: エラー` });
          return;
        }
        allRecords = allRecords.concat(data.records || []);
      }

      const data = { records: allRecords };
      if (!data.records || data.records.length === 0) {
        setStatus({ type: "error", text: "データが見つかりませんでした" });
        return;
      }

      // Deduplicate by ASIN and categorize
      const seenAsins = new Set<string>();
      const unregistered: typeof newRecords = [];
      const allDeduped: typeof newRecords = [];
      let registered = 0;

      for (const rec of data.records) {
        if (seenAsins.has(rec.asin)) continue;
        seenAsins.add(rec.asin);

        const entry = {
          asin: rec.asin,
          productName: rec.productName,
          shortName: rec.shortName,
          amazonCategory: rec.amazonCategory,
          expenseCategory: rec.expenseCategory || "",
        };

        allDeduped.push(entry);

        if (rec.expenseCategory) {
          registered++;
        } else {
          // Apply auto-set from Amazon category
          unregistered.push(entry);
        }
      }

      setAllParsedRecords(allDeduped);
      setSkippedCount(registered);
      setNewRecords(unregistered);

      if (unregistered.length === 0) {
        // All ASINs already registered — still save to update product names
        setAllRegistered(true);
        setStatus({
          type: "info",
          text: `全商品が登録済み（${registered}件）。商品名を最新に更新します...`,
        });
        // Auto-save to update product names
        const saveRes = await fetch("/api/upload/amazon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: allDeduped, action: "save" }),
        });
        if (saveRes.ok) {
          setStatus({
            type: "success",
            text: `全商品が登録済みです（${registered}件の商品名を最新に更新しました）`,
          });
        }
        onSuccess?.();
      } else {
        setStatus({
          type: "success",
          text: `新規 ${unregistered.length}件 / 登録済み ${registered}件`,
        });
      }
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (newRecords.length === 0) return;
    setSaving(true);
    setStatus({ type: "info", text: "商品マスタに登録中..." });

    try {
      const res = await fetch("/api/upload/amazon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [...newRecords, ...allParsedRecords.filter(r => r.expenseCategory && !newRecords.find(n => n.asin === r.asin))], action: "save" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", text: data.error || "エラーが発生しました" });
        return;
      }

      setStatus({
        type: "success",
        text: `商品マスタに ${data.saved ?? newRecords.length}件 登録しました`,
      });
      onSuccess?.();
      setNewRecords([]);
      setSkippedCount(0);
      setFiles([]);
    } catch (e) {
      setStatus({
        type: "error",
        text: e instanceof Error ? e.message : "エラーが発生しました",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateRecordCategory = (index: number, category: string) => {
    setNewRecords((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], expenseCategory: category };
      return next;
    });
  };

  const parsed = newRecords.length > 0 || allRegistered;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Amazonビジネス注文履歴CSVをアップロード（商品マスタ登録用）
      </p>

      <FileDropzone
        accept=".csv"
        multiple
        files={files}
        onFilesSelect={(newFiles) => {
          setFiles((prev) => [...prev, ...newFiles]);
          setNewRecords([]);
          setSkippedCount(0);
          setAllRegistered(false);
        }}
        onRemoveFile={(i) => {
          setFiles((prev) => prev.filter((_, idx) => idx !== i));
          setNewRecords([]);
          setSkippedCount(0);
          setAllRegistered(false);
        }}
      />

      <div className="flex gap-2">
        <ActionButton onClick={handleParse} loading={loading} disabled={files.length === 0 || parsed}>
          解析する
        </ActionButton>
        {newRecords.length > 0 && (
          <ActionButton onClick={handleSave} loading={saving} variant="primary">
            この内容で商品マスタに登録する
          </ActionButton>
        )}
      </div>

      <StatusBanner status={status} />

      {newRecords.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-2 px-3 font-medium">ASIN</th>
                  <th className="text-left py-2 px-3 font-medium">商品名</th>
                  <th className="text-left py-2 px-3 font-medium">Amazonカテゴリ</th>
                  <th className="text-left py-2 px-3 font-medium">勘定科目</th>
                </tr>
              </thead>
              <tbody>
                {newRecords.map((rec, i) => (
                  <tr key={rec.asin} className="border-t border-gray-100">
                    <td className="py-1.5 px-3 whitespace-nowrap font-mono text-[10px]">{rec.asin}</td>
                    <td className="py-1.5 px-3 max-w-[250px] truncate" title={rec.productName}>
                      {rec.shortName}
                    </td>
                    <td className="py-1.5 px-3 whitespace-nowrap text-gray-500 text-[10px]">{rec.amazonCategory}</td>
                    <td className="py-1.5 px-3">
                      <select
                        value={rec.expenseCategory}
                        onChange={(e) => updateRecordCategory(i, e.target.value)}
                        className={`text-xs border rounded px-1.5 py-1 w-full ${
                          rec.expenseCategory
                            ? "border-green-300 bg-green-50"
                            : "border-yellow-300 bg-yellow-50"
                        }`}
                      >
                        <option value="">未分類</option>
                        {EXPENSE_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
