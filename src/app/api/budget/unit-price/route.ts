import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStoreUploadAccess } from "@/lib/auth";
import { BUDGET_CATEGORY_UNIT_PRICE } from "@/lib/constants";

// Fiscal year months: Oct(fy-1), Nov(fy-1), Dec(fy-1), Jan(fy), ..., Sep(fy)
function fiscalYearMonths(fiscalYear: number): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  for (let m = 10; m <= 12; m++) months.push({ year: fiscalYear - 1, month: m });
  for (let m = 1; m <= 9; m++) months.push({ year: fiscalYear, month: m });
  return months;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const store = searchParams.get("store") || "";
  const fiscalYear = parseInt(searchParams.get("fiscalYear") || "", 10);

  if (!store || isNaN(fiscalYear)) {
    return NextResponse.json(
      { error: "store, fiscalYear are required" },
      { status: 400 },
    );
  }

  // 非adminは自店舗以外の客単価予算を閲覧不可
  const auth = await requireStoreUploadAccess(store);
  if (auth.error) return auth.error;

  const months = fiscalYearMonths(fiscalYear);
  const rows = await prisma.budgetData.findMany({
    where: {
      storeName: store,
      category: BUDGET_CATEGORY_UNIT_PRICE,
      OR: months.map(({ year, month }) => ({ year, month })),
    },
  });

  const byKey = new Map<string, number>();
  for (const r of rows) byKey.set(`${r.year}-${r.month}`, r.amount);

  return NextResponse.json({
    store,
    fiscalYear,
    months: months.map(({ year, month }) => ({
      year,
      month,
      amount: byKey.get(`${year}-${month}`) ?? 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as
    | { store?: string; fiscalYear?: number; amount?: number }
    | null;

  const store = body?.store;
  const fiscalYear = body?.fiscalYear;
  const amount = body?.amount;

  if (!store || typeof fiscalYear !== "number" || typeof amount !== "number") {
    return NextResponse.json(
      { error: "store, fiscalYear, amount are required" },
      { status: 400 },
    );
  }

  // 非adminは自店舗以外の客単価予算を編集不可
  const auth = await requireStoreUploadAccess(store);
  if (auth.error) return auth.error;

  if (amount < 0 || !Number.isFinite(amount)) {
    return NextResponse.json({ error: "amount must be a non-negative finite number" }, { status: 400 });
  }

  const rounded = Math.round(amount);
  const months = fiscalYearMonths(fiscalYear);

  await prisma.$transaction(async (tx) => {
    for (const { year, month } of months) {
      await tx.budgetData.upsert({
        where: {
          storeName_year_month_category: {
            storeName: store,
            year,
            month,
            category: BUDGET_CATEGORY_UNIT_PRICE,
          },
        },
        update: { amount: rounded },
        create: {
          storeName: store,
          year,
          month,
          category: BUDGET_CATEGORY_UNIT_PRICE,
          amount: rounded,
        },
      });
    }
  });

  return NextResponse.json({ ok: true, saved: months.length });
}
