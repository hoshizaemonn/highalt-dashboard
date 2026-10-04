import { logError } from "@/lib/log";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { loadDataFreshness } from "@/lib/data-freshness-loader";
import { summarize } from "@/lib/data-freshness";

// 各データの「最終更新日」と鮮度判定。管理者のみ（取込専用ユーザーは admin ロールのため、日次の鮮度チェックジョブからも呼べる）。
// 読み取りのみ。個人情報は返さない。

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { generatedAt, items } = await loadDataFreshness();
    const s = summarize(items);
    return NextResponse.json({
      generatedAt,
      summary: { ok: s.ok, stale: s.stale, missing: s.missing },
      items,
    });
  } catch (error) {
    logError("DataFreshness GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
