import { logError } from "@/lib/log";
import { NextResponse } from "next/server";
import { requireAdminOrIngest } from "@/lib/auth";
import { loadDataFreshness } from "@/lib/data-freshness-loader";
import { summarize } from "@/lib/data-freshness";
import { currentAndPreviousMonthJst, loadTrialConsistency } from "@/lib/trial-consistency";

// 各データの「最終更新日」と鮮度判定。管理者のみ（取込専用ユーザーは admin ロールのため、日次の鮮度チェックジョブからも呼べる）。
// 読み取りのみ。個人情報は返さない。

export async function GET() {
  try {
    const auth = await requireAdminOrIngest();
    if (auth.error) return auth.error;
    const { generatedAt, items } = await loadDataFreshness();
    const s = summarize(items);
    // 体験者数が 月次・全体・店舗比較 で同じか（当月・前月）。件数のみ
    const trialConsistency = await loadTrialConsistency(currentAndPreviousMonthJst());
    return NextResponse.json({
      generatedAt,
      summary: { ok: s.ok, stale: s.stale, missing: s.missing },
      items,
      trialConsistency,
    });
  } catch (error) {
    logError("DataFreshness GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
