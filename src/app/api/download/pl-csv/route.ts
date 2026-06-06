import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { aggregatePlForFiscalYear, yenToThousand } from "@/lib/pl-data";
import type { PlMonthlyData } from "@/lib/pl-xlsx";

/**
 * 損益計算書 (PL) CSV エクスポート（依頼④・CSV版）。
 * クライアント提供テンプレ「予算実績対比表 / 損益計算書」シートの行構造に合わせて、
 * 10月〜9月の月次値＋合計を1ファイルで出力する。単位は千円。
 *
 *   /api/download/pl-csv?year=2026&store=東日本橋
 */

const COLUMN_HEADERS = [
  "10月",
  "11月",
  "12月",
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "合計",
];

const EXPENSE_CATEGORY_ORDER = [
  "広告宣伝費",
  // 給与関係はPayrollDataから別途
  "修繕費",
  "減価償却費",
  "賃借料",
  "消耗品費",
  "備品費",
  "電気料",
  "上下水道料",
  "通信費",
  "研修費",
  "支払手数料",
  "リース料",
  "委託料",
  "保険料",
  "接待交際費",
  "開発費償却",
  "租税公課",
];

function esc(v: string | number): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmt(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "";
  return String(value);
}

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

    // fiscalIdx 0-11 の各月データ
    const months: PlMonthlyData[] = Array.from({ length: 12 }, (_, i) =>
      monthly.get(i) ?? {
        salesPersonalAndProduct: 0,
        salesMembership: 0,
        salesService: 0,
        salesVending: 0,
        cogs: 0,
        expenses: {},
        payrollFulltime: 0,
        payrollBonus: 0,
        payrollCommute: 0,
        payrollLegalWelfare: 0,
        payrollWelfare: 0,
      },
    );

    // 行ビルダー
    const lines: string[] = [];

    // タイトル
    lines.push(
      `${fiscalYear}/9期　損益計算書,${storeDisplayName},,,,,,,,,,,社外秘,単位：千円`,
    );
    lines.push("");
    lines.push("," + COLUMN_HEADERS.join(","));

    type RowGetter = (m: PlMonthlyData) => number;
    const addRow = (label: string, getValue: RowGetter) => {
      const vals = months.map((m) => yenToThousand(getValue(m)));
      const sum = vals.reduce((s, v) => s + v, 0);
      lines.push(
        esc(label) + "," + vals.map(fmt).join(",") + "," + fmt(Math.round(sum * 10) / 10),
      );
    };

    // 売上
    addRow("パーソナル・物販・その他収入", (m) => m.salesPersonalAndProduct);
    addRow("月会費収入", (m) => m.salesMembership);
    addRow("サービス収入", (m) => m.salesService);
    addRow("自販機手数料収入", (m) => m.salesVending);
    lines.push("");

    // 純売上高
    const netSales = months.map(
      (m) =>
        m.salesPersonalAndProduct +
        m.salesMembership +
        m.salesService +
        m.salesVending,
    );
    addRow("◆純売上高", (m) => {
      const i = months.indexOf(m);
      return netSales[i];
    });

    // 売上原価
    addRow("仕入高", (m) => m.cogs);
    addRow("◆売上原価", (m) => m.cogs);

    // 売上総利益
    const grossProfit = netSales.map((s, i) => s - months[i].cogs);
    addRow("◆売上総利益", (m) => {
      const i = months.indexOf(m);
      return grossProfit[i];
    });

    // 販管費（経費勘定科目 + 人件費）
    addRow("広告宣伝費", (m) => m.expenses["広告宣伝費"] ?? 0);
    addRow("正社員・契約社員給与", (m) => m.payrollFulltime);
    addRow("賞　与", (m) => m.payrollBonus);
    addRow("通勤手当", (m) => m.payrollCommute);
    addRow("法定福利費", (m) => m.payrollLegalWelfare);
    addRow("福利厚生費", (m) => m.payrollWelfare);

    for (const cat of EXPENSE_CATEGORY_ORDER) {
      if (cat === "広告宣伝費") continue; // 上で出力済
      addRow(cat, (m) => m.expenses[cat] ?? 0);
    }
    lines.push("");

    // 販管費合計
    const sgaPerMonth = months.map((m) => {
      const payroll =
        m.payrollFulltime +
        m.payrollBonus +
        m.payrollCommute +
        m.payrollLegalWelfare +
        m.payrollWelfare;
      const expenses = EXPENSE_CATEGORY_ORDER.reduce(
        (s, cat) => s + (m.expenses[cat] ?? 0),
        0,
      );
      return payroll + expenses;
    });
    addRow("◆販売費及び一般管理費", (m) => {
      const i = months.indexOf(m);
      return sgaPerMonth[i];
    });

    // 営業利益
    const opProfit = grossProfit.map((g, i) => g - sgaPerMonth[i]);
    addRow("◆営業利益", (m) => {
      const i = months.indexOf(m);
      return opProfit[i];
    });

    // 営業利益率
    const opRate = opProfit.map((p, i) => {
      const sales = netSales[i];
      if (!sales) return 0;
      return (p / sales) * 100;
    });
    const opRateVals = opRate.map((r) =>
      r === 0 ? "" : `${(Math.round(r * 10) / 10).toFixed(1)}%`,
    );
    // 通期営業利益率
    const totalNetSales = netSales.reduce((s, v) => s + v, 0);
    const totalOp = opProfit.reduce((s, v) => s + v, 0);
    const totalOpRate = totalNetSales
      ? `${(Math.round((totalOp / totalNetSales) * 1000) / 10).toFixed(1)}%`
      : "";
    lines.push("営業利益率," + opRateVals.join(",") + "," + totalOpRate);

    const csv = "﻿" + lines.join("\r\n") + "\r\n";

    const filename = `${fiscalYear}_9期_損益計算書_${storeDisplayName}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("GET /api/download/pl-csv error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
