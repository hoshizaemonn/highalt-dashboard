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
    const lockoutSeconds = await checkRateLimit(ip);
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

    // 坪井さん要望: 社員ID / 社員名 のどちらでもログインできるように。
    // さらに半角/全角スペースの有無に揺れがあってもログインできるよう、
    // 名前比較時は全空白を除いて正規化する。
    // ① username 完全一致
    // ② 無ければ displayName 完全一致
    // ③ 無ければ 入力を社員IDとみなして PayrollData から社員名を逆引き
    // ④ 無ければ 全ユーザを正規化比較（スペース揺れ吸収）
    const normalize = (s: string | null | undefined) =>
      (s ?? "").replace(/[\s　]+/g, "");
    const normalizedInput = normalize(username);

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
      // 社員IDとして逆引き（PayrollDataにスペースは入らない想定だが念のため正規化）
      const payroll = await prisma.payrollData.findFirst({
        where: { employeeId: username },
        select: { employeeName: true },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      });
      const empName = payroll?.employeeName;
      if (empName) {
        const byUsername = await prisma.user.findUnique({
          where: { username: empName },
        });
        if (byUsername) {
          user = byUsername;
        } else {
          const byDisp = await prisma.user.findMany({
            where: { displayName: empName },
            take: 2,
          });
          if (byDisp.length === 1) user = byDisp[0];
        }
      }
    }
    if (!user && normalizedInput.length > 0) {
      // スペース揺れ吸収: 全ユーザを取って正規化比較
      const candidates = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          password: true,
          role: true,
          storeName: true,
          displayName: true,
        },
      });
      const matches = candidates.filter(
        (u) =>
          normalize(u.username) === normalizedInput ||
          normalize(u.displayName) === normalizedInput,
      );
      if (matches.length === 1) user = matches[0];
    }
    if (!user && normalizedInput.length > 0) {
      // 社員IDで逆引きした社員名のスペース揺れも吸収
      const payrolls = await prisma.payrollData.findMany({
        select: { employeeName: true },
        distinct: ["employeeName"],
      });
      const empMatches = payrolls
        .map((p) => p.employeeName)
        .filter(
          (name): name is string =>
            !!name && normalize(name) === normalizedInput,
        );
      if (empMatches.length === 1) {
        const empName = empMatches[0];
        const candidates = await prisma.user.findMany({
          select: {
            id: true,
            username: true,
            password: true,
            role: true,
            storeName: true,
            displayName: true,
          },
        });
        const norm = normalize(empName);
        const matches = candidates.filter(
          (u) =>
            normalize(u.username) === norm ||
            normalize(u.displayName) === norm,
        );
        if (matches.length === 1) user = matches[0];
      }
    }

    if (!user) {
      await recordFailedAttempt(ip);
      return NextResponse.json(
        { error: "ユーザー名またはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password);

    if (!valid) {
      const locked = await recordFailedAttempt(ip);
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
    await clearAttempts(ip);

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
    // セキュリティ強化(2026-07): スタックトレースやクエリ詳細（PIIを含み得る）を
    // ログに残さないよう、エラー種別とメッセージのみ出力する。
    console.error(
      "Login error:",
      e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    );
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
