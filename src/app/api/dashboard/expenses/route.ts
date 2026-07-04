import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireSession,
  effectiveStoreScope,
  getSessionAllowedStores,
} from "@/lib/auth";
import { parseAccrualMonth } from "@/lib/accrual";
import { REVENUE_CATEGORIES } from "@/lib/constants";

const REVENUE_SET = new Set<string>(REVENUE_CATEGORIES as readonly string[]);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const requestedStore = searchParams.get("store") ?? "";
    // 非adminは店舗パラメータを無視して自店舗に強制スコープ
    const store = effectiveStoreScope(auth.session, requestedStore) ?? "";

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    // 発生月対応（依頼⑥）: 当年＋前年から取得し、accrual優先で当該月の行に絞る
    // 入金行（isRevenue=1）も含めて取得する（依頼: 入金部分も内訳・分類可能に）
    // 依頼A: splitRatios あり行は store フィルタを跨ぐため OR で展開
    const allRows = await prisma.expenseData.findMany({
      where: {
        year: { in: [year - 1, year] },
        OR: [
          { storeName: store },
          { splitRatios: { not: null } },
        ],
      },
      orderBy: { day: "asc" },
      select: {
        id: true,
        year: true,
        month: true,
        day: true,
        description: true,
        amount: true,
        deposit: true,
        category: true,
        breakdown: true,
        isRevenue: true,
        accrualYear: true,
        accrualMonth: true,
        storeName: true,
        splitRatios: true,
        categorySplits: true,
      },
    });
    const rows = allRows
      .filter((r) => {
        const ey = r.accrualYear ?? r.year;
        const em = r.accrualMonth ?? r.month;
        if (ey !== year || em !== month) return false;
        if (r.storeName === store) return true;
        // splitRatios あり行は当該店舗が比率に含まれる場合のみ表示
        if (r.splitRatios) {
          try {
            const ratios = JSON.parse(r.splitRatios);
            if (ratios && typeof ratios === "object" && store in ratios) return true;
          } catch {}
        }
        // categorySplits も同様に判定（各分解の splitRatios または親 storeName を見る）
        if (r.categorySplits) {
          try {
            const cs = JSON.parse(r.categorySplits);
            if (Array.isArray(cs)) {
              for (const item of cs) {
                if (
                  item?.splitRatios &&
                  typeof item.splitRatios === "object" &&
                  store in item.splitRatios
                ) {
                  return true;
                }
              }
            }
          } catch {}
        }
        return false;
      })
      .map((r) => {
        // クライアント向けには splitRatios / categorySplits をパース済で返す
        let split: Record<string, number> | null = null;
        if (r.splitRatios) {
          try {
            const o = JSON.parse(r.splitRatios);
            if (o && typeof o === "object") split = o;
          } catch {}
        }
        let catSplits:
          | Array<{
              category: string;
              amount: number;
              splitRatios?: Record<string, number> | null;
            }>
          | null = null;
        if (r.categorySplits) {
          try {
            const arr = JSON.parse(r.categorySplits);
            if (Array.isArray(arr)) catSplits = arr;
          } catch {}
        }
        return {
          ...r,
          splitRatios: split,
          categorySplits: catSplits,
        };
      });

    // Match Amazon orders to fill breakdown for AMAZON expenses
    // Include orders for this month + orders with no payment date
    const monthPrefix = `${year}/${String(month).padStart(2, "0")}`;
    const amazonRows = await prisma.amazonOrder.findMany({
      where: {
        OR: [
          { paymentDate: { startsWith: monthPrefix } },
          { paymentDate: "該当無し" },
          { paymentDate: "" },
          { paymentDate: null },
        ],
      },
      select: {
        shortName: true,
        productName: true,
        amount: true,
        orderTotal: true,
        paymentDate: true,
        orderDate: true,
        storeName: true,
        asin: true,
      },
    });

    // Also load product master for ASIN-based matching
    const productMaster = await prisma.amazonProductMaster.findMany({
      select: { asin: true, productName: true },
    });
    const masterByAsin = new Map(productMaster.map((p) => [p.asin, p.productName]));

    // Normalize full-width to half-width for matching
    function normalizeToHalf(s: string): string {
      return s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    }

    // Pre-compute payment groups: group amazon orders by (paymentDate, orderTotal)
    // to match shipment-level payments (multiple items in one payment)
    const paymentGroups = new Map<string, typeof amazonRows>();
    for (const a of amazonRows) {
      if (!a.paymentDate || a.paymentDate === "該当無し") continue;
      // Group by payment date + order ID (same shipment)
      const key = `${a.paymentDate}_${a.orderTotal}`;
      const group = paymentGroups.get(key) || [];
      group.push(a);
      paymentGroups.set(key, group);
    }

    // Also group by payment date only, summing amounts per shipment
    // A "shipment" is identified by same paymentDate + same orderDate + same orderTotal
    const shipmentPayments = new Map<number, typeof amazonRows>();
    for (const [, group] of paymentGroups) {
      const totalPayment = group.reduce((s, a) => s + a.amount, 0);
      if (!shipmentPayments.has(totalPayment)) {
        shipmentPayments.set(totalPayment, group);
      }
    }

    const enriched = rows.map((row) => {
      if (row.breakdown && row.breakdown.trim()) return row;

      const desc = normalizeToHalf(row.description || "").toUpperCase();
      if (!desc.includes("AMAZON")) return row;

      const amt = Math.round(row.amount);

      if (amazonRows.length > 0) {
        const dayStr = `${year}/${String(month).padStart(2, "0")}/${String(row.day).padStart(2, "0")}`;

        // 1. Exact: payment_date + order_total
        let matched = amazonRows.filter(
          (a) => a.paymentDate === dayStr && a.orderTotal === amt,
        );

        // 2. order_total only
        if (matched.length === 0) {
          matched = amazonRows.filter((a) => a.orderTotal === amt);
        }

        // 3. Individual product amount
        if (matched.length === 0) {
          matched = amazonRows.filter((a) => a.amount === amt);
        }

        // 4. Shipment payment sum (multiple products in one payment = expense amount)
        if (matched.length === 0) {
          const shipmentMatch = shipmentPayments.get(amt);
          if (shipmentMatch) {
            matched = shipmentMatch;
          }
        }

        if (matched.length > 0) {
          const names = [...new Set(matched.map((m) => m.shortName || m.productName).filter(Boolean))];
          if (names.length > 0) {
            return { ...row, breakdown: names.join(" / ") };
          }
        }
      }

      return row;
    });

    return NextResponse.json({ expenses: enriched });
  } catch (err) {
    logError("GET /api/dashboard/expenses error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const body = await request.json();

    // Support batch: { updates: [...] } or single: { id, ... }
    const updates: Array<{
      id: number;
      category?: string;
      amount?: number;
      deposit?: number;
      breakdown?: string;
      // 依頼A: 行ごとの按分比率（店舗→%）。null/未指定なら変更なし、明示null送信なら按分解除
      splitRatios?: Record<string, number> | null;
      // 依頼A: 行の科目別分解（PayPay一括出金の家賃+電気代+...を分ける）
      categorySplits?:
        | Array<{
            category: string;
            amount: number;
            splitRatios?: Record<string, number> | null;
          }>
        | null;
    }> = body.updates ?? [body];

    if (!updates.length || !updates[0].id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 },
      );
    }

    // 非adminの書込スコープ = GETの可視条件と一致させる（自店舗 or 按分に自店を含む共有行）。
    // session.storeName は複数店舗担当だとカンマ区切りになるため、完全一致ではなく担当店舗リストで判定する。
    const isAdmin = auth.session.role === "admin";
    const allowedStores = isAdmin
      ? []
      : getSessionAllowedStores(auth.session);

    // 按分（splitRatios / categorySplits）に担当店舗が含まれるか（＝店長が閲覧・編集してよい共有行か）
    const splitIncludesAllowedStore = (row: {
      storeName: string | null;
      splitRatios: string | null;
      categorySplits: string | null;
    }): boolean => {
      if (row.storeName && allowedStores.includes(row.storeName)) return true;
      const inObj = (raw: string | null): boolean => {
        if (!raw) return false;
        try {
          const o = JSON.parse(raw);
          if (o && typeof o === "object" && !Array.isArray(o)) {
            return allowedStores.some((s) => s in o);
          }
          if (Array.isArray(o)) {
            for (const item of o) {
              if (
                item?.splitRatios &&
                typeof item.splitRatios === "object" &&
                allowedStores.some((s) => s in item.splitRatios)
              ) {
                return true;
              }
            }
          }
        } catch {}
        return false;
      };
      return inObj(row.splitRatios) || inObj(row.categorySplits);
    };

    // Run updates sequentially (Supabase connection pool limit)
    const results = [];
    for (const update of updates) {
      const data: Record<string, unknown> = {};
      if (update.category !== undefined) {
        data.category = update.category;
        // 収入カテゴリが選ばれた場合は isRevenue=1、そうでなければ 0 に自動同期
        if (update.category && REVENUE_SET.has(update.category)) {
          data.isRevenue = 1;
        } else if (update.category) {
          data.isRevenue = 0;
        }
      }
      if (update.amount !== undefined) data.amount = update.amount;
      if (update.deposit !== undefined) data.deposit = update.deposit;
      if (update.splitRatios !== undefined) {
        // null → 解除、オブジェクト → JSON文字列化（0以下/不正な比率は除外）
        if (update.splitRatios === null) {
          data.splitRatios = null;
        } else if (typeof update.splitRatios === "object") {
          const clean: Record<string, number> = {};
          for (const [k, v] of Object.entries(update.splitRatios)) {
            const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
            if (Number.isFinite(n) && n > 0) clean[k] = n;
          }
          data.splitRatios =
            Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
        }
      }
      if (update.categorySplits !== undefined) {
        // null/空配列 → 解除、配列 → JSON文字列化（カテゴリ/金額が無効な要素は除外）
        if (update.categorySplits === null) {
          data.categorySplits = null;
        } else if (Array.isArray(update.categorySplits)) {
          const cleanArr = update.categorySplits
            .map((item) => {
              const category = String(item?.category ?? "").trim();
              const amount = Number(item?.amount ?? 0);
              if (!category || !Number.isFinite(amount) || amount === 0) return null;
              let splitRatios: Record<string, number> | null = null;
              if (item.splitRatios && typeof item.splitRatios === "object") {
                const clean: Record<string, number> = {};
                for (const [k, v] of Object.entries(item.splitRatios)) {
                  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
                  if (Number.isFinite(n) && n > 0) clean[k] = n;
                }
                if (Object.keys(clean).length > 0) splitRatios = clean;
              }
              return { category, amount, splitRatios };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          data.categorySplits =
            cleanArr.length > 0 ? JSON.stringify(cleanArr) : null;
        }
      }
      if (update.breakdown !== undefined) {
        data.breakdown = update.breakdown;
        // 依頼⑥: 内訳の編集時に発生月帰属を再計算
        const existingForAccrual = await prisma.expenseData.findUnique({
          where: { id: update.id },
          select: { year: true, month: true },
        });
        if (existingForAccrual) {
          const accrual = parseAccrualMonth(
            update.breakdown,
            existingForAccrual.year,
            existingForAccrual.month,
          );
          data.accrualYear = accrual?.accrualYear ?? null;
          data.accrualMonth = accrual?.accrualMonth ?? null;
        }
      }

      if (Object.keys(data).length === 0) continue;

      // 非adminは、自店舗の行 または 按分に自店を含む共有行のみ更新可（GETの可視条件と一致）
      if (!isAdmin) {
        const existing = await prisma.expenseData.findUnique({
          where: { id: update.id },
          select: { storeName: true, splitRatios: true, categorySplits: true },
        });
        if (!existing || !splitIncludesAllowedStore(existing)) {
          return NextResponse.json(
            { error: "他店舗のデータは編集できません" },
            { status: 403 },
          );
        }
      }

      const result = await prisma.expenseData.update({
        where: { id: update.id },
        data,
      });
      results.push(result);

      // Auto-register expense rule when category is set
      if (update.category && result.description) {
        const rawDesc = result.description.trim();

        // Extract a meaningful keyword from the description
        // e.g. "Vデビット AMAZON.CO.JP 1A055001" → "AMAZON.CO.JP"
        // e.g. "SMBC（セコム）" → "SMBC（セコム）"
        // e.g. "振込手数料" → "振込手数料"
        // e.g. "Vデビット 印刷通販プリントパック 1A055002" → "印刷通販プリントパック"
        // e.g. "振込 カ）テレポ" → "テレポ"
        function extractKeyword(desc: string): string {
          // Remove "Vデビット " prefix
          let cleaned = desc.replace(/^Vデビット\s+/i, "");
          // Remove trailing transaction IDs (alphanumeric 6+ chars at end)
          cleaned = cleaned.replace(/\s+[0-9A-Z]{6,}$/i, "").trim();
          // If still has spaces, take the main part (skip "振込 カ）" prefix)
          if (cleaned.startsWith("振込") && cleaned.includes("）")) {
            const afterParen = cleaned.split("）").slice(1).join("）").trim();
            if (afterParen) return afterParen;
          }
          return cleaned || desc;
        }

        const keyword = extractKeyword(rawDesc);
        if (keyword && keyword.length >= 2) {
          // Check if any existing rule already covers this keyword (partial match)
          const allRules = await prisma.expenseRule.findMany();
          const alreadyCovered = allRules.some(
            (r) => keyword.toUpperCase().includes(r.keyword.toUpperCase()) ||
                   r.keyword.toUpperCase().includes(keyword.toUpperCase()),
          );

          if (!alreadyCovered) {
            try {
              await prisma.expenseRule.create({
                data: { keyword, category: update.category },
              });
            } catch {
              // Ignore duplicate key errors
            }
          } else {
            // Update the most specific matching rule's category
            const exactMatch = allRules.find(
              (r) => r.keyword.toUpperCase() === keyword.toUpperCase(),
            );
            if (exactMatch && exactMatch.category !== update.category) {
              await prisma.expenseRule.update({
                where: { id: exactMatch.id },
                data: { category: update.category },
              });
            }
          }
        }
      }
    }

    return NextResponse.json({ updated: results.length });
  } catch (err) {
    logError("PUT /api/dashboard/expenses error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
