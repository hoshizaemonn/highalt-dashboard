// 人件費の店舗割当ロジック（純粋関数＋リポジトリ抽象）。
// DB へのアクセスは PayrollRepo 経由に限定し、本体（prisma）は payroll-reallocate.ts で接続する。
// このファイルは外部 import を持たない（node --experimental-strip-types でそのままテストするため）。
//
// 店舗割当の優先順位（松尾様要望・2026-10）:
//   1) その月の「月別調整」（payroll_monthly_split）
//   2) マッピング（store_overrides。適用開始月・移転前店舗を含む）
//   3) 社員番号ルール（千の位）
// 月別調整は、マッピング保存/削除・人件費CSVの再取込・全月再計算のどれでも上書きしない。
// 解除（その月の月別調整を削除）したときだけ、マッピング→社員番号ルールに戻る。

export interface StoreAssignment {
  storeName: string;
  ratio: number;
}

export interface EmployeeMapping {
  stores: StoreAssignment[]; // 適用開始月以降の按分先
  effectiveYear: number | null;
  effectiveMonth: number | null;
  baseStore: string | null; // 適用開始月より前に使う店舗
}

/** PayrollData の金額・時間（100%換算で保持し、ratio は別フィールド） */
export const PAYROLL_VALUE_FIELDS = [
  "workDaysWeekday",
  "workDaysHoliday",
  "workDaysLegalHoliday",
  "scheduledHours",
  "overtimeHours",
  "baseSalary",
  "positionAllowance",
  "overtimePay",
  "commuteTaxable",
  "commuteNontax",
  "taxableTotal",
  "grossTotal",
  "healthInsuranceCo",
  "careInsuranceCo",
  "pensionCo",
  "childContributionCo",
  "pensionFundCo",
  "employmentInsuranceCo",
  "workersCompCo",
  "generalContributionCo",
] as const;

export type PayrollValueField = (typeof PAYROLL_VALUE_FIELDS)[number];

export type PayrollRowInput = {
  year: number;
  month: number;
  employeeId: string;
  employeeName: string | null;
  contractType: string | null;
  storeName: string;
  ratio: number;
} & Record<PayrollValueField, number>;

export interface MonthlySplitRow {
  year: number;
  month: number;
  employeeId: string;
  storeName: string;
  ratio: number;
}

/** DB アクセスの最小インターフェース（本体は prisma、テストはメモリ実装） */
export interface PayrollRepo {
  /** 従業員の人件費行（year,month 昇順）。year/month 指定時はその月だけ */
  findPayrollRows(q: { employeeId: string; year?: number; month?: number }): Promise<PayrollRowInput[]>;
  /** (employeeId, year, month) の行を置き換える（削除スコープはこの3つに限定） */
  replacePayrollRows(employeeId: string, year: number, month: number, rows: PayrollRowInput[]): Promise<void>;
  /** 月別調整の取得（指定した条件で絞り込み） */
  findMonthlySplits(q: { employeeId?: string; year?: number; month?: number }): Promise<MonthlySplitRow[]>;
  /** (employeeId, year, month) の月別調整を置き換える（削除スコープはこの3つに限定） */
  replaceMonthlySplits(
    employeeId: string,
    year: number,
    month: number,
    splits: StoreAssignment[],
    updatedBy: string,
  ): Promise<void>;
  /** (employeeId, year, month) の月別調整を削除し、削除件数を返す */
  deleteMonthlySplits(employeeId: string, year: number, month: number): Promise<number>;
}

const ymIndex = (year: number, month: number) => year * 12 + (month - 1);
export const periodKey = (year: number, month: number) => `${year}-${month}`;

/**
 * マッピングがある月に対して、どの店舗にどの比率で割り当てるかを返す。
 *  - 適用開始月以降（または適用開始月が未設定）→ マッピングの按分先
 *  - それより前 → 移転前の店舗1店舗100%（解決できなければ按分先のまま）
 */
export function assignmentsForMonth(
  mapping: EmployeeMapping,
  homeStore: string | null,
  year: number,
  month: number,
): StoreAssignment[] {
  const split = mapping.stores.filter((s) => s.ratio > 0);
  const hasEffective = mapping.effectiveYear != null && mapping.effectiveMonth != null;
  const applySplit =
    !hasEffective ||
    ymIndex(year, month) >= ymIndex(mapping.effectiveYear as number, mapping.effectiveMonth as number);

  if (applySplit) return split.length > 0 ? split : [];

  const base = mapping.baseStore || homeStore || mapping.stores[0]?.storeName || null;
  if (base) return [{ storeName: base, ratio: 100 }];
  return split; // 移転前店舗を解決できない場合は按分をそのまま維持（消失させない）
}

/**
 * ある従業員のある月の店舗割当を決める（優先順位: 月別調整 ＞ マッピング ＞ 社員番号ルール）。
 * どれでも決まらなければ空配列（呼び出し側でフォールバック）。
 */
export function resolveAssignments(params: {
  monthlySplits: StoreAssignment[] | undefined;
  mapping: EmployeeMapping | null;
  homeStore: string | null;
  year: number;
  month: number;
}): StoreAssignment[] {
  const monthly = (params.monthlySplits ?? []).filter((s) => s.ratio > 0);
  if (monthly.length > 0) return monthly;
  if (params.mapping) return assignmentsForMonth(params.mapping, params.homeStore, params.year, params.month);
  if (params.homeStore) return [{ storeName: params.homeStore, ratio: 100 }];
  return [];
}

/** 月別調整の行を「年月キー → 割当」にまとめる */
export function groupMonthlySplits(rows: MonthlySplitRow[]): Map<string, StoreAssignment[]> {
  const map = new Map<string, StoreAssignment[]>();
  for (const r of rows) {
    const key = periodKey(r.year, r.month);
    const list = map.get(key) ?? [];
    list.push({ storeName: r.storeName, ratio: r.ratio });
    map.set(key, list);
  }
  return map;
}

/** 月別調整の行を「従業員ID → 割当」にまとめる（1か月分の行を渡す前提） */
export function groupMonthlySplitsByEmployee(rows: MonthlySplitRow[]): Map<string, StoreAssignment[]> {
  const map = new Map<string, StoreAssignment[]>();
  for (const r of rows) {
    const list = map.get(r.employeeId) ?? [];
    list.push({ storeName: r.storeName, ratio: r.ratio });
    map.set(r.employeeId, list);
  }
  return map;
}

/** 按分の入力を検証して正規化する（0%は除外・店舗重複不可・合計100±1） */
export function validateSplits(
  splits: unknown,
): { ok: true; splits: StoreAssignment[] } | { ok: false; error: string } {
  if (!Array.isArray(splits) || splits.length === 0) return { ok: false, error: "splits は必須です" };
  const normalized: StoreAssignment[] = [];
  for (const s of splits as { storeName?: unknown; ratio?: unknown }[]) {
    const storeName = typeof s?.storeName === "string" ? s.storeName.trim() : "";
    const ratio = Math.round(Number(s?.ratio));
    if (!storeName || !Number.isFinite(ratio) || ratio < 0 || ratio > 100) {
      return { ok: false, error: "店舗名・比率が不正です" };
    }
    if (ratio > 0) normalized.push({ storeName, ratio });
  }
  if (normalized.length === 0) return { ok: false, error: "比率が0%の店舗のみは保存できません" };
  if (new Set(normalized.map((s) => s.storeName)).size !== normalized.length) {
    return { ok: false, error: "店舗が重複しています" };
  }
  const sum = normalized.reduce((t, s) => t + s.ratio, 0);
  if (Math.abs(sum - 100) > 1) return { ok: false, error: `合計が100%になりません（現在 ${sum}%）` };
  return { ok: true, splits: normalized };
}

function rowsFromBase(base: PayrollRowInput, assignments: StoreAssignment[]): PayrollRowInput[] {
  return assignments.map((a) => {
    const row = {
      year: base.year,
      month: base.month,
      employeeId: base.employeeId,
      employeeName: base.employeeName,
      contractType: base.contractType,
      storeName: a.storeName,
      ratio: Math.round(a.ratio),
    } as PayrollRowInput;
    for (const f of PAYROLL_VALUE_FIELDS) row[f] = base[f];
    return row;
  });
}

/**
 * 従業員の全月の人件費を組み直す（マッピング保存/削除・全月再計算から呼ぶ）。
 * 月別調整がある月はそれを優先し、無い月だけ mapping（null＝マッピング無し→社員番号ルール）に従う。
 * 各月の既存行から100%換算の元値を1件取り出して作り直すため可逆。
 */
export async function recomputeEmployeePayroll(
  repo: PayrollRepo,
  employeeId: string,
  mapping: EmployeeMapping | null,
  homeStore: string | null,
  scope?: { year: number; month?: number },
): Promise<number> {
  const rows = await repo.findPayrollRows({ employeeId, year: scope?.year, month: scope?.month });
  if (rows.length === 0) return 0;
  const splitsByPeriod = groupMonthlySplits(
    await repo.findMonthlySplits({ employeeId, year: scope?.year, month: scope?.month }),
  );

  const baseByPeriod = new Map<string, PayrollRowInput>();
  for (const r of rows) {
    const key = periodKey(r.year, r.month);
    if (!baseByPeriod.has(key)) baseByPeriod.set(key, r);
  }

  let created = 0;
  for (const [key, base] of baseByPeriod) {
    let assignments = resolveAssignments({
      monthlySplits: splitsByPeriod.get(key),
      mapping,
      homeStore,
      year: base.year,
      month: base.month,
    });
    // 割当が決まらない（社員番号ルールも不可）なら元の店舗を維持して消失させない
    if (assignments.length === 0) assignments = [{ storeName: base.storeName, ratio: 100 }];
    await repo.replacePayrollRows(employeeId, base.year, base.month, rowsFromBase(base, assignments));
    created += assignments.length;
  }
  return created;
}

/** 月別調整を保存し、その月の人件費行を組み直す。対象月の人件費行が無ければ保存しない */
export async function saveMonthlySplit(
  repo: PayrollRepo,
  params: { year: number; month: number; employeeId: string; splits: StoreAssignment[]; updatedBy: string },
): Promise<{ ok: true } | { ok: false; error: "no-payroll" }> {
  const { year, month, employeeId, splits, updatedBy } = params;
  const existing = await repo.findPayrollRows({ employeeId, year, month });
  if (existing.length === 0) return { ok: false, error: "no-payroll" };
  await repo.replaceMonthlySplits(employeeId, year, month, splits, updatedBy);
  await repo.replacePayrollRows(employeeId, year, month, rowsFromBase(existing[0], splits));
  return { ok: true };
}

/** 月別調整を解除し、その月をマッピング（無ければ社員番号ルール）で組み直す */
export async function clearMonthlySplit(
  repo: PayrollRepo,
  params: { year: number; month: number; employeeId: string; mapping: EmployeeMapping | null; homeStore: string | null },
): Promise<{ removed: number }> {
  const { year, month, employeeId, mapping, homeStore } = params;
  const removed = await repo.deleteMonthlySplits(employeeId, year, month);
  await recomputeEmployeePayroll(repo, employeeId, mapping, homeStore, { year, month });
  return { removed };
}
