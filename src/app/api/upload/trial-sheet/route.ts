import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireStoreUploadAccess } from "@/lib/auth";
import { decodeFileBuffer, parseCSV } from "@/lib/csv-utils";
import { parseTrialSheetCsv, summarizeTrialSheet } from "@/lib/trial-sheet-parse";

/**
 * 体験シート（各店舗の Google スプレッドシート → CSV エクスポート）の取込API。
 * (year, month, storeName) スコープで deleteMany → createMany（他アップロードAPIと同一パターン）。
 * 船橋のみ isFunabashi=true で別ロジック（B案）を適用する。
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const store = searchParams.get("store") || "";
    const year = parseInt(searchParams.get("year") || "", 10);
    const month = parseInt(searchParams.get("month") || "", 10);

    if (!store || isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "store, year, month are required" },
        { status: 400 },
      );
    }

    const auth = await requireStoreUploadAccess(store);
    if (auth.error) return auth.error;

    const count = await prisma.trialSheetEntry.count({
      where: { year, month, storeName: store },
    });

    return NextResponse.json({ existingCount: count });
  } catch (error) {
    logError("Trial sheet check error:", error);
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
    const year = parseInt(formData.get("year") as string, 10);
    const month = parseInt(formData.get("month") as string, 10);
    const isFunabashi = store === "船橋";
    const dryRun = formData.get("dryRun") === "true";

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!store || isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "store, year, month are required" },
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
    const text = decodeFileBuffer(buffer);
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return NextResponse.json({ error: "CSVにデータ行がありません" }, { status: 400 });
    }

    const { records, warnings } = parseTrialSheetCsv(
      allRows,
      store,
      year,
      month,
      isFunabashi,
    );

    if (records.length === 0) {
      return NextResponse.json(
        {
          error:
            warnings.join(" ") || "取り込める体験者データが見つかりませんでした。",
        },
        { status: 400 },
      );
    }

    const existingCount = await prisma.trialSheetEntry.count({
      where: { year, month, storeName: store },
    });

    if (dryRun) {
      return NextResponse.json({
        existingCount,
        records: records.length,
        summary: summarizeTrialSheet(records),
        warnings,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.trialSheetEntry.deleteMany({
        where: { year, month, storeName: store },
      });
      await tx.trialSheetEntry.createMany({
        data: records.map((r) => ({
          year: r.year,
          month: r.month,
          storeName: r.storeName,
          entryDate: r.entryDate,
          memberName: r.memberName,
          resultType: r.resultType,
          sourceFile: file.name,
        })),
      });
      await tx.uploadLog.create({
        data: {
          userId: session.userId,
          userName: session.displayName || session.storeName || "ユーザー",
          dataType: "trial_sheet",
          storeName: store,
          year,
          month,
          fileName: file.name,
          recordCount: records.length,
          note: `体験シート取込（既存${existingCount}件を置換）${isFunabashi ? "・船橋フォーマット" : ""}`,
        },
      });
    }, { timeout: 30000 });

    const summary = summarizeTrialSheet(records);

    return NextResponse.json({
      records: records.length,
      summary,
      warnings,
      store,
      year,
      month,
    });
  } catch (error) {
    logError("Trial sheet upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
