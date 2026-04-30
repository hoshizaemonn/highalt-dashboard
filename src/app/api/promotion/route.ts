import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, effectiveStoreScope, requireStoreUploadAccess } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const requestedStore = searchParams.get("store") || undefined;
    const store = effectiveStoreScope(auth.session, requestedStore) ?? undefined;

    if (!yearParam || !monthParam) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    const year = parseInt(yearParam, 10);
    const month = parseInt(monthParam, 10);

    if (store) {
      // Single store
      const report = await prisma.promotionReport.findUnique({
        where: { year_month_storeName: { year, month, storeName: store } },
      });
      return NextResponse.json({ report });
    }

    // All stores for that year/month
    const reports = await prisma.promotionReport.findMany({
      where: { year, month },
      orderBy: { storeName: "asc" },
    });
    return NextResponse.json({ reports });
  } catch (err) {
    console.error("GET /api/promotion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, month, storeName, ...fields } = body;

    if (!year || !month || !storeName) {
      return NextResponse.json(
        { error: "year, month, storeName are required" },
        { status: 400 },
      );
    }

    // 店舗スコープ厳格化: 非adminは自店舗以外への保存を拒否
    const auth = await requireStoreUploadAccess(storeName);
    if (auth.error) return auth.error;

    // Compute totals
    const trialTotal =
      (fields.trialReferral ?? 0) + (fields.trialNonReferral ?? 0);
    const postingTotal =
      (fields.postingStaff ?? 0) + (fields.postingVendor ?? 0);
    const adTotal =
      (fields.adGoogle ?? 0) +
      (fields.adMeta ?? 0) +
      (fields.adPosting ?? 0) +
      (fields.adDesign ?? 0) +
      (fields.adPrint ?? 0) +
      (fields.adGift ?? 0) +
      (fields.adEvent ?? 0) +
      (fields.adRecruit ?? 0) +
      (fields.adOther ?? 0);

    const data = {
      trialReferral: fields.trialReferral ?? 0,
      trialNonReferral: fields.trialNonReferral ?? 0,
      trialTotal,
      trialJoinRate: fields.trialJoinRate ?? 0,
      trialSameDayRate: fields.trialSameDayRate ?? 0,
      postingStaff: fields.postingStaff ?? 0,
      postingVendor: fields.postingVendor ?? 0,
      postingTotal,
      adGoogle: fields.adGoogle ?? 0,
      adMeta: fields.adMeta ?? 0,
      adPosting: fields.adPosting ?? 0,
      adDesign: fields.adDesign ?? 0,
      adPrint: fields.adPrint ?? 0,
      adGift: fields.adGift ?? 0,
      adEvent: fields.adEvent ?? 0,
      adRecruit: fields.adRecruit ?? 0,
      adOther: fields.adOther ?? 0,
      adTotal,
      unitPrice: fields.unitPrice ?? 0,
      optAthlete4: fields.optAthlete4 ?? 0,
      optAthlete8: fields.optAthlete8 ?? 0,
      optDrinkHyalchi: fields.optDrinkHyalchi ?? 0,
      optDrinkNmn: fields.optDrinkNmn ?? 0,
      optBoost4: fields.optBoost4 ?? 0,
      optBoost8: fields.optBoost8 ?? 0,
      personalRevenue: fields.personalRevenue ?? 0,
      merchandiseRevenue: fields.merchandiseRevenue ?? 0,
      comment: fields.comment ?? "",
    };

    const report = await prisma.promotionReport.upsert({
      where: { year_month_storeName: { year, month, storeName } },
      create: { year, month, storeName, ...data },
      update: data,
    });

    return NextResponse.json({ report });
  } catch (err) {
    console.error("POST /api/promotion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
