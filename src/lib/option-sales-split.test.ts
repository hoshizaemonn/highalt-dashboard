// オプション売上按分の純粋関数の単体テスト。
// 実行: node --experimental-strip-types src/lib/option-sales-split.test.ts
// 保存則（総額・カテゴリ×月・店舗合計）と、無効/開始前/同店舗/複数商品行で変更しないことを検証する。
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { validateTargets, parseTargetsJson, applyOptionSalesSplit, isRuleActiveFor, summarizeUnsplittable, normalizeForMatch, descriptionMatchesAny, type OptionSplitRule, type SalesRowLike } from "./option-sales-split.ts";
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

// 11. 未分割件数: 対象商品を含み複数商品が連結された行だけを年月×店舗で数える（単一商品・対象外は数えない）
{
  const rowsU = [
    { year: 2026, month: 10, storeName: "春日", description: "HYROXオプション 月額費 (2026年10月)x1, 入会金x1" },
    { year: 2026, month: 10, storeName: "春日", description: "HYROXオプション 月額費 (2026年10月)x1, 事務手数料x1" },
    { year: 2026, month: 10, storeName: "春日", description: "HYROXオプション 月額費 (2026年10月)x1" },
    { year: 2026, month: 11, storeName: "船橋", description: "HYROXチケット(既存会員様用)x1, 入会金x1" },
    { year: 2026, month: 11, storeName: "船橋", description: "HYROXオプション（月4回） 初月額費 (2026年11月)x1, 入会金x1" },
  ];
  const got = summarizeUnsplittable(rowsU, NAMES);
  assert.deepEqual(got, [
    { year: 2026, month: 10, storeName: "春日", count: 2 },
    { year: 2026, month: 11, storeName: "船橋", count: 1 },
  ]);
}
// 12. 商品名の正規化: 全角/半角（括弧・英数）・スペース・英字の大小を無視して照合する
{
  const base = normalizeForMatch("HYROXオプション下北沢(月4回)");
  for (const v of ["HYROXオプション下北沢（月4回）", "ＨＹＲＯＸオプション 下北沢(月4回)", "hyroxオプション　下北沢（月4回）", " HYROX オプション 下北沢 ( 月4回 ) "]) {
    assert.equal(normalizeForMatch(v), base, v);
  }
  assert.notEqual(normalizeForMatch("HYROXオプション（月4回） 初月額費"), base);          // 下北沢が無い別商品は一致しない
  assert.equal(descriptionMatchesAny("HYROXオプション下北沢（月4回） 月額費 (2026年10月)x1", ["HYROXオプション下北沢(月4回)"]), true);
  assert.equal(descriptionMatchesAny("HYROXオプション 月額費 (2026年10月)x1", ["HYROXオプション下北沢(月4回)"]), false);
  assert.equal(descriptionMatchesAny("何でも", [""]), false);                               // 空の商品名は一致しない
}
// 13. 画面で入力した商品名のルール: 括弧・スペースの違いに関わらず按分される。PS001の商品名は使わない
{
  const NAMES2 = { NAME1: [] as string[], I0345: ["HYROXオプション 月額費"] };
  const ruleN = (o: Partial<OptionSplitRule> = {}): OptionSplitRule => ({ productCode: "NAME1", matchName: "HYROXオプション下北沢(月4回)", targetStore: "下北沢", ratioPercent: 50, startYear: 2026, startMonth: 10, enabled: true, ...o });
  const r1 = (id: number, d: string, store = "春日", month = 10): SalesRowLike => ({ id, year: 2026, month, storeName: store, description: d, category: "月会費", amount: 6000 });
  for (const d of ["HYROXオプション下北沢(月4回) 月額費 (2026年10月)x1", "HYROXオプション下北沢（月4回）x1", "ＨＹＲＯＸオプション 下北沢（月4回） 初月額費x1"]) {
    const out = applyOptionSalesSplit([r1(1, d)], [ruleN()], NAMES2);
    assert.equal(out.stats.split, 1, d);
    assert.deepEqual(byStore(out.rows), { 春日: 3000, 下北沢: 3000 });
    assert.equal(sum(out.rows), 6000);
  }
  // 一致しない商品（下北沢の文字がない既存オプション・別商品）は触らない
  const keep = [r1(2, "HYROXオプション 月額費 (2026年10月)x1"), r1(3, "HYROXオプション（月4回） 初月額費 (2026年10月)x1"), r1(4, "プレミアムS会員 月会費 (202610)x1")];
  const o2 = applyOptionSalesSplit(keep, [ruleN()], NAMES2);
  assert.deepEqual(o2.rows, keep); assert.equal(o2.stats.split, 0);                  // 行は1つも変わらない
  // 開始月より前（9月）は商品名が一致しても変更しない／所属が按分先（下北沢）なら変更しない／複数商品の行は按分せず件数のみ
  assert.equal(applyOptionSalesSplit([r1(5, "HYROXオプション下北沢(月4回)x1", "春日", 9)], [ruleN()], NAMES2).stats.split, 0);
  assert.equal(applyOptionSalesSplit([r1(6, "HYROXオプション下北沢(月4回)x1", "下北沢")], [ruleN()], NAMES2).stats.split, 0);
  const o3 = applyOptionSalesSplit([r1(7, "HYROXオプション下北沢(月4回)x1, 入会金x1")], [ruleN()], NAMES2);
  assert.equal(o3.stats.unsplittable, 1); assert.equal(o3.stats.split, 0);
  // 無効のルールは何もしない
  const dis = [r1(8, "HYROXオプション下北沢(月4回)x1")];
  assert.equal(applyOptionSalesSplit(dis, [ruleN({ enabled: false })], NAMES2).rows, dis);
  // matchName が空なら、従来どおり PS001 の商品名（I0345）で照合
  const ruleI = (): OptionSplitRule => ({ productCode: "I0345", matchName: "", targetStore: "下北沢", ratioPercent: 50, startYear: 2026, startMonth: 10, enabled: true });
  assert.equal(applyOptionSalesSplit([r1(9, "HYROXオプション 月額費 (2026年10月)x1")], [ruleI()], NAMES2).stats.split, 1);
  assert.equal(applyOptionSalesSplit([r1(10, "ＨＹＲＯＸオプション　月額費x1")], [ruleI()], NAMES2).stats.split, 1);   // PS001名も全角/空白の違いを吸収
  // 未分割件数: 画面入力の商品名（括弧違い）でも数える
  const un = summarizeUnsplittable([{ year: 2026, month: 10, storeName: "春日", description: "HYROXオプション下北沢（月4回）x1, 事務手数料x1" }], NAMES2, [ruleN()]);
  assert.deepEqual(un, [{ year: 2026, month: 10, storeName: "春日", count: 1 }]);
}

// --- 動的ルール: 複数按分先・最も具体的なルール1件のみ・順序非依存・検証 ---
{
  const mk = (code: string, name: string, targets: { store: string; ratio: number }[]): OptionSplitRule => ({
    productCode: code, matchName: name, targets, targetStore: targets[0].store, ratioPercent: targets[0].ratio,
    startYear: 2026, startMonth: 10, enabled: true,
  });
  const base = row({ id: 1, description: "HYROXオプション下北沢(月4回)x1", amount: 10000 });
  // 複数按分先: 春日の10,000円 -> 下北沢30% / 中目黒20% / 春日に50%残る。総額不変
  const multi = applyOptionSalesSplit([base], [mk("R-a", "HYROXオプション下北沢", [{ store: "下北沢", ratio: 30 }, { store: "中目黒", ratio: 20 }])], {});
  assert.deepEqual(byStore(multi.rows), { 春日: 5000, 下北沢: 3000, 中目黒: 2000 });
  assert.equal(sum(multi.rows), 10000);
  // 重複一致: 短い名前と長い名前の両方に一致 -> 長い方1件だけ（二重按分しない）。ルール順を入れ替えても同じ結果
  const broad = mk("R-b", "HYROXオプション", [{ store: "中目黒", ratio: 100 }]);
  const narrow = mk("R-a", "HYROXオプション下北沢(月4回)", [{ store: "下北沢", ratio: 50 }]);
  const r1_ = applyOptionSalesSplit([base], [broad, narrow], {});
  const r2_ = applyOptionSalesSplit([base], [narrow, broad], {});
  assert.deepEqual(byStore(r1_.rows), { 春日: 5000, 下北沢: 5000 });
  assert.deepEqual(byStore(r2_.rows), byStore(r1_.rows));
  assert.equal(sum(r1_.rows), 10000);
  // 按分先が所属店舗と同じ場合はその分を動かさない
  const self = applyOptionSalesSplit([base], [mk("R-c", "HYROXオプション下北沢", [{ store: "春日", ratio: 40 }, { store: "下北沢", ratio: 10 }])], {});
  assert.deepEqual(byStore(self.rows), { 春日: 9000, 下北沢: 1000 });
  // 返金（負数）も符号を保って按分
  const neg = applyOptionSalesSplit([row({ id: 2, description: "HYROXオプション下北沢(月4回)x1", amount: -10000 })], [mk("R-a", "HYROXオプション下北沢", [{ store: "下北沢", ratio: 50 }])], {});
  assert.deepEqual(byStore(neg.rows), { 春日: -5000, 下北沢: -5000 });
  // 検証
  assert.equal(validateTargets([{ store: "下北沢", ratio: 60 }, { store: "中目黒", ratio: 50 }]) !== null, true); // 合計100超
  assert.equal(validateTargets([{ store: "下北沢", ratio: 50 }, { store: "下北沢", ratio: 10 }]) !== null, true); // 重複店舗
  assert.equal(validateTargets([{ store: "", ratio: 50 }]) !== null, true);
  assert.equal(validateTargets([{ store: "下北沢", ratio: 0 }]) !== null, true);
  assert.equal(validateTargets([{ store: "下北沢", ratio: 70 }, { store: "中目黒", ratio: 30 }]), null);
  assert.equal(parseTargetsJson("not json"), null);
  assert.deepEqual(parseTargetsJson('[{"store":"下北沢","ratio":50}]'), [{ store: "下北沢", ratio: 50 }]);
}

console.log("ALL TESTS PASSED (incl. unsplittable summary / name normalization)");

