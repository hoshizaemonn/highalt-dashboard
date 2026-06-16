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
    id?: unknown;
    year?: unknown;
    month?: unknown;
    category?: unknown;
    storeName?: unknown;
    totalAmount?: unknown;
    note?: unknown;
  };
  const items: Entry[] = Array.isArray(body.items) ? body.items : [];

  const updatedByName =
    auth.session.displayName || auth.session.storeName || "admin";

  type Cleaned = {
    id?: number;
    year: number;
    month: number;
    category: string;
    storeName: string;
    totalAmount: number;
    note: string | null;
  };
  const cleaned: Cleaned[] = items
    .map((r) => {
      const id = typeof r.id === "number" ? r.id : undefined;
      const year = typeof r.year === "number" ? r.year : parseInt(String(r.year ?? ""), 10);
      const month =
        typeof r.month === "number" ? r.month : parseInt(String(r.month ?? ""), 10);
      const category = typeof r.category === "string" ? r.category.trim() : "";
      // storeName 空 = 本部一括（均等按分）、店舗名指定 = その店のみ
      const storeName = typeof r.storeName === "string" ? r.storeName.trim() : "";
      const totalAmount =
        typeof r.totalAmount === "number"
          ? Math.round(r.totalAmount)
          : parseInt(String(r.totalAmount ?? "0").replace(/,/g, ""), 10);
      const note = typeof r.note === "string" ? r.note : null;
      return { id, year, month, category, storeName, totalAmount, note };
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
        if (r.id !== undefined) {
          await tx.manualExpenseEntry.deleteMany({ where: { id: r.id } });
        } else {
          await tx.manualExpenseEntry.deleteMany({
            where: {
              year: r.year,
              month: r.month,
              category: r.category,
              storeName: r.storeName,
            },
          });
        }
        continue;
      }
      // 既存ID指定時: 必ずそのレコードを id ベースで update（カテゴリ等の主キー変更も同一レコードで反映）
      // これにより、ユーザーがカテゴリや月を変更した際に「新規追加されてしまうバグ」を回避。
      if (r.id !== undefined) {
        try {
          await tx.manualExpenseEntry.update({
            where: { id: r.id },
            data: {
              year: r.year,
              month: r.month,
              category: r.category,
              storeName: r.storeName,
              totalAmount: r.totalAmount,
              note: r.note,
              updatedByName,
            },
          });
          continue;
        } catch {
          // unique制約違反（移動先キーに既存行あり）等は fall-through で upsert に任せる
        }
      }
      await tx.manualExpenseEntry.upsert({
        where: {
          year_month_category_storeName: {
            year: r.year,
            month: r.month,
            category: r.category,
            storeName: r.storeName,
          },
        },
        create: {
          year: r.year,
          month: r.month,
          category: r.category,
          storeName: r.storeName,
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
