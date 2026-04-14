import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";

export async function POST(request: Request) {
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
      return NextResponse.json(
        { error: "ユーザー名またはパスワードが正しくありません" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password);

    if (!valid) {
      return NextResponse.json(
        { error: "ユーザー名またはパスワードが正しくありません" },
        { status: 401 }
      );
    }

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
  } catch {
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
