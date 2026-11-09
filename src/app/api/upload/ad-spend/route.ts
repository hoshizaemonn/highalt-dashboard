import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrIngest } from "@/lib/auth";
import { STORES } from "@/lib/constants";
import {
  AD_SPEND_CATEGORY,
  AD_SPEND_NOTE_PREFIX,
  AD_SPEND_UPDATED_BY,
  adSpendBlockReasons,
  buildAdSpendRows,
  type AdSpendItem,
} from "@/lib/ad-spend-ingest";

/**
 * 広告費（Google・Meta）の実測を、業績の「広告宣伝費」へ月次で入れる（10期=2026/10〜）。
 * 呼び出し元: 広告ダッシュボードの日次ジョブ（highalt-ads-daily）。取込専用ロール（ingest）または admin。
 *
 * body: { year, month, items: [{ store: "船橋" | "" , google, meta }], dryRun?: boolean }
 *   store="" は店舗に割れない分（本部P-MAX・全社/他拠点Meta・店舗未判定）。営業店舗数で均等按分される。
 *
 * 置き換え範囲: 年月 × 広告宣伝費 × note が「[広告自動]」で始まる行だけ（人が入れた行・経費明細は触らない）。
 * 同じ内容を何度送っても結果は同じ（idempotent）。
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminOrIngest();
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON body が必要です" }, { status: 400 });
    }
    const year = Number(body.year);
    const month = Number(body.month);
    const dryRun = body.dryRun === true;
    const items: AdSpendItem[] = Array.isArray(body.items)
      ? body.items.map((r: Record<string, unknown>) => ({
          store: typeof r.store === "string" ? r.store : "",
          google: Number(r.google ?? 0),
          meta: Number(r.meta ?? 0),
        }))
      : [];

    const why = adSpendBlockReasons(year, month, items, STORES);
    if (why.length > 0) {
      return NextResponse.json({ error: "入れられません", reasons: why }, { status: 400 });
    }

    const rows = buildAdSpendRows(year, month, items);
    const scope = {
      year,
      month,
      category: AD_SPEND_CATEGORY,
      note: { startsWith: AD_SPEND_NOTE_PREFIX },
    };
    const existing = await prisma.manualExpenseEntry.findMany({
      where: scope,
      select: { storeName: true, totalAmount: true, note: true },
    });
    const plan = {
      year,
      month,
      rows: rows.length,
      total: rows.reduce((s, r) => s + r.totalAmount, 0),
      existingAutoRows: existing.length,
      existingAutoTotal: existing.reduce((s, r) => s + r.totalAmount, 0),
    };
    if (dryRun) return NextResponse.json({ dryRun: true, plan, rows });

    await prisma.$transaction(
      async (tx) => {
        await tx.manualExpenseEntry.deleteMany({ where: scope });
        await tx.manualExpenseEntry.createMany({
          data: rows.map((r) => ({
            year: r.year,
            month: r.month,
            category: r.category,
            storeName: r.storeName,
            totalAmount: r.totalAmount,
            note: r.note,
            updatedByName: AD_SPEND_UPDATED_BY,
          })),
        });
      },
      { timeout: 30000 },
    );
    return NextResponse.json({ dryRun: false, plan });
  } catch (error) {
    logError("Ad spend ingest error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
