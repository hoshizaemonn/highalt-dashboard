/**
 * 人件費（クラウド給与の支給控除一覧表 CSV）の自動取込（取込専用ロール ingest）用の安全ガード。
 *
 * 取込API（/api/upload/payroll）は CSV を「列の位置」で読む。クラウド給与側で列が増減すると
 * 別の列（例: 標準報酬月額）を健康保険料として黙って取り込んでしまう（2026-06-06 に実際に発生）。
 * 自動取込では人の目が入らないため、次の場合は書き込まずに止める:
 *   1. ヘッダ照合: 必須の見出しが無い／重複する（会社負担の列は見出しから位置を引く。下記参照）
 *   2. 氏名の不一致: 既存データと同じ従業員番号で氏名が違う（強制上書きしない）
 *   3. 未登録従業員: 店舗を判定できない従業員がいる（取りこぼしを防ぐ）
 *   4. 件数の急減: 前月の件数の 8 割未満（エクスポート条件の誤り・途中切れを疑う）
 *   5. 取込済み: 対象年月に既にデータがある（自動取込は上書きしない。上書きは画面から人が行う）
 *
 * ここは純粋関数だけ（DB・個人情報に触れない）。戻り値に氏名は含めない。
 */

/** 位置固定で読む列（route.ts が 0,1,27,51,55 を直接読む）の見出し確認。
 *  この位置はクラウド給与の 97列版・99列版で同じ（実ファイルとDBの突合で確認済み）。
 *  見出しの正規化後に patterns のどれかに当てはまればOK。 */
export const PAYROLL_FIXED_HEADER_EXPECTATIONS: ReadonlyArray<{ index: number; field: string; patterns: RegExp[] }> = [
  { index: 0, field: "従業員番号", patterns: [/^従業員(番号|コード|No)$/i, /^社員(番号|コード)$/] },
  // 現行CSVの氏名の見出しは「従業員」。表記ゆれ（氏名/名前/従業員名）も許す
  { index: 1, field: "氏名", patterns: [/^(従業員|氏名|名前|従業員名)$/] },
  { index: 27, field: "基本給", patterns: [/基本給/] },
  { index: 51, field: "課税支給合計", patterns: [/課税.*(支給)?合計/, /課税支給/] },
  { index: 55, field: "総支給額", patterns: [/総支給/, /支給合計/] },
];

/** 会社負担の列（見出しから位置を引く）。
 *  クラウド給与は 2026年4月支給分から 97列→99列になり、健保以降の位置が動いた
 *  （「子ども・子育て支援金(会社)」が増え、標準報酬の列も増減する）。位置固定だと別の項目を
 *  黙って取り込む（2026-03月分以降のDBで 雇用保険・労災・一般拠出金がずれた）ため、見出しで引く。
 *  header は正規化後（全角括弧→半角）の「完全一致」。部分一致にしない（「健康保険料(本人)」等と混ざるため）。 */
export type PayrollCompanyKey =
  | "healthInsuranceCo"
  | "careInsuranceCo"
  | "childSupportCo"
  | "pensionCo"
  | "childContributionCo"
  | "pensionFundCo"
  | "employmentInsuranceCo"
  | "workersCompCo"
  | "generalContributionCo";

export const PAYROLL_COMPANY_HEADERS: ReadonlyArray<{ key: PayrollCompanyKey; header: string; required: boolean }> = [
  { key: "healthInsuranceCo", header: "健康保険料(会社)", required: true },
  { key: "careInsuranceCo", header: "介護保険料(会社)", required: true },
  // 支援金は97列時代のCSVに無い（0として扱う）ので任意
  { key: "childSupportCo", header: "子ども・子育て支援金(会社)", required: false },
  { key: "pensionCo", header: "厚生年金保険料(会社)", required: true },
  { key: "childContributionCo", header: "子ども・子育て拠出金(会社)", required: true },
  // 基金掛金は加入していない会社だと列が無い可能性があるので任意（無ければ0）
  { key: "pensionFundCo", header: "厚生年金基金掛金(会社)", required: false },
  { key: "employmentInsuranceCo", header: "雇用保険料(会社)", required: true },
  { key: "workersCompCo", header: "労災保険料(会社)", required: true },
  { key: "generalContributionCo", header: "一般拠出金(会社)", required: true },
];

/** 前月比でこの割合を下回ったら投入しない */
export const PAYROLL_MIN_RATIO_VS_PREVIOUS = 0.8;

/** 見出しの正規化（全角英数・括弧・空白の揺れを吸収） */
export function normalizeHeaderCell(s: string | undefined | null): string {
  return (s ?? "")
    .normalize("NFKC")
    .replace(/^﻿/, "")
    .replace(/[\s"]/g, "");
}

export interface HeaderMismatch {
  /** 列位置（0始まり）。見出しから引く項目で見つからない／重複のときは -1 */
  index: number;
  field: string;
  actual: string;
}

/** 会社負担の列位置。-1 は「列なし（0として扱う）」 */
export type PayrollCompanyColumns = Record<PayrollCompanyKey, number>;

/** 見出しから会社負担の列位置を引く（純関数）。必須の見出しが無い／重複するときは columns=null。
 *  mismatches には見出し名だけを入れる（個人情報は入らない）。 */
export function resolvePayrollCompanyColumns(header: string[]): {
  columns: PayrollCompanyColumns | null;
  mismatches: HeaderMismatch[];
} {
  const normalized = header.map((h) => normalizeHeaderCell(h));
  const mismatches: HeaderMismatch[] = [];
  const columns = {} as PayrollCompanyColumns;
  for (const spec of PAYROLL_COMPANY_HEADERS) {
    const want = normalizeHeaderCell(spec.header);
    const hits: number[] = [];
    normalized.forEach((h, i) => {
      if (h === want) hits.push(i);
    });
    if (hits.length > 1) {
      // 任意の列でも重複は止める（どちらが正しいか決められない）
      mismatches.push({ index: -1, field: spec.header, actual: `(重複 ${hits.length}列)` });
      columns[spec.key] = -1;
    } else if (hits.length === 1) {
      columns[spec.key] = hits[0];
    } else {
      columns[spec.key] = -1;
      if (spec.required) mismatches.push({ index: -1, field: spec.header, actual: "(見出しなし)" });
    }
  }
  // 読む対象に入っていない「(会社)」負担の列（クラウド給与が新しい会社負担の項目を足した場合）は止める。
  // 黙って読み飛ばすと法定福利費が過少になる（2026年4月の「子ども・子育て支援金(会社)」追加時と同じ事故）。
  const known = new Set(PAYROLL_COMPANY_HEADERS.map((s) => normalizeHeaderCell(s.header)));
  normalized.forEach((h, i) => {
    if (/\(会社\)$/.test(h) && !known.has(h)) {
      mismatches.push({ index: i, field: "未対応の会社負担の列", actual: h.slice(0, 40) });
    }
  });
  return { columns: mismatches.length === 0 ? columns : null, mismatches };
}

/** 必須見出しの照合。位置固定で読む列は位置の見出しを、会社負担の列は見出しの有無・重複を確認する。
 *  見出しは個人情報を含まないので actual をそのまま返してよい（先頭40文字まで） */
export function checkPayrollHeader(header: string[]): {
  ok: boolean;
  mismatches: HeaderMismatch[];
  columns: PayrollCompanyColumns | null;
} {
  const mismatches: HeaderMismatch[] = [];
  for (const e of PAYROLL_FIXED_HEADER_EXPECTATIONS) {
    const actual = normalizeHeaderCell(header[e.index]);
    if (!actual || !e.patterns.some((p) => p.test(actual))) {
      mismatches.push({ index: e.index, field: e.field, actual: actual.slice(0, 40) || "(列なし)" });
    }
  }
  const resolved = resolvePayrollCompanyColumns(header);
  mismatches.push(...resolved.mismatches);
  return { ok: mismatches.length === 0, mismatches, columns: resolved.columns };
}

export interface PayrollCompanyAmounts {
  healthInsuranceCo: number;
  careInsuranceCo: number;
  pensionCo: number;
  childContributionCo: number;
  pensionFundCo: number;
  employmentInsuranceCo: number;
  workersCompCo: number;
  generalContributionCo: number;
}

/** 1行から会社負担9項目を読む（純関数）。toNumber は route 側の safeFloat を渡す。
 *  子ども・子育て拠出金には支援金（2026年4月支給分〜）を足し込む。
 *  理由: DBのスキーマを変えずに、会社負担の法定福利費の合計が CSV と一致するようにするため。
 *  ★支援金を別項目にするか拠出金に含めるかの計上方法は、松尾さんに確認中（確定したらここを直す）。 */
export function readPayrollCompanyAmounts(
  row: string[],
  columns: PayrollCompanyColumns,
  toNumber: (v: string | undefined) => number,
): PayrollCompanyAmounts {
  const at = (key: PayrollCompanyKey) => {
    const idx = columns[key];
    return idx >= 0 && idx < row.length ? toNumber(row[idx]) : 0;
  };
  return {
    healthInsuranceCo: at("healthInsuranceCo"),
    careInsuranceCo: at("careInsuranceCo"),
    pensionCo: at("pensionCo"),
    childContributionCo: at("childContributionCo") + at("childSupportCo"),
    pensionFundCo: at("pensionFundCo"),
    employmentInsuranceCo: at("employmentInsuranceCo"),
    workersCompCo: at("workersCompCo"),
    generalContributionCo: at("generalContributionCo"),
  };
}

/** 契約種別がこれの行は業務用ダッシュボードに載せない（星崎さん決定 2026-10-23: 役員・本社は載せない）。
 *  ★要確認: 契約種別の実際の表記（「役員」以外に「取締役」等が無いか）。完全一致のみ除外。 */
export const PAYROLL_EXCLUDED_CONTRACT_TYPES: readonly string[] = ["役員"];

/** 従業員番号がこれ未満（社員番号ルール＝千の位で店舗が決まらない番号）で、マッピングも月別調整も
 *  店舗見出しも無い人は「本部」として除外する。★要確認: 閾値1000は千の位ルール（1xxx〜）の下限から置いた。
 *  1000以上でルールにもマッピングにも無い人は、従来どおり店舗未判定（取込停止）にする。 */
export const PAYROLL_HQ_EMPLOYEE_ID_MAX = 1000;

/** 店舗判定の前に呼ぶ: 役員なら除外 */
export function isExcludedContractType(contractType: string): boolean {
  const c = normalizeHeaderCell(contractType);
  return PAYROLL_EXCLUDED_CONTRACT_TYPES.some((t) => c === normalizeHeaderCell(t));
}

/** 店舗が決まらなかった行にだけ使う: 1000未満の番号なら本部として除外（数値でない番号は除外しない） */
export function isHeadquartersEmployeeId(employeeId: string): boolean {
  const s = employeeId.normalize("NFKC").trim();
  if (!/^\d+$/.test(s)) return false;
  return parseInt(s, 10) < PAYROLL_HQ_EMPLOYEE_ID_MAX;
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export interface PayrollIngestFacts {
  records: number;
  headerOk: boolean;
  nameConflictCount: number;
  unresolvedCount: number;
  /** 役員・本部として除外した人数（停止理由にはしない。応答に出すだけ） */
  excludedCount?: number;
  existingCount: number;
  previousCount: number;
}

/** 自動取込を止める理由（空なら投入してよい）。文言に氏名・金額は含めない */
export function payrollIngestBlockReasons(f: PayrollIngestFacts): string[] {
  const reasons: string[] = [];
  if (!f.headerOk) reasons.push("ヘッダ照合NG（列の並びが想定と違う）");
  if (f.records === 0) reasons.push("取込対象0件");
  if (f.nameConflictCount > 0) reasons.push(`氏名不一致 ${f.nameConflictCount}名（自動では上書きしない）`);
  if (f.unresolvedCount > 0) reasons.push(`店舗未判定の従業員 ${f.unresolvedCount}名`);
  if (f.existingCount > 0) reasons.push(`対象年月は取込済み（${f.existingCount}件）`);
  if (f.previousCount > 0 && f.records < f.previousCount * PAYROLL_MIN_RATIO_VS_PREVIOUS) {
    reasons.push(
      `件数が前月の${Math.round(PAYROLL_MIN_RATIO_VS_PREVIOUS * 100)}%未満（今回 ${f.records}件 / 前月 ${f.previousCount}件）`,
    );
  }
  return reasons;
}

// ─── 会社負担の列だけを CSV から取り直す（再取込の準備。DB は触らない純関数） ─────────────────────

export const PAYROLL_COMPANY_FIELDS = [
  "healthInsuranceCo",
  "careInsuranceCo",
  "pensionCo",
  "childContributionCo",
  "pensionFundCo",
  "employmentInsuranceCo",
  "workersCompCo",
  "generalContributionCo",
] as const;
export type PayrollCompanyField = (typeof PAYROLL_COMPANY_FIELDS)[number];

/** DB の payroll_data の1行（会社負担の補正に必要な列だけ。氏名は持たない） */
export interface ExistingPayrollRow extends PayrollCompanyAmounts {
  id: number;
  employeeId: string;
  ratio: number;
  baseSalary: number;
  grossTotal: number;
}

export interface CompanyColumnPlan {
  headerOk: boolean;
  mismatches: HeaderMismatch[];
  /** 更新する行（会社負担のどれかが変わる行だけ）。店舗・按分率・基本給・総支給は含めない */
  updates: Array<{ id: number; employeeId: string; values: PayrollCompanyAmounts }>;
  /** 項目別の差額（新 − 旧）。兼務の行は ratio/100 を掛けて合算（＝ダッシュボードの集計と同じ） */
  diffByField: Record<PayrollCompanyField, number>;
  changedEmployeesByField: Record<PayrollCompanyField, number>;
  diffTotal: number;
  changedEmployees: number;
  changedRows: number;
  dbRows: number;
  dbEmployees: number;
  /** DB にあるが CSV に見つからない従業員数（0 でないと適用してはいけない） */
  dbEmployeesMissingInCsv: number;
  /** DB 行の基本給・総支給が CSV と食い違う行数（月のずれ・別人を疑う。0 でないと適用してはいけない） */
  baseGrossMismatchRows: number;
  /** CSV の従業員番号が重複している数（どちらが正しいか決められない。0 でないと適用してはいけない） */
  duplicateCsvEmployees: number;
  /** CSV にだけいる従業員数（役員除く）。DB に行を足さない（役員・本部は店舗PL対象外）ので参考値 */
  csvOnlyEmployees: number;
  excludedCount: number;
  /** 適用を止める理由（空なら適用してよい）。氏名・金額は含めない */
  blockers: string[];
}

/** CSV（全行）と DB の既存行から、会社負担の補正計画を作る（純関数・DB 書き込みなし）。
 *  再取込（deleteMany→createMany）ではなく「会社負担8項目だけを行IDで更新」する前提の計画なので、
 *  店舗割当・按分率（兼務）・月別調整・基本給・総支給は構造的に変わらない。 */
export function planCompanyColumnCorrection(
  allRows: string[][],
  existing: ExistingPayrollRow[],
  toNumber: (v: string | undefined) => number,
): CompanyColumnPlan {
  const header = allRows[0] ?? [];
  const check = checkPayrollHeader(header);
  const zero = () => Object.fromEntries(PAYROLL_COMPANY_FIELDS.map((f) => [f, 0])) as Record<PayrollCompanyField, number>;
  const plan: CompanyColumnPlan = {
    headerOk: check.ok,
    mismatches: check.mismatches,
    updates: [],
    diffByField: zero(),
    changedEmployeesByField: zero(),
    diffTotal: 0,
    changedEmployees: 0,
    changedRows: 0,
    dbRows: existing.length,
    dbEmployees: new Set(existing.map((r) => r.employeeId)).size,
    dbEmployeesMissingInCsv: 0,
    baseGrossMismatchRows: 0,
    duplicateCsvEmployees: 0,
    csvOnlyEmployees: 0,
    excludedCount: 0,
    blockers: [],
  };
  if (!check.ok || !check.columns) {
    plan.blockers.push("ヘッダ照合NG（会社負担の列が見つからない・重複・未対応の列がある）");
    return plan;
  }

  const csv = new Map<string, { amounts: PayrollCompanyAmounts; base: number; gross: number }>();
  for (const row of allRows.slice(1)) {
    if (row.length < 10) continue;
    const id = (row[0] ?? "").trim();
    if (!id || id.startsWith("【")) continue;
    if ((row[1] ?? "").trim() === "-") continue;
    if (isExcludedContractType(row[5]?.trim() ?? "")) {
      plan.excludedCount++;
      continue;
    }
    if (csv.has(id)) {
      plan.duplicateCsvEmployees++;
      continue;
    }
    csv.set(id, {
      amounts: readPayrollCompanyAmounts(row, check.columns, toNumber),
      base: toNumber(row[27]),
      gross: toNumber(row[55]),
    });
  }

  const dbIds = new Set(existing.map((r) => r.employeeId));
  plan.csvOnlyEmployees = [...csv.keys()].filter((id) => !dbIds.has(id)).length;
  const missing = new Set<string>();
  const changedEmp = new Set<string>();
  const changedEmpByField = Object.fromEntries(PAYROLL_COMPANY_FIELDS.map((f) => [f, new Set<string>()])) as Record<PayrollCompanyField, Set<string>>;
  for (const r of existing) {
    const c = csv.get(r.employeeId);
    if (!c) {
      missing.add(r.employeeId);
      continue;
    }
    if (Math.abs(r.baseSalary - c.base) > 0.5 || Math.abs(r.grossTotal - c.gross) > 0.5) plan.baseGrossMismatchRows++;
    let changed = false;
    for (const f of PAYROLL_COMPANY_FIELDS) {
      const delta = c.amounts[f] - r[f];
      if (Math.abs(delta) > 0.5) {
        changed = true;
        plan.diffByField[f] += delta * (r.ratio / 100);
        changedEmpByField[f].add(r.employeeId);
      }
    }
    if (changed) {
      changedEmp.add(r.employeeId);
      plan.updates.push({ id: r.id, employeeId: r.employeeId, values: c.amounts });
    }
  }
  plan.dbEmployeesMissingInCsv = missing.size;
  plan.changedEmployees = changedEmp.size;
  plan.changedRows = plan.updates.length;
  for (const f of PAYROLL_COMPANY_FIELDS) {
    plan.changedEmployeesByField[f] = changedEmpByField[f].size;
    plan.diffTotal += plan.diffByField[f];
  }
  if (plan.dbEmployeesMissingInCsv > 0) plan.blockers.push(`DBにいてCSVに見つからない従業員 ${plan.dbEmployeesMissingInCsv}名（月のずれを疑う）`);
  if (plan.baseGrossMismatchRows > 0) plan.blockers.push(`基本給・総支給がCSVと食い違う行 ${plan.baseGrossMismatchRows}行（月のずれを疑う）`);
  if (plan.duplicateCsvEmployees > 0) plan.blockers.push(`CSVの従業員番号が重複 ${plan.duplicateCsvEmployees}件`);
  if (existing.length === 0) plan.blockers.push("対象月のDB行が0件");
  return plan;
}
