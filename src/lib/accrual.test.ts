// 実行: node --experimental-strip-types src/lib/accrual.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { parseAccrualMonth, accrualFetchYears } from "./accrual.ts";
import assert from "node:assert/strict";

const ym = (t: string, y: number, m: number) => {
  const r = parseAccrualMonth(t, y, m);
  return r ? `${r.accrualYear}/${r.accrualMonth}` : null;
};

// 後払い（従来どおり）
assert.equal(ym("4月分", 2026, 5), "2026/4");
assert.equal(ym("12月分", 2026, 1), "2025/12");
// 前払い（不具合の再現ケース: 6/30決済の「7月チラシ分」が前年7月に飛んでいた）
assert.equal(ym("7月チラシ分", 2026, 6), "2026/7");
assert.equal(ym("6月はがき", 2026, 5), "2026/6");
assert.equal(ym("10月チラシ", 2026, 9), "2026/10");
assert.equal(ym("1月分", 2026, 12), "2027/1");
// 同月はシフトしない
assert.equal(ym("7月電気料金", 2026, 7), null);
assert.equal(ym("8月会費未払い分（9月計上）", 2026, 9), null);
// ちょうど6ヶ月差は過去側
assert.equal(ym("1月分", 2026, 7), "2026/1");
assert.equal(ym("7月分", 2026, 1), "2025/7");
// 5ヶ月先までは未来側
assert.equal(ym("12月分", 2026, 7), "2026/12");
// 月表記なし
assert.equal(ym("販促物", 2026, 9), null);
// 帰属が決済から±6ヶ月以内に収まること（全組合せ）
for (let pm = 1; pm <= 12; pm++) {
  for (let n = 1; n <= 12; n++) {
    const r = parseAccrualMonth(`${n}月分`, 2026, pm);
    if (!r) { assert.equal(n, pm); continue; }
    const d = r.accrualYear * 12 + r.accrualMonth - (2026 * 12 + pm);
    assert.ok(d >= -6 && d <= 5 && d !== 0, `${pm}月決済の${n}月分 → ${d}`);
    assert.ok(accrualFetchYears([r.accrualYear]).includes(2026));
  }
}
assert.deepEqual(accrualFetchYears([2026]).sort(), [2025, 2026, 2027]);
console.log("accrual.test.ts: ok");
