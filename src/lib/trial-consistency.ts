// 体験者数の「画面間の一致」確認（鮮度チェック用・読み取りのみ・件数のみ）。
//
// 月次（店舗を選んだ単月ビュー）・全体（店舗未指定の単月ビュー）・店舗比較 の3画面が、
// 同じ年月で同じ体験者数を出しているかを、各画面と同じ集計関数で計算して突き合わせる。
//   - 月次:     pickEffectiveTrial（/api/dashboard の店舗指定時）
//   - 全体:     sumEffectiveTrialByStore（/api/dashboard の店舗未指定時）
//   - 店舗比較: storeCompareTrialForMonth（/api/dashboard/store-compare）
// 氏名などの個人情報は読まない（店舗名・年月・件数・体験日のみ）。

import { prisma } from "@/lib/prisma";
import { HQ_STORE } from "@/lib/constants";
import { getHiddenStores } from "@/lib/hidden-stores";
import { trialDateMonthWhere } from "@/lib/csv-utils";
import { judgeTrialConsistency, type TrialConsistencyMonth } from "@/lib/trial-join-rate";

export type { TrialConsistencyMonth } from "@/lib/trial-join-rate";

/** 指定年月（複数可）の一致確認を本番DBから読み取りで行う */
export async function loadTrialConsistency(
  months: ReadonlyArray<{ year: number; month: number }>,
): Promise<TrialConsistencyMonth[]> {
  const hidden = await getHiddenStores();
  const excluded = [HQ_STORE, ...hidden];
  const out: TrialConsistencyMonth[] = [];
  for (const { year, month } of months) {
    const [sheetRows, manualRows, memberRows] = await Promise.all([
      prisma.trialSheetEntry.findMany({
        where: { year, month },
        select: { storeName: true, year: true, month: true },
      }),
      prisma.manualEntry.findMany({
        where: { year, month },
        select: { storeName: true, year: true, month: true, trialCount: true },
      }),
      prisma.memberData.findMany({
        where: trialDateMonthWhere(year, month),
        select: { storeName: true, trialDate: true, firstTrialDate: true },
      }),
    ]);
    out.push(judgeTrialConsistency({ year, month, sheetRows, manualRows, memberRows, excluded }));
  }
  return out;
}

/** JST の当月と前月 */
export function currentAndPreviousMonthJst(now: Date = new Date()): { year: number; month: number }[] {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  return [{ year: y, month: m }, prev];
}
