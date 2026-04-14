import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "highalt_session";
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours in seconds

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

  cookieStore.set(SESSION_COOKIE, JSON.stringify(session), {
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
    const session: SessionUser = JSON.parse(sessionCookie.value);

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
