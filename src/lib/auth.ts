import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "highalt_session";
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET environment variable is required in production");
    }
    return "dev-secret-do-not-use-in-production";
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

export interface SessionUser {
  userId: number;
  role: string;
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
    role,
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

    return session;
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
  // 店長: 店舗未指定 or 自店舗以外は拒否
  if (!requestedStore || requestedStore !== result.session.storeName) {
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
  return session.storeName;
}
