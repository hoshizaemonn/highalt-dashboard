import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  return NextResponse.json({
    userId: session.userId,
    role: session.role,
    // DB上の元ロール（manager は role 上は admin と同等に正規化されるため、
    // 「本当のadminかどうか」を区別する必要がある画面（ユーザーのロール変更等）で使う）
    rawRole: session.rawRole ?? session.role,
    storeName: session.storeName,
    displayName: session.displayName,
  });
}
