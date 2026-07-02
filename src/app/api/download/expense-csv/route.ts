import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import JSZip from "jszip";

/**
 * 経費明細 CSVエクスポート（依頼②・任意期間対応）
 *
 * クエリパラメータ:
 *  - year, month: 単月モード（既存挙動）
 *  - fromYM, toYM: YYYY-MM 形式で任意期間（範囲モード）。優先される。
 *  - store: 店舗名
 *  - scope: all | expense
 *
 * 範囲モードの出力:
 *  - 月ごとに CSV を生成し ZIP で返却（取込元ファイル別の分割も同時に実施）
 *  - 単月かつ取込元1ファイル → 単一 CSV（既存挙動）
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

function baseNameWithoutExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

/**
 * YYYY-MM の文字列を {year, month} にパース。失敗時は null。
 */
function parseYM(s: string | null): { year: number; month: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  return { year, month };
}

/**
 * (fromYM, toYM) → 月リスト。toYM が前なら自動で入替え。
 */
function buildMonthList(
  from: { year: number; month: number },
  to: { year: number; month: number },
): { year: number; month: number }[] {
  const start = from.year * 12 + (from.month - 1);
  const end = to.year * 12 + (to.month - 1);
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  const out: { year: number; month: number }[] = [];
  for (let v = lo; v <= hi; v++) {
    out.push({ year: Math.floor(v / 12), month: (v % 12) + 1 });
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const store = searchParams.get("store") ?? "";
    const scope = (searchParams.get("scope") ?? "all").toLowerCase();

    const fromYM = parseYM(searchParams.get("fromYM"));
    const toYM = parseYM(searchParams.get("toYM"));

    // 範囲モード: fromYM/toYM 両方指定 or 片方のみ＝同月
    let months: { year: number; month: number }[];
    if (fromYM || toYM) {
      const start = fromYM ?? toYM!;
      const end = toYM ?? fromYM!;
      months = buildMonthList(start, end);
    } else {
      const year = parseInt(searchParams.get("year") ?? "", 10);
      const month = parseInt(searchParams.get("month") ?? "", 10);
      if (isNaN(year) || isNaN(month)) {
        return NextResponse.json(
          { error: "year and month (or fromYM/toYM) are required" },
          { status: 400 },
        );
      }
      months = [{ year, month }];
    }

    // 全期間の行を取得
    const rows = await prisma.expenseData.findMany({
      where: {
        OR: months.map((m) => ({ year: m.year, month: m.month })),
        storeName: store,
        ...(scope === "expense" ? { isRevenue: 0 } : {}),
      },
      orderBy: [{ year: "asc" }, { month: "asc" }, { day: "asc" }, { id: "asc" }],
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

    // 月毎のヘッダ取得
    const headerRows = await prisma.expenseCsvHeader.findMany({
      where: {
        OR: months.map((m) => ({
          year: m.year,
          month: m.month,
          storeName: store,
        })),
      },
    });
    const headerMap = new Map<string, string[]>();
    for (const h of headerRows) {
      try {
        const parsed = JSON.parse(h.headers);
        if (Array.isArray(parsed)) {
          headerMap.set(`${h.year}-${h.month}`, parsed);
        }
      } catch {}
    }

    // 月 → (sourceFile → rows) でグループ化
    const monthGroups = new Map<
      string,
      Map<string, ExpenseRow[]>
    >();
    for (const r of rows) {
      const monthKey = `${r.year}-${String(r.month).padStart(2, "0")}`;
      const sfKey =
        r.sourceFile && r.sourceFile.trim() ? r.sourceFile : "経費明細";
      if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, new Map());
      const inner = monthGroups.get(monthKey)!;
      const arr = inner.get(sfKey) ?? [];
      arr.push(r);
      inner.set(sfKey, arr);
    }

    const isSingleMonth = months.length === 1;

    // 単月かつ source_file が1グループ以下 → 既存と同じく単一CSV
    if (isSingleMonth) {
      const ym = months[0];
      const inner = monthGroups.get(`${ym.year}-${String(ym.month).padStart(2, "0")}`);
      const groups = inner ?? new Map<string, ExpenseRow[]>();
      const colMap = buildColumnMap(
        headerMap.get(`${ym.year}-${ym.month}`) ?? null,
      );
      const mm = String(ym.month).padStart(2, "0");
      if (groups.size <= 1) {
        const allRows: ExpenseRow[] =
          [...groups.values()].flat();
        const csv = buildCsvFor(allRows, colMap);
        const filename = `${ym.year}${mm}_${store}_経費明細.csv`;
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          },
        });
      }
      // 単月だが複数ファイル取込 → ZIP
      const zip = new JSZip();
      for (const [sourceFile, groupRows] of groups) {
        const csvBody = buildCsvFor(groupRows, colMap);
        const csvName = `${ym.year}${mm}_${store}_${baseNameWithoutExt(sourceFile)}_経費明細.csv`;
        zip.file(csvName, csvBody);
      }
      const buf = await zip.generateAsync({ type: "nodebuffer" });
      const zipName = `${ym.year}${mm}_${store}_経費明細.zip`;
      return new NextResponse(buf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        },
      });
    }

    // 範囲モード → ZIP（月別 × ファイル別）
    const zip = new JSZip();
    for (const ym of months) {
      const monthKey = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
      const inner = monthGroups.get(monthKey);
      if (!inner || inner.size === 0) continue;
      const colMap = buildColumnMap(
        headerMap.get(`${ym.year}-${ym.month}`) ?? null,
      );
      const mm = String(ym.month).padStart(2, "0");
      if (inner.size === 1) {
        const [sf, groupRows] = [...inner.entries()][0];
        const csvBody = buildCsvFor(groupRows, colMap);
        const tag = baseNameWithoutExt(sf) || "経費明細";
        zip.file(`${ym.year}${mm}_${store}_${tag}.csv`, csvBody);
      } else {
        for (const [sourceFile, groupRows] of inner) {
          const csvBody = buildCsvFor(groupRows, colMap);
          const csvName = `${ym.year}${mm}_${store}_${baseNameWithoutExt(sourceFile)}_経費明細.csv`;
          zip.file(csvName, csvBody);
        }
      }
    }
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const start = months[0];
    const end = months[months.length - 1];
    const startStr = `${start.year}${String(start.month).padStart(2, "0")}`;
    const endStr = `${end.year}${String(end.month).padStart(2, "0")}`;
    const zipName = `${startStr}-${endStr}_${store}_経費明細.zip`;
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      },
    });
  } catch (err) {
    logError("GET /api/download/expense-csv error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
