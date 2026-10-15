// 実行: node --test src/lib/payroll-allocation.test.ts
// 月別調整（payroll_monthly_split）がマッピング保存・CSV再取込・全月再計算で消えないことの確認。
// データはすべてダミー（実在の従業員・金額ではない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignmentsForMonth,
  clearMonthlySplit,
  groupMonthlySplitsByEmployee,
  PAYROLL_VALUE_FIELDS,
  recomputeEmployeePayroll,
  resolveAssignments,
  saveMonthlySplit,
  validateSplits,
  type EmployeeMapping,
  type MonthlySplitRow,
  type PayrollRepo,
  type PayrollRowInput,
  type StoreAssignment,
  // @ts-expect-error node --experimental-strip-types で直接実行するため .ts 拡張子が必要
} from "./payroll-allocation.ts";

// ─── メモリ上のリポジトリ（prisma の代わり） ─────────────────────
class MemoryRepo implements PayrollRepo {
  payroll: PayrollRowInput[] = [];
  splits: (MonthlySplitRow & { updatedBy: string })[] = [];

  async findPayrollRows(q: { employeeId: string; year?: number; month?: number }) {
    return this.payroll
      .filter((r) => r.employeeId === q.employeeId)
      .filter((r) => q.year == null || r.year === q.year)
      .filter((r) => q.month == null || r.month === q.month)
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map((r) => ({ ...r }));
  }
  async replacePayrollRows(employeeId: string, year: number, month: number, rows: PayrollRowInput[]) {
    this.payroll = this.payroll.filter(
      (r) => !(r.employeeId === employeeId && r.year === year && r.month === month),
    );
    this.payroll.push(...rows.map((r) => ({ ...r })));
  }
  async findMonthlySplits(q: { employeeId?: string; year?: number; month?: number }) {
    return this.splits
      .filter((r) => q.employeeId == null || r.employeeId === q.employeeId)
      .filter((r) => q.year == null || r.year === q.year)
      .filter((r) => q.month == null || r.month === q.month)
      .map(({ year, month, employeeId, storeName, ratio }) => ({ year, month, employeeId, storeName, ratio }));
  }
  async replaceMonthlySplits(employeeId: string, year: number, month: number, splits: StoreAssignment[], updatedBy: string) {
    await this.deleteMonthlySplits(employeeId, year, month);
    this.splits.push(...splits.map((s) => ({ year, month, employeeId, storeName: s.storeName, ratio: s.ratio, updatedBy })));
  }
  async deleteMonthlySplits(employeeId: string, year: number, month: number) {
    const before = this.splits.length;
    this.splits = this.splits.filter(
      (r) => !(r.employeeId === employeeId && r.year === year && r.month === month),
    );
    return before - this.splits.length;
  }

  /** ある従業員・月の割当（店舗→比率） */
  allocation(employeeId: string, year: number, month: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.payroll) {
      if (r.employeeId === employeeId && r.year === year && r.month === month) out[r.storeName] = r.ratio;
    }
    return out;
  }
}

const EMP = "1001"; // ダミー社員番号（千の位=1 → 社員番号ルールでは STORE_A 相当）
const HOME = "店舗A";

function payrollRow(year: number, month: number, storeName = HOME, ratio = 100): PayrollRowInput {
  const row = {
    year, month, employeeId: EMP, employeeName: "ダミー", contractType: "正社員", storeName, ratio,
  } as PayrollRowInput;
  for (const f of PAYROLL_VALUE_FIELDS) row[f] = 1000; // ダミー金額
  return row;
}

/** 7〜9月の人件費が社員番号ルール（店舗A 100%）で入っている状態 */
function seeded(): MemoryRepo {
  const repo = new MemoryRepo();
  repo.payroll.push(payrollRow(2026, 7), payrollRow(2026, 8), payrollRow(2026, 9));
  return repo;
}

const DUAL: EmployeeMapping = {
  stores: [{ storeName: "店舗A", ratio: 50 }, { storeName: "店舗B", ratio: 50 }],
  effectiveYear: null,
  effectiveMonth: null,
  baseStore: null,
};

/** CSV再取込と同じ判定（route.ts の resolveStore と同じ優先順位）で1か月を組み直す */
async function reimportMonth(repo: MemoryRepo, year: number, month: number, mapping: EmployeeMapping | null) {
  const splitsByEmp = groupMonthlySplitsByEmployee(await repo.findMonthlySplits({ year, month }));
  const assignments = resolveAssignments({
    monthlySplits: splitsByEmp.get(EMP),
    mapping,
    homeStore: HOME,
    year,
    month,
  });
  const base = payrollRow(year, month); // CSV原本（100%換算）
  await repo.replacePayrollRows(
    EMP, year, month,
    assignments.map((a) => ({ ...base, storeName: a.storeName, ratio: a.ratio })),
  );
}

test("月別調整を保存→マッピング（兼務）を保存しても、その月の調整は残る", async () => {
  const repo = seeded();
  const r = await saveMonthlySplit(repo, {
    year: 2026, month: 8, employeeId: EMP,
    splits: [{ storeName: "店舗A", ratio: 70 }, { storeName: "店舗C", ratio: 30 }],
    updatedBy: "tester",
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(repo.allocation(EMP, 2026, 8), { 店舗A: 70, 店舗C: 30 });

  // 従業員→店舗マッピングで兼務登録（全月再計算が走る）
  await recomputeEmployeePayroll(repo, EMP, DUAL, HOME);

  assert.deepEqual(repo.allocation(EMP, 2026, 8), { 店舗A: 70, 店舗C: 30 }, "8月の月別調整が残る");
  assert.deepEqual(repo.allocation(EMP, 2026, 7), { 店舗A: 50, 店舗B: 50 }, "調整のない月はマッピング");
  assert.deepEqual(repo.allocation(EMP, 2026, 9), { 店舗A: 50, 店舗B: 50 }, "調整のない月はマッピング");
});

test("月別調整を保存→マッピングを削除しても残る（他の月は社員番号ルールへ）", async () => {
  const repo = seeded();
  await recomputeEmployeePayroll(repo, EMP, DUAL, HOME);
  await saveMonthlySplit(repo, {
    year: 2026, month: 8, employeeId: EMP,
    splits: [{ storeName: "店舗B", ratio: 100 }], updatedBy: "tester",
  });
  await recomputeEmployeePayroll(repo, EMP, null, HOME); // マッピング削除

  assert.deepEqual(repo.allocation(EMP, 2026, 8), { 店舗B: 100 });
  assert.deepEqual(repo.allocation(EMP, 2026, 7), { 店舗A: 100 });
});

test("月別調整を保存→人件費CSVを再取込しても残る", async () => {
  const repo = seeded();
  await saveMonthlySplit(repo, {
    year: 2026, month: 8, employeeId: EMP,
    splits: [{ storeName: "店舗A", ratio: 60 }, { storeName: "店舗D", ratio: 40 }],
    updatedBy: "tester",
  });
  await reimportMonth(repo, 2026, 8, DUAL); // マッピングありでも月別調整が優先
  assert.deepEqual(repo.allocation(EMP, 2026, 8), { 店舗A: 60, 店舗D: 40 });

  await reimportMonth(repo, 2026, 9, DUAL); // 調整のない月はマッピング
  assert.deepEqual(repo.allocation(EMP, 2026, 9), { 店舗A: 50, 店舗B: 50 });
});

test("解除するとその月だけマッピングの按分に戻る（他の月の調整は残る）", async () => {
  const repo = seeded();
  await recomputeEmployeePayroll(repo, EMP, DUAL, HOME);
  for (const month of [7, 8]) {
    await saveMonthlySplit(repo, {
      year: 2026, month, employeeId: EMP,
      splits: [{ storeName: "店舗C", ratio: 100 }], updatedBy: "tester",
    });
  }
  const { removed } = await clearMonthlySplit(repo, {
    year: 2026, month: 8, employeeId: EMP, mapping: DUAL, homeStore: HOME,
  });
  assert.equal(removed, 1);
  assert.deepEqual(repo.allocation(EMP, 2026, 8), { 店舗A: 50, 店舗B: 50 }, "8月はマッピングに戻る");
  assert.deepEqual(repo.allocation(EMP, 2026, 7), { 店舗C: 100 }, "7月の調整は残る");
  assert.equal(repo.splits.filter((s) => s.month === 8).length, 0);

  // 解除後に再取込してもマッピングどおり
  await reimportMonth(repo, 2026, 8, DUAL);
  assert.deepEqual(repo.allocation(EMP, 2026, 8), { 店舗A: 50, 店舗B: 50 });
});

test("マッピングが無い従業員の解除は社員番号ルールに戻る", async () => {
  const repo = seeded();
  await saveMonthlySplit(repo, {
    year: 2026, month: 9, employeeId: EMP,
    splits: [{ storeName: "店舗B", ratio: 100 }], updatedBy: "tester",
  });
  await clearMonthlySplit(repo, { year: 2026, month: 9, employeeId: EMP, mapping: null, homeStore: HOME });
  assert.deepEqual(repo.allocation(EMP, 2026, 9), { 店舗A: 100 });
});

test("月別調整は金額（100%換算）を変えず ratio だけ変える・再保存で置き換わる", async () => {
  const repo = seeded();
  await saveMonthlySplit(repo, {
    year: 2026, month: 8, employeeId: EMP,
    splits: [{ storeName: "店舗A", ratio: 50 }, { storeName: "店舗B", ratio: 50 }], updatedBy: "tester",
  });
  await saveMonthlySplit(repo, {
    year: 2026, month: 8, employeeId: EMP,
    splits: [{ storeName: "店舗C", ratio: 100 }], updatedBy: "tester",
  });
  assert.deepEqual(repo.allocation(EMP, 2026, 8), { 店舗C: 100 });
  assert.equal(repo.splits.length, 1);
  const row = repo.payroll.find((r) => r.month === 8)!;
  for (const f of PAYROLL_VALUE_FIELDS) assert.equal(row[f], 1000);
});

test("人件費データの無い月は月別調整を保存しない", async () => {
  const repo = seeded();
  const r = await saveMonthlySplit(repo, {
    year: 2026, month: 10, employeeId: EMP,
    splits: [{ storeName: "店舗A", ratio: 100 }], updatedBy: "tester",
  });
  assert.deepEqual(r, { ok: false, error: "no-payroll" });
  assert.equal(repo.splits.length, 0);
});

test("適用開始月ロジックは従来どおり（開始月より前は移転前の店舗）", () => {
  const m: EmployeeMapping = { ...DUAL, effectiveYear: 2026, effectiveMonth: 8, baseStore: "店舗Z" };
  assert.deepEqual(assignmentsForMonth(m, HOME, 2026, 7), [{ storeName: "店舗Z", ratio: 100 }]);
  assert.deepEqual(assignmentsForMonth(m, HOME, 2026, 8), DUAL.stores);
  // 月別調整は適用開始月より前でも優先
  assert.deepEqual(
    resolveAssignments({ monthlySplits: [{ storeName: "店舗C", ratio: 100 }], mapping: m, homeStore: HOME, year: 2026, month: 7 }),
    [{ storeName: "店舗C", ratio: 100 }],
  );
  // マッピングも調整も無ければ社員番号ルール、それも無ければ空
  assert.deepEqual(resolveAssignments({ monthlySplits: undefined, mapping: null, homeStore: HOME, year: 2026, month: 7 }), [{ storeName: HOME, ratio: 100 }]);
  assert.deepEqual(resolveAssignments({ monthlySplits: [], mapping: null, homeStore: null, year: 2026, month: 7 }), []);
});

test("按分入力の検証", () => {
  assert.equal(validateSplits([]).ok, false);
  assert.equal(validateSplits([{ storeName: "店舗A", ratio: 60 }]).ok, false); // 合計60
  assert.equal(validateSplits([{ storeName: "店舗A", ratio: 50 }, { storeName: "店舗A", ratio: 50 }]).ok, false); // 重複
  assert.equal(validateSplits([{ storeName: "店舗A", ratio: 0 }]).ok, false); // 0%のみ
  assert.equal(validateSplits([{ storeName: "", ratio: 100 }]).ok, false);
  assert.deepEqual(
    validateSplits([{ storeName: "店舗A", ratio: 70 }, { storeName: "店舗B", ratio: 30 }, { storeName: "店舗C", ratio: 0 }]),
    { ok: true, splits: [{ storeName: "店舗A", ratio: 70 }, { storeName: "店舗B", ratio: 30 }] },
  );
});
