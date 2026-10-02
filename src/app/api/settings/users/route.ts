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
    const { id, password, displayName, role, storeName } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const userId = parseInt(id, 10);

    const data: Record<string, unknown> = {};
    if (password && password.trim()) {
      data.password = await hashPassword(password.trim());
    }
    if (displayName !== undefined) {
      data.displayName = displayName || null;
    }

    // ロール変更（店長⇄マネージャー）・担当店舗の変更（星崎さん依頼 2026-10-02）。
    // manager は role 上は admin と同等に正規化されるため、他人の権限変更という
    // 危険な操作はDB上の生ロール(rawRole)が本当に"admin"の場合のみ許可する。
    const wantsRoleOrStoreChange = role !== undefined || storeName !== undefined;
    if (wantsRoleOrStoreChange) {
      if (session.rawRole !== "admin") {
        return NextResponse.json(
          { error: "ロール・担当店舗の変更はシステム管理者のみ実行できます" },
          { status: 403 },
        );
      }

      const target = await prisma.user.findUnique({ where: { id: userId } });
      if (!target) {
        return NextResponse.json(
          { error: "ユーザーが見つかりません" },
          { status: 404 },
        );
      }
      if (target.role === "admin") {
        return NextResponse.json(
          { error: "管理者ユーザーのロール・担当店舗は変更できません" },
          { status: 403 },
        );
      }

      // 変更できるロールは 店長(store_manager) / マネージャー(manager) のみ
      // （このUIから admin への昇格は不可。事故防止のためDB直接操作を要する）。
      const CHANGEABLE_ROLES = ["store_manager", "manager"];
      if (role !== undefined && !CHANGEABLE_ROLES.includes(role)) {
        return NextResponse.json(
          { error: "変更できるロールは店長・マネージャーのみです" },
          { status: 400 },
        );
      }

      const normalizedStoreName =
        storeName === undefined
          ? undefined
          : Array.isArray(storeName)
            ? storeName.filter(Boolean).join(",")
            : (storeName as string) || "";

      const resultingRole = role !== undefined ? role : target.role;

      if (resultingRole === "manager") {
        // マネージャーは全店舗が対象のため担当店舗は持たせない（指定されても無視せず明示的にnull化）。
        data.role = "manager";
        data.storeName = null;
      } else {
        // store_manager（店長）: 担当店舗が最終的に空だとログインしても
        // 自店舗データが一切見えない「ロック状態」になるため、ここで必ず検証する。
        const resultingStoreName =
          normalizedStoreName !== undefined ? normalizedStoreName : target.storeName;
        if (!resultingStoreName) {
          return NextResponse.json(
            {
              error:
                "店長への変更・店長の担当店舗変更には、担当店舗を1つ以上指定してください",
            },
            { status: 400 },
          );
        }
        if (role !== undefined) data.role = "store_manager";
        if (normalizedStoreName !== undefined) data.storeName = resultingStoreName;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "変更内容がありません" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        role: true,
        storeName: true,
        displayName: true,
      },
    });

    return NextResponse.json({ success: true, user: updated });
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
