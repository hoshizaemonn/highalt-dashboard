"use client";

import { useState, useEffect } from "react";
import { Upload, Clock } from "lucide-react";
import { PayrollTab } from "./components/PayrollTab";
import { ExpenseTab } from "./components/ExpenseTab";
import { HacomonoTab } from "./components/HacomonoTab";
import { BudgetTab, UploadHistory } from "./components/BudgetTab";

// ─── Types ──────────────────────────────────────────────────

type TabId = "payroll" | "expense" | "hacomono" | "budget";

// ─── Main Upload Page ───────────────────────────────────────

export default function UploadPage() {
  // 月次運用の自然なフロー（売上→人件費→経費→予算照合）に合わせて並べる。
  // 触る頻度が一番高い「売上（hacomono）」を最初のタブにする。
  const [activeTab, setActiveTab] = useState<TabId>("hacomono");
  const [historyKey, setHistoryKey] = useState(0);
  const refreshHistory = () => setHistoryKey((k) => k + 1);

  // 店長ロール（admin 以外）はアップロード対象が自店舗に固定されるため、
  // 店舗セレクタを非表示にして session.storeName をそのまま使う。
  const [lockedStore, setLockedStore] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.role !== "admin" && data.storeName) {
          setLockedStore(data.storeName);
        }
      })
      .catch(() => {});
  }, []);

  // 並び順: 月次運用フローに沿って 売上 → 人件費 → 経費 → 予算
  // ラベル: アップロード画面は「投入者視点」を優先するため Source-first 命名。
  //        投入者は「hacomono からDLしたCSVをここに入れる」という思考順なので
  //        外部システム名（出所）→ 業務カテゴリの順で並べる。
  //
  // 経費タブのラベルは役割で出し分け:
  //   - 店長: Amazon のみ取り込むため「経費（Amazon）」
  //   - admin: Amazon と PayPay銀行 両方扱うため「経費（Amazon＋PayPay銀行）」
  const tabs: { id: TabId; label: string }[] = [
    { id: "hacomono", label: "hacomono（売上）" },
    { id: "payroll", label: "人件費" },
    {
      id: "expense",
      label: lockedStore ? "経費（Amazon）" : "経費（Amazon＋PayPay銀行）",
    },
    { id: "budget", label: "予算" },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Upload className="text-[#567FC0]" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">アップロード</h1>
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-t-lg shadow-sm border-b border-gray-200">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 px-4 py-3 text-sm font-medium transition-colors relative
                ${
                  activeTab === tab.id
                    ? "text-[#567FC0]"
                    : "text-gray-500 hover:text-gray-700"
                }
              `}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#567FC0]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-b-lg shadow-sm p-6">
        {activeTab === "payroll" && <PayrollTab onSuccess={refreshHistory} />}
        {activeTab === "expense" && (
          <ExpenseTab onSuccess={refreshHistory} lockedStore={lockedStore} />
        )}
        {activeTab === "hacomono" && (
          <HacomonoTab onSuccess={refreshHistory} lockedStore={lockedStore} />
        )}
        {activeTab === "budget" && (
          <BudgetTab onSuccess={refreshHistory} lockedStore={lockedStore} />
        )}
      </div>

      {/* Upload History — タブに紐づく履歴のみ表示 */}
      <div className="mt-6 bg-white rounded-lg shadow-sm">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-200">
          <Clock size={16} className="text-gray-400" />
          <h2 className="text-sm font-medium text-gray-700">
            このタブのアップロード履歴
          </h2>
        </div>
        <div className="p-4">
          <UploadHistory key={`${historyKey}-${activeTab}`} filterTab={activeTab} />
        </div>
      </div>
    </div>
  );
}
