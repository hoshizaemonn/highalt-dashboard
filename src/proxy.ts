import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return "dev-secret-do-not-use-in-production";
  return secret;
}

/** Verify HMAC-SHA256 signed cookie using Web Crypto API (Edge-compatible) */
async function verifySignedCookie(
  signed: string
): Promise<Record<string, unknown> | null> {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;

  const payload = signed.substring(0, lastDot);
  const signature = signed.substring(lastDot + 1);

  const secret = getSessionSecret();
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(expected)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  if (signature !== expectedB64) return null;

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    // If user has session and tries to access /login, redirect to /dashboard
    const session = request.cookies.get("highalt_session");
    if (pathname === "/login" && session?.value) {
      const parsed = await verifySignedCookie(session.value);
      if (parsed && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now()) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    }
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get("highalt_session");

  if (!session?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const parsed = await verifySignedCookie(session.value);
  if (!parsed || typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) {
    return NextResponse.redirect(new URL("/login", request.url));
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
