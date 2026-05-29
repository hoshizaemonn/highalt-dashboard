import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STORES, HQ_STORE } from "@/lib/constants";
import { requireSession } from "@/lib/auth";

/**
 * 動的な店舗リストを返す（坪井さん要望17: ハコモノ店舗自動追加）
 *
 * 既定の STORES 定数 + 各テーブルから distinct 抽出した店舗名 を union。
 * 本部（除外）は別途返す。
 *
 * これにより hacomono CSV の取込で新店舗の sales_detail / member_data が
 * 入った時、自動でダッシュボードのドロップダウンに現れる。
 */
export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  // 接続プール枯渇を避けるため逐次取得
  const salesStores = await prisma.salesDetail.findMany({
    select: { storeName: true },
    distinct: ["storeName"],
  });
  const memberStores = await prisma.memberData.findMany({
    select: { storeName: true },
    distinct: ["storeName"],
  });
  const payrollStores = await prisma.payrollData.findMany({
    select: { storeName: true },
    distinct: ["storeName"],
  });
  const summaryStores = await prisma.monthlySummary.findMany({
    select: { storeName: true },
    distinct: ["storeName"],
  });

  const dynamicSet = new Set<string>([...STORES]);
  for (const r of [...salesStores, ...memberStores, ...payrollStores, ...summaryStores]) {
    if (r.storeName && r.storeName !== HQ_STORE) {
      dynamicSet.add(r.storeName);
    }
  }

  // 表示名・非表示フラグを取得（坪井さん要望: 店舗名変更 / 閉店店舗の非表示）
  const displayRows = await prisma.storeDisplayName.findMany({
    select: { storeName: true, displayName: true, hidden: true },
  });
  const displayMap: Record<string, string> = {};
  const hiddenSet = new Set<string>();
  for (const r of displayRows) {
    displayMap[r.storeName] = r.displayName;
    if (r.hidden) hiddenSet.add(r.storeName);
  }

  // 名前のソート: 既存 STORES の順を尊重し、その後に新規（自動検出）追加分を追加。
  // 非表示店舗は除外する。
  const result: string[] = [];
  const seen = new Set<string>();
  for (const s of STORES) {
    if (dynamicSet.has(s) && !seen.has(s) && !hiddenSet.has(s)) {
      result.push(s);
      seen.add(s);
    }
  }
  // 自動追加分（既定 STORES に無いもの・非表示は除外）
  const newOnes = [...dynamicSet].filter((s) => !seen.has(s) && !hiddenSet.has(s));
  newOnes.sort();
  for (const s of newOnes) result.push(s);

  return NextResponse.json({
    stores: result,
    hq_store: HQ_STORE,
    /** 既定 STORES に含まれず、データから自動検出された店舗 */
    auto_detected: newOnes,
    /** 表示名マッピング { storeName: displayName } */
    display_names: displayMap,
    /** 非表示店舗一覧 */
    hidden_stores: [...hiddenSet],
  });
}
