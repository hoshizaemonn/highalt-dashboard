// 会計年度（10月始まり・年度末年表記）と暦年の変換。
// 例: 年度 2027（10期 = 2026/10〜2027/9）の 10月 → 暦年 2026、3月 → 暦年 2027。
// 画面の年セレクタ（page.tsx の year）は「年度末年」であり、単月APIは暦年で保存されているため、
// 単月表示ではこの変換が必須（10〜12月は前年、1〜9月は同年）。

/** 年度末年と月から、その月の暦年を返す */
export function fiscalToCalendarYear(fiscalYear: number, month: number): number {
  return month >= 10 ? fiscalYear - 1 : fiscalYear;
}

/** 暦年と月から、その月が属する年度末年を返す（fiscalToCalendarYear の逆） */
export function calendarToFiscalYear(calendarYear: number, month: number): number {
  return month >= 10 ? calendarYear + 1 : calendarYear;
}
