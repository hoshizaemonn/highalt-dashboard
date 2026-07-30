import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

/**
 * 社員マスタを返す（admin専用）。UsersTab の社員プルダウンで利用する。
 *
 * ソースは2つを統合する：
 *  ① PayrollData（人件費CSV由来）
 *     - employeeId + employeeName + storeName を distinct
 *     - 同じ employeeId が複数店舗・複数月に出る場合は、最新月のレコードを採用
 *  ② StoreOverride（従業員店舗マッピング由来・松尾さん依頼 2026-07）
 *     - 人件費CSVにまだ載っていない社員（マッピングだけ追加した人）も
 *       プルダウンに出す。PayrollData に既にいる社員は①を優先し重複させない。
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

  // ② 従業員店舗マッピング（store_overrides）由来。人件費CSVに未登録の社員も拾う。
  //    StoreOverride.employeeId は数値なので文字列化して PayrollData 側とキーを揃える。
  //    兼務（同一社員が複数店舗）の場合は最初の1件を代表として採用（店舗はUI側で再選択可）。
  const overrides = await prisma.storeOverride.findMany({
    orderBy: { employeeId: "asc" },
  });
  for (const o of overrides) {
    const idStr = String(o.employeeId);
    if (seen.has(idStr)) continue;
    seen.add(idStr);
    employees.push({
      employeeId: idStr,
      employeeName: o.employeeName || idStr,
      storeName: o.storeName,
      contractType: null,
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
