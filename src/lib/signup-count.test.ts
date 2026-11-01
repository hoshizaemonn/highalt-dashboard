// 実行: node --experimental-strip-types src/lib/signup-count.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { sheetJoinedByMonth, signupsForMonthWithSheet } from "./signup-count.ts";
import assert from "node:assert/strict";

const m = (storeName: string, joinDate: string) => ({ storeName, joinDate });
const sh = (storeName: string, resultType: string, year = 2026, month = 10) => ({ storeName, year, month, resultType });

// 体験シートの入会 = 即日+後日。検討中・入会しないは入れない
{
  const j = sheetJoinedByMonth([sh("下北沢", "即日入会"), sh("下北沢", "後日入会"), sh("下北沢", "入会しない"), sh("下北沢", "検討中")]);
  assert.equal(j.get("2026-10")?.get("下北沢"), 2);
}
// 体験シートがある店舗はシートの値。会員一覧の入会日時は使わない
{
  const rows = [m("下北沢", "2026/10/03"), m("下北沢", "2026/10/04"), m("下北沢", "2026/10/05")];
  const j = sheetJoinedByMonth([sh("下北沢", "即日入会")]);
  assert.equal(signupsForMonthWithSheet(rows, new Map([["下北沢", 9]]), 2026, 10, true, j.get("2026-10")), 1);
}
// 体験シートの行はあるが入会が0件 → 0（会員一覧には落とさない）
{
  const rows = [m("春日", "2026/10/03")];
  const j = sheetJoinedByMonth([sh("春日", "検討中")]);
  assert.equal(signupsForMonthWithSheet(rows, new Map(), 2026, 10, true, j.get("2026-10")), 0);
}
// 体験シートの無い店舗は従来どおり（入会日時ベース）。全体は合算
{
  const rows = [m("下北沢", "2026/10/03"), m("船橋", "2026/10/10"), m("船橋", "2026/10/11"), m("船橋", "2026/09/30")];
  const j = sheetJoinedByMonth([sh("下北沢", "即日入会"), sh("下北沢", "後日入会")]);
  assert.equal(signupsForMonthWithSheet(rows, new Map(), 2026, 10, true, j.get("2026-10")), 2 + 2);
}
// 体験シートの無い月は従来どおり（マスタ未取込なら MA002 にフォールバック）
{
  const j = sheetJoinedByMonth([sh("下北沢", "即日入会", 2026, 10)]);
  assert.equal(signupsForMonthWithSheet([], new Map([["下北沢", 7]]), 2026, 9, false, j.get("2026-9")), 7);
}
// 体験シートが全く無ければ従来と同じ
{
  const rows = [m("A", "2026-10-01"), m("A", "2026-10-02")];
  assert.equal(signupsForMonthWithSheet(rows, new Map(), 2026, 10, true, undefined), 2);
}
console.log("signup-count tests ok");
