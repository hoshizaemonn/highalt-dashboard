import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * 経費明細 CSVエクスポート（依頼②）
 *
 * 出力フォーマット（PayPay銀行CSV書式・メモ列なし + 勘定科目 + 内訳）:
 *   操作日(年) / 操作日(月) / 操作日(日)
 *   操作時刻(時) / 操作時刻(分) / 操作時刻(秒)
 *   取引順番号 / 摘要 / お支払金額 / お預り金額 / 残高
 *   勘定科目 / 内訳
 *
 * - 元情報 (rawRow + ExpenseCsvHeader) がある月 → rawRow から元の列をマップして出力
 * - 元情報がない過去データ → DB保存項目から復元（時刻・取引順番号・残高は空セル）
 */

// 出力する固定列の順序（メモは除外）
const OUTPUT_HEADERS = [
  "操作日(年)",
  "操作日(月)",
  "操作日(日)",
  "操作時刻(時)",
  "操作時刻(分)",
  "操作時刻(秒)",
  "取引順番号",
  "摘要",
  "お支払金額",
  "お預り金額",
  "残高",
  "勘定科目",
  "内訳",
];

// rawRow（元CSV配列）から出力列の値を取り出す既定マッピング（PayPay書式）
// 列0=年, 1=月, 2=日, 3=時, 4=分, 5=秒, 6=取引順番号, 7=摘要,
// 8=お支払金額(出金), 9=お預り金額(入金), 10=残高, 11=メモ
const PAYPAY_DEFAULT_HEADERS = [
  "操作日(年)",
  "操作日(月)",
  "操作日(日)",
  "操作時刻(時)",
  "操作時刻(分)",
  "操作時刻(秒)",
  "取引順番号",
  "摘要",
  "お支払金額",
  "お預り金額",
  "残高",
  "メモ",
];

function escapeCsvCell(value: string): string {
  const v = value ?? "";
  return `"${v.replace(/"/g, '""')}"`;
}

/**
 * 保存されたヘッダから、各出力列がソースCSVの何列目に対応するかを推定する。
 * 保存ヘッダ名と完全一致を試み、一致しない場合は PayPay 既定の順序に従う。
 */
function buildColumnMap(
  storedHeaders: string[] | null,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const h of OUTPUT_HEADERS) {
    if (h === "勘定科目" || h === "内訳") {
      map.set(h, null); // DB側で別途付与
      continue;
    }
    if (storedHeaders) {
      const idx = storedHeaders.findIndex((sh) => sh.trim() === h);
      if (idx >= 0) {
        map.set(h, idx);
        continue;
      }
    }
    // フォールバック: PayPay 既定の順序
    const defIdx = PAYPAY_DEFAULT_HEADERS.indexOf(h);
    map.set(h, defIdx >= 0 ? defIdx : null);
  }
  return map;
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

    const storedHeaders: string[] | null = headerRow
      ? (JSON.parse(headerRow.headers) as string[])
      : null;
    const colMap = buildColumnMap(storedHeaders);

    const headerLine = OUTPUT_HEADERS.map(escapeCsvCell).join(",");

    const lines = rows.map((r) => {
      let raw: string[] = [];
      if (r.rawRow) {
        try {
          const parsed = JSON.parse(r.rawRow);
          if (Array.isArray(parsed)) raw = parsed;
        } catch {
          raw = [];
        }
      }

      // DB由来のフォールバック値（rawRow が無い行用）
      const dbFallback: Record<string, string> = {
        "操作日(年)": String(r.year),
        "操作日(月)": String(r.month),
        "操作日(日)": String(r.day),
        "操作時刻(時)": "",
        "操作時刻(分)": "",
        "操作時刻(秒)": "",
        "取引順番号": "",
        "摘要": r.description ?? "",
        "お支払金額": r.amount > 0 ? String(Math.round(r.amount)) : "",
        "お預り金額": r.deposit > 0 ? String(Math.round(r.deposit)) : "",
        "残高": "",
      };

      const cells = OUTPUT_HEADERS.map((h) => {
        if (h === "勘定科目") return r.category ?? "";
        if (h === "内訳") return r.breakdown ?? "";
        const sourceIdx = colMap.get(h);
        if (sourceIdx !== null && sourceIdx !== undefined && raw[sourceIdx] != null) {
          return String(raw[sourceIdx]);
        }
        return dbFallback[h] ?? "";
      });

      return cells.map(escapeCsvCell).join(",");
    });

    const csv = "﻿" + headerLine + "\r\n" + lines.join("\r\n") + "\r\n";

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
