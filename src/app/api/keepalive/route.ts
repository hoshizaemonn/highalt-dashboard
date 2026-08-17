import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyChatwork } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 何日ログインが無かったら通知するか */
const NO_LOGIN_ALERT_DAYS = 3;

/**
 * DB 死活確認 兼 Supabase 自動停止の防止。
 *
 * Supabase 無料プランは一定期間 DB アクセスが無いとプロジェクトが自動停止し、
 * 復旧するまでログインを含む全機能が 500 になる（2026-08-17 に発生。長期休暇で
 * 誰もログインしないと再発する）。Vercel Cron から毎日ここを叩いて DB に
 * 触り続けることで停止させない。
 *
 * あわせて、
 *   ① DB に繋がらない
 *   ② 誰も一定期間ログインしていない
 * のときだけ ChatWork へ通知する（正常時は無通知）。
 *
 * ※通知先・トークンは Vercel の環境変数にのみ置く。このリポジトリは public。
 */
export async function GET(request: Request) {
  // Vercel Cron は CRON_SECRET が設定されていれば自動で
  // `Authorization: Bearer <CRON_SECRET>` を付けて呼ぶ。
  // 未設定の環境（ローカル・プレビュー等）では素通しして疎通確認だけできるようにする。
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
    // 最大値を見る。まだ誰も記録がない（NULL のみ）場合は通知しない。
    const latest = await prisma.user.aggregate({
      _max: { lastLoginAt: true },
    });
    const lastLoginAt = latest._max.lastLoginAt;
    const daysSinceLastLogin = lastLoginAt
      ? Math.floor((Date.now() - lastLoginAt.getTime()) / 86_400_000)
      : null;

    // 毎日鳴らすと無視されるので、3日目・6日目・9日目…と3日おきに鳴らす
    const shouldWarnNoLogin =
      daysSinceLastLogin !== null &&
      daysSinceLastLogin >= NO_LOGIN_ALERT_DAYS &&
      daysSinceLastLogin % NO_LOGIN_ALERT_DAYS === 0;

    if (shouldWarnNoLogin) {
      const last = lastLoginAt!.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      });
      await notifyChatwork(
        `[info][title]📉 ハイアルチ ダッシュボードに${daysSinceLastLogin}日間ログインがありません[/title]` +
          `最終ログイン: ${last}\n\n` +
          `DBの自動停止は毎日の自動アクセスで防いでいるので、すぐ壊れることはありません。\n` +
          `ただ、誰も見ていない状態が続いています。データ更新の遅れがないか確認してください。[/info]`
      );
    }

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
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("Keepalive error:", detail);

    await notifyChatwork(
      `[info][title]⚠️ ハイアルチ 業績ダッシュボードのDBに接続できません[/title]` +
        `坪井様・アンビルさんが開くとエラー画面になる状態です。\n\n` +
        `詳細: ${detail}\n\n` +
        `■ 最初に見るところ\n` +
        `Supabase が一時停止していないか（無料プランは放置で自動停止します）。\n` +
        `paused と出ていたら [Resume project] を押すだけで復旧します（データは消えません）。[/info]`
    );

    return NextResponse.json(
      { ok: false, error: "database unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
