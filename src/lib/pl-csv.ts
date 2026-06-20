// 開業からの実績累計（PL）CSV のパーサ。
//
// クライアント（ハイアルチ）の「2026_9期 予算実績対比表（◯◯スタジオ）」xlsx の
// 「開業からの実績累計（PL）」シートを CSV にしたものを取り込む。
//
// CSV 構造（店舗の開業時期で列範囲が異なるが行様式は共通・単位は千円）:
//   [ラベル列][月次ヘッダー...][累積 or 実績累計]
//   - 月ヘッダー行は最後に合計列「累積」または「実績累計」を持つ。
//   - 月ラベルは原則そのまま (例 "2025.10") だが、一部店舗（東日本橋・春日）は
//     末尾に当年(9期)を「前年と同じ年表記」で複製した誤ラベル列が付く。
//     → 同じ(年,月)が2回出たら2回目以降を「当年＝+1年」として補正する。
//   - 月ごとに(年,月)→列を確定し、直近24ヶ月（前年+当年）を採用する。
//   - 前年比は取込後に (year) vs (year-1) で比較する（このパーサは年月をそのまま保存）。
//
// 抽出費目（坪井さん要望の前年比比較3費目）:
//   - 人件費 = 正社員・契約社員給与 + 賞与(8期は契約社員給与) + 通勤手当 + 法定福利費
//   - 消耗品費
//   - 広告宣伝費
//
// 金額は CSV が千円表記なので ×1000 して「円」で返す。

export interface PlActualRecord {
  year: number;
  month: number;
  category: "人件費" | "消耗品費" | "広告宣伝費";
  amount: number; // 円
}

/** "1,234" / "(516)" / "" / "12.3%" などを数値化（負号・カンマ・括弧・%に対応）。 */
function toNumber(s: string | undefined): number {
  if (s == null) return 0;
  let t = String(s).trim();
  if (!t) return 0;
  const negative = /^\(.*\)$/.test(t);
  t = t.replace(/[(),%]/g, "").replace(/,/g, "").trim();
  const n = parseFloat(t);
  if (isNaN(n)) return 0;
  return negative ? -n : n;
}

function findRow(
  rows: string[][],
  pred: (label: string) => boolean,
): string[] | undefined {
  return rows.find((r) => r[0] != null && pred(String(r[0]).trim()));
}

const TOTAL_RE = /^(実績)?累[積計]$/; // 「累積」「実績累計」など合計列のラベル
const MONTH_RE = /^(\d{4})[.,/](\d{1,2})$/; // "2025.10" / "2024,12" 等

/**
 * パース済み CSV 行（parseCSV の戻り値）から PlActualRecord[] を生成する。
 * 解析できない場合は Error を投げる（呼び出し側で 400 を返す）。
 */
export function parsePlActuals(rows: string[][]): PlActualRecord[] {
  // 月ヘッダー行 = 合計列ラベル（累積/実績累計）を含む行
  const headerIdx = rows.findIndex((r) =>
    r.some((c) => TOTAL_RE.test(String(c).trim())),
  );
  if (headerIdx === -1) {
    throw new Error(
      "PL CSVの形式を認識できません（合計列『累積』『実績累計』が見つかりません）。『開業からの実績累計（PL）』シートのCSVか確認してください。",
    );
  }
  const header = rows[headerIdx];
  const totalIdx = header.findIndex((c) => TOTAL_RE.test(String(c).trim()));

  // 月ラベル列を収集（ラベル列=0 を除く、合計列の手前まで）
  const monthCols: { col: number; year: number; month: number }[] = [];
  for (let i = 1; i < totalIdx; i++) {
    const label = String(header[i]).replace(/\s/g, "");
    const m = label.match(MONTH_RE);
    if (m) {
      monthCols.push({ col: i, year: parseInt(m[1], 10), month: parseInt(m[2], 10) });
    }
  }
  if (monthCols.length === 0) {
    throw new Error("PL CSVに月次ヘッダー（例: 2025.10）が見つかりません。");
  }

  // 重複ラベル補正: 同じ(年,月)が2回目以降に出たら誤ラベルの当年ブロック → +1年
  // （東日本橋・春日: 末尾に当年を前年表記で複製している）
  const seen = new Set<string>();
  for (const mc of monthCols) {
    let key = `${mc.year}-${mc.month}`;
    if (seen.has(key)) {
      mc.year += 1;
      key = `${mc.year}-${mc.month}`;
    }
    seen.add(key);
  }

  // (年,月) → 列（補正後に重複が残る場合は後勝ち）。直近24ヶ月（前年+当年）を採用。
  const byYm = new Map<string, number>();
  for (const mc of monthCols) byYm.set(`${mc.year}-${mc.month}`, mc.col);
  const yms = Array.from(byYm.entries())
    .map(([k, col]) => {
      const [y, m] = k.split("-").map(Number);
      return { year: y, month: m, col };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-24);

  // 費目の行を特定
  const laborRows = [
    findRow(rows, (s) => s.startsWith("正社員")),
    findRow(rows, (s) => s.startsWith("賞")), // 賞与(9期) / 契約社員給与(8期)
    findRow(rows, (s) => s.startsWith("通勤手当")),
    findRow(rows, (s) => s.startsWith("法定福利")),
  ].filter((r): r is string[] => Boolean(r));
  const shohinRow = findRow(rows, (s) => s.startsWith("消耗品費"));
  const adRow = findRow(rows, (s) => s.startsWith("広告宣伝費"));

  const sumAt = (rws: string[][], col: number): number =>
    rws.reduce((acc, r) => acc + toNumber(r[col]), 0);

  const out: PlActualRecord[] = [];
  const push = (
    year: number,
    month: number,
    category: PlActualRecord["category"],
    sen: number,
  ) => {
    out.push({ year, month, category, amount: Math.round(sen * 1000) });
  };

  for (const { year, month, col } of yms) {
    push(year, month, "人件費", sumAt(laborRows, col));
    if (shohinRow) push(year, month, "消耗品費", toNumber(shohinRow[col]));
    if (adRow) push(year, month, "広告宣伝費", toNumber(adRow[col]));
  }

  // 0円は保存しない（未到来月・未発生費目）
  return out.filter((r) => r.amount !== 0);
}

export const PL_CATEGORIES: PlActualRecord["category"][] = [
  "人件費",
  "消耗品費",
  "広告宣伝費",
];
