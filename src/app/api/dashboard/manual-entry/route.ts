import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, effectiveStoreScope } from "@/lib/auth";
import { trialDateMonthWhere } from "@/lib/csv-utils";

/**
 * 店長手動追記（坪井さん要望）
 * - trial_count: 体験者数（hacomono 取込に無いため手動）
 * - other_sales_items: 請求書ベースの「その他売上」を複数件記録
 *   （旧 other_sales_amount / other_sales_note は互換のため残しているが、
 *    items が1件以上あれば items の合計を優先する）
 *
 * 権限:
 *   - GET: 認証済ユーザー全員（店長は自店舗のみ実質取得）
 *   - PUT: admin = 任意の店舗、店長 = 自店舗のみ
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const { searchParams } = request.nextUrl;
  const year = parseInt(searchParams.get("year") ?? "", 10);
  const month = parseInt(searchParams.get("month") ?? "", 10);
  const storeParam = searchParams.get("store") || undefined;
  const store = effectiveStoreScope(auth.session, storeParam);

  if (isNaN(year) || isNaN(month) || !store) {
    return NextResponse.json(
      { error: "year, month, store are required" },
      { status: 400 },
    );
  }

  const entry = await prisma.manualEntry.findUnique({
    where: { year_month_storeName: { year, month, storeName: store } },
  });

  const items = await prisma.manualOtherSalesItem.findMany({
    where: { year, month, storeName: store },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  // hacomono ML001 から自動算出。ML001 は時点スナップショットのため、
  // trialDate / firstTrialDate が指定年月にマッチする会員数をカウントする。
  const autoTrialCount = await prisma.memberData.count({
    where: { storeName: store, ...trialDateMonthWhere(year, month) },
  });

  // items 合計（あれば優先）
  const itemsTotal = items.reduce((s, r) => s + r.amount, 0);
  const otherSalesAmount =
    items.length > 0 ? itemsTotal : (entry?.otherSalesAmount ?? 0);

  return NextResponse.json({
    year,
    month,
    store,
    trial_count: entry?.trialCount ?? 0,
    auto_trial_count: autoTrialCount,
    trial_referral_count: entry?.trialReferralCount ?? 0,
    other_sales_amount: otherSalesAmount,
    other_sales_note: entry?.otherSalesNote ?? null,
    other_sales_items: items.map((r) => ({
      id: r.id,
      amount: r.amount,
      note: r.note,
      sort_order: r.sortOrder,
    })),
    updated_by_name: entry?.updatedByName ?? null,
    updated_at: entry?.updatedAt ?? null,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const body = await request.json();
  const year = Number(body.year);
  const month = Number(body.month);
  const storeParam = body.store as string | undefined;
  const store = effectiveStoreScope(auth.session, storeParam);

  if (isNaN(year) || isNaN(month) || !store) {
    return NextResponse.json(
      { error: "year, month, store are required" },
      { status: 400 },
    );
  }

  const trialCount = Math.max(0, parseInt(String(body.trial_count ?? 0), 10) || 0);
  const trialReferralCount = Math.max(
    0,
    parseInt(String(body.trial_referral_count ?? 0), 10) || 0,
  );

  // 複数件の内訳が送られてきた場合はそちらを採用、無ければ単一金額(互換)
  type ItemInput = { amount?: unknown; note?: unknown };
  const rawItems: ItemInput[] = Array.isArray(body.other_sales_items)
    ? (body.other_sales_items as ItemInput[])
    : [];
  const items = rawItems
    .map((r, i) => ({
      amount: Math.max(0, parseInt(String(r.amount ?? 0), 10) || 0),
      note:
        typeof r.note === "string" && r.note.length > 0
          ? String(r.note).slice(0, 200)
          : null,
      sortOrder: i,
    }))
    // 全部 amount=0 かつ note 空の行は除外
    .filter((r) => r.amount > 0 || r.note);

  const fallbackAmount = Math.max(
    0,
    parseInt(String(body.other_sales_amount ?? 0), 10) || 0,
  );
  const fallbackNote =
    typeof body.other_sales_note === "string" && body.other_sales_note.length > 0
      ? String(body.other_sales_note).slice(0, 500)
      : null;

  // 集計用の代表値: items があればその合計、無ければ単一値
  const otherSalesAmount =
    items.length > 0
      ? items.reduce((s, r) => s + r.amount, 0)
      : fallbackAmount;
  const otherSalesNote = items.length > 0 ? null : fallbackNote;

  const updatedByName =
    auth.session.displayName || auth.session.storeName || "ユーザー";

  const saved = await prisma.$transaction(async (tx) => {
    const entry = await tx.manualEntry.upsert({
      where: { year_month_storeName: { year, month, storeName: store } },
      create: {
        year,
        month,
        storeName: store,
        trialCount,
        trialReferralCount,
        otherSalesAmount,
        otherSalesNote,
        updatedByName,
      },
      update: {
        trialCount,
        trialReferralCount,
        otherSalesAmount,
        otherSalesNote,
        updatedByName,
      },
    });

    // items は (year, month, storeName) スコープで全置換
    await tx.manualOtherSalesItem.deleteMany({
      where: { year, month, storeName: store },
    });
    if (items.length > 0) {
      await tx.manualOtherSalesItem.createMany({
        data: items.map((r) => ({
          year,
          month,
          storeName: store,
          amount: r.amount,
          note: r.note,
          sortOrder: r.sortOrder,
          updatedByName,
        })),
      });
    }

    const savedItems = await tx.manualOtherSalesItem.findMany({
      where: { year, month, storeName: store },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });

    return { entry, savedItems };
  });

  return NextResponse.json({
    ok: true,
    trial_count: saved.entry.trialCount,
    trial_referral_count: saved.entry.trialReferralCount,
    other_sales_amount: saved.entry.otherSalesAmount,
    other_sales_note: saved.entry.otherSalesNote,
    other_sales_items: saved.savedItems.map((r) => ({
      id: r.id,
      amount: r.amount,
      note: r.note,
      sort_order: r.sortOrder,
    })),
    updated_by_name: saved.entry.updatedByName,
    updated_at: saved.entry.updatedAt,
  });
}
