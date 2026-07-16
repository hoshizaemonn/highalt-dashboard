import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "highalt_session";
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

// 開発環境用フォールバック: 固定文字列ではなくプロセス起動ごとのランダム値。
// 固定のdevシークレットはコード流出時にセッション偽造に悪用できるため廃止。
// （開発サーバ再起動でセッションが切れるが、開発用途では問題ない）
let devFallbackSecret: string | null = null;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET environment variable is required in production");
    }
    if (!devFallbackSecret) {
      devFallbackSecret = randomBytes(48).toString("base64url");
    }
    return devFallbackSecret;
  }
  return secret;
}

/**
 * Sign a payload string with HMAC-SHA256.
 * Returns "payload.signature" format.
 */
function signPayload(payload: string): string {
  const signature = createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verify and extract the payload from a signed cookie value.
 * Returns null if signature is invalid.
 */
function verifySignedPayload(value: string): string | null {
  const lastDot = value.lastIndexOf(".");
  if (lastDot === -1) return null;

  const payload = value.substring(0, lastDot);
  const providedSig = value.substring(lastDot + 1);

  const expectedSig = createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");

  // Timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(providedSig, "base64url");
    const b = Buffer.from(expectedSig, "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
  } catch {
    return null;
  }

  return payload;
}

/**
 * ロール定義。
 * - admin        : 管理者
 * - manager      : マネージャー（権限は管理者と同等・松尾さん依頼 2026-07）
 * - store_manager: 店長（自店舗のみ）
 *
 * manager は「管理者と同等」のため、セッション上の実効ロール(role)は "admin" に
 * 正規化する。これにより API 各所の `role === "admin"` 判定（多数）を書き換えずに済み、
 * 判定漏れによる権限ホールを構造的に防ぐ。表示用の元ロールは rawRole に保持する。
 */
export const ADMIN_EQUIVALENT_ROLES = ["admin", "manager"] as const;

/** DBロール → セッション上の実効ロール（manager は admin と同等に扱う） */
export function toEffectiveRole(role: string): string {
  return role === "manager" ? "admin" : role;
}

export interface SessionUser {
  userId: number;
  /** 実効ロール（manager は "admin" に正規化済み）。権限判定はこれを使う */
  role: string;
  /** DB上の元ロール（"manager" 等）。表示用 */
  rawRole?: string;
  storeName: string | null;
  displayName: string | null;
  expiresAt: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  return bcrypt.compare(password, storedHash);
}

export async function createSession(
  userId: number,
  role: string,
  storeName: string | null,
  displayName: string | null = null
): Promise<void> {
  const cookieStore = await cookies();
  const session: SessionUser = {
    userId,
    // manager は admin と同等の実効ロールにする（権限判定は role を見る）
    role: toEffectiveRole(role),
    rawRole: role,
    storeName,
    displayName,
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  };

  const signedValue = signPayload(JSON.stringify(session));

  cookieStore.set(SESSION_COOKIE, signedValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE);

  if (!sessionCookie?.value) {
    return null;
  }

  try {
    const payload = verifySignedPayload(sessionCookie.value);
    if (!payload) {
      return null; // Invalid signature — tampered cookie
    }

    const session: SessionUser = JSON.parse(payload);

    if (session.expiresAt < Date.now()) {
      return null;
    }

    // 発行済みCookieに manager が入っている場合も admin 相当へ正規化（取りこぼし防止）
    return {
      ...session,
      role: toEffectiveRole(session.role),
      rawRole: session.rawRole ?? session.role,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Require an authenticated session for an API route.
 * Returns the session or a 401 NextResponse.
 */
export async function requireSession(): Promise<
  | { session: SessionUser; error?: never }
  | { session?: never; error: Response }
> {
  const { NextResponse } = await import("next/server");
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json(
        { error: "認証が必要です" },
        { status: 401 }
      ),
    };
  }
  return { session };
}

/**
 * Require admin role for an API route.
 * Returns the session or a 401/403 NextResponse.
 */
export async function requireAdmin(): Promise<
  | { session: SessionUser; error?: never }
  | { session?: never; error: Response }
> {
  const result = await requireSession();
  if (result.error) return result;
  if (result.session.role !== "admin") {
    const { NextResponse } = await import("next/server");
    return {
      error: NextResponse.json(
        { error: "管理者権限が必要です" },
        { status: 403 }
      ),
    };
  }
  return result;
}

/**
 * 書き込み系 API 用：要求された店舗が許可されているか厳密に検証する。
 *
 * - admin: 任意の店舗（または店舗指定なし）を許可
 * - store_manager: requestedStore が session.storeName と一致しない場合は 403
 *
 * UI 側で店舗セレクタをロックしていても、curl や DevTools 直叩きで
 * 他店舗のデータを書き換えられないよう、サーバ側で必ず本関数を通す。
 */
export async function requireStoreUploadAccess(
  requestedStore: string | null | undefined,
): Promise<
  | { session: SessionUser; error?: never }
  | { session?: never; error: Response }
> {
  const result = await requireSession();
  if (result.error) return result;
  if (result.session.role === "admin") return result;
  // 店長: 店舗未指定 or 担当店舗（カンマ区切りで複数可）に含まれていなければ拒否
  const allowedStores = (result.session.storeName ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!requestedStore || !allowedStores.includes(requestedStore)) {
    const { NextResponse } = await import("next/server");
    return {
      error: NextResponse.json(
        { error: "他店舗のデータは操作できません" },
        { status: 403 }
      ),
    };
  }
  return result;
}

/**
 * 読み取り系 API 用：非 admin の閲覧スコープを自店舗に強制する。
 *
 * - admin: requestedStore をそのまま返す（null なら全店舗集計）
 * - store_manager: 何が要求されても session.storeName を返す（silent override）
 *
 * 403 にしてしまうと UI が壊れるため、読み取りは silent override を採用する。
 * 店舗未指定（全店舗集計）の挙動を要求した非 admin も、強制的に自店舗のみに絞られる。
 */
export function effectiveStoreScope(
  session: SessionUser,
  requestedStore: string | null | undefined,
): string | null {
  if (session.role === "admin") {
    return requestedStore || null;
  }
  // 店長: 担当店舗（カンマ区切りで複数可）の中に要求店舗があればそれを返す。
  const allowedStores = (session.storeName ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (requestedStore && allowedStores.includes(requestedStore)) {
    return requestedStore;
  }
  // 複数店舗担当 + 「全体」or 担当外要求 → admin と同じく null（全店舗ビュー）を返す
  // 単店担当の場合は自店舗にロック（従来通り）
  const isAggregateRequest =
    !requestedStore || requestedStore === "全体";
  if (allowedStores.length > 1 && isAggregateRequest) {
    return null;
  }
  return allowedStores[0] ?? session.storeName;
}

/**
 * 店長セッションの担当店舗リスト（カンマ区切りを配列化）。
 * UI側で店舗セレクタに表示する選択肢を絞るときに使う。
 */
export function getSessionAllowedStores(session: SessionUser): string[] {
  return (session.storeName ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * ダッシュボード集計APIで使う storeName フィルタを返す。
 *
 * 戻り値:
 *  - 文字列: 単店舗（その店舗だけにフィルタ）
 *  - { notIn: [...] } や { in: [...] } 等の Prisma フィルタ: 複数店舗の集計
 *
 * パターン:
 *  - admin + 特定店舗指定: その店舗
 *  - admin + 「全体」または未指定: notHqOrHidden（全店）
 *  - 店長（単店）+ 任意指定: 担当店舗1つ（要求と無関係に強制）
 *  - 店長（複数店舗担当）+ 担当内店舗指定: その店舗
 *  - 店長（複数店舗担当）+ 「全体」または未指定 or 担当外: 担当店舗を IN 句で集計
 */
export function getEffectiveStoreFilter(
  session: SessionUser,
  requestedStore: string | null | undefined,
  notHqOrHidden: { notIn: string[] },
): string | { notIn: string[] } | { in: string[] } {
  const normalizedRequest = (requestedStore ?? "").trim();
  const isAggregateRequest =
    !normalizedRequest || normalizedRequest === "全体";

  if (session.role === "admin") {
    return isAggregateRequest ? notHqOrHidden : normalizedRequest;
  }
  const allowedStores = getSessionAllowedStores(session);
  if (allowedStores.length === 0) {
    // 担当店舗が未設定の店長 → 安全のため絶対にマッチしない条件を返す
    return { in: [] };
  }
  if (!isAggregateRequest && allowedStores.includes(normalizedRequest)) {
    return normalizedRequest;
  }
  // 単店担当: 自店舗ロック（従来通り）
  if (allowedStores.length === 1) {
    return allowedStores[0];
  }
  // 複数店舗担当 + 「全体」 → 全店舗（非表示・本部除く）を閲覧可能（書き込みは別途 requireStoreUploadAccess で担当店舗のみに制限）
  return notHqOrHidden;
}
