import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { decodeFileBuffer, parseCSV } from "@/lib/csv-utils";
import {
  parsePayjpFee,
  parseFincodeFee,
  type StoreAmount,
} from "@/lib/fee-electricity-parse";
import {
  parseSinenergyInvoice,
  planStoreImport,
  invoiceNote,
  type ParsedInvoice,
  type PlanItem,
} from "@/lib/sinenergy-invoice";
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
    let year = parseInt(String(formData.get("year") ?? ""), 10);
    let month = parseInt(String(formData.get("month") ?? ""), 10);
    const dryRun = formData.get("dryRun") === "true";
    // 自動取込（GitHub Actions）: 計上月は請求書のタイトル行（口座引落月）から判定する。
    const auto = formData.get("auto") === "true";
    // 年月の指定は任意。シンエナジーの請求明細Excelだけを取り込むときは、省略するとタイトル行から判定する。
    const ymGiven = !(isNaN(year) || isNaN(month) || month < 1 || month > 12);
    if (!auto && !ymGiven && !(isNaN(year) && isNaN(month))) {
      return NextResponse.json({ error: "対象年月が不正です" }, { status: 400 });
    }

    // ファイルは1つのドロップゾーンにまとめて受け取り、中身から自動判別する。
    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json(
        { error: "ファイルを1つ以上選択してください（PAY.JP/fincodeのCSV、シンエナジーのExcel）" },
        { status: 400 },
      );
    }

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    for (const f of files) {
      const e = validateUploadedFile(f);
      if (e) return NextResponse.json({ error: `${f.name}: ${e}` }, { status: 400 });
    }

    if (auto) {
      return await handleAutoImport({ files, dryRun, session });
    }

    // 各ファイルを中身（拡張子＋ヘッダ）から PAY.JP / fincode / シンエナジー に自動判別。
    // 支払手数料 = PAY.JP + fincode（合算）、電気料 = シンエナジー。
    const feeByStore = new Map<string, number>();
    const elecByStore = new Map<string, number>();
    const sources: Record<string, number> = {};
    const detected: Array<{ name: string; type: string }> = [];
    const unknown: string[] = [];
    // 手数料 / 電気料それぞれに寄与したファイル名（note に記録し、
    // 同一ファイルの再取込＝更新／別の入金分ファイル＝加算行、の判定に使う）
    const feeFiles: string[] = [];
    const elecFiles: string[] = [];
    const invoices: Array<{ name: string; inv: ParsedInvoice }> = [];
    const warnings: string[] = [];

    for (const f of files) {
      const lower = f.name.toLowerCase();
      const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xls");
      try {
        if (isExcel) {
          // Excel はシンエナジー電気料金明細。店舗は供給地点特定番号の対応表で判定し、
          // 未登録の番号・合計不一致・月判定の失敗があれば、そのファイルは取り込まない（黙って捨てない）。
          const rows = await xlsxToRows(await f.arrayBuffer());
          const inv = parseSinenergyInvoice(rows);
          if (inv.errors.length > 0) {
            return NextResponse.json(
              {
                error: `${f.name} は取り込めません：${inv.errors.join(" / ")}`,
                errors: inv.errors,
                invoiceNo: inv.invoiceNo || null,
              },
              { status: 400 },
            );
          }
          invoices.push({ name: f.name, inv });
          const list = inv.byStore;
          mapPlus(elecByStore, list);
          sources.sinenergy =
            (sources.sinenergy ?? 0) + list.reduce((s, x) => s + x.amount, 0);
          detected.push({ name: f.name, type: "シンエナジー 電気料" });
          elecFiles.push(f.name);
          continue;
        }
        // CSV: ヘッダを見て PAY.JP か fincode かを判別
        const rows = parseCSV(decodeFileBuffer(await f.arrayBuffer()));
        const header = (rows[0] ?? []).join("").replace(/\s/g, "");
        if (header.includes("PAY.JP") || header.includes("PAYJP")) {
          const list = parsePayjpFee(rows);
          mapPlus(feeByStore, list);
          sources.payjp =
            (sources.payjp ?? 0) + list.reduce((s, x) => s + x.amount, 0);
          detected.push({ name: f.name, type: "PAY.JP 決済手数料" });
          feeFiles.push(f.name);
        } else if (
          header.includes("参考値") ||
          header.includes("メンバー所属店舗") ||
          (header.includes("店舗") && header.includes("決済手数料"))
        ) {
          const list = parseFincodeFee(rows);
          mapPlus(feeByStore, list);
          sources.fincode =
            (sources.fincode ?? 0) + list.reduce((s, x) => s + x.amount, 0);
          detected.push({ name: f.name, type: "fincode 決済手数料" });
          feeFiles.push(f.name);
        } else {
          unknown.push(f.name);
        }
      } catch (e) {
        return NextResponse.json(
          {
            error: `${f.name} の解析に失敗しました${
              e instanceof Error ? "：" + e.message : ""
            }`,
          },
          { status: 400 },
        );
      }
    }

    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: `ファイルの種類を判別できませんでした：${unknown.join(
            " / ",
          )}。PAY.JP・fincode の決済手数料CSV、またはシンエナジーの電気料Excel(.xlsx)を入れてください。`,
        },
        { status: 400 },
      );
    }

    // 年月が未指定なら、請求書のタイトル行（口座引落月）から判定する（複数の請求書は同じ月のときだけ）。
    if (!ymGiven) {
      const books = [...new Set(invoices.map((x) => `${x.inv.bookingYear}-${x.inv.bookingMonth}`))];
      if (books.length !== 1) {
        return NextResponse.json(
          {
            error:
              books.length === 0
                ? "対象年月を指定してください（請求明細Excelがないため月を判定できません）"
                : `請求書の計上月が複数あります（${books.join(" / ")}）。月ごとに分けて取り込むか、対象年月を指定してください`,
          },
          { status: 400 },
        );
      }
      [year, month] = books[0].split("-").map(Number);
    } else {
      // 指定された年月が請求書の引落月と違うときは警告する（取り込みは止めない。手動指定を優先）
      for (const { name, inv } of invoices) {
        if (inv.bookingYear !== year || inv.bookingMonth !== month) {
          warnings.push(
            `${name}: 指定の${year}年${month}月は、請求書の引落月（${inv.bookingYear}年${inv.bookingMonth}月＝${inv.usageYear}年${inv.usageMonth}月分）と異なります`,
          );
        }
      }
    }

    // 書き込み対象エントリを構築。
    // note に「取込元ファイル名」を記録し、これを重複判定キーにする。
    //  - 同じファイルを再取込 → 同じ note の行を update（二重計上しない）
    //  - 別の入金分ファイル（別名）を取込 → 別 note の行を新規作成 → 月内で合算される
    const feeNote = `決済手数料 自動取込（${feeFiles.join(" + ")}）`;
    const elecNote = `シンエナジー 自動取込（${elecFiles.join(" + ")}）`;
    const entries: Array<{ store: string; category: string; amount: number; note: string }> = [];
    for (const [store, amount] of feeByStore) {
      if (amount !== 0) entries.push({ store, category: FEE_CATEGORY, amount, note: feeNote });
    }
    for (const [store, amount] of elecByStore) {
      if (amount !== 0) entries.push({ store, category: ELEC_CATEGORY, amount, note: elecNote });
    }
    if (entries.length === 0) {
      return NextResponse.json({ error: "取り込める店舗別データがありませんでした" }, { status: 400 });
    }

    // 既存の同月・同店舗・同科目の登録額（＝全行の合計）を取得。
    // 加算方式のため「現在の登録合計」を表示し、今回分が上乗せされることを示す。
    // ただし同一ファイル(note一致)が既にある場合は上書き扱いなので加算対象から除く。
    const existing = await prisma.manualExpenseEntry.findMany({
      where: {
        year,
        month,
        category: { in: [FEE_CATEGORY, ELEC_CATEGORY] },
        storeName: { in: entries.map((e) => e.store) },
      },
      select: { storeName: true, category: true, totalAmount: true, note: true },
    });
    // (category:store) → 現在の合計
    const existingTotal = new Map<string, number>();
    // (category:store) → 同一ファイル(note一致)の既存額（あれば上書き＝差し替え）
    const sameFileAmount = new Map<string, number>();
    for (const r of existing) {
      const key = `${r.category}:${r.storeName}`;
      existingTotal.set(key, (existingTotal.get(key) ?? 0) + r.totalAmount);
      const note = r.category === FEE_CATEGORY ? feeNote : elecNote;
      if (r.note === note) sameFileAmount.set(key, r.totalAmount);
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        year,
        month,
        warnings,
        sources,
        detected,
        preview: entries.map((e) => {
          const key = `${e.category}:${e.store}`;
          const curTotal = existingTotal.get(key) ?? 0;
          const same = sameFileAmount.get(key); // 同一ファイルの既存額（更新対象）
          // 取込後の合計 = 現在合計 − 同一ファイル分 + 今回分
          const after = curTotal - (same ?? 0) + e.amount;
          return {
            store: e.store,
            category: e.category,
            amount: e.amount,
            existing: curTotal > 0 ? curTotal : null,
            after,
            mode: same != null ? "update" : "add",
          };
        }),
      });
    }

    // 加算方式で書き込む。manual_expense_entry はユニーク制約なし（依頼#3で撤廃）のため、
    // 同一 note（＝同一取込元ファイル）の行だけを update、無ければ新規行を create する。
    // これにより月2回入金など「別ファイルで分割取込」しても月内で合算される。
    const updatedByName = session.displayName || session.storeName || "admin";
    await prisma.$transaction(async (tx) => {
      for (const e of entries) {
        const existingRow = await tx.manualExpenseEntry.findFirst({
          where: { year, month, category: e.category, storeName: e.store, note: e.note },
          select: { id: true },
        });
        if (existingRow) {
          await tx.manualExpenseEntry.update({
            where: { id: existingRow.id },
            data: { totalAmount: e.amount, note: e.note, updatedByName },
          });
        } else {
          await tx.manualExpenseEntry.create({
            data: {
              year,
              month,
              category: e.category,
              storeName: e.store,
              totalAmount: e.amount,
              note: e.note,
              updatedByName,
            },
          });
        }
      }
      await tx.uploadLog.create({
        data: {
          userId: session.userId,
          userName: updatedByName,
          dataType: "fee_electricity",
          storeName: null,
          year,
          month,
          fileName: files.map((f) => f.name).join(", "),
          recordCount: entries.length,
          note: `手数料/電気料 自動取込 ${year}/${month}`,
        },
      });
    });

    return NextResponse.json({
      success: true,
      year,
      month,
      warnings,
      sources,
      detected,
      recordCount: entries.length,
      entries,
    });
  } catch (error) {
    logError("fee-electricity upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


/**
 * 自動取込（シンエナジーの請求明細Excel1件）。GitHub Actions から `auto=true` で呼ぶ。
 *  - 計上月は請求書のタイトル行の口座引落月（N月分の翌月）
 *  - 同じ請求書番号の行は上書き（ファイル名に依存しない。二重計上しない）
 *  - 同じ店舗・月に別の登録（手入力・過去の手動取込）がある場合は、加算も上書きもせずスキップして警告
 *  - 前月比が極端（3倍超・1/3未満）の店舗は保留（取り込まず警告）
 *  - 解析エラー（未登録の使用場所・合計不一致・月判定失敗・0件）のときは何も取り込まない（400）
 *  - 削除はしない。書き込むのは該当店舗・月の電気料の行の作成／更新のみ
 */
async function handleAutoImport(args: {
  files: File[];
  dryRun: boolean;
  session: { userId: number; displayName: string | null; storeName: string | null };
}) {
  const { files, dryRun, session } = args;
  const f = files[0];
  if (files.length !== 1 || !(f.name.toLowerCase().endsWith(".xlsx") || f.name.toLowerCase().endsWith(".xls"))) {
    return NextResponse.json(
      { error: "自動取込は請求明細Excel（.xlsx）を1ファイルだけ受け付けます" },
      { status: 400 },
    );
  }
  const inv = parseSinenergyInvoice(await xlsxToRows(await f.arrayBuffer()));
  if (inv.errors.length > 0) {
    return NextResponse.json(
      { error: `取り込めません：${inv.errors.join(" / ")}`, errors: inv.errors, invoiceNo: inv.invoiceNo || null },
      { status: 400 },
    );
  }
  const year = inv.bookingYear;
  const month = inv.bookingMonth;
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  const stores = inv.byStore.map((x) => x.store);

  const [existingRows, prevRows] = await Promise.all([
    prisma.manualExpenseEntry.findMany({
      where: { year, month, category: ELEC_CATEGORY, storeName: { in: stores } },
      select: { storeName: true, totalAmount: true, note: true },
    }),
    prisma.manualExpenseEntry.findMany({
      where: { year: prevY, month: prevM, category: ELEC_CATEGORY, storeName: { in: stores } },
      select: { storeName: true, totalAmount: true },
    }),
  ]);
  const prevByStore = new Map<string, number>();
  for (const r of prevRows) prevByStore.set(r.storeName, (prevByStore.get(r.storeName) ?? 0) + r.totalAmount);

  const items: PlanItem[] = inv.byStore.map(({ store, amount }) =>
    planStoreImport({
      store,
      amount,
      invoiceNo: inv.invoiceNo,
      existing: existingRows
        .filter((r) => r.storeName === store)
        .map((r) => ({ amount: r.totalAmount, note: r.note })),
      previousAmount: prevByStore.get(store) ?? null,
    }),
  );
  const head = {
    invoiceNo: inv.invoiceNo,
    usage: { year: inv.usageYear, month: inv.usageMonth },
    booking: { year, month },
    items,
  };
  const writes = items.filter((i) => i.action === "create" || i.action === "update");
  if (dryRun || writes.length === 0) {
    return NextResponse.json({ dryRun, ...head, written: 0 });
  }

  const note = invoiceNote(inv.invoiceNo);
  const updatedByName = session.displayName || session.storeName || "admin";
  await prisma.$transaction(async (tx) => {
    for (const w of writes) {
      const row = await tx.manualExpenseEntry.findFirst({
        where: { year, month, category: ELEC_CATEGORY, storeName: w.store, note },
        select: { id: true },
      });
      if (row) {
        await tx.manualExpenseEntry.update({ where: { id: row.id }, data: { totalAmount: w.amount, updatedByName } });
      } else {
        await tx.manualExpenseEntry.create({
          data: { year, month, category: ELEC_CATEGORY, storeName: w.store, totalAmount: w.amount, note, updatedByName },
        });
      }
    }
    await tx.uploadLog.create({
      data: {
        userId: session.userId,
        userName: updatedByName,
        dataType: "fee_electricity",
        storeName: null,
        year,
        month,
        fileName: f.name,
        recordCount: writes.length,
        note: `電気料 自動取込 請求書番号${inv.invoiceNo}（${year}/${month}計上）`,
      },
    });
  });
  return NextResponse.json({ success: true, ...head, written: writes.length });
}
