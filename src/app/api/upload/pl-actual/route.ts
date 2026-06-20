import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStoreUploadAccess } from "@/lib/auth";
import { decodeFileBuffer, parseCSV } from "@/lib/csv-utils";
import { parsePlActuals } from "@/lib/pl-csv";

/**
 * 開業からの実績累計（PL）CSV を取り込み、pl_actuals に保存する。
 * 前年比比較（人件費・消耗品費・広告宣伝費）専用のデータ源。
 *
 * - store はUIで選択（PLは店舗別ファイル）。CSV内の値ではなく選択店舗に紐付け。
 * - 同一店舗の (年,月) を一旦スコープ削除してから挿入（重複防止・上書き）。
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const store = formData.get("store") as string;
    const dryRun = formData.get("dryRun") === "true";

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!store) {
      return NextResponse.json({ error: "store is required" }, { status: 400 });
    }

    // 店舗スコープ検証（非adminは自店舗以外への書き込み禁止）
    const auth = await requireStoreUploadAccess(store);
    if (auth.error) return auth.error;
    const session = auth.session;

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const text = decodeFileBuffer(buffer);
    const rows = parseCSV(text);

    let records;
    try {
      records = parsePlActuals(rows);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "PL CSVの解析に失敗しました" },
        { status: 400 },
      );
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: "取り込めるデータ（人件費・消耗品費・広告宣伝費）が見つかりませんでした" },
        { status: 400 },
      );
    }

    // 対象 (年,月) の集合
    const periodKeys = new Set(records.map((r) => `${r.year}-${r.month}`));
    const periods = Array.from(periodKeys).map((k) => {
      const [y, m] = k.split("-").map(Number);
      return { year: y, month: m };
    });
    const years = Array.from(new Set(periods.map((p) => p.year))).sort();

    if (dryRun) {
      const existing = await prisma.plActual.count({
        where: {
          storeName: store,
          OR: periods.map((p) => ({ year: p.year, month: p.month })),
        },
      });
      return NextResponse.json({
        dryRun: true,
        store,
        exists: existing > 0,
        existingCount: existing,
        recordCount: records.length,
        periodCount: periods.length,
        yearRange: `${years[0]}〜${years[years.length - 1]}`,
      });
    }

    // スコープ削除（店舗 × 対象年月）→ 挿入
    await prisma.$transaction(async (tx) => {
      for (const p of periods) {
        await tx.plActual.deleteMany({
          where: { storeName: store, year: p.year, month: p.month },
        });
      }
      await tx.plActual.createMany({
        data: records.map((r) => ({
          storeName: store,
          year: r.year,
          month: r.month,
          category: r.category,
          amount: r.amount,
        })),
      });
      await tx.uploadLog.create({
        data: {
          userId: session.userId,
          userName: session.displayName || session.storeName || "ユーザー",
          dataType: "pl_actual",
          storeName: store,
          year: years[0],
          month: periods[0]?.month ?? null,
          fileName: file.name,
          recordCount: records.length,
          note: `前年比PL ${years[0]}〜${years[years.length - 1]}`,
        },
      });
    });

    return NextResponse.json({
      success: true,
      store,
      recordCount: records.length,
      periodCount: periods.length,
      yearRange: `${years[0]}〜${years[years.length - 1]}`,
    });
  } catch (error) {
    console.error("PL actual upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
