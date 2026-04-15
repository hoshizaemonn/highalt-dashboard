import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { BUDGET_ITEMS } from "@/lib/constants";
import { decodeFileBuffer, parseCSV, safeInt } from "@/lib/csv-utils";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const store = searchParams.get("store") || "";
    const fiscalYear = parseInt(searchParams.get("fiscalYear") || "", 10);

    if (!store || isNaN(fiscalYear)) {
      return NextResponse.json(
        { error: "store, fiscalYear are required" },
        { status: 400 },
      );
    }

    const count = await prisma.budgetData.count({
      where: { storeName: store, year: fiscalYear },
    });

    return NextResponse.json({
      exists: count > 0,
      count,
    });
  } catch (error) {
    console.error("Budget check error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const store = formData.get("store") as string;
    const fiscalYear = parseInt(formData.get("fiscalYear") as string, 10);
    const period = parseInt(formData.get("period") as string, 10);

    if (!file || !store || isNaN(fiscalYear)) {
      return NextResponse.json(
        { error: "file, store, fiscalYear are required" },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const text = decodeFileBuffer(buffer, "shift_jis");
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return NextResponse.json(
        { error: "CSVにデータ行がありません" },
        { status: 400 },
      );
    }

    // Budget CSV (予算実績対比表) format:
    // Each month has 4 columns: 予算, 実績, 予算差, 予算比
    // Row structure: category name, then 4 cols x 12 months + totals
    // We extract the 予算 column (first of each group of 4) for 12 months

    // Determine fiscal year start month (period parameter)
    // If period=9, fiscal year starts in September
    // Month mapping: col 0 = category, then groups of 4
    const fiscalStartMonth = isNaN(period) ? 9 : period;

    interface BudgetRecord {
      storeName: string;
      year: number;
      month: number;
      category: string;
      amount: number;
    }

    const records: BudgetRecord[] = [];

    // Skip header rows - find data rows by matching against known BUDGET_ITEMS
    const budgetItemSet = new Set(BUDGET_ITEMS as readonly string[]);

    for (const row of allRows) {
      if (row.length < 5) continue;

      const categoryName = row[0]?.trim();
      if (!categoryName || !budgetItemSet.has(categoryName)) continue;

      // Extract budget values for 12 months
      // Each month occupies 4 columns starting at column 1
      for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
        const budgetColIdx = 1 + monthIdx * 4; // 予算 is first of each 4-col group

        if (budgetColIdx >= row.length) break;

        const amount = safeInt(row[budgetColIdx]);

        // Calculate actual year and month
        const actualMonth =
          ((fiscalStartMonth - 1 + monthIdx) % 12) + 1;
        const actualYear =
          actualMonth >= fiscalStartMonth
            ? fiscalYear
            : fiscalYear + 1;

        records.push({
          storeName: store,
          year: actualYear,
          month: actualMonth,
          category: categoryName,
          amount,
        });
      }
    }

    // Delete existing budget data for this store and year range, then insert
    // Use sequential operations instead of transaction to avoid pool limits
    const years = [...new Set(records.map((r) => r.year))];
    for (const y of years) {
      await prisma.budgetData.deleteMany({
        where: { storeName: store, year: y },
      });
    }

    // Insert one by one to handle upsert for duplicates
    let savedCount = 0;
    for (const rec of records) {
      try {
        await prisma.budgetData.upsert({
          where: {
            storeName_year_month_category: {
              storeName: rec.storeName,
              year: rec.year,
              month: rec.month,
              category: rec.category,
            },
          },
          update: { amount: rec.amount },
          create: rec,
        });
        savedCount++;
      } catch (e) {
        console.error("Budget upsert error:", rec, e);
      }
    }

    await prisma.uploadLog.create({
      data: {
        userId: session.userId,
        userName: session.displayName || session.storeName || "ユーザー",
        dataType: "budget",
        storeName: store,
        year: fiscalYear,
        fileName: file.name,
        recordCount: savedCount,
        note: `${fiscalYear}年度 期首月${fiscalStartMonth}月`,
      },
    });

    return NextResponse.json({
      records: records.length,
      categories: [...new Set(records.map((r) => r.category))],
    });
  } catch (error) {
    console.error("Budget upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
