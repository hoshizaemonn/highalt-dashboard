import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { generatePlXlsx } from "@/lib/pl-xlsx";
import { aggregatePlForFiscalYear } from "@/lib/pl-data";

/**
 * 損益計算書 (PL) を既存テンプレ書式でエクスポート（依頼④）。
 * /api/download/pl-xlsx?year=2026&store=東日本橋
 *
 * - year は 会計年度（fiscalYear, 例: 2026 → 2025/10〜2026/9 = 2026/9期）
 * - store は店舗名（省略時は全体合計）
 *
 * 集計ロジックは pl-csv と共通の aggregatePlForFiscalYear（src/lib/pl-data.ts）を使う。
 * ★以前はこのファイルに独自の集計ロジックを重複実装していたが、
 *   splitRatios/categorySplits（複数店舗・複数科目への按分）を反映しておらず、
 *   pl-csv 側とは異なる（より不正確な）数値を出す状態だった。
 *   共通ロジックに寄せることで、CSV/Excel 両エクスポートの数値を一致させる。
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const fiscalYear = parseInt(searchParams.get("year") ?? "", 10);
    const store = searchParams.get("store") ?? "";

    if (isNaN(fiscalYear)) {
      return NextResponse.json(
        { error: "year is required" },
        { status: 400 },
      );
    }

    const { storeDisplayName, monthly } = await aggregatePlForFiscalYear(
      fiscalYear,
      store,
    );

    const buffer = await generatePlXlsx(fiscalYear, storeDisplayName, monthly);

    const filename = `${fiscalYear}_9期_損益計算書_${storeDisplayName}.xlsx`;
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    logError("GET /api/download/pl-xlsx error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
