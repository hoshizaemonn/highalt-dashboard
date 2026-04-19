import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STORES } from "@/lib/constants";

// Extract plan name from PL001 description like "スタンダード会員S 月会費 (202510)x1"
const PLAN_RE = /^(.+?)\s+(?:月会費|初月会費)/;

function extractPlanFromDesc(desc: string): string | null {
  // Description may contain multiple items separated by ", "
  // We want the first one that matches 月会費
  for (const part of desc.split(",")) {
    const trimmed = part.trim();
    const match = trimmed.match(PLAN_RE);
    if (match) return match[1].trim();
  }
  return null;
}

type PlanEntry = { name: string; count: number };
type StorePlanData = { store: string; plans: PlanEntry[]; total: number };

function buildPlanList(counts: Record<string, number>): PlanEntry[] {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => ({ name, count }));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const store = searchParams.get("store") || undefined;
    const byStore = searchParams.get("byStore") === "1";

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    // Try ML001 (member data) first
    const members = await prisma.memberData.findMany({
      where: {
        year,
        month,
        isActive: 1,
        ...(store && { storeName: store }),
      },
      select: { planName: true, storeName: true },
    });

    let source: "member" | "sales" = "member";
    let planItems: { plan: string; storeName: string }[] = [];

    if (members.length > 0) {
      // Use ML001 data
      planItems = members.map((m) => ({
        plan: m.planName || "不明",
        storeName: m.storeName,
      }));
    } else {
      // Fallback: derive from PL001 (sales_detail) monthly fee records
      // Match description containing 月会費 with category = 月会費
      source = "sales";
      const salesRows = await prisma.salesDetail.findMany({
        where: {
          year,
          month,
          category: "月会費",
          ...(store && { storeName: store }),
        },
        select: { description: true, storeName: true, saleId: true },
      });

      // Extract plan name from description, deduplicate by saleId
      const seen = new Set<string>();
      for (const row of salesRows) {
        if (!row.description) continue;
        // Deduplicate by saleId (one sale = one member's monthly payment)
        if (row.saleId && seen.has(row.saleId)) continue;
        if (row.saleId) seen.add(row.saleId);

        const plan = extractPlanFromDesc(row.description);
        if (plan) {
          planItems.push({ plan, storeName: row.storeName });
        }
      }
    }

    // Aggregate
    const planCounts: Record<string, number> = {};
    for (const item of planItems) {
      planCounts[item.plan] = (planCounts[item.plan] || 0) + 1;
    }

    const plans = buildPlanList(planCounts);

    // Per-store breakdown
    let byStoreData: StorePlanData[] | undefined;
    if (byStore) {
      byStoreData = STORES.map((s) => {
        const items = planItems.filter((m) => m.storeName === s);
        const counts: Record<string, number> = {};
        for (const m of items) {
          counts[m.plan] = (counts[m.plan] || 0) + 1;
        }
        return {
          store: s,
          plans: buildPlanList(counts),
          total: items.length,
        };
      }).filter((s) => s.total > 0);
    }

    return NextResponse.json({
      year,
      month,
      store: store ?? null,
      source,
      plans,
      total: planItems.length,
      ...(byStoreData && { byStore: byStoreData }),
    });
  } catch (error) {
    console.error("Plan breakdown API error:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
