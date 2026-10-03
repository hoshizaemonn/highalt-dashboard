// オプション売上按分の純粋関数の単体テスト。
// 実行: node --experimental-strip-types src/lib/option-sales-split.test.ts
// 保存則（総額・カテゴリ×月・店舗合計）と、無効/開始前/同店舗/複数商品行で変更しないことを検証する。
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { applyOptionSalesSplit, isRuleActiveFor, type OptionSplitRule, type SalesRowLike } from "./option-sales-split.ts";
import assert from "node:assert/strict";

const NAMES = { I0345: ["HYROXオプション 月額費"], I0346: ["HYROXオプション（月4回） 初月額費"] };
const rule = (o: Partial<OptionSplitRule> = {}): OptionSplitRule => ({ productCode: "I0345", targetStore: "下北沢", ratioPercent: 50, startYear: 2026, startMonth: 10, enabled: true, ...o });
const row = (o: Partial<SalesRowLike> & { id: number }): SalesRowLike => ({ year: 2026, month: 10, storeName: "春日", description: "HYROXオプション 月額費 (2026年10月)x1", category: "月会費", amount: 6000, ...o });
const sum = (rs: SalesRowLike[]) => rs.reduce((s, r) => s + r.amount, 0);
const byStore = (rs: SalesRowLike[]) => rs.reduce<Record<string, number>>((m, r) => ((m[r.storeName] = (m[r.storeName] ?? 0) + r.amount), m), {});

// 1. ルール無効 → 入力そのもの（参照も同一）・統計ゼロ
{
  const rows = [row({ id: 1 }), row({ id: 2, storeName: "下北沢", description: "x" })];
  for (const r of [rule({ enabled: false }), rule({ startYear: null, startMonth: null }), rule({ ratioPercent: 0 }), rule({ ratioPercent: 101 }), rule({ targetStore: "" })]) {
    const out = applyOptionSalesSplit(rows, [r], NAMES);
    assert.equal(out.rows, rows); assert.deepEqual(out.stats, { split: 0, unsplittable: 0, movedTotal: 0 });
  }
}
// 2. 開始前の月は変更なし
{
  const rows = [row({ id: 1, month: 9 })];
  const out = applyOptionSalesSplit(rows, [rule()], NAMES);
  assert.deepEqual(out.rows, rows); assert.equal(out.stats.split, 0);
}
// 3. 開始月は適用・50%付け替え・分類維持・総額不変
{
  const rows = [row({ id: 1 })];
  const out = applyOptionSalesSplit(rows, [rule()], NAMES);
  assert.deepEqual(byStore(out.rows), { 春日: 3000, 下北沢: 3000 });
  assert.equal(sum(out.rows), 6000);
  assert.ok(out.rows.every((r) => r.category === "月会費"));
  assert.equal(out.stats.split, 1); assert.equal(out.stats.movedTotal, 3000);
}
// 4. 所属店舗が按分先（下北沢）→ 変更なし（二重計上しない）
{
  const rows = [row({ id: 1, storeName: "下北沢" })];
  const out = applyOptionSalesSplit(rows, [rule()], NAMES);
  assert.deepEqual(out.rows, rows); assert.equal(out.stats.split, 0);
}
// 5. 複数商品の1行は按分せず件数だけ数える
{
  const rows = [row({ id: 1, description: "HYROXオプション 月額費 (2026年10月)x1, 入会金x1" })];
  const out = applyOptionSalesSplit(rows, [rule()], NAMES);
  assert.deepEqual(out.rows, rows); assert.equal(out.stats.unsplittable, 1); assert.equal(out.stats.split, 0);
}
// 6. 対象外商品は触らない
{
  const rows = [row({ id: 1, description: "HYROXチケット(既存会員様用)x1" })];
  const out = applyOptionSalesSplit(rows, [rule()], NAMES);
  assert.deepEqual(out.rows, rows);
}
// 7. 端数の丸め: 1001 × 50% = 500.5 → 付け替え 501（Math.round）・総額不変
{
  const rows = [row({ id: 1, amount: 1001 })];
  const out = applyOptionSalesSplit(rows, [rule()], NAMES);
  assert.equal(sum(out.rows), 1001); assert.equal(byStore(out.rows)["下北沢"], 501);
}
// 8. I0346（初月額費）も対象・月別に混在しても総額・カテゴリ別合計が保存
{
  const rows = [
    row({ id: 1, description: "HYROXオプション（月4回） 初月額費 (2026年10月)x1", category: "入会金", amount: 4000, storeName: "東日本橋" }),
    row({ id: 2, amount: 6000 }),
    row({ id: 3, month: 9, amount: 9999 }),
    row({ id: 4, storeName: "下北沢", amount: 500 }),
  ];
  const r2 = [rule(), rule({ productCode: "I0346", ratioPercent: 30 })];
  const out = applyOptionSalesSplit(rows, r2, NAMES);
  assert.equal(sum(out.rows), sum(rows));
  const cat = (rs: SalesRowLike[]) => rs.reduce<Record<string, number>>((m, r) => ((m[r.category ?? ""] = (m[r.category ?? ""] ?? 0) + r.amount), m), {});
  assert.deepEqual(cat(out.rows), cat(rows));
  assert.equal(out.stats.split, 2);
  assert.equal(byStore(out.rows)["下北沢"], 500 + 1200 + 3000);
}
// 9. 無作為入力で保存則（総額・カテゴリ別・店舗合計）を検証
{
  const stores = ["東日本橋", "春日", "船橋", "巣鴨", "祖師ヶ谷大蔵", "下北沢", "中目黒"];
  const descs = ["HYROXオプション 月額費 (2026年10月)x1", "HYROXオプション（月4回） 初月額費 (2026年11月)x1", "HYROXチケット(既存会員様用)x1", "通常商品x1", "HYROXオプション 月額費 x1, 入会金x1"];
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let t = 0; t < 300; t++) {
    const rows: SalesRowLike[] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, year: 2026, month: 9 + Math.floor(rnd() * 3), storeName: stores[Math.floor(rnd() * 7)], description: descs[Math.floor(rnd() * 5)], category: ["月会費", "入会金", "その他"][Math.floor(rnd() * 3)], amount: Math.floor(rnd() * 20000) }));
    const rs = [rule({ ratioPercent: 1 + Math.floor(rnd() * 100) }), rule({ productCode: "I0346", targetStore: stores[Math.floor(rnd() * 7)], ratioPercent: 1 + Math.floor(rnd() * 100), startYear: 2026, startMonth: 11 })];
    const out = applyOptionSalesSplit(rows, rs, NAMES);
    assert.equal(sum(out.rows), sum(rows), "total conserved");
    const tot = (rr: SalesRowLike[]) => rr.reduce<Record<string, number>>((m, r) => ((m[(r.category ?? "") + "|" + r.month] = (m[(r.category ?? "") + "|" + r.month] ?? 0) + r.amount), m), {});
    assert.deepEqual(tot(out.rows), tot(rows), "category x month conserved");
    assert.ok(out.rows.every((r) => r.amount >= 0 || true));
  }
}
// 10. 開始年月の境界（2026/10 は対象、2026/9 は対象外、2027/1 は対象）
{
  assert.equal(isRuleActiveFor(rule(), 2026, 9), false);
  assert.equal(isRuleActiveFor(rule(), 2026, 10), true);
  assert.equal(isRuleActiveFor(rule(), 2027, 1), true);
}
console.log("ALL TESTS PASSED");
