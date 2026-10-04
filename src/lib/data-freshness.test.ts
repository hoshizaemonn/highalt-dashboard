// node --experimental-strip-types src/lib/data-freshness.test.ts
// @ts-expect-error .ts 拡張子 import は strip-types 実行用
import { parseSaleDate, toJstDate, dayDiff, judgeByDate, judgeByMonth, summarize } from "./data-freshness.ts";
import assert from "node:assert/strict";

const base = { key: "sales", label: "売上明細", store: "春日", thresholdDays: 2, basis: "t" };

assert.equal(parseSaleDate("2026/09/30 19:31:16"), "2026-09-30");
assert.equal(parseSaleDate("2026/9/5"), "2026-09-05");
assert.equal(parseSaleDate("2026-10-01T00:00:00"), "2026-10-01");
assert.equal(parseSaleDate("abc"), null);
assert.equal(parseSaleDate(null), null);
// JST変換: UTC 10/3 16:00 は JST 10/4 01:00
assert.equal(toJstDate(new Date("2026-10-03T16:00:00Z")), "2026-10-04");
assert.equal(dayDiff("2026-10-04", "2026-09-30"), 4);
// 売上: 昨日まで=ok、2日前=stale、無し=missing
assert.equal(judgeByDate(base, "2026-10-03", "2026-10-04").status, "ok");
assert.equal(judgeByDate(base, "2026-10-02", "2026-10-04").status, "stale");
assert.equal(judgeByDate(base, "2026-09-28", "2026-10-04").ageDays, 6);
assert.equal(judgeByDate(base, null, "2026-10-04").status, "missing");
// 月ベース: 閾値3か月。10月に 2026-08 は 2か月前=ok、2026-07 は3か月前=stale
const mb = { key: "elec", label: "電気料", store: null, thresholdMonths: 3, basis: "t" };
assert.equal(judgeByMonth(mb, "2026-08", "2026-10-04").status, "ok");
assert.equal(judgeByMonth(mb, "2026-07", "2026-10-04").status, "stale");
assert.equal(judgeByMonth(mb, null, "2026-10-04").status, "missing");
// 年またぎ
assert.equal(judgeByMonth(mb, "2026-11", "2027-01-10").status, "ok");
assert.equal(judgeByMonth(mb, "2026-10", "2027-01-10").status, "stale");
const s = summarize([judgeByDate(base, "2026-10-03", "2026-10-04"), judgeByDate(base, "2026-09-28", "2026-10-04"), judgeByDate(base, null, "2026-10-04")]);
assert.deepEqual([s.ok, s.stale, s.missing, s.problems.length], [1, 1, 1, 2]);
console.log("DATA-FRESHNESS TESTS PASSED");
