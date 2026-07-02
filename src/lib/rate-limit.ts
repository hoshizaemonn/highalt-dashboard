/**
 * Login brute-force protection (rate limiter).
 *
 * セキュリティ強化(2026-07): DB永続化に移行。
 * 旧実装はインメモリMapだったが、Vercelサーバーレスでは関数インスタンスごとに
 * メモリが分かれるため、複数インスタンスに振り分けられるとロックを回避できた。
 * 失敗回数を login_attempts テーブルに記録して全インスタンスで共有する。
 *
 * 実装メモ:
 * - クエリは Prisma の $queryRaw / $executeRaw（タグ付きテンプレート）を使用。
 *   全てパラメータ化されるためSQLインジェクションの余地はない。
 *   型付きクライアントではなく raw を使うのは、prisma generate の実行タイミングに
 *   依存せずデプロイできるようにするため（スキーマ→コードの順序問題を回避）。
 * - フェイルセーフ: DBエラー（テーブル未作成・接続断など）の場合は従来の
 *   インメモリ方式に自動フォールバックし、ログイン機能自体は止めない。
 *   テーブル作成SQL: scripts/sql/2026-07_login_attempts.sql
 */

import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MINUTES = 15;

// ─── In-memory fallback（DBエラー時のみ使用）────────────────────────

interface AttemptRecord {
  count: number;
  firstAttempt: number;
  lockedUntil: number | null;
}

const memAttempts = new Map<string, AttemptRecord>();

function memCheckRateLimit(ip: string): number {
  const record = memAttempts.get(ip);
  if (!record?.lockedUntil) return 0;
  const remaining = record.lockedUntil - Date.now();
  if (remaining <= 0) {
    memAttempts.delete(ip);
    return 0;
  }
  return Math.ceil(remaining / 1000);
}

function memRecordFailedAttempt(ip: string): boolean {
  const now = Date.now();
  const record = memAttempts.get(ip);
  if (!record || now - record.firstAttempt > LOCKOUT_DURATION_MS) {
    memAttempts.set(ip, { count: 1, firstAttempt: now, lockedUntil: null });
    return false;
  }
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    return true;
  }
  return false;
}

// ─── DB-backed implementation ───────────────────────────────────────

/**
 * Check if an IP is currently locked out.
 * Returns the remaining lockout time in seconds, or 0 if not locked.
 */
export async function checkRateLimit(ip: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ locked_until: Date | null }[]>`
      SELECT locked_until FROM login_attempts WHERE ip = ${ip}
    `;
    const lockedUntil = rows[0]?.locked_until;
    if (!lockedUntil) return 0;
    const remaining = lockedUntil.getTime() - Date.now();
    if (remaining <= 0) {
      await prisma
        .$executeRaw`DELETE FROM login_attempts WHERE ip = ${ip}`.catch(
        () => {}
      );
      return 0;
    }
    return Math.ceil(remaining / 1000);
  } catch {
    // DBエラー時はインメモリにフォールバック（ログインを止めない）
    return memCheckRateLimit(ip);
  }
}

/**
 * Record a failed login attempt. Returns true if the IP is now locked out.
 * UPSERT を1文で行うため、複数インスタンス同時実行でもカウントが失われない。
 */
export async function recordFailedAttempt(ip: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ locked_until: Date | null }[]>`
      INSERT INTO login_attempts (ip, count, first_attempt, locked_until)
      VALUES (${ip}, 1, now(), NULL)
      ON CONFLICT (ip) DO UPDATE SET
        count = CASE
          WHEN login_attempts.first_attempt < now() - (${LOCKOUT_MINUTES} * interval '1 minute')
            THEN 1
          ELSE login_attempts.count + 1
        END,
        first_attempt = CASE
          WHEN login_attempts.first_attempt < now() - (${LOCKOUT_MINUTES} * interval '1 minute')
            THEN now()
          ELSE login_attempts.first_attempt
        END,
        locked_until = CASE
          WHEN (CASE
                  WHEN login_attempts.first_attempt < now() - (${LOCKOUT_MINUTES} * interval '1 minute')
                    THEN 1
                  ELSE login_attempts.count + 1
                END) >= ${MAX_ATTEMPTS}
            THEN now() + (${LOCKOUT_MINUTES} * interval '1 minute')
          ELSE login_attempts.locked_until
        END
      RETURNING locked_until
    `;

    // 古い行の掃除（ベストエフォート・失敗しても無視）
    prisma
      .$executeRaw`
        DELETE FROM login_attempts
        WHERE first_attempt < now() - (${2 * LOCKOUT_MINUTES} * interval '1 minute')
          AND (locked_until IS NULL OR locked_until < now())
      `.catch(() => {});

    const lockedUntil = rows[0]?.locked_until;
    return !!lockedUntil && lockedUntil.getTime() > Date.now();
  } catch {
    return memRecordFailedAttempt(ip);
  }
}

/**
 * Clear failed attempts for an IP (call on successful login).
 */
export async function clearAttempts(ip: string): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM login_attempts WHERE ip = ${ip}`;
  } catch {
    // ignore
  }
  memAttempts.delete(ip);
}
