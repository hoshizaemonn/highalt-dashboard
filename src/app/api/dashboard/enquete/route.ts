import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { HQ_STORE } from "@/lib/constants";
import { requireSession, effectiveStoreScope } from "@/lib/auth";

/**
 * アンケート集計API。
 * 認知経路 / 目的 / 頻度 の3カテゴリを構成比で返す。
 *
 * クエリ:
 *   store: 店舗名 or "全体"（admin/店長ロールに応じてスコープ）
 *   trialOnly=1: 体験者のみ（無料体験会受講日時 or トライアル受講日時が記録されている会員）
 *   year, month: 単月集計（AttributesSectionと同じ規約）
 *   months: 期間集計。"YYYY-MM,YYYY-MM,..." （AttributesSectionと同じ規約）
 *   （いずれも未指定の場合は全期間集計にフォールバックする）
 *
 * 星崎さん要望 2026-09-24: 従来は回答日時に関わらず全期間を常に累計表示していたが、
 * ダッシュボードの他の指標と同様、選択した期間に応じた集計に変更した
 * （registeredAt=hacomono側の回答登録日時を使って年月判定する）。
 *
 * レスポンス:
 *   total: 集計対象回答数
 *   awareness: { ラベル: 件数, ... }
 *   purposes: { ラベル: 件数, ... }
 *   frequency: { ラベル: 件数, ... }
 *   has_data: 選択期間に、認知経路・目的・頻度のいずれかが入った回答が1件でもあれば true
 *   all_total: 期間に関係なく、その店舗（または全体）の回答の累計件数（0なら本当に未取込）
 *   latest_registered_at: 期間に関係なく最新の回答日時（hacomono側の登録日時）
 */

/** registeredAt が指定年月に該当するかの Prisma where 条件（"-" / "/" 区切り両対応） */
function registeredAtMonthWhere(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  return {
    OR: [
      { registeredAt: { startsWith: `${year}-${mm}-` } },
      { registeredAt: { startsWith: `${year}/${mm}/` } },
    ],
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const { searchParams } = request.nextUrl;
  const storeParam = searchParams.get("store") || undefined;
  const scopedStore = effectiveStoreScope(auth.session, storeParam);
  const storeFilter =
    scopedStore && scopedStore !== "全体"
      ? { storeName: scopedStore }
      : { storeName: { not: HQ_STORE } };

  // 期間フィルタの組み立て（year+month の単月、または months の期間リスト）
  const monthsParam = searchParams.get("months");
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const periods: { year: number; month: number }[] = [];
  if (monthsParam) {
    for (const part of monthsParam.split(",")) {
      const [y, m] = part.trim().split("-").map(Number);
      if (!isNaN(y) && !isNaN(m)) periods.push({ year: y, month: m });
    }
  } else if (yearParam && monthParam) {
    const y = parseInt(yearParam, 10);
    const m = parseInt(monthParam, 10);
    if (!isNaN(y) && !isNaN(m)) periods.push({ year: y, month: m });
  }
  const periodFilter =
    periods.length > 0
      ? { OR: periods.map((p) => registeredAtMonthWhere(p.year, p.month)) }
      : {};

  const rows = await prisma.enqueteAnswer.findMany({
    where: { ...storeFilter, ...periodFilter },
    select: {
      awarenessChannels: true,
      purposes: true,
      exerciseFrequency: true,
    },
  });

  const awareness: Record<string, number> = {};
  const purposes: Record<string, number> = {};
  const frequency: Record<string, number> = {};

  const splitAndCount = (
    target: Record<string, number>,
    csv: string | null,
  ) => {
    if (!csv) return;
    for (const v of csv.split(",")) {
      const s = v.trim();
      if (!s) continue;
      target[s] = (target[s] ?? 0) + 1;
    }
  };

  for (const r of rows) {
    splitAndCount(awareness, r.awarenessChannels);
    splitAndCount(purposes, r.purposes);
    if (r.exerciseFrequency) {
      frequency[r.exerciseFrequency] =
        (frequency[r.exerciseFrequency] ?? 0) + 1;
    }
  }

  const hasData =
    Object.keys(awareness).length > 0 ||
    Object.keys(purposes).length > 0 ||
    Object.keys(frequency).length > 0;

  // 「未取込」と「この期間は回答なし」を区別するため、期間に関係なく店舗の累計と最新回答日を返す（個人情報なし）
  const [allTotal, latest] = await Promise.all([
    prisma.enqueteAnswer.count({ where: storeFilter }),
    prisma.enqueteAnswer.aggregate({ where: storeFilter, _max: { registeredAt: true } }),
  ]);

  return NextResponse.json({
    store: scopedStore ?? null,
    total: rows.length,
    all_total: allTotal,
    latest_registered_at: latest._max.registeredAt ?? null,
    awareness,
    purposes,
    frequency,
    has_data: hasData,
  });
}
