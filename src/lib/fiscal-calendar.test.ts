// 実行: node --experimental-strip-types src/lib/fiscal-calendar.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { fiscalToCalendarYear, calendarToFiscalYear } from "./fiscal-calendar.ts";
import assert from "node:assert/strict";

// 年度2027（10期 2026/10〜2027/9）
for (const m of [10, 11, 12]) assert.equal(fiscalToCalendarYear(2027, m), 2026, `FY2027 ${m}月`);
for (let m = 1; m <= 9; m++) assert.equal(fiscalToCalendarYear(2027, m), 2027, `FY2027 ${m}月`);
// 過去年度 2026（9期 2025/10〜2026/9）の10月は 2025年10月
assert.equal(fiscalToCalendarYear(2026, 10), 2025);
assert.equal(fiscalToCalendarYear(2026, 9), 2026);
// 往復で元に戻る（全年度×全月）
for (let fy = 2019; fy <= 2030; fy++) {
  for (let m = 1; m <= 12; m++) {
    assert.equal(calendarToFiscalYear(fiscalToCalendarYear(fy, m), m), fy, `roundtrip ${fy}/${m}`);
  }
}
// 暦→年度（MonthlyView が使う式と一致）
assert.equal(calendarToFiscalYear(2026, 10), 2027);
assert.equal(calendarToFiscalYear(2026, 9), 2026);
console.log("FISCAL-CALENDAR TESTS PASSED");
