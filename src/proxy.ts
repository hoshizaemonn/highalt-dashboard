import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    // If user has session and tries to access /login, redirect to /dashboard
    const session = request.cookies.get("highalt_session");
    if (pathname === "/login" && session?.value) {
      try {
        const parsed = JSON.parse(session.value);
        if (parsed.expiresAt > Date.now()) {
          return NextResponse.redirect(new URL("/dashboard", request.url));
        }
      } catch {
        // Invalid session, let them proceed to login
      }
    }
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get("highalt_session");

  if (!session?.value) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const parsed = JSON.parse(session.value);
    if (parsed.expiresAt < Date.now()) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  } catch {
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
