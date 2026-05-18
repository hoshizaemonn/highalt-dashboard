import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import {
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from "@/lib/rate-limit";

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);

    // Check rate limit before processing
    const lockoutSeconds = checkRateLimit(ip);
    if (lockoutSeconds > 0) {
      return NextResponse.json(
        {
          error: `ログイン試行回数が上限に達しました。${Math.ceil(lockoutSeconds / 60)}分後に再度お試しください`,
        },
        { status: 429 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "ユーザー名とパスワードを入力してください" },
        { status: 400 }
      );
    }

    // ① username 一致を優先、② 無ければ displayName 一致を探す
    //   （坪井さん要望: 社員ID / 社員名 のどちらでもログインできるように）
    //   displayName 一致が複数ある場合は曖昧なので失敗扱い
    let user = await prisma.user.findUnique({
      where: { username },
    });
    if (!user) {
      const byDisplay = await prisma.user.findMany({
        where: { displayName: username },
        take: 2,
      });
      if (byDisplay.length === 1) user = byDisplay[0];
    }

    if (!user) {
      recordFailedAttempt(ip);
      return NextResponse.json(
        { error: "ユーザー名またはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password);

    if (!valid) {
      const locked = recordFailedAttempt(ip);
      if (locked) {
        return NextResponse.json(
          {
            error: "ログイン試行回数が上限に達しました。15分後に再度お試しください",
          },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: "ユーザー名またはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    // Success — clear failed attempts
    clearAttempts(ip);

    await createSession(user.id, user.role, user.storeName, user.displayName);

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        storeName: user.storeName,
        displayName: user.displayName,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
