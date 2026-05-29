import { prisma } from "@/lib/prisma";

/**
 * 非表示に設定された店舗名の一覧を返す。
 * 閉店した店舗・テスト店舗（例: 原宿）を店舗リスト・店舗比較・集計から除外するために使う。
 */
export async function getHiddenStores(): Promise<string[]> {
  const rows = await prisma.storeDisplayName.findMany({
    where: { hidden: true },
    select: { storeName: true },
  });
  return rows.map((r) => r.storeName);
}
