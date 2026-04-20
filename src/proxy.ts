import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

/**
 * Verify HMAC-SHA256 signature using Web Crypto API (Edge Runtime compatible).
 */
async function verifySessionSignature(
  cookieValue: string,
  secret: string
): Promise<string | null> {
  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot === -1) return null;

  const payload = cookieValue.substring(0, lastDot);
  const providedSig = cookieValue.substring(lastDot + 1);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Constant-time comparison
  if (providedSig.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < providedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  return payload;
}

/**
 * Parse and validate session from a signed cookie value.
 * Returns parsed session or null.
 */
async function parseSession(
  cookieValue: string,
  secret: string
): Promise<{ userId: number; expiresAt: number } | null> {
  const payload = await verifySessionSignature(cookieValue, secret);
  if (!payload) return null;

  try {
    const session = JSON.parse(payload);
    if (!session.userId || !session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF protection: verify Origin header on state-changing requests
  if (MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host) {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { error: "不正なリクエストです" },
          { status: 403 }
        );
      }
    }
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    // If user has valid session and tries to access /login, redirect to /dashboard
    if (pathname === "/login") {
      const sessionCookie = request.cookies.get("highalt_session");
      const secret = process.env.SESSION_SECRET;
      if (sessionCookie?.value && secret) {
        const session = await parseSession(sessionCookie.value, secret);
        if (session && session.expiresAt > Date.now()) {
          return NextResponse.redirect(new URL("/dashboard", request.url));
        }
      }
    }
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get("highalt_session");

  if (!sessionCookie?.value) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify HMAC signature
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("SESSION_SECRET is not set");
    return NextResponse.json(
      { error: "サーバー設定エラー" },
      { status: 500 }
    );
  }

  const session = await parseSession(sessionCookie.value, secret);

  if (!session) {
    // Invalid signature or malformed session
    const response = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "認証が必要です" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("highalt_session");
    return response;
  }

  if (session.expiresAt < Date.now()) {
    const response = pathname.startsWith("/api/")
      ? NextResponse.json(
          { error: "セッションが期限切れです" },
          { status: 401 }
        )
      : NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("highalt_session");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
