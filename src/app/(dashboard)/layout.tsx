import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <DashboardShell
      userId={session.userId}
      role={session.role}
      storeName={session.storeName}
      displayName={session.displayName}
    >
      {children}
    </DashboardShell>
  );
}
