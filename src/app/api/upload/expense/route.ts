import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireStoreUploadAccess } from "@/lib/auth";
import { decodeFileBuffer, parseCSV, safeFloat } from "@/lib/csv-utils";
import { parseAccrualMonth } from "@/lib/accrual";

/**
 * Extract a meaningful keyword from a PayPay bank description.
 * e.g. "Vデビット AMAZON.CO.JP 1A055001" → "AMAZON.CO.JP"
 */
function extractKeyword(desc: string): string {
  let cleaned = desc.replace(/^Vデビット\s+/i, "");
  cleaned = cleaned.replace(/\s+[0-9A-Z]{6,}$/i, "").trim();
  if (cleaned.startsWith("振込") && cleaned.includes("）")) {
    const afterParen = cleaned.split("）").slice(1).join("）").trim();
    if (afterParen) return afterParen;
  }
  return cleaned || desc;
}

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

    const auth = await requireStoreUploadAccess(store);
    if (auth.error) return auth.error;

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
        error: "Internal server error",
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

      // 店舗スコープ厳格化: 非adminは自店舗以外への保存を拒否
      const saveAuth = await requireStoreUploadAccess(store);
      if (saveAuth.error) return saveAuth.error;

      const csvHeaders: string[] | null = Array.isArray(body.csvHeaders)
        ? body.csvHeaders
        : null;
      // 保存モード: "overwrite"（既定・既存データ全削除→挿入）/ "append"（既存を残して追記）
      // append は同月内に経費CSV＋売上CSVを別ファイルで取り込みたいケース用（依頼③）。
      const saveMode: "overwrite" | "append" =
        body.mode === "append" ? "append" : "overwrite";

      // Delete existing expense data for this year/month/store, then insert
      await prisma.$transaction(async (tx) => {
        if (saveMode === "overwrite") {
          await tx.expenseData.deleteMany({
            where: { year, month, storeName: store },
          });
        }

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
              rawRow?: string[] | null;
            }) => {
              const rowYear = rec.year || year;
              const rowMonth = rec.month || month;
              // 内訳パース → 発生月帰属（依頼⑥・A案）
              const accrual = parseAccrualMonth(
                rec.breakdown || "",
                rowYear,
                rowMonth,
              );
              return {
                year: rowYear,
                month: rowMonth,
                day: rec.day,
                storeName: store,
                description: rec.description,
                amount: rec.amount,
                deposit: rec.deposit,
                category: rec.category || null,
                isRevenue: rec.isRevenue ? 1 : 0,
                breakdown: rec.breakdown || "",
                rawRow: rec.rawRow ? JSON.stringify(rec.rawRow) : null,
                accrualYear: accrual?.accrualYear ?? null,
                accrualMonth: accrual?.accrualMonth ?? null,
              };
            }),
          });
        }

        // Persist CSV headers (year, month, store単位) for export re-construction
        // append時は既存ヘッダを尊重し、無い時のみ新規作成（後続ファイルで列構造を壊さないため）
        if (csvHeaders && csvHeaders.length > 0) {
          if (saveMode === "append") {
            const existing = await tx.expenseCsvHeader.findUnique({
              where: {
                year_month_storeName: { year, month, storeName: store },
              },
            });
            if (!existing) {
              await tx.expenseCsvHeader.create({
                data: {
                  year,
                  month,
                  storeName: store,
                  headers: JSON.stringify(csvHeaders),
                },
              });
            }
          } else {
            await tx.expenseCsvHeader.upsert({
              where: {
                year_month_storeName: { year, month, storeName: store },
              },
              update: { headers: JSON.stringify(csvHeaders) },
              create: {
                year,
                month,
                storeName: store,
                headers: JSON.stringify(csvHeaders),
              },
            });
          }
        }

        // Auto-register expense rules for manually classified items
        for (const rec of inputRecords) {
          if (rec.category && !rec.isAutoClassified && rec.description) {
            const keyword = extractKeyword(rec.description.trim());
            if (keyword && keyword.length >= 2) {
              await tx.expenseRule.upsert({
                where: { keyword },
                update: { category: rec.category },
                create: { keyword, category: rec.category },
              });
            }
          }
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

    // 店舗スコープ厳格化: 非adminは自店舗以外へのパース／保存を拒否
    const parseAuth = await requireStoreUploadAccess(store);
    if (parseAuth.error) return parseAuth.error;

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
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

    const csvHeaders = allRows[0] ?? [];
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
      // 元CSV該当行（全列）。エクスポート時に元情報を再現するため保持。
      rawRow: string[];
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
        rawRow: row,
      });
    }

    // Return preview only — do NOT save to DB
    return NextResponse.json({
      records,
      classified,
      unclassified,
      csvHeaders,
    });
  } catch (error) {
    console.error("Expense upload error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
