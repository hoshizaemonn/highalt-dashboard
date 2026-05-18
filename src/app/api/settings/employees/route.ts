import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

/**
 * 人件費CSV由来の社員マスタを返す（admin専用）。
 * UsersTab の社員プルダウンで利用する。
 *
 * - PayrollData から employeeId + employeeName + storeName を distinct
 * - 同じ employeeId が複数店舗・複数月に出る場合は、最新月のレコードを採用
 */
export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 最新月優先で取りたいので order by year/month desc
  const rows = await prisma.payrollData.findMany({
    select: {
      employeeId: true,
      employeeName: true,
      storeName: true,
      contractType: true,
      year: true,
      month: true,
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  // employeeId ごとに最新行を採用
  const seen = new Set<string>();
  const employees: {
    employeeId: string;
    employeeName: string;
    storeName: string;
    contractType: string | null;
  }[] = [];
  for (const r of rows) {
    if (seen.has(r.employeeId)) continue;
    seen.add(r.employeeId);
    employees.push({
      employeeId: r.employeeId,
      employeeName: r.employeeName ?? r.employeeId,
      storeName: r.storeName,
      contractType: r.contractType,
    });
  }
  // 並び順: 店舗 → 社員ID
  employees.sort((a, b) =>
    a.storeName === b.storeName
      ? a.employeeId.localeCompare(b.employeeId)
      : a.storeName.localeCompare(b.storeName),
  );

  return NextResponse.json({ employees });
}
