// オプション売上按分を売上明細の集計に適用するローダー。
// 按分ルールが1つも有効でない場合は base の結果をそのまま返す（従来の集計と完全一致）。
// 按分ルール・商品名は数分キャッシュする（毎回のDB往復を減らす）。保存時は memoCacheDeletePrefix("optionSplit:") で即時失効。

import { prisma } from "@/lib/prisma";
import { memoCache } from "@/lib/memo-cache";
import {
  applyOptionSalesSplit,
  summarizeUnsplittable,
  type OptionSplitRule,
  type SalesRowLike,
  type SplitStats,
  type UnsplittableCount,
} from "@/lib/option-sales-split";

export const OPTION_SPLIT_CODES = ["I0345", "I0346"] as const;
export const OPTION_SPLIT_CACHE_PREFIX = "optionSplit:";
const CONTEXT_TTL_MS = 5 * 60 * 1000;

export type NamesByCode = Record<string, string[]>;

/** 対象2商品の商品名（PS001由来）。摘要との照合に使う。 */
export async function loadOptionProductNames(): Promise<NamesByCode> {
  const products = await prisma.productSales.findMany({
    where: { productCode: { in: [...OPTION_SPLIT_CODES] } },
    select: { productCode: true, productName: true },
    distinct: ["productCode", "productName"],
  });
  const out: NamesByCode = {};
  for (const p of products) (out[p.productCode] ??= []).push(p.productName);
  return out;
}

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

/** ルールと商品名をまとめて数分キャッシュ */
async function loadContext(): Promise<{ rules: OptionSplitRule[]; namesByCode: NamesByCode }> {
  return memoCache(`${OPTION_SPLIT_CACHE_PREFIX}ctx`, CONTEXT_TTL_MS, async () => ({
    rules: await loadOptionSplitRules(),
    namesByCode: await loadOptionProductNames(),
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
  let ctx: { rules: OptionSplitRule[]; namesByCode: NamesByCode };
  try {
    ctx = await loadContext();
  } catch (e) {
    console.error("option-sales-split: rules load failed, split skipped", e instanceof Error ? e.message : e);
    return { rows: baseRows, stats: null };
  }
  if (!ctx.rules.some((r) => r.enabled)) {
    return { rows: baseRows, stats: null };
  }
  const names = Object.values(ctx.namesByCode).flat();
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

  const { rows, stats } = applyOptionSalesSplit(merged, ctx.rules, ctx.namesByCode);
  const filtered = rows.filter(
    (r) =>
      opts.years.includes(r.year) &&
      (opts.month === undefined || r.month === opts.month) &&
      opts.keep(r),
  );
  return { rows: filtered, stats };
}

/**
 * 未分割（1行に複数商品）の売上明細件数を年月×店舗で返す（按分設定画面の表示用）。
 * 読み取りのみ。ルールの有効・無効に関係なく、対象商品を含む未分割行を数える。
 */
export async function loadUnsplittableCounts(): Promise<UnsplittableCount[]> {
  const namesByCode = await loadOptionProductNames();
  const names = Object.values(namesByCode).flat();
  if (names.length === 0) return [];
  const rows = await prisma.salesDetail.findMany({
    where: { OR: names.map((n) => ({ description: { contains: n } })) },
    select: { year: true, month: true, storeName: true, description: true },
  });
  return summarizeUnsplittable(rows, namesByCode);
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
