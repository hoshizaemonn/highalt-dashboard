import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, effectiveStoreScope } from "@/lib/auth";

/**
 * 店長手動追記（坪井さん要望）
 * - trial_count: 体験者数（hacomono 取込に無いため手動）
 * - other_sales_amount: 請求書ベースの「その他売上」
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

  // hacomono 自動算出（had_trial=1）も返して、UIで「自動: N」と表示できるように
  const autoTrialCount = await prisma.memberData.count({
    where: { year, month, storeName: store, hadTrial: 1 },
  });

  return NextResponse.json({
    year,
    month,
    store,
    trial_count: entry?.trialCount ?? 0,
    auto_trial_count: autoTrialCount,
    trial_referral_count: entry?.trialReferralCount ?? 0,
    other_sales_amount: entry?.otherSalesAmount ?? 0,
    other_sales_note: entry?.otherSalesNote ?? null,
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
  const otherSalesAmount = Math.max(
    0,
    parseInt(String(body.other_sales_amount ?? 0), 10) || 0,
  );
  const otherSalesNote =
    typeof body.other_sales_note === "string" && body.other_sales_note.length > 0
      ? String(body.other_sales_note).slice(0, 500)
      : null;

  const updatedByName =
    auth.session.displayName || auth.session.storeName || "ユーザー";

  const saved = await prisma.manualEntry.upsert({
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

  return NextResponse.json({
    ok: true,
    trial_count: saved.trialCount,
    trial_referral_count: saved.trialReferralCount,
    other_sales_amount: saved.otherSalesAmount,
    other_sales_note: saved.otherSalesNote,
    updated_by_name: saved.updatedByName,
    updated_at: saved.updatedAt,
  });
}
