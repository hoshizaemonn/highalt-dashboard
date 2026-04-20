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
