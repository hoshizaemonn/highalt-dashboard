import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { decodeFileBuffer, parseCSV } from "@/lib/csv-utils";
import {
  parsePayjpFee,
  parseFincodeFee,
  parseSinenergyElectricity,
  type StoreAmount,
} from "@/lib/fee-electricity-parse";
import ExcelJS from "exceljs";

/**
 * 決済手数料（PAY.JP + fincode 合算）・電気料（シンエナジー）の一括取込。
 * 毎月、以下のファイル（任意の組み合わせ）と対象年月を受け取り、店舗別・月次で
 * manual_expense_entry（本部一括経費と同じ枠）に upsert する。
 *
 *  - payjp    : PAY.JP 決済手数料（店舗別サマリCSV）  → 支払手数料
 *  - fincode  : fincode 決済手数料（取引明細CSV・合算）→ 支払手数料
 *  - sinenergy: シンエナジー 電気料金明細（Excel）     → 電気料
 *
 * 支払手数料は PAY.JP + fincode を合算して1店舗1行（松尾さん/星﨑さん確定 2026-07）。
 * admin 限定（会社全体の会計データ）。既存キーは上書き（idempotent）。
 */

const FEE_CATEGORY = "支払手数料";
const ELEC_CATEGORY = "電気料";

/** exceljs のセル値（リッチテキスト/数式/ハイパーリンク等）をプレーンテキスト化。 */
function cellText(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if ("text" in o) return String(o.text ?? "");
    if ("result" in o) return String(o.result ?? "");
    return "";
  }
  return v as string | number;
}

async function xlsxToRows(buf: ArrayBuffer): Promise<(string | number)[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excelにシートが見つかりません。");
  const rows: (string | number)[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = row.values;
    rows.push(Array.isArray(vals) ? vals.slice(1).map(cellText) : []);
  });
  return rows;
}

function mapPlus(a: Map<string, number>, list: StoreAmount[]) {
  for (const { store, amount } of list) a.set(store, (a.get(store) ?? 0) + amount);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const session = auth.session;

    const formData = await request.formData();
    const year = parseInt(String(formData.get("year") ?? ""), 10);
    const month = parseInt(String(formData.get("month") ?? ""), 10);
    const dryRun = formData.get("dryRun") === "true";
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "対象年月を指定してください" }, { status: 400 });
    }

    const payjpFile = formData.get("payjp") as File | null;
    const fincodeFile = formData.get("fincode") as File | null;
    const sinenergyFile = formData.get("sinenergy") as File | null;
    if (!payjpFile && !fincodeFile && !sinenergyFile) {
      return NextResponse.json(
        { error: "PAY.JP / fincode / シンエナジー のいずれかのファイルを選択してください" },
        { status: 400 },
      );
    }

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    for (const f of [payjpFile, fincodeFile, sinenergyFile]) {
      if (f) {
        const e = validateUploadedFile(f);
        if (e) return NextResponse.json({ error: e }, { status: 400 });
      }
    }

    // 支払手数料（PAY.JP + fincode 合算）
    const feeByStore = new Map<string, number>();
    const sources: Record<string, number> = {};
    try {
      if (payjpFile) {
        const rows = parseCSV(decodeFileBuffer(await payjpFile.arrayBuffer()));
        const list = parsePayjpFee(rows);
        mapPlus(feeByStore, list);
        sources.payjp = list.reduce((s, x) => s + x.amount, 0);
      }
      if (fincodeFile) {
        const rows = parseCSV(decodeFileBuffer(await fincodeFile.arrayBuffer()));
        const list = parseFincodeFee(rows);
        mapPlus(feeByStore, list);
        sources.fincode = list.reduce((s, x) => s + x.amount, 0);
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "手数料CSVの解析に失敗しました" },
        { status: 400 },
      );
    }

    // 電気料（シンエナジー）
    const elecByStore = new Map<string, number>();
    try {
      if (sinenergyFile) {
        const rows = await xlsxToRows(await sinenergyFile.arrayBuffer());
        const list = parseSinenergyElectricity(rows);
        mapPlus(elecByStore, list);
        sources.sinenergy = list.reduce((s, x) => s + x.amount, 0);
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "シンエナジーExcelの解析に失敗しました" },
        { status: 400 },
      );
    }

    // 書き込み対象エントリを構築
    const entries: Array<{ store: string; category: string; amount: number; note: string }> = [];
    for (const [store, amount] of feeByStore) {
      if (amount !== 0) entries.push({ store, category: FEE_CATEGORY, amount, note: "決済手数料 自動取込（PAY.JP+fincode）" });
    }
    for (const [store, amount] of elecByStore) {
      if (amount !== 0) entries.push({ store, category: ELEC_CATEGORY, amount, note: "シンエナジー 自動取込" });
    }
    if (entries.length === 0) {
      return NextResponse.json({ error: "取り込める店舗別データがありませんでした" }, { status: 400 });
    }

    // 既存の同一キー（本部一括経費）を取得（上書き確認・二重計上注意の表示用）
    const existing = await prisma.manualExpenseEntry.findMany({
      where: {
        year,
        month,
        category: { in: [FEE_CATEGORY, ELEC_CATEGORY] },
        storeName: { in: entries.map((e) => e.store) },
      },
      select: { storeName: true, category: true, totalAmount: true },
    });
    const existingMap = new Map(
      existing.map((r) => [`${r.category}:${r.storeName}`, r.totalAmount]),
    );

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        year,
        month,
        sources,
        preview: entries.map((e) => ({
          store: e.store,
          category: e.category,
          amount: e.amount,
          existing: existingMap.get(`${e.category}:${e.store}`) ?? null,
        })),
      });
    }

    // upsert（既存キーは上書き・idempotent）
    const updatedByName = session.displayName || session.storeName || "admin";
    await prisma.$transaction(async (tx) => {
      for (const e of entries) {
        await tx.manualExpenseEntry.upsert({
          where: {
            year_month_category_storeName: {
              year,
              month,
              category: e.category,
              storeName: e.store,
            },
          },
          create: {
            year,
            month,
            category: e.category,
            storeName: e.store,
            totalAmount: e.amount,
            note: e.note,
            updatedByName,
          },
          update: { totalAmount: e.amount, note: e.note, updatedByName },
        });
      }
      await tx.uploadLog.create({
        data: {
          userId: session.userId,
          userName: updatedByName,
          dataType: "fee_electricity",
          storeName: null,
          year,
          month,
          fileName: [payjpFile?.name, fincodeFile?.name, sinenergyFile?.name]
            .filter(Boolean)
            .join(", "),
          recordCount: entries.length,
          note: `手数料/電気料 自動取込 ${year}/${month}`,
        },
      });
    });

    return NextResponse.json({
      success: true,
      year,
      month,
      sources,
      recordCount: entries.length,
      entries,
    });
  } catch (error) {
    logError("fee-electricity upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
