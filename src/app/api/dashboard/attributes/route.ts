import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HQ_STORE } from "@/lib/constants";
import { requireSession, effectiveStoreScope } from "@/lib/auth";

/**
 * 会員属性の集計（坪井さん要望13/14）
 *
 * クエリ:
 *   year, month, store (optional, "全体" or unset = 全店舗合算)
 *   trialOnly=1 で「新規体験者属性」のみ集計（had_trial=1）
 *
 * レスポンス:
 *   gender_breakdown: { 男性: n, 女性: n, その他: n, 未登録: n }
 *   age_breakdown: { "9歳以下": n, "10代": n, ..., "70代以上": n, 未登録: n }
 *   total: 集計対象会員数
 *   has_data: 性別または年代が1件でも入っていれば true
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const { searchParams } = request.nextUrl;
  const year = parseInt(searchParams.get("year") ?? "", 10);
  const month = parseInt(searchParams.get("month") ?? "", 10);
  const storeParam = searchParams.get("store") || undefined;
  const trialOnly = searchParams.get("trialOnly") === "1";

  if (isNaN(year) || isNaN(month)) {
    return NextResponse.json(
      { error: "year, month are required" },
      { status: 400 },
    );
  }

  const scopedStore = effectiveStoreScope(auth.session, storeParam);
  const storeFilter =
    scopedStore && scopedStore !== "全体"
      ? { storeName: scopedStore }
      : { storeName: { not: HQ_STORE } };

  // ML001 は時点スナップショット。年月別ではなく「現在の会員/体験者」を集計する。
  // - 会員属性: isActive=1 の全会員（年月フィルタなし）
  // - 新規体験者属性: trialDate or firstTrialDate が指定年月にマッチする会員
  //   trialDate は "YYYY/MM/DD HH:MM:SS" or "YYYY-MM-DD ..." 形式の文字列なので
  //   startsWith で月マッチ判定する
  const mm = String(month).padStart(2, "0");
  const trialFilter = trialOnly
    ? {
        OR: [
          { trialDate: { startsWith: `${year}/${mm}/` } },
          { trialDate: { startsWith: `${year}-${mm}-` } },
          { firstTrialDate: { startsWith: `${year}/${mm}/` } },
          { firstTrialDate: { startsWith: `${year}-${mm}-` } },
        ],
      }
    : { isActive: 1 };

  const rows = await prisma.memberData.findMany({
    where: {
      ...trialFilter,
      ...storeFilter,
    },
    select: { gender: true, ageBucket: true },
  });

  const genderBreakdown: Record<string, number> = {
    男性: 0,
    女性: 0,
    その他: 0,
    未登録: 0,
  };
  const ageBuckets = [
    "9歳以下",
    "10代",
    "20代",
    "30代",
    "40代",
    "50代",
    "60代",
    "70代以上",
  ];
  const ageBreakdown: Record<string, number> = {};
  for (const a of ageBuckets) ageBreakdown[a] = 0;
  ageBreakdown["未登録"] = 0;

  for (const r of rows) {
    if (r.gender) genderBreakdown[r.gender] = (genderBreakdown[r.gender] ?? 0) + 1;
    else genderBreakdown["未登録"]++;

    if (r.ageBucket && ageBreakdown[r.ageBucket] !== undefined) {
      ageBreakdown[r.ageBucket]++;
    } else {
      ageBreakdown["未登録"]++;
    }
  }

  const hasData = rows.some((r) => r.gender || r.ageBucket);

  return NextResponse.json({
    year,
    month,
    store: scopedStore ?? null,
    trial_only: trialOnly,
    total: rows.length,
    gender_breakdown: genderBreakdown,
    age_breakdown: ageBreakdown,
    has_data: hasData,
  });
}
