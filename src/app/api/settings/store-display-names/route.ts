import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

/**
 * 店舗表示名マッピング API。
 * - GET: 全ユーザー閲覧可（画面表示用）
 * - PUT: admin のみ
 *
 * 保存形態: { storeName: displayName } のリスト
 * 内部 storeName（DBの紐付けキー）は変更しない。表示名のみ上書き。
 */
export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const rows = await prisma.storeDisplayName.findMany({
    select: { storeName: true, displayName: true },
  });
  const mapping: Record<string, string> = {};
  for (const r of rows) mapping[r.storeName] = r.displayName;
  return NextResponse.json({ mapping });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await request.json();
  type Entry = { storeName?: unknown; displayName?: unknown };
  const items: Entry[] = Array.isArray(body.items) ? body.items : [];

  const cleaned = items
    .map((r) => ({
      storeName: typeof r.storeName === "string" ? r.storeName.trim() : "",
      displayName:
        typeof r.displayName === "string" ? r.displayName.trim() : "",
    }))
    .filter((r) => r.storeName.length > 0);

  await prisma.$transaction(async (tx) => {
    for (const r of cleaned) {
      if (r.displayName.length === 0 || r.displayName === r.storeName) {
        // 空 or 同じ名前ならマッピングを削除（表示はそのまま storeName）
        await tx.storeDisplayName.deleteMany({
          where: { storeName: r.storeName },
        });
      } else {
        await tx.storeDisplayName.upsert({
          where: { storeName: r.storeName },
          create: {
            storeName: r.storeName,
            displayName: r.displayName,
          },
          update: { displayName: r.displayName },
        });
      }
    }
  });

  const after = await prisma.storeDisplayName.findMany();
  const mapping: Record<string, string> = {};
  for (const r of after) mapping[r.storeName] = r.displayName;
  return NextResponse.json({ ok: true, mapping });
}
