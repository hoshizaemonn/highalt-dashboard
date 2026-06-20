// 開業からの実績累計（PL）CSV のパーサ。
//
// クライアント（ハイアルチ）の「2026_9期 予算実績対比表（◯◯スタジオ）」xlsx の
// 「開業からの実績累計（PL）」シートを CSV にしたものを取り込む。
//
// CSV 構造（全店共通様式・単位は千円）:
//   [ラベル列][開業〜前期末までの月次...][前年(8期)12ヶ月][当年(9期)12ヶ月][累積]
//   - 月ヘッダー行に「累積」が含まれる。累積の手前12列＝当年、その手前12列＝前年。
//   - 当年ブロックの月ラベルは前年と同じ表記（1年ずれの誤表記）。位置で判定し、
//     前年ブロック先頭ラベルから基準年月を読み、当年＝前年+1年として補正する。
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

/**
 * パース済み CSV 行（parseCSV の戻り値）から PlActualRecord[] を生成する。
 * 解析できない場合は Error を投げる（呼び出し側で 400 を返す）。
 */
export function parsePlActuals(rows: string[][]): PlActualRecord[] {
  // 月ヘッダー行 = 「累積」を含む行
  const headerIdx = rows.findIndex((r) =>
    r.some((c) => String(c).trim() === "累積"),
  );
  if (headerIdx === -1) {
    throw new Error(
      "PL CSVの形式を認識できません（『累積』列が見つかりません）。『開業からの実績累計（PL）』シートのCSVか確認してください。",
    );
  }
  const header = rows[headerIdx];
  const ruiIdx = header.findIndex((c) => String(c).trim() === "累積");
  if (ruiIdx < 24) {
    throw new Error("PL CSVの列数が不足しています（前年・当年ブロックを抽出できません）。");
  }

  // 当年=累積の手前12列、前年=その手前12列
  const currentCols: number[] = [];
  for (let i = ruiIdx - 12; i < ruiIdx; i++) currentCols.push(i);
  const prevCols: number[] = [];
  for (let i = ruiIdx - 24; i < ruiIdx - 12; i++) prevCols.push(i);

  // 前年ブロック先頭ラベルから基準年月（例 "2024.10" / "2024,10" / "2024\n10"）を読む
  const firstPrevLabel = String(header[prevCols[0]]).replace(/\s/g, "");
  const m = firstPrevLabel.match(/(\d{4})[.,/](\d{1,2})/);
  if (!m) {
    throw new Error(
      `前年ブロックの年月ラベルを認識できません（取得値: "${header[prevCols[0]]}"）。`,
    );
  }
  const baseYear = parseInt(m[1], 10);
  const baseMonth = parseInt(m[2], 10);

  // offset ヶ月目（0=基準月）の (year, month)。addYear で年を足す（当年=+1）。
  const ymOf = (offset: number, addYear: number): [number, number] => {
    let mm = baseMonth + offset;
    const yy = baseYear + addYear + Math.floor((mm - 1) / 12);
    mm = ((mm - 1) % 12) + 1;
    return [yy, mm];
  };

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

  for (let i = 0; i < 12; i++) {
    const [py, pm] = ymOf(i, 0); // 前年
    const [cy, cm] = ymOf(i, 1); // 当年
    // 人件費
    push(py, pm, "人件費", sumAt(laborRows, prevCols[i]));
    push(cy, cm, "人件費", sumAt(laborRows, currentCols[i]));
    // 消耗品費
    if (shohinRow) {
      push(py, pm, "消耗品費", toNumber(shohinRow[prevCols[i]]));
      push(cy, cm, "消耗品費", toNumber(shohinRow[currentCols[i]]));
    }
    // 広告宣伝費
    if (adRow) {
      push(py, pm, "広告宣伝費", toNumber(adRow[prevCols[i]]));
      push(cy, cm, "広告宣伝費", toNumber(adRow[currentCols[i]]));
    }
  }

  // 全0月（未到来の当年後半など）は保存しない（前年比の分母/見栄えのため）
  return out.filter((r) => r.amount !== 0);
}

export const PL_CATEGORIES: PlActualRecord["category"][] = [
  "人件費",
  "消耗品費",
  "広告宣伝費",
];
