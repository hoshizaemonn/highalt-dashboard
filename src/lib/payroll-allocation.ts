// 人件費の店舗割当ロジック（純粋関数＋リポジトリ抽象）。
// DB へのアクセスは PayrollRepo 経由に限定し、本体（prisma）は payroll-reallocate.ts で接続する。
// このファイルは外部 import を持たない（node --experimental-strip-types でそのままテストするため）。
//
// 店舗割当の優先順位（松尾様要望・2026-10）:
//   1) その月の「月別調整」（payroll_monthly_split）
//   2) マッピング（期間ごとの按分。store_override_periods／旧 store_overrides は「開始月〜継続中」の1期間）
//      どの期間にも入らない月は baseStore（期間外の店舗）1店舗100%
//   3) 社員番号ルール（千の位）
// 月別調整は、マッピング保存/削除・人件費CSVの再取込・全月再計算のどれでも上書きしない。
// 解除（その月の月別調整を削除）したときだけ、マッピング→社員番号ルールに戻る。

export interface StoreAssignment {
  storeName: string;
  ratio: number;
}

/** マッピングの1期間。開始 null＝最初から、終了 null＝継続中 */
export interface MappingPeriod {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  stores: StoreAssignment[];
}

export interface EmployeeMapping {
  periods: MappingPeriod[];
  baseStore: string | null; // どの期間にも入らない月に使う店舗（旧: 移転前の店舗）
}

/** 旧 store_overrides の行（1従業員分） */
export interface LegacyOverrideRow {
  storeName: string;
  ratio: number;
  effectiveYear: number | null;
  effectiveMonth: number | null;
  baseStore: string | null;
}

/** store_override_periods の行（1従業員分） */
export interface PeriodOverrideRow {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  storeName: string;
  ratio: number;
  baseStore: string | null;
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

const hasStart = (p: MappingPeriod) => p.startYear != null && p.startMonth != null;
const hasEnd = (p: MappingPeriod) => p.endYear != null && p.endMonth != null;
const startIndex = (p: MappingPeriod) =>
  hasStart(p) ? ymIndex(p.startYear as number, p.startMonth as number) : -Infinity;
const endIndex = (p: MappingPeriod) =>
  hasEnd(p) ? ymIndex(p.endYear as number, p.endMonth as number) : Infinity;

/** 期間がその年月を含むか（開始・終了とも含む） */
export function periodContains(p: MappingPeriod, year: number, month: number): boolean {
  const i = ymIndex(year, month);
  return i >= startIndex(p) && i <= endIndex(p);
}

/** 期間を開始順に並べる（開始 null＝最初から が先頭） */
export function sortPeriods(periods: MappingPeriod[]): MappingPeriod[] {
  return [...periods].sort((a, b) => {
    const x = startIndex(a);
    const y = startIndex(b);
    return x === y ? 0 : x < y ? -1 : 1;
  });
}

/** 旧 store_overrides の行を「開始月（未設定＝最初から）〜継続中」の1期間として読む */
export function mappingFromLegacyRows(rows: LegacyOverrideRow[]): EmployeeMapping | null {
  if (rows.length === 0) return null;
  const head = rows[0];
  const eff = head.effectiveYear != null && head.effectiveMonth != null;
  return {
    periods: [
      {
        startYear: eff ? head.effectiveYear : null,
        startMonth: eff ? head.effectiveMonth : null,
        endYear: null,
        endMonth: null,
        stores: rows.map((r) => ({ storeName: r.storeName, ratio: r.ratio })),
      },
    ],
    baseStore: head.baseStore ?? null,
  };
}

/** store_override_periods の行を (開始年月) で束ねて期間にする */
export function mappingFromPeriodRows(rows: PeriodOverrideRow[]): EmployeeMapping | null {
  if (rows.length === 0) return null;
  const byStart = new Map<string, MappingPeriod>();
  for (const r of rows) {
    const key = r.startYear != null && r.startMonth != null ? periodKey(r.startYear, r.startMonth) : "start";
    let p = byStart.get(key);
    if (!p) {
      p = {
        startYear: r.startYear ?? null,
        startMonth: r.startMonth ?? null,
        endYear: r.endYear ?? null,
        endMonth: r.endMonth ?? null,
        stores: [],
      };
      byStart.set(key, p);
    }
    p.stores.push({ storeName: r.storeName, ratio: r.ratio });
  }
  return {
    periods: sortPeriods([...byStart.values()]),
    baseStore: rows.find((r) => r.baseStore)?.baseStore ?? null,
  };
}

/** 期間テーブルに行があればそれを、無ければ旧 store_overrides を使う */
export function buildEmployeeMapping(
  legacyRows: LegacyOverrideRow[],
  periodRows: PeriodOverrideRow[],
): EmployeeMapping | null {
  return mappingFromPeriodRows(periodRows) ?? mappingFromLegacyRows(legacyRows);
}

/**
 * マッピングがある月に対して、どの店舗にどの比率で割り当てるかを返す。
 *  - その月を含む期間がある → その期間の按分先
 *  - どの期間にも入らない → 期間外の店舗（baseStore）1店舗100%
 *    （解決できなければ社員番号ルール→最初の期間の先頭店舗、それも無ければ最初の期間の按分）
 */
export function assignmentsForMonth(
  mapping: EmployeeMapping,
  homeStore: string | null,
  year: number,
  month: number,
): StoreAssignment[] {
  const period = mapping.periods.find((p) => periodContains(p, year, month));
  if (period) {
    const split = period.stores.filter((s) => s.ratio > 0);
    return split.length > 0 ? split : [];
  }

  const first = sortPeriods(mapping.periods)[0];
  const base = mapping.baseStore || homeStore || first?.stores[0]?.storeName || null;
  if (base) return [{ storeName: base, ratio: 100 }];
  return (first?.stores ?? []).filter((s) => s.ratio > 0); // 解決できない場合も消失させない
}

export interface PeriodInput {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  stores: StoreAssignment[];
}

const fmtYm = (y: number | null, m: number | null, empty: string) =>
  y != null && m != null ? `${y}年${m}月` : empty;

/** 期間の表示用ラベル（例: 2026年10月〜2027年2月 / 最初から〜継続中） */
export function periodLabel(p: { startYear: number | null; startMonth: number | null; endYear: number | null; endMonth: number | null }): string {
  return `${fmtYm(p.startYear, p.startMonth, "最初から")}〜${fmtYm(p.endYear, p.endMonth, "継続中")}`;
}

function parseYm(y: unknown, m: unknown): { ok: true; year: number | null; month: number | null } | { ok: false } {
  const empty = (v: unknown) => v == null || v === "";
  if (empty(y) && empty(m)) return { ok: true, year: null, month: null };
  const yy = Number(y);
  const mm = Number(m);
  if (!Number.isInteger(yy) || !Number.isInteger(mm) || yy < 2000 || yy > 2100 || mm < 1 || mm > 12) {
    return { ok: false };
  }
  return { ok: true, year: yy, month: mm };
}

/**
 * 期間の入力を検証して正規化する。
 *  - 年月は「年・月とも指定」または「両方空」（開始の空＝最初から／終了の空＝継続中）
 *  - 開始 ≦ 終了
 *  - 各期間の按分は validateSplits（店舗重複不可・合計100±1）
 *  - 期間どうしの重複不可
 */
export function validatePeriods(
  input: unknown,
): { ok: true; periods: PeriodInput[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "期間を1つ以上登録してください" };
  const periods: PeriodInput[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = (input[i] ?? {}) as Record<string, unknown>;
    const label = `期間${i + 1}`;
    const start = parseYm(raw.startYear, raw.startMonth);
    const end = parseYm(raw.endYear, raw.endMonth);
    if (!start.ok) return { ok: false, error: `${label}：開始の年月が正しくありません` };
    if (!end.ok) return { ok: false, error: `${label}：終了の年月が正しくありません` };
    if (
      start.year != null && end.year != null &&
      ymIndex(start.year, start.month as number) > ymIndex(end.year, end.month as number)
    ) {
      return { ok: false, error: `${label}：終了月が開始月より前になっています` };
    }
    const splits = validateSplits(raw.stores);
    if (!splits.ok) return { ok: false, error: `${label}：${splits.error}` };
    periods.push({
      startYear: start.year,
      startMonth: start.month,
      endYear: end.year,
      endMonth: end.month,
      stores: splits.splits,
    });
  }
  const sorted = sortPeriods(periods);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (startIndex(cur) <= endIndex(prev)) {
      return { ok: false, error: `期間が重なっています（${periodLabel(prev)} と ${periodLabel(cur)}）` };
    }
  }
  return { ok: true, periods: sorted };
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
