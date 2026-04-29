"use client";

import { useState } from "react";
import { Upload, Clock } from "lucide-react";
import { PayrollTab } from "./components/PayrollTab";
import { ExpenseTab } from "./components/ExpenseTab";
import { HacomonoTab } from "./components/HacomonoTab";
import { BudgetTab, UploadHistory } from "./components/BudgetTab";

// ─── Types ──────────────────────────────────────────────────

type TabId = "payroll" | "expense" | "hacomono" | "budget";

// ─── Main Upload Page ───────────────────────────────────────

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<TabId>("payroll");
  const [historyKey, setHistoryKey] = useState(0);
  const refreshHistory = () => setHistoryKey((k) => k + 1);

  const tabs: { id: TabId; label: string }[] = [
    { id: "payroll", label: "人件費" },
    { id: "expense", label: "経費" },
    { id: "hacomono", label: "hacomono（売上）" },
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
        {activeTab === "expense" && <ExpenseTab onSuccess={refreshHistory} />}
        {activeTab === "hacomono" && <HacomonoTab onSuccess={refreshHistory} />}
        {activeTab === "budget" && <BudgetTab onSuccess={refreshHistory} />}
      </div>

      {/* Upload History */}
      <div className="mt-6 bg-white rounded-lg shadow-sm">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-200">
          <Clock size={16} className="text-gray-400" />
          <h2 className="text-sm font-medium text-gray-700">アップロード履歴</h2>
        </div>
        <div className="p-4">
          <UploadHistory key={historyKey} />
        </div>
      </div>
    </div>
  );
}
