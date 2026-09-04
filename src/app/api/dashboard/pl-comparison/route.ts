import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, getEffectiveStoreFilter } from "@/lib/auth";
import { HQ_STORE } from "@/lib/constants";
import { getHiddenStores } from "@/lib/hidden-stores";
import { PL_CATEGORIES } from "@/lib/pl-csv";

// 前年比比較（人件費・消耗品費・広告宣伝費）— クライアント公式PL（pl_actuals）由来。
// 当年 vs 前年を同一ソースで比較するため、ダッシュボードの granular（PayPay）とは別系統。
//
// fiscalYear: 会計年度の「年度末年」（例 2026 = 9期 2025/10〜2026/9）。
//
// 全体表示にも対応する（松尾さん報告 2026-07: 全体の前年比グラフで前期が0になる）。
// getEffectiveStoreFilter で「全体=全店」「単店=その店」のフィルタを得て、
// 対象店舗ぶんを (費目, 年, 月) で合算する。
//
// ★取込途中の月の扱い（アンビルさん報告 2026-09: 5月以降の数値が正しくない）
//   pl_actuals は店舗ごと・月ごとに取り込まれるため、月の途中では
//   「7店舗中3店舗だけ入っている」状態が発生する。以前はこれを区別せず
//   当年合計÷前年合計を出していたため、
//     - 未取込月（当年0円）が「前年比0%」＝経費100%削減 に見える
//     - 一部店舗しか無い月が全店実績として過少に見える（5月 人件費16.5% など）
//     - 合計が「当年7ヶ月 vs 前年12ヶ月」の期間ミスマッチになる（63.9% など）
//   という誤読を招いた。そこで月ごとに取込状況(status)を判定し、
//   揃っている月(complete)だけで前年比・合計を出す。
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

    // 店舗スコープ: 全体=全店（本部・非表示除く）、単店=その店。非adminは担当店舗に制限。
    const hiddenStores = await getHiddenStores();
    const storeNameFilter = getEffectiveStoreFilter(auth.session, requestedStore, {
      notIn: [HQ_STORE, ...hiddenStores],
    });
    const store = typeof storeNameFilter === "string" ? storeNameFilter : "全体";

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
      where: { storeName: storeNameFilter, OR: orConds },
    });

    // (category, year, month) -> amount（全体表示時は複数店舗ぶんを合算する）
    const map = new Map<string, number>();
    // (year, month) -> その月にPLが取り込まれている店舗の集合
    const storesByYm = new Map<string, Set<string>>();
    // (category, year, month) -> その費目が入っている店舗の集合
    const storesByCatYm = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = `${r.category}:${r.year}:${r.month}`;
      map.set(k, (map.get(k) ?? 0) + r.amount);
      const ymk = `${r.year}:${r.month}`;
      if (!storesByYm.has(ymk)) storesByYm.set(ymk, new Set());
      storesByYm.get(ymk)!.add(r.storeName);
      if (!storesByCatYm.has(k)) storesByCatYm.set(k, new Set());
      storesByCatYm.get(k)!.add(r.storeName);
    }
    const get = (cat: string, y: number, m: number) =>
      map.get(`${cat}:${y}:${m}`) ?? 0;
    const coverage = (y: number, m: number) =>
      storesByYm.get(`${y}:${m}`)?.size ?? 0;
    const catCoverage = (cat: string, y: number, m: number) =>
      storesByCatYm.get(`${cat}:${y}:${m}`)?.size ?? 0;

    // 「その月が揃っている」と判断する基準店舗数。
    // 当年・前年を通じて最も店舗数が多い月を満額とみなす（単店表示なら1）。
    // 前年(8期)は全月そろっているため、当年の取込途中月をここで検出できる。
    let expectedStores = 0;
    for (const mm of months) {
      expectedStores = Math.max(
        expectedStores,
        coverage(mm.y, mm.m),
        coverage(mm.y - 1, mm.m),
      );
    }

    // 月ごとの取込状況。
    //   "none"     : 当年のPLが1店舗も入っていない（＝未取込。前年比は出さない）
    //   "partial"  : 一部店舗しか入っていない（＝速報値。全店実績ではないので前年比は出さない）
    //   "complete" : 対象店舗が揃っている（＝前年比・合計の対象）
    type Status = "none" | "partial" | "complete";
    const statusOf = (y: number, m: number): Status => {
      const c = coverage(y, m);
      if (c === 0) return "none";
      if (expectedStores > 0 && c < expectedStores) return "partial";
      return "complete";
    };

    const monthStatus = months.map((mm) => ({
      label: mm.label,
      status: statusOf(mm.y, mm.m),
      stores: coverage(mm.y, mm.m),
    }));

    const categories = PL_CATEGORIES.map((cat) => {
      const monthly = months.map((mm, i) => {
        const current = get(cat, mm.y, mm.m);
        const prev = get(cat, mm.y - 1, mm.m);

        // 判定は「当年側」だけで行う（前年は確定済みのため）。
        //   ① その月にPLを出している店舗が揃っていない → partial / none
        //   ② 月は揃っていても、その費目だけ欠けている店舗がある → partial
        // ②が無いと、例えば7月のPLは全店提出済みでも人件費だけ5店舗、という
        // 状態を「揃っている」と誤判定し、人件費が過少なまま前年比が出てしまう
        // （2026-07・2026-04人件費の実例あり）。
        const monthCov = monthStatus[i].stores;
        const cCov = catCoverage(cat, mm.y, mm.m);
        const status: "none" | "partial" | "complete" =
          monthCov === 0
            ? "none"
            : expectedStores > 0 && monthCov < expectedStores
              ? "partial"
              : cCov < monthCov
                ? "partial"
                : "complete";

        // 揃っている月だけ前年比を出す。揃っていない月の 0円 は
        // 「使わなかった」ではなく「まだ入っていない」なので比率にしない。
        const yoy =
          status === "complete" && prev !== 0 ? current / prev : null;
        return {
          month: mm.m,
          label: mm.label,
          current,
          prev,
          yoy,
          status,
          stores: cCov,
        };
      });

      // 合計も「揃っている月」だけで当年・前年をそろえて出す（期間ミスマッチ防止）。
      // 揃っている月は費目ごとに違いうるので、対象期間ラベルも費目ごとに持つ。
      const completeMonths = monthly.filter((x) => x.status === "complete");
      const currentTotal = completeMonths.reduce((s, x) => s + x.current, 0);
      const prevTotal = completeMonths.reduce((s, x) => s + x.prev, 0);
      const labels = completeMonths.map((x) => x.label);
      return {
        category: cat,
        monthly,
        currentTotal,
        prevTotal,
        yoyTotal: prevTotal !== 0 ? currentTotal / prevTotal : null,
        totalPeriodLabel:
          labels.length === 0
            ? null
            : labels.length === 1
              ? labels[0]
              : `${labels[0]}〜${labels[labels.length - 1]}`,
      };
    });

    // 合計が何月ぶんの比較なのかを画面に出すためのラベル（例: "10月〜4月"）
    const completeLabels = monthStatus
      .filter((s) => s.status === "complete")
      .map((s) => s.label);
    const totalPeriodLabel =
      completeLabels.length === 0
        ? null
        : completeLabels.length === 1
          ? completeLabels[0]
          : `${completeLabels[0]}〜${completeLabels[completeLabels.length - 1]}`;

    // データ有無（全費目・全月で当年も前年も0なら未取込）
    const hasData = categories.some(
      (c) => c.currentTotal !== 0 || c.prevTotal !== 0,
    );

    return NextResponse.json({
      fiscalYear,
      store,
      hasData,
      months: months.map((m) => m.label),
      monthStatus,
      expectedStores,
      totalPeriodLabel,
      categories,
    });
  } catch (error) {
    logError("PL comparison API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
