// Amazon 注文履歴から、PayPay銀行明細の「AMAZON」行の内訳（商品名）を補完する。
//
// 経費明細は画面（/api/dashboard/expenses）とCSV出力（/api/download/expense-csv）の
// 2経路で表示されるが、内訳はDBに保存せず取得時に突合して埋めている。
// 両方で同じ結果になるよう、突合ロジックはここに集約する。
// （松尾さん依頼: 画面に出ている内訳がCSVに出ない・2026-07）

import { prisma } from "@/lib/prisma";

/** 内訳補完の対象となる経費行（必要な項目のみ） */
export interface AmazonMatchableRow {
  year: number;
  month: number;
  day: number;
  description: string | null;
  amount: number;
  breakdown: string | null;
}

/** 全角英数を半角化（明細の「ＡＭＡＺＯＮ」を拾うため） */
function normalizeToHalf(s: string): string {
  return s.replace(/[！-～]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * 指定した年月群のAmazon注文を取得して、AMAZON明細行の内訳を補完する。
 * 既に内訳が入っている行、AMAZON以外の行はそのまま返す。
 */
export async function fillAmazonBreakdown<T extends AmazonMatchableRow>(
  rows: T[],
  months: Array<{ year: number; month: number }>,
): Promise<T[]> {
  // 対象行が無ければ問い合わせもしない
  const hasAmazonRow = rows.some(
    (r) =>
      (!r.breakdown || !r.breakdown.trim()) &&
      normalizeToHalf(r.description || "")
        .toUpperCase()
        .includes("AMAZON"),
  );
  if (!hasAmazonRow) return rows;

  // 対象月の注文＋支払日が未確定の注文を取得
  const monthPrefixes = months.map(
    (m) => `${m.year}/${String(m.month).padStart(2, "0")}`,
  );
  const amazonRows = await prisma.amazonOrder.findMany({
    where: {
      OR: [
        ...monthPrefixes.map((p) => ({ paymentDate: { startsWith: p } })),
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
  if (amazonRows.length === 0) return rows;

  // 同一発送（支払日＋注文合計）でまとめ、合計額でも突合できるようにする
  const paymentGroups = new Map<string, typeof amazonRows>();
  for (const a of amazonRows) {
    if (!a.paymentDate || a.paymentDate === "該当無し") continue;
    const key = `${a.paymentDate}_${a.orderTotal}`;
    const group = paymentGroups.get(key) || [];
    group.push(a);
    paymentGroups.set(key, group);
  }
  const shipmentPayments = new Map<number, typeof amazonRows>();
  for (const [, group] of paymentGroups) {
    const totalPayment = group.reduce((s, a) => s + a.amount, 0);
    if (!shipmentPayments.has(totalPayment)) {
      shipmentPayments.set(totalPayment, group);
    }
  }

  return rows.map((row) => {
    if (row.breakdown && row.breakdown.trim()) return row;

    const desc = normalizeToHalf(row.description || "").toUpperCase();
    if (!desc.includes("AMAZON")) return row;

    const amt = Math.round(row.amount);
    const dayStr = `${row.year}/${String(row.month).padStart(2, "0")}/${String(
      row.day,
    ).padStart(2, "0")}`;

    // 1. 支払日 + 注文合計 の完全一致
    let matched = amazonRows.filter(
      (a) => a.paymentDate === dayStr && a.orderTotal === amt,
    );
    // 2. 注文合計のみ
    if (matched.length === 0) {
      matched = amazonRows.filter((a) => a.orderTotal === amt);
    }
    // 3. 商品単価
    if (matched.length === 0) {
      matched = amazonRows.filter((a) => a.amount === amt);
    }
    // 4. 発送単位の合計額（複数商品を1回で支払）
    if (matched.length === 0) {
      const shipmentMatch = shipmentPayments.get(amt);
      if (shipmentMatch) matched = shipmentMatch;
    }

    if (matched.length > 0) {
      const names = [
        ...new Set(matched.map((m) => m.shortName || m.productName).filter(Boolean)),
      ];
      if (names.length > 0) {
        return { ...row, breakdown: names.join(" / ") };
      }
    }
    return row;
  });
}
