import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { checkOrigin } from "@/lib/csrf";

// Brute force protection
const LOGIN_ATTEMPTS = new Map<string, { count: number; firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  if (!checkOrigin(request as NextRequest)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for") || "unknown";

  // Check rate limit
  const now = Date.now();
  const record = LOGIN_ATTEMPTS.get(ip);
  if (record) {
    if (now - record.firstAttempt > WINDOW_MS) {
      LOGIN_ATTEMPTS.delete(ip);
    } else if (record.count >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "ログイン試行回数が上限に達しました。15分後に再度お試しください。" },
        { status: 429 }
      );
    }
  }

  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "ユーザー名とパスワードを入力してください" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      // Track failed attempt
      const existing = LOGIN_ATTEMPTS.get(ip);
      if (existing) {
        existing.count++;
      } else {
        LOGIN_ATTEMPTS.set(ip, { count: 1, firstAttempt: now });
      }
      return NextResponse.json(
        { error: "ユーザー名またはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password);

    if (!valid) {
      // Track failed attempt
      const existing = LOGIN_ATTEMPTS.get(ip);
      if (existing) {
        existing.count++;
      } else {
        LOGIN_ATTEMPTS.set(ip, { count: 1, firstAttempt: now });
      }
      return NextResponse.json(
        { error: "ユーザー名またはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    // Reset counter on successful login
    LOGIN_ATTEMPTS.delete(ip);

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
      { error: "サーバーエラーが発生しました", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
