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
    select: { storeName: true, displayName: true, hidden: true },
  });
  const mapping: Record<string, string> = {};
  const hidden: Record<string, boolean> = {};
  for (const r of rows) {
    mapping[r.storeName] = r.displayName;
    if (r.hidden) hidden[r.storeName] = true;
  }
  return NextResponse.json({ mapping, hidden });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await request.json();
  type Entry = { storeName?: unknown; displayName?: unknown; hidden?: unknown };
  const items: Entry[] = Array.isArray(body.items) ? body.items : [];

  const cleaned = items
    .map((r) => ({
      storeName: typeof r.storeName === "string" ? r.storeName.trim() : "",
      displayName:
        typeof r.displayName === "string" ? r.displayName.trim() : "",
      hidden: r.hidden === true,
    }))
    .filter((r) => r.storeName.length > 0);

  await prisma.$transaction(async (tx) => {
    for (const r of cleaned) {
      const hasCustomName =
        r.displayName.length > 0 && r.displayName !== r.storeName;
      // 表示名カスタムも非表示も無い → 行を削除（既定状態）
      if (!hasCustomName && !r.hidden) {
        await tx.storeDisplayName.deleteMany({
          where: { storeName: r.storeName },
        });
      } else {
        // displayName が無い場合は storeName をそのまま入れる（NOT NULL 制約のため）
        const displayName = hasCustomName ? r.displayName : r.storeName;
        await tx.storeDisplayName.upsert({
          where: { storeName: r.storeName },
          create: {
            storeName: r.storeName,
            displayName,
            hidden: r.hidden,
          },
          update: { displayName, hidden: r.hidden },
        });
      }
    }
  });

  const after = await prisma.storeDisplayName.findMany();
  const mapping: Record<string, string> = {};
  const hidden: Record<string, boolean> = {};
  for (const r of after) {
    mapping[r.storeName] = r.displayName;
    if (r.hidden) hidden[r.storeName] = true;
  }
  return NextResponse.json({ ok: true, mapping, hidden });
}
