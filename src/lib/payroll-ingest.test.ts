// 実行: node --experimental-strip-types src/lib/payroll-ingest.test.ts
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
import { checkPayrollHeader, normalizeHeaderCell, payrollIngestBlockReasons, previousMonth, PAYROLL_HEADER_EXPECTATIONS } from "./payroll-ingest.ts";
import assert from "node:assert/strict";

// 想定どおりの見出し（ダミー。実データではない）
function goodHeader(): string[] {
  const h = Array.from({ length: 100 }, (_, i) => `項目${i}`);
  h[0] = "従業員番号"; h[1] = "氏名"; h[27] = "基本給"; h[51] = "課税支給合計"; h[55] = "総支給額";
  h[88] = "標準報酬月額(健保)"; h[89] = "標準報酬月額(厚生年金)";
  h[90] = "健康保険料(会社負担)"; h[91] = "介護保険料(会社負担)"; h[92] = "子ども・子育て拠出金(会社負担)";
  h[93] = "厚生年金保険料(会社負担)"; h[94] = "雇用保険料(会社負担)"; h[95] = "労災保険料(会社負担)"; h[96] = "一般拠出金(会社負担)";
  return h;
}

// ヘッダ照合: 想定どおりなら OK
assert.deepEqual(checkPayrollHeader(goodHeader()), { ok: true, mismatches: [] });

// BOM・全角・空白の揺れは吸収
{
  const h = goodHeader();
  h[0] = "﻿従業員 番号"; h[55] = "総支給額　";
  assert.equal(checkPayrollHeader(h).ok, true);
  assert.equal(normalizeHeaderCell("（会社負担）"), "(会社負担)");
}

// 列が1つずれた（2026-06-06 と同型: 健保の位置に標準報酬月額）→ NG・どの列かを返す
{
  const h = goodHeader();
  h.splice(88, 0, "新しい列");
  const r = checkPayrollHeader(h);
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.index === 90 && m.field.startsWith("健康保険料")));
}

// 列が足りない CSV → NG（列なし）
{
  const r = checkPayrollHeader(goodHeader().slice(0, 60));
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.every((m) => m.index >= 88));
  assert.ok(r.mismatches.some((m) => m.actual === "(列なし)"));
}

// 照合対象の列位置は route.ts の読み取り位置と一致（0,1,27,51,55,88-96）
assert.deepEqual(PAYROLL_HEADER_EXPECTATIONS.map((e) => e.index), [0, 1, 27, 51, 55, 88, 89, 90, 91, 92, 93, 94, 95, 96]);

// 前月
assert.deepEqual(previousMonth(2026, 1), { year: 2025, month: 12 });
assert.deepEqual(previousMonth(2026, 10), { year: 2026, month: 9 });

// 停止理由
const base = { records: 80, headerOk: true, nameConflictCount: 0, unresolvedCount: 0, existingCount: 0, previousCount: 80 };
assert.deepEqual(payrollIngestBlockReasons(base), []);
assert.deepEqual(payrollIngestBlockReasons({ ...base, previousCount: 0 }), []);            // 初回（前月なし）は件数比較しない
assert.deepEqual(payrollIngestBlockReasons({ ...base, records: 64 }), []);                // ちょうど8割は通す
assert.equal(payrollIngestBlockReasons({ ...base, records: 63 }).length, 1);               // 8割未満は止める
assert.match(payrollIngestBlockReasons({ ...base, records: 63 })[0], /前月の80%未満/);
assert.match(payrollIngestBlockReasons({ ...base, headerOk: false })[0], /ヘッダ照合NG/);
assert.match(payrollIngestBlockReasons({ ...base, nameConflictCount: 2 })[0], /氏名不一致 2名/);
assert.match(payrollIngestBlockReasons({ ...base, unresolvedCount: 1 })[0], /店舗未判定/);
assert.match(payrollIngestBlockReasons({ ...base, existingCount: 78 })[0], /取込済み/);
assert.ok(payrollIngestBlockReasons({ ...base, records: 0 }).some((r) => /0件/.test(r)));
// 停止理由の文言に氏名を含めない（数と種別だけ）
for (const r of payrollIngestBlockReasons({ ...base, records: 1, nameConflictCount: 3, unresolvedCount: 2, existingCount: 5, headerOk: false })) {
  assert.ok(!/様|さん/.test(r), r);
}
console.log("PAYROLL INGEST TESTS PASSED");
