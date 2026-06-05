import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * CSV セルを RFC4180 ライクにエスケープして引用符付きで返す。
 */
function escapeCsvCell(value: string): string {
  const v = value ?? "";
  return `"${v.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const store = searchParams.get("store") ?? "";
    // 全行（収入含む）か、経費のみか。デフォルトは all（元情報を欠落させないため）。
    const scope = (searchParams.get("scope") ?? "all").toLowerCase();

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    const rows = await prisma.expenseData.findMany({
      where: {
        year,
        month,
        storeName: store,
        ...(scope === "expense" ? { isRevenue: 0 } : {}),
      },
      orderBy: { day: "asc" },
    });

    const headerRow = await prisma.expenseCsvHeader.findUnique({
      where: { year_month_storeName: { year, month, storeName: store } },
    });

    // 元CSVヘッダ＋勘定科目＋内訳の付与方式（依頼②）
    // 全行に rawRow が入っていて、ヘッダも保存されていれば、元の列構造で書き出す。
    const hasRawData =
      headerRow &&
      rows.length > 0 &&
      rows.every((r) => r.rawRow !== null && r.rawRow !== "");

    let csvBody: string;

    if (hasRawData) {
      const originalHeaders: string[] = JSON.parse(headerRow!.headers);
      const fullHeaders = [...originalHeaders, "勘定科目", "内訳"];
      const headerLine = fullHeaders.map(escapeCsvCell).join(",");

      const lines = rows.map((r) => {
        let raw: string[] = [];
        try {
          raw = JSON.parse(r.rawRow!);
          if (!Array.isArray(raw)) raw = [];
        } catch {
          raw = [];
        }
        // 元行の列数をヘッダ数に揃える（不足は空セル、超過は切り詰めない=末尾に維持）
        const padded =
          raw.length >= originalHeaders.length
            ? raw
            : [...raw, ...Array(originalHeaders.length - raw.length).fill("")];

        const cat = r.category ?? "";
        const bd = r.breakdown ?? "";
        return [...padded, cat, bd].map(escapeCsvCell).join(",");
      });

      csvBody = headerLine + "\r\n" + lines.join("\r\n");
    } else {
      // フォールバック（rawRow未保存の旧データ）: 従来の7列フォーマット
      const header = "年,月,日,摘要,出金,入金,勘定科目,内訳";
      const lines = rows.map((r) => {
        return [
          String(r.year),
          String(r.month),
          String(r.day),
          r.description ?? "",
          r.amount > 0 ? String(r.amount) : "",
          r.deposit > 0 ? String(r.deposit) : "",
          r.category ?? "",
          r.breakdown ?? "",
        ]
          .map(escapeCsvCell)
          .join(",");
      });
      csvBody = header + "\r\n" + lines.join("\r\n");
    }

    const csv = "﻿" + csvBody + "\r\n";

    const mm = String(month).padStart(2, "0");
    const filename = `${year}${mm}_${store}_経費明細.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("GET /api/download/expense-csv error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
