import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        storeName: true,
        displayName: true,
      },
      orderBy: { id: "asc" },
    });

    return NextResponse.json({ users });
  } catch (error) {
    logError("Users GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { username, password, displayName, storeName, role } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "username and password are required" },
        { status: 400 },
      );
    }

    // 作成できるのは 店長 / マネージャー のみ（admin はこの画面からは作らせない）。
    // manager は権限が管理者と同等（松尾さん依頼 2026-07）。
    const CREATABLE_ROLES = ["store_manager", "manager"];
    const newRole =
      typeof role === "string" && CREATABLE_ROLES.includes(role)
        ? role
        : "store_manager";
    // マネージャーは全店舗を見るため店舗紐付けは持たせない
    const newStoreName = newRole === "manager" ? null : storeName || null;

    // Check duplicate
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "このユーザー名は既に使用されています" },
        { status: 409 },
      );
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: newRole,
        displayName: displayName || null,
        storeName: newStoreName,
      },
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          storeName: user.storeName,
          displayName: user.displayName,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    logError("Users POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, password, displayName } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (password && password.trim()) {
      data.password = await hashPassword(password.trim());
    }
    if (displayName !== undefined) {
      data.displayName = displayName || null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "変更内容がありません" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: parseInt(id, 10) },
      data,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Users PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const userId = parseInt(id, 10);

    // Prevent deleting admin
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return NextResponse.json(
        { error: "ユーザーが見つかりません" },
        { status: 404 },
      );
    }
    if (target.role === "admin") {
      return NextResponse.json(
        { error: "管理者ユーザーは削除できません" },
        { status: 403 },
      );
    }

    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Users DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
