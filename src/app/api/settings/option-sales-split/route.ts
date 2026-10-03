import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { STORES } from "@/lib/constants";
import { OPTION_SPLIT_CODES } from "@/lib/option-sales-split-loader";

// オプション売上の店舗按分ルール（星崎さん指示 2026-10-02）。
// 変更はシステム管理者（DB上の生ロール rawRole === "admin"）のみ。
// 按分は金額に直結するため、マネージャー（rawRole=manager）は閲覧も不可。

// 開始年月の下限: 2026年10月より前の実績は動かさない（仕様）
const MIN_START = { year: 2026, month: 10 };

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.rawRole !== "admin") return null;
  return session;
}

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [rules, products] = await Promise.all([
      prisma.optionSalesSplitRule.findMany({
        where: { productCode: { in: [...OPTION_SPLIT_CODES] } },
      }),
      prisma.productSales.findMany({
        where: { productCode: { in: [...OPTION_SPLIT_CODES] } },
        select: { productCode: true, productName: true },
        distinct: ["productCode", "productName"],
      }),
    ]);
    const items = OPTION_SPLIT_CODES.map((code) => {
      const r = rules.find((x) => x.productCode === code);
      const name = products.find((p) => p.productCode === code)?.productName ?? null;
      return {
        productCode: code,
        productName: name,
        targetStore: r?.targetStore ?? "",
        ratioPercent: r?.ratioPercent ?? 50,
        startYear: r?.startYear ?? null,
        startMonth: r?.startMonth ?? null,
        enabled: r?.enabled ?? false,
      };
    });
    return NextResponse.json({
      items,
      stores: [...STORES],
      minStart: MIN_START,
    });
  } catch (error) {
    logError("OptionSalesSplit GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const { productCode, targetStore, ratioPercent, startYear, startMonth, enabled } = body ?? {};

    if (!(OPTION_SPLIT_CODES as readonly string[]).includes(productCode)) {
      return NextResponse.json({ error: "対象外の商品コードです" }, { status: 400 });
    }
    const ratio = Number(ratioPercent);
    if (!Number.isInteger(ratio) || ratio < 1 || ratio > 100) {
      return NextResponse.json({ error: "比率は1〜100の整数で指定してください" }, { status: 400 });
    }
    const sy = startYear == null || startYear === "" ? null : Number(startYear);
    const sm = startMonth == null || startMonth === "" ? null : Number(startMonth);
    if ((sy == null) !== (sm == null)) {
      return NextResponse.json({ error: "開始年月は年と月の両方を指定してください" }, { status: 400 });
    }
    if (sy != null && sm != null) {
      if (!Number.isInteger(sy) || !Number.isInteger(sm) || sm < 1 || sm > 12) {
        return NextResponse.json({ error: "開始年月が不正です" }, { status: 400 });
      }
      if (sy * 12 + sm < MIN_START.year * 12 + MIN_START.month) {
        return NextResponse.json(
          { error: "開始年月は2026年10月以降を指定してください（それ以前の実績は変更しない仕様です）" },
          { status: 400 },
        );
      }
    }
    const target = typeof targetStore === "string" ? targetStore.trim() : "";
    if (target && !(STORES as readonly string[]).includes(target)) {
      return NextResponse.json({ error: "按分先の店舗が不正です" }, { status: 400 });
    }
    const isEnabled = enabled === true;
    if (isEnabled && (!target || sy == null || sm == null)) {
      return NextResponse.json(
        { error: "有効化するには按分先店舗と開始年月の指定が必要です" },
        { status: 400 },
      );
    }

    const data = {
      targetStore: target,
      ratioPercent: ratio,
      startYear: sy,
      startMonth: sm,
      enabled: isEnabled,
      updatedByName: session.displayName ?? null,
    };
    const saved = await prisma.optionSalesSplitRule.upsert({
      where: { productCode },
      create: { productCode, ...data, targetStore: target || "" },
      update: data,
    });
    return NextResponse.json({ success: true, rule: saved });
  } catch (error) {
    logError("OptionSalesSplit PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
