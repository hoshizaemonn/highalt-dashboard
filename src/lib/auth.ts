import bcrypt from "bcryptjs";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "highalt_session";
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // Fallback for development — in production SESSION_SECRET must be set
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET environment variable is required in production");
    }
    return "dev-secret-do-not-use-in-production";
  }
  return secret;
}

/** Sign a payload string with HMAC-SHA256 */
function sign(payload: string): string {
  const secret = getSessionSecret();
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify and extract payload from a signed string. Returns null if invalid. */
export function verifySignature(signed: string): string | null {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;

  const payload = signed.substring(0, lastDot);
  const signature = signed.substring(lastDot + 1);

  const secret = getSessionSecret();
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");

  // Timing-safe comparison to prevent timing attacks
  try {
    const sigBuf = Buffer.from(signature, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
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
  // Support both bcrypt ($2a$/$2b$ prefix) and legacy SHA-256 hashes
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$")) {
    return bcrypt.compare(password, storedHash);
  }
  // Legacy SHA-256 hash (from Streamlit app)
  const sha256 = createHash("sha256").update(password).digest("hex");
  return sha256 === storedHash;
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

  const signed = sign(JSON.stringify(session));

  cookieStore.set(SESSION_COOKIE, signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
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
    const payload = verifySignature(sessionCookie.value);
    if (!payload) return null;

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
