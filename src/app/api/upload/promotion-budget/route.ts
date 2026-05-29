import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireStoreUploadAccess } from "@/lib/auth";
import { decodeFileBuffer, parseCSV } from "@/lib/csv-utils";
import {
  PROMOTION_BUDGET_CATEGORIES,
  extractPromotionBudgetRecords,
} from "@/lib/promotion-budget-parse";

/**
 * 販促報告シート（予算実績対比表の「販促報告」タブ）から、
 * 売上系の予算CSVには含まれない KPI 予算を取り込む。
 *
 * 取込対象（BudgetData カテゴリ）:
 *   - 体験者数   = 紹介からの体験数（予算） + 紹介以外からの体験数（予算）
 *   - 新規入会数 = 入会数（予算）
 *   - 退会数     = 退会数（予算）
 *
 * これにより店舗比較の「店舗別新規体験者数」「店舗別入会率」に
 * 店舗ごとの予算折れ線が表示できるようになる。
 *
 * シート様式: col1=行ラベル, col2〜col13=10月〜9月（単一列・千円ではなく実数の件数/人数）, col14=合計。
 * 予算/実績/前年/予実差 がそれぞれ別行で、ラベル末尾の「（予算）」で判別する。
 */

// このエンドポイントが管理する BudgetData カテゴリ（削除スコープもこれに限定）
const MANAGED_CATEGORIES = PROMOTION_BUDGET_CATEGORIES;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const store = searchParams.get("store") || "";
    const fiscalYear = parseInt(searchParams.get("fiscalYear") || "", 10);
    if (!store || isNaN(fiscalYear)) {
      return NextResponse.json(
        { error: "store, fiscalYear are required" },
        { status: 400 },
      );
    }
    const auth = await requireStoreUploadAccess(store);
    if (auth.error) return auth.error;

    const count = await prisma.budgetData.count({
      where: {
        storeName: store,
        year: { in: [fiscalYear - 1, fiscalYear] },
        category: { in: [...MANAGED_CATEGORIES] },
      },
    });
    return NextResponse.json({ exists: count > 0, count });
  } catch (error) {
    console.error("Promotion budget check error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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

    if (!file || !store || isNaN(fiscalYear)) {
      return NextResponse.json(
        { error: "file, store, fiscalYear are required" },
        { status: 400 },
      );
    }

    const auth = await requireStoreUploadAccess(store);
    if (auth.error) return auth.error;

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    // エンコーディング自動判定（UTF-8優先→Shift_JIS）
    const text = decodeFileBuffer(buffer);
    const allRows = parseCSV(text);
    if (allRows.length < 2) {
      return NextResponse.json({ error: "CSVにデータ行がありません" }, { status: 400 });
    }

    const records = extractPromotionBudgetRecords(allRows, store, fiscalYear);

    if (records.length === 0) {
      return NextResponse.json(
        {
          error:
            "予算データを検出できませんでした。販促報告シートに「入会数（予算）」「紹介からの体験数（予算）」等の行が含まれているか確認してください。",
        },
        { status: 400 },
      );
    }

    const years = [...new Set(records.map((r) => r.year))];
    await prisma.$transaction(async (tx) => {
      // 削除は本エンドポイント管理カテゴリ（体験者数/新規入会数/退会数）のみにスコープし、
      // 売上・経費系の予算は絶対に消さない。
      await tx.budgetData.deleteMany({
        where: {
          storeName: store,
          year: { in: years },
          category: { in: [...MANAGED_CATEGORIES] },
        },
      });
      await tx.budgetData.createMany({ data: records, skipDuplicates: true });
      await tx.uploadLog.create({
        data: {
          userId: session.userId,
          userName: session.displayName || session.storeName || "ユーザー",
          dataType: "promotion_budget",
          storeName: store,
          year: fiscalYear,
          fileName: file.name,
          recordCount: records.length,
          note: `${fiscalYear}年度 KPI予算（体験者数/新規入会数/退会数）`,
        },
      });
    }, { timeout: 30000 });

    return NextResponse.json({
      records: records.length,
      categories: [...new Set(records.map((r) => r.category))],
    });
  } catch (error) {
    console.error("Promotion budget upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
