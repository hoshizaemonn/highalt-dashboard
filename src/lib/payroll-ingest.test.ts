// 実行: node --experimental-strip-types src/lib/payroll-ingest.test.ts
// 実行: node --experimental-strip-types src/lib/payroll-ingest.test.ts
import {
  checkPayrollHeader,
  isExcludedContractType,
  isHeadquartersEmployeeId,
  normalizeHeaderCell,
  payrollIngestBlockReasons,
  previousMonth,
  readPayrollCompanyAmounts,
  resolvePayrollCompanyColumns,
  PAYROLL_HQ_EMPLOYEE_ID_MAX,
// @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
} from "./payroll-ingest.ts";
import assert from "node:assert/strict";

// 数値化（route.ts の safeFloat の代わり。テスト用）
const num = (v: string | undefined) => {
  const n = parseFloat((v ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

// 共通の先頭部分（位置固定の列）。中身は架空
function baseHeader(len: number): string[] {
  const h = Array.from({ length: len }, (_, i) => `項目${i}`);
  h[0] = "従業員番号"; h[1] = "従業員"; h[27] = "基本給"; h[51] = "課税支給合計"; h[55] = "総支給額";
  return h;
}

// 97列版（〜2026年3月支給）: 支援金なし。89=健保 90=介護 91=厚年 92=拠出金 93=基金掛金 94=雇用 95=労災 96=一般拠出金
function header97(): string[] {
  const h = baseHeader(97);
  h[87] = "標準報酬月額(健保)"; h[88] = "標準報酬月額(厚生年金)";
  const tail = ["健康保険料(会社)", "介護保険料(会社)", "厚生年金保険料(会社)", "子ども・子育て拠出金(会社)",
    "厚生年金基金掛金(会社)", "雇用保険料(会社)", "労災保険料(会社)", "一般拠出金(会社)"];
  tail.forEach((t, i) => { h[89 + i] = t; });
  return h;
}

// 99列版（2026年4月支給〜）: 89=厚年標準報酬 90=健保 91=介護 92=支援金 93=厚年 94=拠出金 95=基金掛金 96=雇用 97=労災 98=一般拠出金
function header99(): string[] {
  const h = baseHeader(99);
  h[88] = "標準報酬月額(健保)"; h[89] = "標準報酬月額(厚生年金)";
  const tail = ["健康保険料(会社)", "介護保険料(会社)", "子ども・子育て支援金(会社)", "厚生年金保険料(会社)",
    "子ども・子育て拠出金(会社)", "厚生年金基金掛金(会社)", "雇用保険料(会社)", "労災保険料(会社)", "一般拠出金(会社)"];
  tail.forEach((t, i) => { h[90 + i] = t; });
  return h;
}

// 全角括弧・BOM・空白の揺れは吸収
assert.equal(normalizeHeaderCell("（会社）"), "(会社)");

// 97列・99列の両方で OK になり、列位置が見出しから引ける
{
  const r97 = checkPayrollHeader(header97());
  assert.deepEqual(r97.mismatches, []);
  assert.equal(r97.ok, true);
  assert.deepEqual(r97.columns, {
    healthInsuranceCo: 89, careInsuranceCo: 90, childSupportCo: -1, pensionCo: 91, childContributionCo: 92,
    pensionFundCo: 93, employmentInsuranceCo: 94, workersCompCo: 95, generalContributionCo: 96,
  });
  const r99 = checkPayrollHeader(header99());
  assert.deepEqual(r99.mismatches, []);
  assert.deepEqual(r99.columns, {
    healthInsuranceCo: 90, careInsuranceCo: 91, childSupportCo: 92, pensionCo: 93, childContributionCo: 94,
    pensionFundCo: 95, employmentInsuranceCo: 96, workersCompCo: 97, generalContributionCo: 98,
  });
}

// 見出しの表記ゆれ（BOM・全角括弧・空白）でも引ける
{
  const h = header99();
  h[0] = "﻿従業員 番号"; h[90] = "健康保険料（会社）"; h[96] = "雇用保険料(会社) ";
  const r = checkPayrollHeader(h);
  assert.equal(r.ok, true);
  assert.equal(r.columns?.healthInsuranceCo, 90);
  assert.equal(r.columns?.employmentInsuranceCo, 96);
}

// 氏名の見出しは 従業員/氏名/名前/従業員名 を許す。無関係な見出しは NG
for (const ok of ["従業員", "氏名", "名前", "従業員名"]) {
  const h = header99(); h[1] = ok;
  assert.equal(checkPayrollHeader(h).ok, true, ok);
}
{
  const h = header99(); h[1] = "部署";
  const r = checkPayrollHeader(h);
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.field === "氏名"));
}

// 必須の会社負担の見出しが無い → 止まる（columns=null・見出し名だけが返る）
{
  const h = header99(); h[97] = "別の項目"; // 労災が消えた
  const r = checkPayrollHeader(h);
  assert.equal(r.ok, false);
  assert.equal(r.columns, null);
  assert.deepEqual(r.mismatches, [{ index: -1, field: "労災保険料(会社)", actual: "(見出しなし)" }]);
}

// 本人負担など(会社)が付かない見出しだけでは取り込まない（部分一致で拾わない）
{
  const h = header99(); h[90] = "健康保険料(本人)";
  const r = checkPayrollHeader(h);
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.field === "健康保険料(会社)"));
}

// 重複見出し → 止まる（必須でも任意でも）
{
  const h = header99(); h[89] = "健康保険料(会社)";
  const r = checkPayrollHeader(h);
  assert.equal(r.ok, false);
  assert.equal(r.columns, null);
  assert.deepEqual(r.mismatches, [{ index: -1, field: "健康保険料(会社)", actual: "(重複 2列)" }]);
  const h2 = header99(); h2[10] = "子ども・子育て支援金(会社)";
  assert.equal(resolvePayrollCompanyColumns(h2).columns, null);
}

// 位置固定の列がずれた（基本給の位置に別の見出し）→ NG・どの項目かを返す
{
  const h = header99(); h.splice(27, 0, "新しい列");
  const r = checkPayrollHeader(h);
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.index === 27 && m.field === "基本給"));
}

// 列が足りない CSV → NG（会社負担の見出しなし・columns=null）
{
  const r = checkPayrollHeader(header99().slice(0, 60));
  assert.equal(r.ok, false);
  assert.equal(r.columns, null);
  assert.ok(r.mismatches.some((m) => m.field === "健康保険料(会社)" && m.actual === "(見出しなし)"));
}

// 値の読み取り: 97列版（支援金なし＝0）
{
  const cols = checkPayrollHeader(header97()).columns!;
  const row = Array.from({ length: 97 }, () => "0");
  row[89] = "1000"; row[90] = "100"; row[91] = "2000"; row[92] = "30"; row[93] = "5"; row[94] = "600"; row[95] = "70"; row[96] = "8";
  assert.deepEqual(readPayrollCompanyAmounts(row, cols, num), {
    healthInsuranceCo: 1000, careInsuranceCo: 100, pensionCo: 2000, childContributionCo: 30,
    pensionFundCo: 5, employmentInsuranceCo: 600, workersCompCo: 70, generalContributionCo: 8,
  });
}

// 値の読み取り: 99列版（支援金を拠出金に足し込む。雇用・労災・一般拠出金がずれない）
{
  const cols = checkPayrollHeader(header99()).columns!;
  const row = Array.from({ length: 99 }, () => "0");
  row[90] = "1000"; row[91] = "100"; row[92] = "11"; row[93] = "2000"; row[94] = "30"; row[95] = "5"; row[96] = "600"; row[97] = "70"; row[98] = "8";
  assert.deepEqual(readPayrollCompanyAmounts(row, cols, num), {
    healthInsuranceCo: 1000, careInsuranceCo: 100, pensionCo: 2000, childContributionCo: 41,
    pensionFundCo: 5, employmentInsuranceCo: 600, workersCompCo: 70, generalContributionCo: 8,
  });
  // 行が短い（列が欠けた行）でも落ちず 0
  assert.equal(readPayrollCompanyAmounts(row.slice(0, 95), cols, num).generalContributionCo, 0);
}

// 除外ルール: 役員は契約種別で除外（表記ゆれ吸収）。それ以外は除外しない
assert.equal(isExcludedContractType("役員"), true);
assert.equal(isExcludedContractType(" 役員 "), true);
assert.equal(isExcludedContractType("正社員"), false);
assert.equal(isExcludedContractType("アルバイト"), false);
assert.equal(isExcludedContractType(""), false);

// 除外ルール: 本部は番号が1000未満のときだけ。1000以上・数値でない番号・4008（アルバイト）は除外しない
assert.equal(PAYROLL_HQ_EMPLOYEE_ID_MAX, 1000);
assert.equal(isHeadquartersEmployeeId("1"), true);
assert.equal(isHeadquartersEmployeeId("999"), true);
assert.equal(isHeadquartersEmployeeId("0012"), true);
assert.equal(isHeadquartersEmployeeId("1000"), false);
assert.equal(isHeadquartersEmployeeId("4008"), false);
assert.equal(isHeadquartersEmployeeId("9001"), false);
assert.equal(isHeadquartersEmployeeId("A12"), false);
assert.equal(isHeadquartersEmployeeId(""), false);

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
// 除外した人数があっても停止理由にはならない（除外は正常系）
assert.deepEqual(payrollIngestBlockReasons({ ...base, excludedCount: 3 }), []);
assert.match(payrollIngestBlockReasons({ ...base, nameConflictCount: 2 })[0], /氏名不一致 2名/);
assert.match(payrollIngestBlockReasons({ ...base, unresolvedCount: 1 })[0], /店舗未判定/);
assert.match(payrollIngestBlockReasons({ ...base, existingCount: 78 })[0], /取込済み/);
assert.ok(payrollIngestBlockReasons({ ...base, records: 0 }).some((r) => /0件/.test(r)));
// 停止理由の文言に氏名を含めない（数と種別だけ）
for (const r of payrollIngestBlockReasons({ ...base, records: 1, nameConflictCount: 3, unresolvedCount: 2, existingCount: 5, headerOk: false })) {
  assert.ok(!/様|さん/.test(r), r);
}
console.log("PAYROLL INGEST TESTS PASSED");
