/**
 * 人件費（クラウド給与の支給控除一覧表 CSV）の自動取込（取込専用ロール ingest）用の安全ガード。
 *
 * 取込API（/api/upload/payroll）は CSV を「列の位置」で読む。クラウド給与側で列が増減すると
 * 別の列（例: 標準報酬月額）を健康保険料として黙って取り込んでしまう（2026-06-06 に実際に発生）。
 * 自動取込では人の目が入らないため、次の場合は書き込まずに止める:
 *   1. ヘッダ照合: 読み取りに使う列位置の見出しが想定と違う
 *   2. 氏名の不一致: 既存データと同じ従業員番号で氏名が違う（強制上書きしない）
 *   3. 未登録従業員: 店舗を判定できない従業員がいる（取りこぼしを防ぐ）
 *   4. 件数の急減: 前月の件数の 8 割未満（エクスポート条件の誤り・途中切れを疑う）
 *   5. 取込済み: 対象年月に既にデータがある（自動取込は上書きしない。上書きは画面から人が行う）
 *
 * ここは純粋関数だけ（DB・個人情報に触れない）。戻り値に氏名は含めない。
 */

/** 読み取りに使う列位置と、その列の見出しとして許す表記（正規化後に部分一致）。
 *  ★見出しの実際の文言はクラウド給与の実ファイルで要確認（2026-10 時点では推測を含む）。
 *    表記違いで止まった場合は、ここに表記を足す（列位置は route.ts と必ず一致させる）。 */
export const PAYROLL_HEADER_EXPECTATIONS: ReadonlyArray<{ index: number; field: string; patterns: RegExp[] }> = [
  { index: 0, field: "従業員番号", patterns: [/従業員(番号|コード|No)/i, /社員(番号|コード)/] },
  { index: 1, field: "氏名", patterns: [/氏名/, /名前/, /従業員名/] },
  { index: 27, field: "基本給", patterns: [/基本給/] },
  { index: 51, field: "課税支給合計", patterns: [/課税.*(支給)?合計/, /課税支給/] },
  { index: 55, field: "総支給額", patterns: [/総支給/, /支給合計/] },
  { index: 88, field: "標準報酬月額（健保）", patterns: [/標準報酬/] },
  { index: 89, field: "標準報酬月額（厚生年金）", patterns: [/標準報酬/] },
  { index: 90, field: "健康保険料（会社負担）", patterns: [/健康保険/] },
  { index: 91, field: "介護保険料（会社負担）", patterns: [/介護保険/] },
  { index: 92, field: "子ども子育て拠出金（会社負担）", patterns: [/子ども|子育て|児童手当/] },
  { index: 93, field: "厚生年金保険料（会社負担）", patterns: [/厚生年金/] },
  { index: 94, field: "雇用保険料（会社負担）", patterns: [/雇用保険/] },
  { index: 95, field: "労災保険料（会社負担）", patterns: [/労災/] },
  { index: 96, field: "一般拠出金（会社負担）", patterns: [/一般拠出/] },
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
  index: number;
  field: string;
  actual: string;
}

/** 列位置の見出し照合。見出しは個人情報を含まないので actual をそのまま返してよい（先頭40文字まで） */
export function checkPayrollHeader(header: string[]): { ok: boolean; mismatches: HeaderMismatch[] } {
  const mismatches: HeaderMismatch[] = [];
  for (const e of PAYROLL_HEADER_EXPECTATIONS) {
    const actual = normalizeHeaderCell(header[e.index]);
    if (!actual || !e.patterns.some((p) => p.test(actual))) {
      mismatches.push({ index: e.index, field: e.field, actual: actual.slice(0, 40) || "(列なし)" });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export interface PayrollIngestFacts {
  records: number;
  headerOk: boolean;
  nameConflictCount: number;
  unresolvedCount: number;
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
