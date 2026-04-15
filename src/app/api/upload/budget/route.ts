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
    // Each month has 4 columns: 予算/実績/予算差/予算比 starting from col index 1
    // Values are in thousands (千円単位) → multiply by 1000
    // Fiscal year: Oct(fy-1) to Sep(fy)

    // Build fiscal year month mapping: [(2025,10),(2025,11),(2025,12),(2026,1),...,(2026,9)]
    const fyMonths: { year: number; month: number }[] = [];
    for (let m = 10; m <= 12; m++) fyMonths.push({ year: fiscalYear - 1, month: m });
    for (let m = 1; m <= 9; m++) fyMonths.push({ year: fiscalYear, month: m });

    interface BudgetRecord {
      storeName: string;
      year: number;
      month: number;
      category: string;
      amount: number;
    }

    const records: BudgetRecord[] = [];
    const budgetItemSet = new Set(BUDGET_ITEMS as readonly string[]);

    for (const row of allRows) {
      if (!row || !row[0]?.trim()) continue;

      const categoryName = row[0].trim();
      if (!budgetItemSet.has(categoryName)) continue;

      // Each month has 4 columns: 予算/実績/予算差/予算比 starting from col index 1
      for (let i = 0; i < fyMonths.length; i++) {
        const colIdx = 1 + i * 4; // 予算 column (first of each group of 4)
        if (colIdx >= row.length) break;

        const valStr = row[colIdx].trim().replace(/,/g, "").replace(/"/g, "").replace(/ /g, "");
        if (!valStr || valStr === "0" || valStr === "-") continue;

        try {
          const amount = parseInt(valStr, 10) * 1000; // 千円単位 → 円
          if (isNaN(amount)) continue;

          records.push({
            storeName: store,
            year: fyMonths[i].year,
            month: fyMonths[i].month,
            category: categoryName,
            amount,
          });
        } catch {
          // Skip invalid values
        }
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
