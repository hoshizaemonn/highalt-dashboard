import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { canManage, isAdminPage, isRestrictedApi } from "@/lib/permissions";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/keepalive"];
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host) {
      let valid = false;
      try { valid = new URL(origin).host === host; } catch { /* reject malformed origins */ }
      if (!valid) return NextResponse.json({ error: "不正なリクエストです" }, { status: 403 });
    }
  }
  // keepalive validates its own CRON_SECRET; login/logout remain available.
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  const session = await getSession();
  if (!session) {
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "認証が必要です" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
  }
  if (!canManage(session.role)) {
    if (isRestrictedApi(pathname, request.method)) {
      return NextResponse.json({ error: "管理者権限が必要です" }, { status: 403 });
    }
    if (isAdminPage(pathname)) return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|logo\\.png).*)"] };
