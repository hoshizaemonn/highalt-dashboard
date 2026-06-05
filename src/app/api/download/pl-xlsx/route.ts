import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { HQ_STORE } from "@/lib/constants";
import {
  generatePlXlsx,
  toFiscalIndex,
  type PlMonthlyData,
} from "@/lib/pl-xlsx";

/**
 * 損益計算書 (PL) を既存テンプレ書式でエクスポート（依頼④）。
 * /api/download/pl-xlsx?year=2026&store=東日本橋
 *
 * - year は 会計年度（fiscalYear, 例: 2026 → 2025/10〜2026/9 = 2026/9期）
 * - store は店舗名（省略時は全体合計）
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

    const years = [fiscalYear - 1, fiscalYear];
    // 経費は accrual 対応のため前々年も含めて拾う
    const expenseYears = [fiscalYear - 2, fiscalYear - 1, fiscalYear];

    const storeWhere = store ? { storeName: store } : {};
    const hiddenStores = (
      await prisma.storeDisplayName.findMany({
        where: { hidden: true },
        select: { storeName: true },
      })
    ).map((r) => r.storeName);
    const notHqOrHidden = { notIn: [HQ_STORE, ...hiddenStores] };

    // ── データ取得（並列） ─────────────────────────────────
    const [
      allPayroll,
      allExpenses,
      allSalesDetail,
      allRevenue,
      allSquare,
      allManualExpense,
      displayNames,
    ] = await Promise.all([
      prisma.payrollData.findMany({
        where: {
          year: { in: years },
          ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
        },
      }),
      prisma.expenseData.findMany({
        where: {
          year: { in: expenseYears },
          isRevenue: 0,
          ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
        },
      }),
      prisma.salesDetail.findMany({
        where: {
          year: { in: years },
          ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
        },
      }),
      prisma.revenueData.findMany({
        where: {
          year: { in: years },
          ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
        },
      }),
      prisma.squareSales.findMany({
        where: {
          year: { in: years },
          ...(store ? { storeName: store } : { storeName: notHqOrHidden }),
        },
      }),
      prisma.manualExpenseEntry.findMany({
        where: { year: { in: years } },
      }),
      prisma.storeDisplayName.findMany(),
    ]);

    // 営業店舗数（按分用）
    const activeStores = (
      await prisma.storeDisplayName.findMany({
        where: { hidden: false },
      })
    ).length;
    const storeCount = Math.max(activeStores || 7, 1);

    // 店舗表示名
    const displayMap = new Map(
      displayNames.map((d) => [d.storeName, d.displayName]),
    );
    const storeDisplayName = store
      ? (displayMap.get(store) ?? store)
      : "全体合計";

    // ── 月次集計 ─────────────────────────────────────────
    const monthly = new Map<number, PlMonthlyData>();
    const ensureSlot = (idx: number): PlMonthlyData => {
      let slot = monthly.get(idx);
      if (!slot) {
        slot = {
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
        };
        monthly.set(idx, slot);
      }
      return slot;
    };

    // SalesDetail / RevenueData
    const salesRows = allSalesDetail.length > 0 ? allSalesDetail : allRevenue;
    for (const r of salesRows) {
      const idx = toFiscalIndex(r.year, r.month, fiscalYear);
      if (idx === null) continue;
      const slot = ensureSlot(idx);
      const cat = r.category ?? "その他";
      if (cat === "月会費" || cat === "入会金") {
        slot.salesMembership += r.amount;
      } else if (cat === "パーソナル") {
        slot.salesPersonalAndProduct += r.amount;
      } else {
        slot.salesPersonalAndProduct += r.amount;
      }
    }

    // Square売上 → パーソナル・物販・その他に加算
    for (const r of allSquare) {
      const idx = toFiscalIndex(r.year, r.month, fiscalYear);
      if (idx === null) continue;
      ensureSlot(idx).salesPersonalAndProduct += r.grossSales;
    }

    // Expenses（accrual 優先）
    for (const r of allExpenses) {
      const ey = r.accrualYear ?? r.year;
      const em = r.accrualMonth ?? r.month;
      const idx = toFiscalIndex(ey, em, fiscalYear);
      if (idx === null) continue;
      const slot = ensureSlot(idx);
      const cat = r.category ?? "その他";
      if (cat === "仕入高") {
        slot.cogs += r.amount;
      } else {
        slot.expenses[cat] = (slot.expenses[cat] ?? 0) + r.amount;
      }
    }

    // ManualExpense（本部一括 / 店舗別）
    for (const r of allManualExpense) {
      const idx = toFiscalIndex(r.year, r.month, fiscalYear);
      if (idx === null) continue;
      // 計上額: storeName="" は本部一括 → 単店なら ÷店舗数, 全体なら全額
      let amount = r.totalAmount;
      if (r.storeName === "") {
        amount = store ? amount / storeCount : amount;
      } else if (store && r.storeName !== store) {
        continue;
      }
      const slot = ensureSlot(idx);
      if (r.category === "仕入高") {
        slot.cogs += amount;
      } else {
        slot.expenses[r.category] = (slot.expenses[r.category] ?? 0) + amount;
      }
    }

    // Payroll（grossTotal を ratio で配分）
    for (const r of allPayroll) {
      const idx = toFiscalIndex(r.year, r.month, fiscalYear);
      if (idx === null) continue;
      const gross = r.grossTotal * (r.ratio / 100);
      const slot = ensureSlot(idx);
      // 簡易: 全額を「正社員・契約社員給与」に計上
      // 通勤手当・法定福利は payroll カラムを参照
      slot.payrollFulltime += r.baseSalary * (r.ratio / 100) +
        r.positionAllowance * (r.ratio / 100) +
        r.overtimePay * (r.ratio / 100);
      slot.payrollCommute +=
        (r.commuteTaxable + r.commuteNontax) * (r.ratio / 100);
      slot.payrollLegalWelfare +=
        (r.healthInsuranceCo +
          r.careInsuranceCo +
          r.pensionCo +
          r.childContributionCo +
          r.pensionFundCo +
          r.employmentInsuranceCo +
          r.workersCompCo +
          r.generalContributionCo) *
        (r.ratio / 100);
      // 残差は salesMembership 等に行かないよう、gross を超えない範囲で
      // bonus には現状マッピング無いので 0 のまま
      const explained =
        slot.payrollFulltime + slot.payrollCommute + slot.payrollLegalWelfare;
      void explained;
      void gross;
    }

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
    console.error("GET /api/download/pl-xlsx error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
