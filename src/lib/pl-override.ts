// クライアント公式PL（損益計算書 = pl_actuals）を「経費の正」として
// ダッシュボードに反映する範囲の定義。
//
// 経緯（松尾さん決定 2026-07-17）:
//   - 〜2026年4月 : ダッシュボード運用開始前の期間。経費はスプレッドシートの
//                   損益計算書の数値を正とする（PayPay自動仕分けより信頼できるため）。
//   - 2026年5月〜 : ダッシュボードの運用が開始しているため、損益計算書は反映しない。
//                   ダッシュボードに取り込んだ実データ（PayPay/Amazon/手数料等）を正とする。
//
// なお pl_actuals には5月以降のデータも保存する（前年比比較で使うため）。
// 「経費への反映」だけをこのカットオフで打ち切る。
//
// 例外（松尾さん・星崎さん決定 2026-09-24）:
//   減価償却費・開発費償却は非資金支出（現金の出入りが無い会計処理）のため、
//   PayPay銀行/Amazon等の実データに絶対に現れず、カットオフ以降も他に
//   データ源が無い。この2費目だけはカットオフを無視して常時 pl_actuals を
//   反映する（PL_ALWAYS_CATEGORIES）。5月以降も遡及反映する。

import { PL_COST_CATEGORIES } from "@/lib/pl-statement-parse";

/** 損益計算書を経費に反映する最終月（この月まで反映し、翌月以降は反映しない）。 */
export const PL_OVERRIDE_UNTIL = { year: 2026, month: 4 } as const;

/**
 * カットオフを無視して常時 pl_actuals を反映する費目。
 * 非資金支出（減価償却費・開発費償却）で、他に実データの取得元が無いため。
 */
export const PL_ALWAYS_CATEGORIES: readonly string[] = [
  "減価償却費",
  "開発費償却",
];

/** 経費の上書き対象となる費目（人件費は給与データを正とするため含まない）。
 *  PL_ALWAYS_CATEGORIES はカットオフ判定と別ロジックで常時反映するため、
 *  ここからは除外する（重複反映を避ける）。 */
export const PL_OVERRIDE_CATEGORIES: readonly string[] = PL_COST_CATEGORIES.filter(
  (c) => !PL_ALWAYS_CATEGORIES.includes(c),
);

const toKey = (year: number, month: number) => year * 12 + month;
const CUTOFF_KEY = toKey(PL_OVERRIDE_UNTIL.year, PL_OVERRIDE_UNTIL.month);

/** 指定年月が「損益計算書を経費に反映する」対象かどうか。 */
export function isPlOverrideMonth(year: number, month: number): boolean {
  return toKey(year, month) <= CUTOFF_KEY;
}

/** 反映対象の (年,月) だけに絞る Prisma where 条件（OR配列）を作る。 */
export function plOverridePeriods(
  periods: Array<{ year: number; month: number }>,
): Array<{ year: number; month: number }> {
  return periods.filter((p) => isPlOverrideMonth(p.year, p.month));
}
