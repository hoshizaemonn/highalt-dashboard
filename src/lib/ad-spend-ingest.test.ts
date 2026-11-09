// 実行: node --experimental-strip-types src/lib/ad-spend-ingest.test.ts
import {
  adSpendBlockReasons,
  buildAdSpendRows,
  currentYmJst,
  AD_SPEND_NOTE_PREFIX,
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
} from "./ad-spend-ingest.ts";
import assert from "node:assert/strict";

const STORES = ["東日本橋", "春日", "船橋", "巣鴨", "祖師ヶ谷大蔵", "下北沢", "中目黒"];
const NOW = new Date("2026-11-09T03:00:00Z"); // JST 11/9
const ok = [
  { store: "船橋", google: 112506, meta: 95754 },
  { store: "", google: 64878, meta: 4229 },
];

// 日本時間の今月（UTCの月末夜でも日本は翌月）
assert.deepEqual(currentYmJst(new Date("2026-10-31T16:00:00Z")), { year: 2026, month: 11 });

// 正常: 10月分（先月）
assert.deepEqual(adSpendBlockReasons(2026, 10, ok, STORES, NOW), []);
// 9期以前は入れない
assert.ok(adSpendBlockReasons(2026, 9, ok, STORES, NOW).some((s: string) => s.includes("9期以前")));
// 当月・未来は入れない
assert.ok(adSpendBlockReasons(2026, 11, ok, STORES, NOW).some((s: string) => s.includes("当月")));
assert.ok(adSpendBlockReasons(2026, 12, ok, STORES, NOW).some((s: string) => s.includes("当月")));
// 年月不正
assert.ok(adSpendBlockReasons(2026, 13, ok, STORES, NOW).length > 0);
// 空・店舗不明・重複・範囲外
assert.ok(adSpendBlockReasons(2026, 10, [], STORES, NOW).length > 0);
assert.ok(adSpendBlockReasons(2026, 10, [{ store: "渋谷", google: 1, meta: 1 }], STORES, NOW).some((s: string) => s.includes("不明")));
assert.ok(adSpendBlockReasons(2026, 10, [ok[0], ok[0]], STORES, NOW).some((s: string) => s.includes("重複")));
assert.ok(adSpendBlockReasons(2026, 10, [{ store: "船橋", google: -1, meta: 0 }], STORES, NOW).length > 0);
assert.ok(adSpendBlockReasons(2026, 10, [{ store: "船橋", google: 99999999, meta: 0 }], STORES, NOW).length > 0);
assert.ok(adSpendBlockReasons(2026, 10, [{ store: "船橋", google: NaN, meta: 0 }], STORES, NOW).length > 0);

// 行の作り方: 媒体ごと・0円は作らない・円未満は四捨五入・共通は店舗名が空
const rows = buildAdSpendRows(2026, 10, [
  { store: "船橋", google: 112506.4, meta: 0 },
  { store: "", google: 64878, meta: 4229.5 },
]);
assert.equal(rows.length, 3);
assert.equal(rows[0].storeName, "船橋");
assert.equal(rows[0].totalAmount, 112506);
assert.equal(rows[0].category, "広告宣伝費");
assert.ok(rows.every((r: { note: string }) => r.note.startsWith(AD_SPEND_NOTE_PREFIX)));
assert.equal(rows[1].storeName, "");
assert.equal(rows[2].totalAmount, 4230);
console.log("AD-SPEND INGEST TESTS PASSED");
