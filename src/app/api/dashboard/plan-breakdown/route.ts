import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const store = searchParams.get("store") || undefined;

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    const where = {
      year,
      month,
      isActive: 1,
      ...(store && { storeName: store }),
    };

    const members = await prisma.memberData.findMany({
      where,
      select: { planName: true },
    });

    // Group by planName and count
    const planCounts: Record<string, number> = {};
    for (const m of members) {
      const plan = m.planName || "不明";
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    }

    // Sort by count descending
    const plans = Object.entries(planCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));

    return NextResponse.json({
      year,
      month,
      store: store ?? null,
      plans,
      total: members.length,
    });
  } catch (error) {
    console.error("Plan breakdown API error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
