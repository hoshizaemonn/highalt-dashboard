// 実行: node --experimental-strip-types src/lib/trial-sheet-date-col.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { fixSerialDateColumn } from "./trial-sheet-date-col.ts";
import assert from "node:assert/strict";

const H = ["日付", "", "氏名", "即日入会"];
// 連番＋右隣に日付（祖師ヶ谷大蔵・中目黒の形）→ 右隣へ移す
assert.deepEqual(
  fixSerialDateColumn([H, ["1", "2026/09/01", "A", "〇"], ["2", "9/3", "B", ""], ["3", "2026/9/4", "C", ""]], 0, 0),
  { index: 1, moved: true },
);
// 左がすでに日付（下北沢の形）→ 動かさない
assert.deepEqual(
  fixSerialDateColumn([["日付", "氏名", "x"], ["2026/9/1", "A", ""], ["2026/9/2", "B", ""], ["2026/9/3", "C", ""]], 0, 0),
  { index: 0, moved: false },
);
// 右隣の見出しが別の名前（氏名）→ 動かさない
assert.deepEqual(
  fixSerialDateColumn([["日付", "氏名"], ["1", "A"], ["2", "B"], ["3", "C"]], 0, 0),
  { index: 0, moved: false },
);
// 右隣が日付でない → 動かさない
assert.deepEqual(
  fixSerialDateColumn([H, ["1", "x", "A", ""], ["2", "y", "B", ""], ["3", "z", "C", ""]], 0, 0),
  { index: 0, moved: false },
);
console.log("OK");
