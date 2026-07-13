// 発生主義の帰属月パース（アンビルさん依頼⑥・A案）
//
// 内訳テキストに含まれる「N月」「N月分」「N月◯◯費」の月表記から
// 発生月を判定する。決済月との関係から年も自動推定する：
//   - N <= 決済月: 同年（例：5月決済の「4月分」→ 同年4月）
//   - N >  決済月: 前年（例：1月決済の「12月分」→ 前年12月）
//   - N == 決済月: シフトなし（=null返却）
//
// 対象パターン（誤検知抑制しつつ、実際の記入表現を広く拾う）:
//   1) 計上意図キーワード付き「N月分 / N月度 / N月計上 / N月経費 / N月に計上」
//      → 「請求書5月発行につき5月経費に計上」のような文中表記も帰属月として認識する
//        （松尾さん依頼: 全勘定科目で計上月を操作できるように・2026-07）
//   2) フォールバック: 文字列の先頭または区切り後の「N月」（従来の厳密マッチ）
//   - 数値 N は 1〜12 の範囲
//   - 「2026/4」「R7.4」などの日付風表記はパース対象外（月サフィックス無しのため）

// 計上意図キーワードを伴う「N月◯」。前後の文脈を問わず拾う。
const INTENT_PATTERN = /([1-9]|1[0-2])月\s*(?:分|度|計上|経費|に計上)/;
// 従来の厳密マッチ（先頭 or 区切り直後の「N月」）
const DELIM_PATTERN = /(?:^|[\s　、,;:：（(【「『])([1-9]|1[0-2])月/;

export interface AccrualResult {
  /** 帰属年（決済年からの相対調整後） */
  accrualYear: number;
  /** 帰属月 1-12 */
  accrualMonth: number;
}

/**
 * 内訳テキストを解析して発生月の帰属年月を返す。
 * パターン未マッチ／決済月と同じなら null を返す（=シフト不要）。
 */
export function parseAccrualMonth(
  breakdown: string | null | undefined,
  paymentYear: number,
  paymentMonth: number,
): AccrualResult | null {
  if (!breakdown) return null;
  const text = breakdown.trim();
  if (!text) return null;

  // 計上意図キーワード付きを優先、無ければ従来の区切りマッチにフォールバック
  const m = text.match(INTENT_PATTERN) ?? text.match(DELIM_PATTERN);
  if (!m) return null;

  const parsedMonth = parseInt(m[1], 10);
  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    return null;
  }

  if (parsedMonth === paymentMonth) {
    // 帰属月と決済月が一致 → シフト不要
    return null;
  }

  const accrualYear =
    parsedMonth > paymentMonth ? paymentYear - 1 : paymentYear;

  return { accrualYear, accrualMonth: parsedMonth };
}

/**
 * ExpenseData の実効年月を返す（accrualYear/Month があればそれ、無ければ決済年月）。
 * 集計フィルタは全てこの関数経由にすることで accrual の有無を意識せず処理できる。
 */
export function getEffectiveYearMonth(row: {
  year: number;
  month: number;
  accrualYear?: number | null;
  accrualMonth?: number | null;
}): { year: number; month: number } {
  return {
    year: row.accrualYear ?? row.year,
    month: row.accrualMonth ?? row.month,
  };
}
