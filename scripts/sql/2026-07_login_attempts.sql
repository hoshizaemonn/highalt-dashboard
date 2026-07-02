-- セキュリティ強化(2026-07): ログイン試行回数のDB永続化
-- Supabase SQL Editor で実行してください（メンテナンス時間内推奨だが、
-- 実行前でもアプリはインメモリ方式にフォールバックするため停止しない）。

CREATE TABLE IF NOT EXISTS login_attempts (
  ip            TEXT PRIMARY KEY,
  count         INTEGER NOT NULL DEFAULT 0,
  first_attempt TIMESTAMPTZ NOT NULL,
  locked_until  TIMESTAMPTZ
);

-- 古い行の掃除はアプリ側がベストエフォートで実施するため、追加のジョブは不要。

-- (再デプロイトリガー用コメント: 2026-07-02)
