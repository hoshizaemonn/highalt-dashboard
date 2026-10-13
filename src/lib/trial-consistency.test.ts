// 実行: node --experimental-strip-types src/lib/trial-consistency.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { pickEffectiveTrial, storeCompareTrialForMonth, sumEffectiveTrialByStore, judgeTrialConsistency } from "./trial-join-rate.ts";
import assert from "node:assert/strict";

const sheet = (storeName: string, n: number) => Array.from({ length: n }, () => ({ storeName, year: 2026, month: 10 }));
const member = (storeName: string, trialDate: string) => ({ storeName, trialDate, firstTrialDate: null });

// 体験シート ＞ 手入力 ＞ 自動算出 の順。全体＝店舗ごとに判定して合算
{
  const sheetRows = [...sheet("巣鴨", 5), ...sheet("中目黒", 8)];
  const manualRows = [{ storeName: "中目黒", year: 2026, month: 10, trialCount: 3 }, { storeName: "春日", year: 2026, month: 10, trialCount: 4 }];
  const memberRows = [member("春日", "2026/10/02"), member("船橋", "2026-10-03"), member("船橋", "2026/09/30")];
  const sc = (s: string) => storeCompareTrialForMonth({ storeName: s, year: 2026, month: 10, sheetRows, manualRows, memberRows });
  assert.equal(sc("巣鴨"), 5);
  assert.equal(sc("中目黒"), 8); // シート優先（手入力3は使わない）
  assert.equal(sc("春日"), 4);   // 手入力優先（自動1は使わない）
  assert.equal(sc("船橋"), 1);   // 自動算出（9月分は数えない）
  const total = sumEffectiveTrialByStore(
    new Map([["巣鴨", 5], ["中目黒", 8]]),
    new Map([["中目黒", 3], ["春日", 4]]),
    new Map([["春日", 1], ["船橋", 1]]),
  );
  assert.equal(total, 5 + 8 + 4 + 1);
  assert.equal(pickEffectiveTrial({ sheet: 0, manual: 0, auto: 2 }), 2);
}
// 実データの形で一致（本部・非表示店舗は全体から外す）
{
  const r = judgeTrialConsistency({
    year: 2026, month: 10,
    sheetRows: [...sheet("巣鴨", 5), ...sheet("本部（除外）", 2)],
    manualRows: [{ storeName: "春日", year: 2026, month: 10, trialCount: 4 }],
    memberRows: [member("船橋", "2026/10/03"), member("閉店店舗", "2026/10/03")],
    excluded: ["本部（除外）", "閉店店舗"],
  });
  assert.equal(r.ok, true);
  assert.equal(r.overall, 10);
  assert.equal(r.sumMonthly, 10);
  assert.deepEqual(r.stores.map((s) => s.store), ["巣鴨", "春日", "船橋"]);
}
// 同じ店舗・月に手入力が2行ある → 月次は合算、店舗比較は1行目 → 不一致として検知する
{
  const r = judgeTrialConsistency({
    year: 2026, month: 10,
    sheetRows: [],
    manualRows: [{ storeName: "春日", year: 2026, month: 10, trialCount: 4 }, { storeName: "春日", year: 2026, month: 10, trialCount: 1 }],
    memberRows: [],
    excluded: [],
  });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /春日: 月次 5人 \/ 店舗比較 4人/);
  assert.ok(!r.problems.join("").match(/[@＠]/)); // 件数と店舗名のみ
}
console.log("trial-consistency rules: OK");
