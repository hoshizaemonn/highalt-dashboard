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

    return NextResponse.json({ expenses: rows });
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
