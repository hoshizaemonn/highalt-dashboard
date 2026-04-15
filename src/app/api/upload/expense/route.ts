import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { decodeFileBuffer, parseCSV, safeFloat } from "@/lib/csv-utils";

/**
 * Classify a transaction description using expense_rules table.
 * Returns { category, isRevenue }.
 */
function classifyExpense(
  description: string,
  rules: { keyword: string; category: string }[],
): { category: string | null; isRevenue: boolean } {
  if (!description) return { category: null, isRevenue: false };

  const descUpper = description.toUpperCase();

  for (const rule of rules) {
    const keyUpper = rule.keyword.toUpperCase();
    if (keyUpper && descUpper.includes(keyUpper)) {
      if (rule.category === "_収入") {
        return { category: "_収入", isRevenue: true };
      }
      return { category: rule.category, isRevenue: false };
    }
    // Also try exact match (for full-width chars)
    if (rule.keyword && description.includes(rule.keyword)) {
      if (rule.category === "_収入") {
        return { category: "_収入", isRevenue: true };
      }
      return { category: rule.category, isRevenue: false };
    }
  }

  return { category: null, isRevenue: false };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year") || "", 10);
    const month = parseInt(searchParams.get("month") || "", 10);
    const store = searchParams.get("store") || "";

    if (isNaN(year) || isNaN(month) || !store) {
      return NextResponse.json(
        { error: "year, month, store are required" },
        { status: 400 },
      );
    }

    const count = await prisma.expenseData.count({
      where: { year, month, storeName: store },
    });

    return NextResponse.json({
      exists: count > 0,
      count,
    });
  } catch (error) {
    console.error("Expense check error:", error);
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

    const contentType = request.headers.get("content-type") || "";

    // ─── Save action (JSON body) ─────────────────────────────
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { action, records: inputRecords, store, year, month } = body;

      if (action !== "save") {
        return NextResponse.json(
          { error: "Invalid action" },
          { status: 400 },
        );
      }

      if (!Array.isArray(inputRecords) || inputRecords.length === 0) {
        return NextResponse.json(
          { error: "records array is required" },
          { status: 400 },
        );
      }

      if (!store || isNaN(year) || isNaN(month)) {
        return NextResponse.json(
          { error: "store, year, month are required" },
          { status: 400 },
        );
      }

      // Delete existing expense data for this year/month/store, then insert
      await prisma.$transaction(async (tx) => {
        await tx.expenseData.deleteMany({
          where: { year, month, storeName: store },
        });

        if (inputRecords.length > 0) {
          await tx.expenseData.createMany({
            data: inputRecords.map((rec: {
              year?: number;
              month?: number;
              day: number;
              description: string;
              amount: number;
              deposit: number;
              category: string | null;
              isRevenue?: boolean;
              breakdown?: string;
            }) => ({
              year: rec.year || year,
              month: rec.month || month,
              day: rec.day,
              storeName: store,
              description: rec.description,
              amount: rec.amount,
              deposit: rec.deposit,
              category: rec.category || null,
              isRevenue: rec.isRevenue ? 1 : 0,
              breakdown: rec.breakdown || "",
            })),
          });
        }

        // Count classified/unclassified for log
        let classified = 0;
        let unclassified = 0;
        for (const rec of inputRecords) {
          if (rec.category) {
            classified++;
          } else {
            unclassified++;
          }
        }

        await tx.uploadLog.create({
          data: {
            userId: session.userId,
            userName: session.displayName || session.storeName || "ユーザー",
            dataType: "expense",
            storeName: store,
            year,
            month,
            fileName: "PayPay銀行CSV",
            recordCount: inputRecords.length,
            note: `分類済み ${classified}件 / 未分類 ${unclassified}件`,
          },
        });
      });

      return NextResponse.json({
        saved: inputRecords.length,
      });
    }

    // ─── Parse action (FormData) ─────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const store = formData.get("store") as string;
    const year = parseInt(formData.get("year") as string, 10);
    const month = parseInt(formData.get("month") as string, 10);

    if (!file || !store || isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "file, store, year, month are required" },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    // PayPay bank CSV is typically cp932/shift_jis
    const text = decodeFileBuffer(buffer, "shift_jis");
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return NextResponse.json(
        { error: "CSVにデータ行がありません" },
        { status: 400 },
      );
    }

    // Load expense rules once
    const rules = await prisma.expenseRule.findMany();

    const dataRows = allRows.slice(1);
    let classified = 0;
    let unclassified = 0;

    interface ExpensePreviewRecord {
      year: number;
      month: number;
      day: number;
      description: string;
      amount: number;
      deposit: number;
      category: string | null;
      isAutoClassified: boolean;
      isRevenue: boolean;
      breakdown: string;
    }

    const records: ExpensePreviewRecord[] = [];

    for (const row of dataRows) {
      if (row.length < 12) continue;

      const rowYear = parseInt(row[0], 10);
      const rowMonth = parseInt(row[1], 10);
      const day = parseInt(row[2], 10);

      if (isNaN(day)) continue;

      const description = row[7]?.trim() || "";
      const amount = safeFloat(row[8]);
      const deposit = safeFloat(row[9]);

      const { category, isRevenue } = classifyExpense(
        description,
        rules,
      );

      if (category) {
        classified++;
      } else {
        unclassified++;
      }

      records.push({
        year: isNaN(rowYear) ? year : rowYear,
        month: isNaN(rowMonth) ? month : rowMonth,
        day,
        description,
        amount,
        deposit,
        category: category || null,
        isAutoClassified: !!category,
        isRevenue,
        breakdown: "",
      });
    }

    // Return preview only — do NOT save to DB
    return NextResponse.json({
      records,
      classified,
      unclassified,
    });
  } catch (error) {
    console.error("Expense upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
