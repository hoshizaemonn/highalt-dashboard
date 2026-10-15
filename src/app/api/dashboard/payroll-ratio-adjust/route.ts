import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { validateSplits } from "@/lib/payroll-allocation";
import { clearMonthlySplit, saveMonthlySplit } from "@/lib/payroll-reallocate";

/**
 * 月単位の人件費按分調整 API（月別調整）
 *
 * 用途: 応援勤務・ヘルプ・兼務などで「特定の月だけ複数店舗で按分したい」場合に、
 * その月の対象従業員の人件費を任意の比率で再分配する。
 *
 * 調整内容は payroll_monthly_split に保存する。店舗割当の優先順位は
 *   その月の月別調整 ＞ マッピング（従業員→店舗マッピング）＞ 社員番号ルール
 * なので、あとからマッピングを保存/削除しても、人件費CSVを再取込しても、この月の調整は残る。
 *
 * POST   { year, month, employeeId, splits: [{ storeName, ratio }, ...] } … 保存
 * DELETE ?year=&month=&employeeId=                                       … 解除（マッピングに戻す）
 *
 * 制約:
 *   - admin のみ実行可
 *   - splits の合計 ratio が 100 でなければエラー（±1 まで許容）／店舗の重複不可
 *   - その月の人件費データが無い従業員は対象外（先にCSVを取込む）
 */

function parseYm(year: unknown, month: unknown): { year: number; month: number } | null {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || y < 2000 || y > 2100 || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const body = (await request.json()) as {
      year?: unknown;
      month?: unknown;
      employeeId?: unknown;
      splits?: unknown;
    };
    const ym = parseYm(body.year, body.month);
    const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
    if (!ym || !employeeId) {
      return NextResponse.json(
        { error: "year, month, employeeId, splits は必須です" },
        { status: 400 },
      );
    }
    const checked = validateSplits(body.splits);
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }

    const updatedBy = auth.session.displayName || auth.session.storeName || "admin";
    const result = await prisma.$transaction((tx) =>
      saveMonthlySplit(tx, { ...ym, employeeId, splits: checked.splits, updatedBy }),
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: "該当する人件費データがありません。先にCSVを取込んでください。" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, employeeId, ...ym, splits: checked.splits });
  } catch (err) {
    logError("payroll-ratio-adjust error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const ym = parseYm(searchParams.get("year"), searchParams.get("month"));
    const employeeId = (searchParams.get("employeeId") ?? "").trim();
    if (!ym || !employeeId) {
      return NextResponse.json({ error: "year, month, employeeId は必須です" }, { status: 400 });
    }

    const { removed } = await prisma.$transaction((tx) =>
      clearMonthlySplit(tx, { ...ym, employeeId }),
    );
    return NextResponse.json({ ok: true, employeeId, ...ym, removed });
  } catch (err) {
    logError("payroll-ratio-adjust delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
