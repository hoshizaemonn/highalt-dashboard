// オプション売上按分を売上明細の集計に適用するローダー。
// 按分ルールが1つも有効でない場合は base の結果をそのまま返す（従来の集計と完全一致）。

import { prisma } from "@/lib/prisma";
import {
  applyOptionSalesSplit,
  type OptionSplitRule,
  type SalesRowLike,
  type SplitStats,
} from "@/lib/option-sales-split";

export const OPTION_SPLIT_CODES = ["I0345", "I0346"] as const;

/** 按分ルール一覧（対象2商品のみ） */
export async function loadOptionSplitRules(): Promise<OptionSplitRule[]> {
  const rows = await prisma.optionSalesSplitRule.findMany({
    where: { productCode: { in: [...OPTION_SPLIT_CODES] } },
  });
  return rows.map((r) => ({
    productCode: r.productCode,
    targetStore: r.targetStore,
    ratioPercent: r.ratioPercent,
    startYear: r.startYear,
    startMonth: r.startMonth,
    enabled: r.enabled,
  }));
}

/**
 * 売上明細（sales_detail）を按分込みで取得する。
 * @param years 対象年（按分先店舗の行を取り込むため、全店舗の対象商品行を追加で読む）
 * @param month 対象月（未指定なら年全体）
 * @param base 従来どおりの売上明細クエリ（呼び出し元の where をそのまま渡す）
 * @param keep base と同じ店舗・年月の絞り込み条件（按分後の行に同じ条件を適用する）
 */
export async function loadSalesDetailWithSplit<T extends SalesRowLike>(opts: {
  years: number[];
  month?: number;
  base: Promise<T[]>;
  keep: (row: T) => boolean;
}): Promise<{ rows: T[]; stats: SplitStats | null }> {
  const baseRows = await opts.base;
  // ルール取得に失敗しても（例: マイグレーション未適用）売上集計を止めない。失敗時は按分なしの従来結果。
  let rules: OptionSplitRule[] = [];
  try {
    rules = await loadOptionSplitRules();
  } catch (e) {
    console.error("option-sales-split: rules load failed, split skipped", e instanceof Error ? e.message : e);
    return { rows: baseRows, stats: null };
  }
  if (!rules.some((r) => r.enabled)) {
    return { rows: baseRows, stats: null };
  }

  const products = await prisma.productSales.findMany({
    where: { productCode: { in: [...OPTION_SPLIT_CODES] } },
    select: { productCode: true, productName: true },
    distinct: ["productCode", "productName"],
  });
  const namesByCode: Record<string, string[]> = {};
  for (const p of products) {
    (namesByCode[p.productCode] ??= []).push(p.productName);
  }
  const names = Object.values(namesByCode).flat();
  if (names.length === 0) {
    return { rows: baseRows, stats: null };
  }

  // 按分先店舗の行（別店舗の所属行）を取り込むため、対象商品の摘要を全店舗から読む
  const extra = (await prisma.salesDetail.findMany({
    where: {
      year: { in: opts.years },
      OR: names.map((n) => ({ description: { contains: n } })),
    },
  })) as unknown as T[];

  const seen = new Set<number>();
  const merged: T[] = [];
  for (const r of [...baseRows, ...extra]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }

  const { rows, stats } = applyOptionSalesSplit(merged, rules, namesByCode);
  const filtered = rows.filter(
    (r) =>
      opts.years.includes(r.year) &&
      (opts.month === undefined || r.month === opts.month) &&
      opts.keep(r),
  );
  return { rows: filtered, stats };
}

/** Prisma の storeName 条件（文字列 / notIn / in）と同じ意味の JS 述語 */
export function storeFilterPredicate(
  f: string | { notIn?: string[] } | { in?: string[] },
): (storeName: string) => boolean {
  if (typeof f === "string") return (s) => s === f;
  if ("notIn" in f && f.notIn) {
    const ex = new Set(f.notIn);
    return (s) => !ex.has(s);
  }
  if ("in" in f && f.in) {
    const inc = new Set(f.in);
    return (s) => inc.has(s);
  }
  return () => true;
}
