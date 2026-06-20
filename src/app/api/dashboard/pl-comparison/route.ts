import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, effectiveStoreScope } from "@/lib/auth";
import { PL_CATEGORIES } from "@/lib/pl-csv";

// 前年比比較（人件費・消耗品費・広告宣伝費）— クライアント公式PL（pl_actuals）由来。
// 当年 vs 前年を同一ソースで比較するため、ダッシュボードの granular（PayPay）とは別系統。
//
// fiscalYear: 会計年度の「年度末年」（例 2026 = 9期 2025/10〜2026/9）。

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const fiscalYear = parseInt(searchParams.get("fiscalYear") ?? "", 10);
    const requestedStore = searchParams.get("store") || undefined;
    if (isNaN(fiscalYear)) {
      return NextResponse.json(
        { error: "fiscalYear is required" },
        { status: 400 },
      );
    }

    // 店舗スコープ（非adminは自店舗に強制）。全体集計は対象外（PLは店舗別なので単店で見る想定）。
    const store = effectiveStoreScope(auth.session, requestedStore);
    if (!store) {
      // 全店指定時は、前年比比較は店舗を選んでもらう前提なので空を返す
      return NextResponse.json({
        fiscalYear,
        store: null,
        needsStore: true,
        categories: [],
      });
    }

    // 会計年度の月リスト（10月始まり）: 当年と前年
    const months: { y: number; m: number; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const m = ((9 + i) % 12) + 1; // 10,11,12,1,...,9
      const y = m >= 10 ? fiscalYear - 1 : fiscalYear;
      months.push({ y, m, label: `${m}月` });
    }

    // 当年・前年の全 (year, month) を一括取得
    const ymSet = new Set<string>();
    for (const mm of months) {
      ymSet.add(`${mm.y}-${mm.m}`);
      ymSet.add(`${mm.y - 1}-${mm.m}`);
    }
    const orConds = Array.from(ymSet).map((k) => {
      const [y, m] = k.split("-").map(Number);
      return { year: y, month: m };
    });

    const rows = await prisma.plActual.findMany({
      where: { storeName: store, OR: orConds },
    });

    // (category, year, month) -> amount
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(`${r.category}:${r.year}:${r.month}`, r.amount);
    }
    const get = (cat: string, y: number, m: number) =>
      map.get(`${cat}:${y}:${m}`) ?? 0;

    const categories = PL_CATEGORIES.map((cat) => {
      const monthly = months.map((mm) => {
        const current = get(cat, mm.y, mm.m);
        const prev = get(cat, mm.y - 1, mm.m);
        const yoy = prev !== 0 ? current / prev : null; // 前年比（倍率）
        return { month: mm.m, label: mm.label, current, prev, yoy };
      });
      const currentTotal = monthly.reduce((s, x) => s + x.current, 0);
      const prevTotal = monthly.reduce((s, x) => s + x.prev, 0);
      return {
        category: cat,
        monthly,
        currentTotal,
        prevTotal,
        yoyTotal: prevTotal !== 0 ? currentTotal / prevTotal : null,
      };
    });

    // データ有無（全費目・全月で当年も前年も0なら未取込）
    const hasData = categories.some(
      (c) => c.currentTotal !== 0 || c.prevTotal !== 0,
    );

    return NextResponse.json({
      fiscalYear,
      store,
      hasData,
      months: months.map((m) => m.label),
      categories,
    });
  } catch (error) {
    console.error("PL comparison API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
