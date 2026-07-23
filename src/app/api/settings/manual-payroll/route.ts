import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/log";

/**
 * 手動人件費 API（人件費CSVに含まれない社員の追加・松尾さん依頼⑥ 2026-07）。
 * クラウド給与の支給控除一覧表（CSV）に載らない社員（役員・業務委託・未登録者など）の
 * 給与総額を月次で登録し、集計時に該当店舗・月の人件費に加算する。
 *
 * - GET: admin / manager（＝管理者相当）のみ
 * - PUT: 同上（バルク保存）
 * - DELETE: 同上（id 指定）
 *
 * ※ role は auth 側で manager→admin に正規化済み（ADMIN_EQUIVALENT_ROLES）。
 */

function isAdmin(role: string): boolean {
  return role === "admin";
}

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.session.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const where: { year?: number } = {};
  const yearParam = searchParams.get("year");
  if (yearParam) {
    const y = parseInt(yearParam, 10);
    if (!isNaN(y)) where.year = y;
  }

  const rows = await prisma.manualPayrollEntry.findMany({
    where,
    orderBy: [{ year: "desc" }, { month: "desc" }, { storeName: "asc" }],
  });
  return NextResponse.json({ items: rows });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.session.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await request.json();
  type Entry = {
    id?: unknown;
    year?: unknown;
    month?: unknown;
    storeName?: unknown;
    employeeName?: unknown;
    contractType?: unknown;
    amount?: unknown;
    note?: unknown;
  };
  const items: Entry[] = Array.isArray(body.items) ? body.items : [];
  const updatedByName =
    auth.session.displayName || auth.session.storeName || "admin";

  type Cleaned = {
    id?: number;
    year: number;
    month: number;
    storeName: string;
    employeeName: string | null;
    contractType: string | null;
    amount: number;
    note: string | null;
  };
  const cleaned: Cleaned[] = items
    .map((r) => {
      const id = typeof r.id === "number" ? r.id : undefined;
      const year =
        typeof r.year === "number" ? r.year : parseInt(String(r.year ?? ""), 10);
      const month =
        typeof r.month === "number" ? r.month : parseInt(String(r.month ?? ""), 10);
      const storeName = typeof r.storeName === "string" ? r.storeName.trim() : "";
      const employeeName =
        typeof r.employeeName === "string" && r.employeeName.trim()
          ? r.employeeName.trim()
          : null;
      const contractType =
        typeof r.contractType === "string" && r.contractType.trim()
          ? r.contractType.trim()
          : null;
      const amount =
        typeof r.amount === "number"
          ? Math.round(r.amount)
          : parseInt(String(r.amount ?? "0").replace(/,/g, ""), 10);
      const note = typeof r.note === "string" ? r.note : null;
      return { id, year, month, storeName, employeeName, contractType, amount, note };
    })
    .filter(
      (r) =>
        !isNaN(r.year) &&
        !isNaN(r.month) &&
        r.month >= 1 &&
        r.month <= 12 &&
        r.storeName.length > 0 &&
        !isNaN(r.amount),
    );

  try {
    // 本部一括経費の保存失敗（tx 5秒タイムアウト超過）と同じ轍を踏まないよう、
    // 逐次処理でも余裕を持ったタイムアウトを設定する。
    await prisma.$transaction(
      async (tx) => {
        for (const r of cleaned) {
          // 金額0は「その行を削除」の意味（既存行のみ）。
          if (r.amount === 0) {
            if (r.id !== undefined) {
              await tx.manualPayrollEntry.deleteMany({ where: { id: r.id } });
            }
            continue;
          }
          if (r.id !== undefined) {
            await tx.manualPayrollEntry.updateMany({
              where: { id: r.id },
              data: {
                year: r.year,
                month: r.month,
                storeName: r.storeName,
                employeeName: r.employeeName,
                contractType: r.contractType,
                amount: r.amount,
                note: r.note,
                updatedByName,
              },
            });
            continue;
          }
          await tx.manualPayrollEntry.create({
            data: {
              year: r.year,
              month: r.month,
              storeName: r.storeName,
              employeeName: r.employeeName,
              contractType: r.contractType,
              amount: r.amount,
              note: r.note,
              updatedByName,
            },
          });
        }
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (e) {
    logError("PUT /api/settings/manual-payroll transaction error:", e);
    return NextResponse.json(
      { error: "保存に失敗しました（サーバー側でエラーが発生しました）" },
      { status: 500 },
    );
  }

  const after = await prisma.manualPayrollEntry.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }, { storeName: "asc" }],
  });
  return NextResponse.json({ ok: true, items: after });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (!isAdmin(auth.session.role)) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const { searchParams } = request.nextUrl;
  const id = parseInt(searchParams.get("id") || "", 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  await prisma.manualPayrollEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
