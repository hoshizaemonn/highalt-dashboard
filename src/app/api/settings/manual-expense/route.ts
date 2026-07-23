import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { logError } from "@/lib/log";

/**
 * 本部一括経費 API。電気代・水道代・家賃など本部で一括支払いし
 * 各店の PayPay 銀行 CSV には現れない経費を admin が月次で入力する。
 * 集計時は totalAmount を営業店舗数で均等按分（dashboard route 参照）。
 *
 * - GET: admin のみ
 * - PUT: admin のみ（バルク upsert）
 * - DELETE: admin のみ（id 指定）
 */

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");

  const where: { year?: number; month?: number } = {};
  if (yearParam) {
    const y = parseInt(yearParam, 10);
    if (!isNaN(y)) where.year = y;
  }
  if (monthParam) {
    const m = parseInt(monthParam, 10);
    if (!isNaN(m)) where.month = m;
  }

  const rows = await prisma.manualExpenseEntry.findMany({
    where,
    orderBy: [{ year: "desc" }, { month: "desc" }, { category: "asc" }],
  });
  return NextResponse.json({ items: rows });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const body = await request.json();
  type Entry = {
    id?: unknown;
    year?: unknown;
    month?: unknown;
    category?: unknown;
    storeName?: unknown;
    totalAmount?: unknown;
    splitRatios?: unknown;
    note?: unknown;
  };
  const items: Entry[] = Array.isArray(body.items) ? body.items : [];

  const updatedByName =
    auth.session.displayName || auth.session.storeName || "admin";

  type Cleaned = {
    id?: number;
    year: number;
    month: number;
    category: string;
    storeName: string;
    totalAmount: number;
    splitRatios: string | null;
    note: string | null;
  };
  const cleaned: Cleaned[] = items
    .map((r) => {
      const id = typeof r.id === "number" ? r.id : undefined;
      const year = typeof r.year === "number" ? r.year : parseInt(String(r.year ?? ""), 10);
      const month =
        typeof r.month === "number" ? r.month : parseInt(String(r.month ?? ""), 10);
      const category = typeof r.category === "string" ? r.category.trim() : "";
      // storeName 空 = 本部一括（均等按分 or 手動按分）、店舗名指定 = その店のみ
      const storeName = typeof r.storeName === "string" ? r.storeName.trim() : "";
      const totalAmount =
        typeof r.totalAmount === "number"
          ? Math.round(r.totalAmount)
          : parseInt(String(r.totalAmount ?? "0").replace(/,/g, ""), 10);
      // splitRatios: 文字列(JSON) or オブジェクトを受け取り、検証して JSON 文字列に正規化
      let splitRatios: string | null = null;
      const sr = r.splitRatios;
      if (sr && typeof sr === "object") {
        const obj: Record<string, number> = {};
        for (const [k, v] of Object.entries(sr as Record<string, unknown>)) {
          const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
          if (Number.isFinite(n) && n > 0) obj[k] = n;
        }
        if (Object.keys(obj).length > 0) splitRatios = JSON.stringify(obj);
      } else if (typeof sr === "string" && sr.trim()) {
        try {
          const parsed = JSON.parse(sr);
          if (parsed && typeof parsed === "object") splitRatios = JSON.stringify(parsed);
        } catch {}
      }
      const note = typeof r.note === "string" ? r.note : null;
      return { id, year, month, category, storeName, totalAmount, splitRatios, note };
    })
    .filter(
      (r) =>
        !isNaN(r.year) &&
        !isNaN(r.month) &&
        r.month >= 1 &&
        r.month <= 12 &&
        r.category.length > 0 &&
        !isNaN(r.totalAmount),
    );

  try {
    // 1行ずつ create/update/delete するため、行数が多いと往復回数が増える。
    // Vercel(海外リージョン)→Supabase(東京)の遅延下では既定の txタイムアウト(5秒)を
    // 超えて毎回失敗していたため、タイムアウトを延長する（本部一括経費の行が増えると
    // 発生・2026-07 松尾さん報告）。根本的な遅延短縮は vercel.json の regions=hnd1 で対応。
    await prisma.$transaction(
      async (tx) => {
        for (const r of cleaned) {
          // 金額0は「その行を削除」の意味。既存行(id有)は削除、未保存の新規空行(id無)は無視。
          // ※ ユニーク制約撤廃(依頼#3)に伴い、キー一括削除はしない（同一キーの別行を巻き込むため）。
          if (r.totalAmount === 0) {
            if (r.id !== undefined) {
              await tx.manualExpenseEntry.deleteMany({ where: { id: r.id } });
            }
            continue;
          }
          // 既存行(id有)は必ず id ベースで更新（カテゴリ・月・計上先の変更も同一行に反映）。
          if (r.id !== undefined) {
            await tx.manualExpenseEntry.updateMany({
              where: { id: r.id },
              data: {
                year: r.year,
                month: r.month,
                category: r.category,
                storeName: r.storeName,
                totalAmount: r.totalAmount,
                splitRatios: r.splitRatios,
                note: r.note,
                updatedByName,
              },
            });
            continue;
          }
          // 新規行(id無)は常に新規作成 → 同一(年/月/カテゴリ/計上先)でも複数行を登録できる（依頼#3）。
          await tx.manualExpenseEntry.create({
            data: {
              year: r.year,
              month: r.month,
              category: r.category,
              storeName: r.storeName,
              totalAmount: r.totalAmount,
              splitRatios: r.splitRatios,
              note: r.note,
              updatedByName,
            },
          });
        }
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } catch (e) {
    logError("PUT /api/settings/manual-expense transaction error:", e);
    return NextResponse.json(
      { error: "保存に失敗しました（サーバー側でエラーが発生しました）" },
      { status: 500 },
    );
  }

  const after = await prisma.manualExpenseEntry.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }, { category: "asc" }],
  });
  return NextResponse.json({ ok: true, items: after });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;
  if (auth.session.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  const { searchParams } = request.nextUrl;
  const id = parseInt(searchParams.get("id") || "", 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  await prisma.manualExpenseEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
