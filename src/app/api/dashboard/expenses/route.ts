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
    // Try amazon_orders first, then fall back to product master
    const amazonRows = await prisma.amazonOrder.findMany({
      where: {
        paymentDate: { startsWith: `${year}/${String(month).padStart(2, "0")}` },
      },
      select: {
        shortName: true,
        productName: true,
        amount: true,
        orderTotal: true,
        paymentDate: true,
        storeName: true,
        asin: true,
      },
    });

    // Also load product master for ASIN-based matching
    const productMaster = await prisma.amazonProductMaster.findMany({
      select: { asin: true, productName: true },
    });
    const masterByAsin = new Map(productMaster.map((p) => [p.asin, p.productName]));

    // Normalize full-width to half-width for matching
    function normalizeToHalf(s: string): string {
      return s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    }

    const enriched = rows.map((row) => {
      if (row.breakdown && row.breakdown.trim()) return row;

      const desc = normalizeToHalf(row.description || "").toUpperCase();
      if (!desc.includes("AMAZON")) return row;

      const amt = Math.round(row.amount);

      // Try amazon_orders matching (payment_date + amount)
      if (amazonRows.length > 0) {
        const dayStr = `${year}/${String(month).padStart(2, "0")}/${String(row.day).padStart(2, "0")}`;

        let matched = amazonRows.filter(
          (a) => a.paymentDate === dayStr && a.orderTotal === amt,
        );
        if (matched.length === 0) {
          matched = amazonRows.filter((a) => a.orderTotal === amt);
        }
        if (matched.length === 0) {
          matched = amazonRows.filter((a) => a.amount === amt);
        }

        if (matched.length > 0) {
          const names = [...new Set(matched.map((m) => m.shortName || m.productName).filter(Boolean))];
          if (names.length > 0) {
            return { ...row, breakdown: names.join(" / ") };
          }
        }
      }

      // Fall back: try to extract order number from description and match
      // Description like: Vデビット AMAZON.CO.JP 1A032001
      const orderNumMatch = desc.match(/([0-9A-Z]{8,})\s*$/);
      if (orderNumMatch) {
        // Look up any amazon_order or product with matching amount
        const amtMatched = amazonRows.filter((a) => a.amount === amt || a.orderTotal === amt);
        if (amtMatched.length > 0) {
          const names = [...new Set(amtMatched.map((m) => m.shortName || m.productName).filter(Boolean))];
          if (names.length > 0) {
            return { ...row, breakdown: names.join(" / ") };
          }
        }
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

      // Auto-register expense rule when category is set
      if (update.category && result.description) {
        const rawDesc = result.description.trim();

        // Extract a meaningful keyword from the description
        // e.g. "Vデビット AMAZON.CO.JP 1A055001" → "AMAZON.CO.JP"
        // e.g. "SMBC（セコム）" → "SMBC（セコム）"
        // e.g. "振込手数料" → "振込手数料"
        // e.g. "Vデビット 印刷通販プリントパック 1A055002" → "印刷通販プリントパック"
        // e.g. "振込 カ）テレポ" → "テレポ"
        function extractKeyword(desc: string): string {
          // Remove "Vデビット " prefix
          let cleaned = desc.replace(/^Vデビット\s+/i, "");
          // Remove trailing transaction IDs (alphanumeric 6+ chars at end)
          cleaned = cleaned.replace(/\s+[0-9A-Z]{6,}$/i, "").trim();
          // If still has spaces, take the main part (skip "振込 カ）" prefix)
          if (cleaned.startsWith("振込") && cleaned.includes("）")) {
            const afterParen = cleaned.split("）").slice(1).join("）").trim();
            if (afterParen) return afterParen;
          }
          return cleaned || desc;
        }

        const keyword = extractKeyword(rawDesc);
        if (keyword && keyword.length >= 2) {
          // Check if any existing rule already covers this keyword (partial match)
          const allRules = await prisma.expenseRule.findMany();
          const alreadyCovered = allRules.some(
            (r) => keyword.toUpperCase().includes(r.keyword.toUpperCase()) ||
                   r.keyword.toUpperCase().includes(keyword.toUpperCase()),
          );

          if (!alreadyCovered) {
            try {
              await prisma.expenseRule.create({
                data: { keyword, category: update.category },
              });
            } catch {
              // Ignore duplicate key errors
            }
          } else {
            // Update the most specific matching rule's category
            const exactMatch = allRules.find(
              (r) => r.keyword.toUpperCase() === keyword.toUpperCase(),
            );
            if (exactMatch && exactMatch.category !== update.category) {
              await prisma.expenseRule.update({
                where: { id: exactMatch.id },
                data: { category: update.category },
              });
            }
          }
        }
      }
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
