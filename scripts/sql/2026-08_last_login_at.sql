-- 最終ログイン日時の記録(2026-08): 「誰もログインしていない状態」の検知用
--
-- 背景: 2026-08-17 に Supabase 無料プランのプロジェクトが自動停止し、
-- ログインを含む全機能が 500 になった。停止防止は Vercel Cron の
-- /api/keepalive で行うが、そもそも長期間誰も見ていない状態にも
-- 気づけるよう最終ログイン日時を記録する。
--
-- Supabase SQL Editor で実行してください。
-- 追加のみ・NULL 許容なので既存データには一切影響しません。
-- ★デプロイの「前」に実行すること（列が無い状態でアプリが参照すると
--   ログインAPIがエラーになるため）。

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 既存行は NULL のまま（「まだ記録がない」状態）。
-- /api/keepalive は NULL のとき daysSinceLastLogin を null で返し、
-- 監視側は通知をスキップする。最初の1回ログインした時点から計測が始まる。
