"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  ClipboardList,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";

interface DashboardShellProps {
  userId: number;
  role: string;
  storeName: string | null;
  displayName: string | null;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/upload", label: "アップロード", icon: Upload },
  { href: "/settings", label: "設定", icon: Settings },
];

function getRoleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "管理者";
    case "store_manager":
      return "店舗マネージャー";
    case "viewer":
      return "閲覧者";
    default:
      return role;
  }
}

export function DashboardShell({
  role,
  storeName,
  displayName,
  children,
}: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const userLabel = displayName || storeName || "ユーザー";

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-lg transform transition-transform duration-200 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo — クリックでダッシュボードへ戻る（SaaSの暗黙ルール） */}
          <div className="px-4 py-4 flex items-center justify-between">
            <button
              onClick={() => {
                router.push("/dashboard");
                setSidebarOpen(false);
              }}
              className="block focus:outline-none focus:ring-2 focus:ring-[#567FC0] rounded-lg"
              aria-label="ダッシュボードへ戻る"
            >
              <img
                src="/logo.png"
                alt="ハイアルチ 駅前高地™トレーニング"
                className="w-32 rounded-lg"
              />
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-gray-500 hover:text-gray-700"
            >
              <X size={20} />
            </button>
          </div>

          {/* User Info */}
          <div className="px-4 py-4 border-b border-gray-200">
            <p className="font-medium text-gray-800 text-sm">{userLabel}</p>
            <p className="text-xs text-gray-500 mt-0.5">{getRoleLabel(role)}</p>
            {storeName && (
              <p className="text-xs text-[#567FC0] mt-0.5">{storeName}</p>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(item.href);
                    setSidebarOpen(false);
                  }}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors
                    ${
                      isActive
                        ? "bg-[#567FC0] text-white"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }
                  `}
                >
                  <Icon size={18} />
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Logout */}
          <div className="px-3 py-3 border-t border-gray-200">
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 w-full rounded-md text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <LogOut size={18} />
              ログアウト
            </button>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-200">
            <p className="text-xs text-gray-400 text-center">
              High-Alti 業績ダッシュボード v2.0
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden bg-white shadow-sm px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900"
          >
            <Menu size={24} />
          </button>
          <h1 className="font-bold text-[#567FC0]">ハイアルチ</h1>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
