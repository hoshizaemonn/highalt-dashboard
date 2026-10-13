import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "./dashboard-shell";
import { canViewAllStores } from "@/lib/permissions";
import { loadFreshnessAlert } from "@/lib/freshness-alert";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // 鮮度チェックが赤のとき、管理者・マネージャーにだけ最上部の警告を出す
  const freshnessAlert = canViewAllStores(session.role) ? await loadFreshnessAlert() : null;

  return (
    <DashboardShell
      userId={session.userId}
      role={session.role}
      storeName={session.storeName}
      displayName={session.displayName}
      freshnessAlert={freshnessAlert}
    >
      {children}
    </DashboardShell>
  );
}
