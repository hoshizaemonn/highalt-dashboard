import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const store = searchParams.get("store") ?? "";

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    const rows = await prisma.expenseData.findMany({
      where: {
        year,
        month,
        storeName: store,
        isRevenue: 0,
      },
      orderBy: { day: "asc" },
      select: {
        id: true,
        day: true,
        description: true,
        amount: true,
        category: true,
        breakdown: true,
      },
    });

    // Match Amazon orders to fill breakdown for AMAZON expenses
    const amazonRows = await prisma.amazonOrder.findMany({
      where: {
        paymentDate: { startsWith: `${year}/${String(month).padStart(2, "0")}` },
        storeName: store,
      },
      select: {
        shortName: true,
        amount: true,
        orderTotal: true,
        paymentDate: true,
        storeName: true,
      },
    });

    const enriched = rows.map((row) => {
      // If breakdown already set, keep it
      if (row.breakdown && row.breakdown.trim()) return row;

      // Only match AMAZON-related descriptions
      const desc = (row.description || "").toUpperCase();
      if (!desc.includes("AMAZON") && !desc.includes("ＡＭＡＺｏＮ")) return row;

      const amt = Math.round(row.amount);
      const dayStr = `${year}/${String(month).padStart(2, "0")}/${String(row.day).padStart(2, "0")}`;

      // Priority 1: exact payment_date + store + order_total
      let matched = amazonRows.filter(
        (a) => a.paymentDate === dayStr && a.storeName === store && a.orderTotal === amt,
      );

      // Priority 2: month + store + order_total
      if (matched.length === 0) {
        matched = amazonRows.filter(
          (a) => a.storeName === store && a.orderTotal === amt,
        );
      }

      // Priority 3: month + store + individual amount
      if (matched.length === 0) {
        matched = amazonRows.filter(
          (a) => a.storeName === store && a.amount === amt,
        );
      }

      if (matched.length > 0) {
        const names = [...new Set(matched.map((m) => m.shortName).filter(Boolean))];
        return { ...row, breakdown: names.join(" / ") };
      }

      return row;
    });

    return NextResponse.json({ expenses: enriched });
  } catch (err) {
    console.error("GET /api/dashboard/expenses error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Support batch: { updates: [...] } or single: { id, ... }
    const updates: Array<{
      id: number;
      category?: string;
      amount?: number;
      breakdown?: string;
    }> = body.updates ?? [body];

    if (!updates.length || !updates[0].id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 },
      );
    }

    // Run updates sequentially (Supabase connection pool limit)
    const results = [];
    for (const update of updates) {
      const data: Record<string, unknown> = {};
      if (update.category !== undefined) data.category = update.category;
      if (update.amount !== undefined) data.amount = update.amount;
      if (update.breakdown !== undefined) data.breakdown = update.breakdown;

      if (Object.keys(data).length === 0) continue;

      const result = await prisma.expenseData.update({
        where: { id: update.id },
        data,
      });
      results.push(result);
    }

    return NextResponse.json({ updated: results.length });
  } catch (err) {
    console.error("PUT /api/dashboard/expenses error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
