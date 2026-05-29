import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireStoreUploadAccess } from "@/lib/auth";
import { BUDGET_ITEMS, BUDGET_CATEGORY_UNIT_PRICE } from "@/lib/constants";
import { decodeFileBuffer, parseCSV, safeInt } from "@/lib/csv-utils";
import {
  isPromotionReportCsv,
  extractPromotionBudgetRecords,
  PROMOTION_BUDGET_CATEGORIES,
} from "@/lib/promotion-budget-parse";
import { parseBudgetFilename } from "@/lib/budget-filename";

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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    let store = formData.get("store") as string;
    let fiscalYear = parseInt(formData.get("fiscalYear") as string, 10);
    let period = parseInt(formData.get("period") as string, 10);

    if (!file) {
      return NextResponse.json(
        { error: "file is required" },
        { status: 400 },
      );
    }

    // ファイル名から 店舗 / 決算年 / 期 を自動判別し、取れた値で上書きする
    // （別店舗のファイルを誤った店舗で取り込む事故を防ぐ。坪井さん要望）
    const fn = parseBudgetFilename(file.name);
    if (fn.store) store = fn.store;
    if (fn.fiscalYear) fiscalYear = fn.fiscalYear;
    if (fn.period) period = fn.period;

    if (!store || isNaN(fiscalYear)) {
      return NextResponse.json(
        {
          error:
            "ファイル名から店舗・年度を判別できませんでした。ファイル名に「2026_9期（○○スタジオ）」のように年度・期・店舗名を含めてください。",
        },
        { status: 400 },
      );
    }

    // 店舗スコープ厳格化: 非adminは自店舗以外への保存を拒否（ファイル名判別後の最終店舗で検証）
    const auth = await requireStoreUploadAccess(store);
    if (auth.error) return auth.error;

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    // エンコーディング自動判定（UTF-8優先→Shift_JIS）。
    // 注意: shift_jis 優先にすると UTF-8 ファイルが例外を出さず文字化けし、
    // 「販促報告」等の判定キーワードを取りこぼすため、preference は付けない。
    const text = decodeFileBuffer(buffer);
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return NextResponse.json(
        { error: "CSVにデータ行がありません" },
        { status: 400 },
      );
    }

    // ── サーバー側フォールバック自動判別 ──────────────────────
    // 販促報告シート（体験者数/入会数/退会数のKPI予算）がこのエンドポイントに
    // 来た場合でも正しく処理する。予算実績対比表とは行レイアウトが異なり、
    // BUDGET_ITEMS のマッチでは 0 件になってしまうため、内容で振り分ける。
    if (isPromotionReportCsv(text)) {
      const promoRecords = extractPromotionBudgetRecords(
        allRows,
        store,
        fiscalYear,
      );
      if (promoRecords.length === 0) {
        return NextResponse.json(
          {
            error:
              "販促報告シートと判定しましたが、予算行（入会数（予算）/紹介からの体験数（予算）等）を検出できませんでした。",
          },
          { status: 400 },
        );
      }
      const promoYears = [...new Set(promoRecords.map((r) => r.year))];
      await prisma.$transaction(async (tx) => {
        await tx.budgetData.deleteMany({
          where: {
            storeName: store,
            year: { in: promoYears },
            category: { in: [...PROMOTION_BUDGET_CATEGORIES] },
          },
        });
        await tx.budgetData.createMany({
          data: promoRecords,
          skipDuplicates: true,
        });
        await tx.uploadLog.create({
          data: {
            userId: session.userId,
            userName: session.displayName || session.storeName || "ユーザー",
            dataType: "promotion_budget",
            storeName: store,
            year: fiscalYear,
            fileName: file.name,
            recordCount: promoRecords.length,
            note: `${fiscalYear}年度 KPI予算（体験者数/新規入会数/退会数・自動判別）`,
          },
        });
      }, { timeout: 30000 });
      return NextResponse.json({
        records: promoRecords.length,
        categories: [...new Set(promoRecords.map((r) => r.category))],
        detected: "promotion",
        store,
        fiscalYear,
        period,
      });
    }

    // Budget CSV は2つのレイアウトがある:
    //   - 予算実績対比表: 月ごとに4列（予算/実績/予算差/予算比）
    //   - 予算書: 月ごとに1列（予算のみ）
    // どちらでも正しく読むため、ヘッダ行の月ラベル（10月〜9月）の実列位置を検出する。
    // 値は千円単位 → 円に変換。会計年度: Oct(fy-1)〜Sep(fy)。
    const fyMonths: { year: number; month: number }[] = [];
    for (let m = 10; m <= 12; m++) fyMonths.push({ year: fiscalYear - 1, month: m });
    for (let m = 1; m <= 9; m++) fyMonths.push({ year: fiscalYear, month: m });

    // 会計年度順の月ラベル
    const monthLabelsInOrder = [
      "10月", "11月", "12月", "1月", "2月", "3月",
      "4月", "5月", "6月", "7月", "8月", "9月",
    ];
    // ヘッダ行（月ラベルが最も多く並ぶ行）から 月→列インデックス を検出。
    // 「合計」列を January 等と誤認しないよう、各月ラベルの実位置を使う。
    let monthColIdx: (number | undefined)[] = [];
    let bestHits = 0;
    for (const row of allRows.slice(0, 8)) {
      const cols: (number | undefined)[] = new Array(12).fill(undefined);
      let hits = 0;
      for (let ci = 0; ci < row.length; ci++) {
        const t = (row[ci] ?? "").trim();
        const mi = monthLabelsInOrder.indexOf(t);
        if (mi >= 0 && cols[mi] === undefined) {
          cols[mi] = ci;
          hits++;
        }
      }
      if (hits > bestHits) {
        bestHits = hits;
        monthColIdx = cols;
      }
    }
    // ヘッダ検出に失敗した場合は従来の4列/月レイアウトにフォールバック
    if (bestHits < 10) {
      monthColIdx = fyMonths.map((_, i) => 1 + i * 4);
    }

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

      for (let i = 0; i < fyMonths.length; i++) {
        const colIdx = monthColIdx[i];
        if (colIdx === undefined || colIdx >= row.length) continue;

        const valStr = row[colIdx].trim().replace(/,/g, "").replace(/"/g, "").replace(/ /g, "");
        if (!valStr || valStr === "0" || valStr === "-") continue;

        const amount = parseInt(valStr, 10) * 1000; // 千円単位 → 円
        if (isNaN(amount)) continue;

        records.push({
          storeName: store,
          year: fyMonths[i].year,
          month: fyMonths[i].month,
          category: categoryName,
          amount,
        });
      }
    }

    // Delete + insert inside a transaction to prevent partial state
    const years = [...new Set(records.map((r) => r.year))];

    // 接続プール枯渇を避けるため、upsertループ → createMany バッチに変更。
    // 削除→一括insert で 1 + 1 + 1 = 3クエリ（旧: 1 + N + 1 = 191クエリ）。
    await prisma.$transaction(async (tx) => {
      // Preserve manually-entered unit price budget across CSV re-uploads
      await tx.budgetData.deleteMany({
        where: {
          storeName: store,
          year: { in: years },
          category: { not: BUDGET_CATEGORY_UNIT_PRICE },
        },
      });

      if (records.length > 0) {
        await tx.budgetData.createMany({
          data: records,
          skipDuplicates: true,
        });
      }

      await tx.uploadLog.create({
        data: {
          userId: session.userId,
          userName: session.displayName || session.storeName || "ユーザー",
          dataType: "budget",
          storeName: store,
          year: fiscalYear,
          fileName: file.name,
          recordCount: records.length,
          note: `${fiscalYear}年度 第${period || 9}期`,
        },
      });

      return records.length;
    }, { timeout: 30000 });

    return NextResponse.json({
      records: records.length,
      categories: [...new Set(records.map((r) => r.category))],
      detected: "budget",
      store,
      fiscalYear,
      period,
    });
  } catch (error) {
    console.error("Budget upload error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
