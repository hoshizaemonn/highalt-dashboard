// 「会員数・収入算出」シート（予算スプレッドシート）から会員系KPI予算を抽出する。
//
// 松尾さん要望（2026-08）: 休会数予算・退会率予算を、予算「会員数・収入算出」シートの
// 「休会（未払い）」行と「退会率」行から取り込む。
//
// このシートは予算実績対比表とはレイアウトが異なる:
//   - 費目/指標ラベルが col[0] ではなく col[1] に入る（col[0] は空 or "FALSE"）
//   - 会員数ブロックの月ヘッダーは先頭に前年9月が付く: [空][9月][10月]…[9月][合計]
//     → FY(10月〜翌9月) の各月に「その月ラベルの列」を対応させれば先頭9月に釣られない
//   - 休会（未払い）は人数、退会率は "4%" のような百分率
//
// 取り込むのは休会数・退会率のみ（売上/経費は予算実績対比表側が正）。
// BudgetData.amount には千円換算せず生値（人数 / 百分率の整数）を入れる。
// annual/route.ts が budget「休会数」→budget_suspensions、「退会率」→budget_cancellation_rate
// (例: 8 = 8%) としてそのまま消費する。

export const MEMBER_KPI_BUDGET_CATEGORIES = ["休会数", "退会率"] as const;

export interface MemberKpiBudgetRecord {
  storeName: string;
  year: number;
  month: number;
  category: string;
  amount: number;
}

const MONTH_LABELS_IN_ORDER = [
  "10月", "11月", "12月", "1月", "2月", "3月",
  "4月", "5月", "6月", "7月", "8月", "9月",
];

const norm = (s: unknown) => String(s ?? "").replace(/\s/g, "");

/** このCSVが「会員数・収入算出」シートか判定（在籍数＋退会率＋「休会」かつ「未払」で識別）。
 *  カッコ種別（全角/半角）や「い」の有無・閉じカッコ欠けに左右されないよう部分一致で判定する。 */
export function isMemberIncomeSheet(text: string): boolean {
  const t = norm(text);
  return (
    t.includes("在籍数") &&
    t.includes("退会率") &&
    t.includes("休会") &&
    t.includes("未払")
  );
}

/**
 * 行内の月ラベルを FY順(10月〜翌9月)で左から順に列に割り当てる。
 * 先頭に前年9月がある会員数ブロックでも、10月を起点に順送りするので釣られない。
 * 返り値 cols[i] = MONTH_LABELS_IN_ORDER[i] の列番号（無ければ undefined）。
 */
function mapMonthCols(row: string[]): (number | undefined)[] {
  const cols: (number | undefined)[] = new Array(12).fill(undefined);
  let lastCol = -1;
  for (let i = 0; i < 12; i++) {
    const label = MONTH_LABELS_IN_ORDER[i];
    for (let ci = lastCol + 1; ci < row.length; ci++) {
      if (norm(row[ci]) === label) {
        cols[i] = ci;
        lastCol = ci;
        break;
      }
    }
  }
  return cols;
}

/** 指定行より上で最も近い「月ヘッダー行（10月〜9月が10個以上並ぶ）」の列マップを返す */
function findMonthHeaderAbove(
  rows: string[][],
  fromIdx: number,
): (number | undefined)[] | null {
  for (let r = fromIdx; r >= 0; r--) {
    const cols = mapMonthCols(rows[r]);
    if (cols.filter((c) => c !== undefined).length >= 10) return cols;
  }
  return null;
}

/** 行の指定列以外から見出しラベル（col[0]優先、無ければcol[1]）を取り出す */
function rowLabel(row: string[]): string {
  const a = norm(row[0]);
  if (a) return a;
  return norm(row[1]);
}

function parseCount(cell: unknown): number | null {
  const s = String(cell ?? "").replace(/[,"\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function parseRate(cell: unknown): number | null {
  const s = String(cell ?? "").replace(/[,"\s%％]/g, "");
  if (s === "" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n);
}

/**
 * 会員数・収入算出シートから 休会数(=休会（未払い）) と 退会率 の月次予算を抽出する。
 * fiscalYear=2026 のとき 10〜12月は2025年、1〜9月は2026年。
 */
export function extractMemberKpiBudget(
  rows: string[][],
  store: string,
  fiscalYear: number,
): MemberKpiBudgetRecord[] {
  const records: MemberKpiBudgetRecord[] = [];

  // FY月 → (year, month)
  const fyMonths: { year: number; month: number }[] = [];
  for (let m = 10; m <= 12; m++) fyMonths.push({ year: fiscalYear - 1, month: m });
  for (let m = 1; m <= 9; m++) fyMonths.push({ year: fiscalYear, month: m });

  const targets: { category: string; match: (l: string) => boolean; kind: "count" | "rate" }[] = [
    { category: "休会数", match: (l) => l.includes("休会") && l.includes("未払"), kind: "count" },
    { category: "退会率", match: (l) => l === "退会率", kind: "rate" },
  ];

  const seen = new Set<string>();
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!row || row.length === 0) continue;
    const label = rowLabel(row);
    if (!label) continue;

    const target = targets.find((t) => t.match(label));
    if (!target || seen.has(target.category)) continue;

    const header = findMonthHeaderAbove(rows, ri);
    if (!header) continue;
    seen.add(target.category);

    for (let i = 0; i < 12; i++) {
      const col = header[i];
      if (col === undefined || col >= row.length) continue;
      const val =
        target.kind === "count" ? parseCount(row[col]) : parseRate(row[col]);
      if (val === null) continue;
      records.push({
        storeName: store,
        year: fyMonths[i].year,
        month: fyMonths[i].month,
        category: target.category,
        amount: val,
      });
    }
  }

  return records;
}
