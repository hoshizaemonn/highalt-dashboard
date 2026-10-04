/* eslint-disable @typescript-eslint/no-explicit-any -- 単体テスト（合成データ・簡易fake tx） */
// 実行: node --experimental-strip-types src/lib/amazon-orders.test.ts
// 合成データで常に検証する。手元に実物の注文履歴CSV（2026年3月分）があれば、追加で実物も検証する。
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { parseAmazonOrderRows, planAmazonImport, applyAmazonImport, isStorable } from "./amazon-orders.ts";
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { buildHeaderMap, safeInt, parseCSV, decodeFileBuffer } from "./csv-utils.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const H = { buildHeaderMap, safeInt };
const HEADER = ["注文日", "注文番号", "アカウントユーザー", "注文の合計（税込）", "支払い確定日", "配送先住所", "配送業者の問い合わせ番号", "商品カテゴリー", "ASIN", "商品名", "適格請求書（または支払い明細書）番号", "商品の数量", "商品の小計（消費税）", "商品の小計（税率）", "商品および配送料の合計（税込）"];
const row = (o: { date?: string; order: string; user?: string; total?: number; pay?: string; track?: string; asin: string; name: string; amount: number }) =>
  [o.date ?? "2026/03/10", o.order, o.user ?? "船橋スタジオ", String(o.total ?? o.amount), o.pay ?? "2026/03/10", "住所", o.track ?? "", "ABIS_HOME", o.asin, o.name, "T1", "1", "0", "10%", String(o.amount)];
const parse = (rows: string[][], master = new Map()) => parseAmazonOrderRows([HEADER, ...rows], master, H);
const keyOf = (r: any) => `${r.orderId}|${r.asin}|${r.trackingNo}|${r.lineSeq}`;

// 1. 同じ注文に同じ商品が7行（旧キーでは1行に潰れていたケース）→ 7行とも保存・キーが全部違う
{
  const rows = Array.from({ length: 7 }, (_, i) => row({ order: "503-0000001-1111111", asin: "B0TEST0001", name: "同じ商品", amount: 7378, track: `TRK${i}` }));
  const { records } = parse(rows);
  assert.equal(records.length, 7);
  assert.equal(new Set(records.map(keyOf)).size, 7);
  assert.equal(records.reduce((s: number, r: any) => s + r.amount, 0), 51646);
}
// 2. 問い合わせ番号が空（出荷前）の同一行も、連番で区別される
{
  const { records } = parse([row({ order: "A", asin: "X", name: "n", amount: 100 }), row({ order: "A", asin: "X", name: "n", amount: 100 }), row({ order: "A", asin: "X", name: "n", amount: 100 })]);
  assert.deepEqual(records.map((r: any) => r.lineSeq).sort(), [0, 1, 2]);
  assert.equal(new Set(records.map(keyOf)).size, 3);
}
// 3. CSVの行順が変わっても、同じキー集合になる（連番は内容で並べてから振る）
{
  const rows = [row({ order: "A", asin: "X", name: "n", amount: 300 }), row({ order: "A", asin: "X", name: "n", amount: 100 }), row({ order: "A", asin: "X", name: "n", amount: 200 })];
  const a = parse(rows).records.map(keyOf).sort();
  const b = parse([...rows].reverse()).records.map(keyOf).sort();
  assert.deepEqual(a, b);
  // 金額と連番の対応も同じ
  const m = (rs: any[]) => rs.map((r) => `${r.amount}:${r.lineSeq}`).sort();
  assert.deepEqual(m(parse(rows).records), m(parse([...rows].reverse()).records));
}
// 4. 店舗判定・科目分類・短縮名は従来どおり
{
  const master = new Map([["B0KNOWN", { expenseCategory: "消耗品費" }]]);
  const { records, autoClassified } = parse([row({ order: "A", asin: "B0KNOWN", name: "【新品】長い商品名".padEnd(50, "あ"), amount: 500, user: "春日スタジオ" }), row({ order: "B", asin: "B0NEW", name: "x", amount: 1, user: "不明ユーザー" })], master);
  assert.equal(records[0].storeName, "春日"); assert.equal(records[0].expenseCategory, "消耗品費"); assert.equal(autoClassified, 1);
  assert.equal(records[0].shortName.endsWith("…"), true);
  assert.equal(records[1].storeName, ""); assert.equal(records[1].expenseCategory, "");
}
// 5. 注文番号・商品名が無い行は一覧には返すが保存しない（従来どおり）
{
  const { records } = parse([row({ order: "", asin: "X", name: "n", amount: 5 }), row({ order: "A", asin: "X", name: "", amount: 5 }), row({ order: "A", asin: "X", name: "ok", amount: 5 })]);
  assert.equal(records.length, 3); assert.equal(records.filter(isStorable).length, 1);
  assert.equal(planAmazonImport(records, []).skippedNoOrderId, 2);
}
// 6. 取込計画: 旧キーで潰れていた注文は「changed」、行・金額の増分が出る。同じ内容は「same」、既存に無ければ「new」
{
  const rows = [...Array.from({ length: 7 }, (_, i) => row({ order: "ORD1", asin: "X", name: "同じ商品", amount: 7378, track: `T${i}` })), row({ order: "ORD2", asin: "Y", name: "別商品", amount: 1000 }), row({ order: "ORD3", asin: "Z", name: "新規", amount: 500 })];
  const { records } = parse(rows);
  const p = planAmazonImport(records, [{ orderId: "ORD1", lines: 1, total: 7378 }, { orderId: "ORD2", lines: 1, total: 1000 }]);
  assert.equal(p.lines, 9); assert.equal(p.orders, 3); assert.equal(p.total, 51646 + 1000 + 500);
  assert.deepEqual([p.changedOrders, p.sameOrders, p.newOrders], [1, 1, 1]);
  assert.deepEqual(p.delta, { lines: 9 - 2, total: 51646 + 1000 + 500 - 8378 });
  assert.deepEqual(p.shrunkOrders, []);
  // 既存より行が減る注文は警告対象（部分エクスポートの疑い）
  const p2 = planAmazonImport(parse([row({ order: "ORD9", asin: "X", name: "n", amount: 10 })]).records, [{ orderId: "ORD9", lines: 3, total: 30 }]);
  assert.deepEqual(p2.shrunkOrders, ["ORD9"]);
}
// 7. 差し替え: ファイルに含まれる注文番号だけを削除→投入。他の注文には触れない。空ファイルは何もしない
{
  const calls: any[] = [];
  const tx: any = { amazonOrder: { deleteMany: async (a: any) => (calls.push(["del", a]), { count: 2 }), createMany: async (a: any) => (calls.push(["create", a]), { count: a.data.length }) } };
  const { records } = parse([row({ order: "A", asin: "X", name: "n", amount: 1 }), row({ order: "A", asin: "X", name: "n", amount: 1 }), row({ order: "B", asin: "Y", name: "m", amount: 2 })]);
  const r = await applyAmazonImport(tx, records);
  assert.deepEqual(r, { deleted: 2, created: 3, orders: 2 });
  assert.deepEqual(calls[0][1].where.orderId.in.sort(), ["A", "B"]);          // 削除はファイル内の注文番号だけ
  assert.equal(calls.filter((c) => c[0] === "del").length, 1);                  // 全削除（where無し）は呼ばない
  assert.equal(calls[1][1].data.every((d: any) => ["A", "B"].includes(d.orderId)), true);
  const empty: any[] = []; const tx2: any = { amazonOrder: { deleteMany: async () => (empty.push(1), { count: 0 }), createMany: async () => (empty.push(2), { count: 0 }) } };
  assert.deepEqual(await applyAmazonImport(tx2, []), { deleted: 0, created: 0, orders: 0 });
  assert.deepEqual(empty, []);                                                  // 0件のときは削除も投入もしない
}
// 8. 同一ファイルを2回取り込んでも同じ結果（冪等）: 2回目の計画は全注文 same
{
  const { records } = parse([row({ order: "A", asin: "X", name: "n", amount: 5, track: "T1" }), row({ order: "A", asin: "X", name: "n", amount: 5, track: "T2" })]);
  const p = planAmazonImport(records, [{ orderId: "A", lines: 2, total: 10 }]);
  assert.deepEqual([p.sameOrders, p.changedOrders, p.newOrders], [1, 0, 0]);
}

// 9. 実物（2026年3月分・82明細・46注文）
const DIR = "/Users/hoshizaki/Documents/ハイアルチ/ハイアルチ　データ";
const real = existsSync(DIR) ? readdirSync(DIR).find((f) => f.startsWith("注文履歴_from_20260301_to_20260331")) : undefined;
if (real) {
  const buf = readFileSync(`${DIR}/${real}`);
  const rows = parseCSV(decodeFileBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  const { records } = parseAmazonOrderRows(rows, new Map(), H);
  const p = planAmazonImport(records, []);
  assert.equal(records.length, 82); assert.equal(p.lines, 82); assert.equal(p.orders, 46); assert.equal(p.total, 308364);
  assert.equal(new Set(records.map(keyOf)).size, 82);                                   // 82行すべてキーが異なる
  // 旧キー（注文番号+商品名）での件数は76＝6行が潰れていた
  assert.equal(new Set(records.map((r: any) => `${r.orderId}|${r.productName}`)).size, 76);
  // CSV行順を逆にしても同じキー集合
  const rev = parseAmazonOrderRows([rows[0], ...rows.slice(1).reverse()], new Map(), H).records;
  assert.deepEqual(rev.map(keyOf).sort(), records.map(keyOf).sort());
  console.log(`  実物OK: ${p.lines}明細 / ${p.orders}注文 / 合計${p.total}円（旧キーなら76明細・264,096円）`);
} else {
  console.log("  （実物のサンプルCSVが無いため、実物テストはスキップ）");
}
console.log("AMAZON-ORDERS TESTS PASSED");
