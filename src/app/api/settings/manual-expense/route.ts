import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

/**
 * 本部一括経費 API。電気代・水道代・家賃など本部で一括支払いし
 * 各店の PayPay 銀行 CSV には現れない経費を admin が月次で入力する。
 * 集計時は totalAmount を営業店舗数で均等按分（dashboard route 参照）。
 *
 * - GET: admin のみ
 * - PUT: admin のみ（バルク upsert）
 * - DELETE: admin のみ（id 指定）
 */

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");

  const where: { year?: number; month?: number } = {};
  if (yearParam) {
    const y = parseInt(yearParam, 10);
    if (!isNaN(y)) where.year = y;
  }
  if (monthParam) {
    const m = parseInt(monthParam, 10);
    if (!isNaN(m)) where.month = m;
  }

  const rows = await prisma.manualExpenseEntry.findMany({
    where,
    orderBy: [{ year: "desc" }, { month: "desc" }, { category: "asc" }],
  });
  return NextResponse.json({ items: rows });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await request.json();
  type Entry = {
    year?: unknown;
    month?: unknown;
    category?: unknown;
    totalAmount?: unknown;
    note?: unknown;
  };
  const items: Entry[] = Array.isArray(body.items) ? body.items : [];

  const updatedByName =
    auth.session.displayName || auth.session.storeName || "admin";

  type Cleaned = {
    year: number;
    month: number;
    category: string;
    totalAmount: number;
    note: string | null;
  };
  const cleaned: Cleaned[] = items
    .map((r) => {
      const year = typeof r.year === "number" ? r.year : parseInt(String(r.year ?? ""), 10);
      const month =
        typeof r.month === "number" ? r.month : parseInt(String(r.month ?? ""), 10);
      const category = typeof r.category === "string" ? r.category.trim() : "";
      const totalAmount =
        typeof r.totalAmount === "number"
          ? Math.round(r.totalAmount)
          : parseInt(String(r.totalAmount ?? "0").replace(/,/g, ""), 10);
      const note = typeof r.note === "string" ? r.note : null;
      return { year, month, category, totalAmount, note };
    })
    .filter(
      (r) =>
        !isNaN(r.year) &&
        !isNaN(r.month) &&
        r.month >= 1 &&
        r.month <= 12 &&
        r.category.length > 0 &&
        !isNaN(r.totalAmount),
    );

  await prisma.$transaction(async (tx) => {
    for (const r of cleaned) {
      if (r.totalAmount === 0) {
        await tx.manualExpenseEntry.deleteMany({
          where: { year: r.year, month: r.month, category: r.category },
        });
        continue;
      }
      await tx.manualExpenseEntry.upsert({
        where: {
          year_month_category: {
            year: r.year,
            month: r.month,
            category: r.category,
          },
        },
        create: {
          year: r.year,
          month: r.month,
          category: r.category,
          totalAmount: r.totalAmount,
          note: r.note,
          updatedByName,
        },
        update: {
          totalAmount: r.totalAmount,
          note: r.note,
          updatedByName,
        },
      });
    }
  });

  const after = await prisma.manualExpenseEntry.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }, { category: "asc" }],
  });
  return NextResponse.json({ ok: true, items: after });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const { searchParams } = request.nextUrl;
  const id = parseInt(searchParams.get("id") || "", 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  await prisma.manualExpenseEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
