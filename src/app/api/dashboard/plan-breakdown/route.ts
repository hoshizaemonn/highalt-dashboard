import { summarizePlans, planMembersForMonth } from "@/lib/plan-contracts";
import { HQ_STORE } from "@/lib/constants";
import { getHiddenStores } from "@/lib/hidden-stores";
import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, getEffectiveStoreFilter } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const requestedStore = searchParams.get("store") || undefined;
    const store = getEffectiveStoreFilter(auth.session, requestedStore, { notIn: [HQ_STORE, ...await getHiddenStores()] });

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    const where = {
      storeName: store,
    };

    const members = await prisma.memberData.findMany({
      where,
      select: { year: true, month: true, storeName: true, planName: true, isActive: true },
    });

    const plans = summarizePlans(planMembersForMonth(members, year, month));

    return NextResponse.json({
      year,
      month,
      store: store ?? null,
      plans,
      total: plans.reduce((n, p) => n + p.count, 0),
    });
  } catch (error) {
    logError("Plan breakdown API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
