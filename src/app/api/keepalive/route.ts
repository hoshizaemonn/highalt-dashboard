import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DB 死活確認 兼 Supabase 自動停止の防止。
 *
 * Supabase 無料プランは一定期間 DB アクセスが無いとプロジェクトが自動停止し、
 * 復旧するまでログインを含む全機能が 500 になる（2026-08-17 に発生。長期休暇で
 * 誰もログインしないと再発する）。Vercel Cron から毎日ここを叩いて DB に
 * 触り続けることで停止させない。
 *
 * GitHub Actions の外形監視も同じエンドポイントを見て、異常時に通知する。
 */
export async function GET(request: Request) {
  // Vercel Cron は CRON_SECRET が設定されていれば自動で
  // `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶ。
  // 未設定の環境（プレビュー等）では素通しして疎通確認だけできるようにする。
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    // `SELECT 1` ではなく実テーブルを読む。接続は張れてもテーブルが消えている
    // ／スキーマが壊れている状態を検知したいため。
    const users = await prisma.user.count();

    // 「誰もログインしていない状態」の検知用に、全ユーザの最終ログイン日時の
    // 最大値を返す。まだ誰も記録がない（NULL のみ）場合は null を返し、
    // 監視側は通知をスキップする。
    const latest = await prisma.user.aggregate({
      _max: { lastLoginAt: true },
    });
    const lastLoginAt = latest._max.lastLoginAt;
    const daysSinceLastLogin = lastLoginAt
      ? Math.floor((Date.now() - lastLoginAt.getTime()) / 86_400_000)
      : null;

    return NextResponse.json(
      {
        ok: true,
        users,
        lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
        daysSinceLastLogin,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    // 他APIと同様、スタックトレースやクエリ詳細は出さない
    console.error(
      "Keepalive error:",
      e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    );
    return NextResponse.json(
      { ok: false, error: "database unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
