// 実行: node --test src/lib/payroll-periods.test.ts
// 従業員→店舗マッピングの「期間」（開始年月〜終了年月）の判定・検証。
// データはすべてダミー（実在の従業員・金額ではない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentsForMonth,
  buildEmployeeMapping,
  mappingFromLegacyRows,
  mappingFromPeriodRows,
  periodLabel,
  recomputeEmployeePayroll,
  resolveAssignments,
  validatePeriods,
  PAYROLL_VALUE_FIELDS,
  type EmployeeMapping,
  type MonthlySplitRow,
  type PayrollRepo,
  type PayrollRowInput,
  type PeriodOverrideRow,
  type StoreAssignment,
  // @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
} from "./payroll-allocation.ts";

const HOME = "店舗H";
const A100: StoreAssignment[] = [{ storeName: "店舗A", ratio: 100 }];
const AB50: StoreAssignment[] = [{ storeName: "店舗A", ratio: 50 }, { storeName: "店舗B", ratio: 50 }];

/** 期間テーブルの行を作る（同じ期間の行は開始年月で束ねる） */
function rows(
  periods: { start: [number, number] | null; end: [number, number] | null; stores: StoreAssignment[] }[],
  baseStore: string | null,
): PeriodOverrideRow[] {
  return periods.flatMap((p) =>
    p.stores.map((s) => ({
      startYear: p.start?.[0] ?? null,
      startMonth: p.start?.[1] ?? null,
      endYear: p.end?.[0] ?? null,
      endMonth: p.end?.[1] ?? null,
      storeName: s.storeName,
      ratio: s.ratio,
      baseStore,
    })),
  );
}

// 例: 〜2026/9 店舗A 100% ／ 2026/10〜2027/2 店舗A 50%・店舗B 50% ／ 2027/3〜 店舗A 100%
const THREE = mappingFromPeriodRows(
  rows(
    [
      { start: null, end: [2026, 9], stores: A100 },
      { start: [2026, 10], end: [2027, 2], stores: AB50 },
      { start: [2027, 3], end: null, stores: A100 },
    ],
    "店舗Z",
  ),
) as EmployeeMapping;

test("3期間の例で各月の割当が正しい", () => {
  assert.equal(THREE.periods.length, 3);
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2025, 4), A100); // 最初から
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2026, 9), A100); // 期間1の終了月
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2026, 10), AB50); // 期間2の開始月
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2026, 12), AB50);
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2027, 1), AB50); // 年をまたぐ
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2027, 2), AB50); // 期間2の終了月
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2027, 3), A100); // 期間3の開始月
  assert.deepEqual(assignmentsForMonth(THREE, HOME, 2030, 6), A100); // 継続中
});

test("終了月の翌月から期間外の店舗（base）に戻る・base が無ければ社員番号ルール", () => {
  const m = mappingFromPeriodRows(
    rows([{ start: [2026, 10], end: [2027, 2], stores: AB50 }], "店舗Z"),
  ) as EmployeeMapping;
  assert.deepEqual(assignmentsForMonth(m, HOME, 2026, 9), [{ storeName: "店舗Z", ratio: 100 }]); // 開始前
  assert.deepEqual(assignmentsForMonth(m, HOME, 2027, 2), AB50);
  assert.deepEqual(assignmentsForMonth(m, HOME, 2027, 3), [{ storeName: "店舗Z", ratio: 100 }]); // 終了の翌月

  const noBase = mappingFromPeriodRows(
    rows([{ start: [2026, 10], end: [2027, 2], stores: AB50 }], null),
  ) as EmployeeMapping;
  assert.deepEqual(assignmentsForMonth(noBase, HOME, 2027, 3), [{ storeName: HOME, ratio: 100 }]);
  // base も社員番号ルールも無ければ最初の期間の先頭店舗
  assert.deepEqual(assignmentsForMonth(noBase, null, 2027, 3), [{ storeName: "店舗A", ratio: 100 }]);
});

test("既存データ（終了なし・store_overrides）の互換：開始月〜継続中の1期間として読む", () => {
  const legacyRows = AB50.map((s) => ({ ...s, effectiveYear: 2026, effectiveMonth: 8, baseStore: "店舗Z" }));
  const m = mappingFromLegacyRows(legacyRows) as EmployeeMapping;
  assert.deepEqual(m.periods, [{ startYear: 2026, startMonth: 8, endYear: null, endMonth: null, stores: AB50 }]);
  assert.deepEqual(assignmentsForMonth(m, HOME, 2026, 7), [{ storeName: "店舗Z", ratio: 100 }]);
  assert.deepEqual(assignmentsForMonth(m, HOME, 2026, 8), AB50);
  assert.deepEqual(assignmentsForMonth(m, HOME, 2035, 1), AB50);

  // 適用開始月なし（全期間）
  const all = mappingFromLegacyRows(A100.map((s) => ({ ...s, effectiveYear: null, effectiveMonth: null, baseStore: null }))) as EmployeeMapping;
  assert.deepEqual(assignmentsForMonth(all, HOME, 2020, 1), A100);
  // 年だけ入っている等の不完全な開始月は従来どおり全期間扱い
  const half = mappingFromLegacyRows(A100.map((s) => ({ ...s, effectiveYear: 2026, effectiveMonth: null, baseStore: "店舗Z" }))) as EmployeeMapping;
  assert.deepEqual(assignmentsForMonth(half, HOME, 2020, 1), A100);

  // 期間テーブルに行があればそちらを使い、無ければ旧テーブル
  assert.deepEqual(buildEmployeeMapping(legacyRows, []), m);
  assert.deepEqual(buildEmployeeMapping(legacyRows, rows([{ start: null, end: null, stores: A100 }], null))?.periods[0].stores, A100);
  assert.equal(buildEmployeeMapping([], []), null);
});

test("月別調整は期間より優先される", () => {
  const monthly = [{ storeName: "店舗C", ratio: 100 }];
  assert.deepEqual(
    resolveAssignments({ monthlySplits: monthly, mapping: THREE, homeStore: HOME, year: 2026, month: 11 }),
    monthly,
  );
  assert.deepEqual(
    resolveAssignments({ monthlySplits: undefined, mapping: THREE, homeStore: HOME, year: 2026, month: 11 }),
    AB50,
  );
});

test("全月の組み直しでも月別調整の月は残り、他の月は期間どおりになる", async () => {
  const EMP = "9001";
  const base = (year: number, month: number): PayrollRowInput => {
    const r = { year, month, employeeId: EMP, employeeName: "ダミー", contractType: null, storeName: HOME, ratio: 100 } as PayrollRowInput;
    for (const f of PAYROLL_VALUE_FIELDS) r[f] = 1000;
    return r;
  };
  let payroll: PayrollRowInput[] = [base(2026, 9), base(2026, 10), base(2026, 11), base(2027, 3)];
  const splits: MonthlySplitRow[] = [{ year: 2026, month: 11, employeeId: EMP, storeName: "店舗C", ratio: 100 }];
  const repo: PayrollRepo = {
    async findPayrollRows(q) {
      return payroll.filter((r) => r.employeeId === q.employeeId && (q.year == null || r.year === q.year) && (q.month == null || r.month === q.month));
    },
    async replacePayrollRows(employeeId, year, month, next) {
      payroll = payroll.filter((r) => !(r.employeeId === employeeId && r.year === year && r.month === month)).concat(next);
    },
    async findMonthlySplits(q) {
      return splits.filter((r) => q.employeeId == null || r.employeeId === q.employeeId);
    },
    async replaceMonthlySplits() {},
    async deleteMonthlySplits() {
      return 0;
    },
  };
  await recomputeEmployeePayroll(repo, EMP, THREE, HOME);
  const at = (y: number, m: number) =>
    payroll.filter((r) => r.year === y && r.month === m).map((r) => ({ storeName: r.storeName, ratio: r.ratio }));
  assert.deepEqual(at(2026, 9), A100);
  assert.deepEqual(at(2026, 10), AB50);
  assert.deepEqual(at(2026, 11), [{ storeName: "店舗C", ratio: 100 }]); // 月別調整
  assert.deepEqual(at(2027, 3), A100);
});

test("期間の検証：重複・開始＞終了・合計・店舗重複を拒否する", () => {
  const p = (start: [number, number] | null, end: [number, number] | null, stores: StoreAssignment[] = A100) => ({
    startYear: start?.[0] ?? null,
    startMonth: start?.[1] ?? null,
    endYear: end?.[0] ?? null,
    endMonth: end?.[1] ?? null,
    stores,
  });
  // 正常（並べ替えて返す）
  const ok = validatePeriods([p([2027, 3], null), p(null, [2026, 9]), p([2026, 10], [2027, 2], AB50)]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.periods.map((x) => x.startYear), [null, 2026, 2027]);

  // 重複（終了月と次の開始月が同じ）
  const overlap = validatePeriods([p([2026, 10], [2027, 2]), p([2027, 2], null)]);
  assert.equal(overlap.ok, false);
  if (!overlap.ok) assert.match(overlap.error, /重なっています/);
  // 継続中の期間のあとに別の期間
  assert.equal(validatePeriods([p([2026, 1], null), p([2027, 1], [2027, 6])]).ok, false);
  // 「最初から」が2つ
  assert.equal(validatePeriods([p(null, [2025, 1]), p(null, [2026, 1])]).ok, false);
  // 3期間のうち離れた期間どうしの重複
  assert.equal(validatePeriods([p([2026, 1], [2026, 3]), p([2026, 4], [2026, 12]), p([2026, 5], [2026, 6])]).ok, false);

  // 開始＞終了
  const rev = validatePeriods([p([2027, 3], [2027, 2])]);
  assert.equal(rev.ok, false);
  if (!rev.ok) assert.match(rev.error, /開始月より前/);
  // 年だけ・月の範囲外
  assert.equal(validatePeriods([{ ...p(null, null), startYear: 2026 }]).ok, false);
  assert.equal(validatePeriods([p([2026, 13], null)]).ok, false);
  // 合計100±1
  assert.equal(validatePeriods([p(null, null, [{ storeName: "店舗A", ratio: 60 }])]).ok, false);
  assert.equal(validatePeriods([p(null, null, [{ storeName: "店舗A", ratio: 33 }, { storeName: "店舗B", ratio: 33 }, { storeName: "店舗C", ratio: 33 }])]).ok, true);
  // 店舗重複
  assert.equal(validatePeriods([p(null, null, [{ storeName: "店舗A", ratio: 50 }, { storeName: "店舗A", ratio: 50 }])]).ok, false);
  // 空
  assert.equal(validatePeriods([]).ok, false);
});

test("期間の表示ラベル", () => {
  assert.equal(periodLabel({ startYear: null, startMonth: null, endYear: 2026, endMonth: 9 }), "最初から〜2026年9月");
  assert.equal(periodLabel({ startYear: 2027, startMonth: 3, endYear: null, endMonth: null }), "2027年3月〜継続中");
});
