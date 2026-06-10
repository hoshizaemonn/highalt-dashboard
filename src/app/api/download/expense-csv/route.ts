import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import JSZip from "jszip";

/**
 * 経費明細 CSVエクスポート（依頼②）
 *
 * 出力フォーマット（PayPay銀行CSV書式・メモ列なし + 勘定科目 + 内訳）:
 *   操作日(年/月/日) 操作時刻(時/分/秒) 取引順番号 摘要 お支払金額 お預り金額 残高 勘定科目 内訳
 *
 * 取込元ファイルが複数ある場合（例: 経費CSV + 売上CSV）は、source_file 単位で
 * 行をグループ化し、ZIPで複数CSVを返す（2ファイル取込→2ファイル出力）。
 */

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

function buildColumnMap(
  storedHeaders: string[] | null,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const h of OUTPUT_HEADERS) {
    if (h === "勘定科目" || h === "内訳") {
      map.set(h, null);
      continue;
    }
    if (storedHeaders) {
      const idx = storedHeaders.findIndex((sh) => sh.trim() === h);
      if (idx >= 0) {
        map.set(h, idx);
        continue;
      }
    }
    const defIdx = PAYPAY_DEFAULT_HEADERS.indexOf(h);
    map.set(h, defIdx >= 0 ? defIdx : null);
  }
  return map;
}

interface ExpenseRow {
  year: number;
  month: number;
  day: number;
  description: string | null;
  amount: number;
  deposit: number;
  category: string | null;
  breakdown: string;
  rawRow: string | null;
  sourceFile: string | null;
}

function buildCsvFor(
  rows: ExpenseRow[],
  colMap: Map<string, number | null>,
): string {
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
  return "﻿" + headerLine + "\r\n" + lines.join("\r\n") + "\r\n";
}

/**
 * ファイル名から拡張子を除いた基底名を取り出す。ZIP内のCSV名生成に使う。
 */
function baseNameWithoutExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const store = searchParams.get("store") ?? "";
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
      select: {
        year: true,
        month: true,
        day: true,
        description: true,
        amount: true,
        deposit: true,
        category: true,
        breakdown: true,
        rawRow: true,
        sourceFile: true,
      },
    });

    const headerRow = await prisma.expenseCsvHeader.findUnique({
      where: { year_month_storeName: { year, month, storeName: store } },
    });

    const storedHeaders: string[] | null = headerRow
      ? (JSON.parse(headerRow.headers) as string[])
      : null;
    const colMap = buildColumnMap(storedHeaders);

    // source_file 単位でグループ化
    const groups = new Map<string, ExpenseRow[]>();
    for (const r of rows) {
      const key = r.sourceFile && r.sourceFile.trim() ? r.sourceFile : "経費明細";
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }

    const mm = String(month).padStart(2, "0");

    // 1グループのみ → 単一CSV（従来挙動）
    if (groups.size <= 1) {
      const csv = buildCsvFor(rows, colMap);
      const filename = `${year}${mm}_${store}_経費明細.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    }

    // 複数グループ → ZIPで返す
    const zip = new JSZip();
    for (const [sourceFile, groupRows] of groups) {
      const csvBody = buildCsvFor(groupRows, colMap);
      const csvName = `${year}${mm}_${store}_${baseNameWithoutExt(sourceFile)}_経費明細.csv`;
      zip.file(csvName, csvBody);
    }
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const zipName = `${year}${mm}_${store}_経費明細.zip`;
    return new NextResponse(zipBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
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
