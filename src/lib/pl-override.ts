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

import { PL_COST_CATEGORIES } from "@/lib/pl-statement-parse";

/** 損益計算書を経費に反映する最終月（この月まで反映し、翌月以降は反映しない）。 */
export const PL_OVERRIDE_UNTIL = { year: 2026, month: 4 } as const;

/** 経費の上書き対象となる費目（人件費は給与データを正とするため含まない）。 */
export const PL_OVERRIDE_CATEGORIES: readonly string[] = PL_COST_CATEGORIES;

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
