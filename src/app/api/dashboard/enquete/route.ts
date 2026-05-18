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
 *   ※ アンケート回答は時点スナップショットのため year/month フィルタは行わない。
 *
 * レスポンス:
 *   total: 集計対象回答数
 *   awareness: { ラベル: 件数, ... }
 *   purposes: { ラベル: 件数, ... }
 *   frequency: { ラベル: 件数, ... }
 *   has_data: 1件でも回答があれば true
 */
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

  const rows = await prisma.enqueteAnswer.findMany({
    where: { ...storeFilter },
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

  return NextResponse.json({
    store: scopedStore ?? null,
    total: rows.length,
    awareness,
    purposes,
    frequency,
    has_data: hasData,
  });
}
