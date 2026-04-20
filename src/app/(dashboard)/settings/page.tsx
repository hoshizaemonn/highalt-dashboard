"use client";

import { useState, useEffect } from "react";
import { Settings } from "lucide-react";
import OverridesTab from "./components/OverridesTab";
import ExpenseRulesTab from "./components/ExpenseRulesTab";
import AmazonMasterTab from "./components/AmazonMasterTab";
import UsersTab from "./components/UsersTab";

// ─── Helper: get session role from cookie (lightweight) ─────────────

function useSessionRole() {
  const [role, setRole] = useState<string>("store_manager");
  useEffect(() => {
    async function fetchRole() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          setRole(data.role || "store_manager");
        }
      } catch {
        // ignore
      }
    }
    fetchRole();
  }, []);
  return role;
}

// ─── Tab Definitions ────────────────────────────────────────────────

const TABS = [
  { key: "overrides", label: "従業員→店舗マッピング" },
  { key: "expense-rules", label: "経費分類ルール" },
  { key: "amazon-master", label: "Amazon商品マスタ" },
  { key: "users", label: "ユーザー管理" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── Main Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const role = useSessionRole();
  const [activeTab, setActiveTab] = useState<TabKey>("overrides");

  const visibleTabs =
    role === "admin" ? TABS : TABS.filter((t) => t.key !== "users");

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Settings className="text-[#567FC0]" size={28} />
        <h1 className="text-2xl font-bold text-gray-800">設定</h1>
      </div>

      {/* Tab Bar */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-0 -mb-px">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-[#567FC0] text-[#567FC0]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        {activeTab === "overrides" && <OverridesTab />}
        {activeTab === "expense-rules" && <ExpenseRulesTab />}
        {activeTab === "amazon-master" && <AmazonMasterTab />}
        {activeTab === "users" && role === "admin" && <UsersTab />}
      </div>
    </div>
  );
}
