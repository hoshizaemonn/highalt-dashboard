/**
 * 体験シートの「日付」列の取り違えを直す（2026-10-03 発覚）。
 *
 * 祖師ヶ谷大蔵・中目黒などは、見出し「日付」が連番列と日付列の2列にまたがる結合セルになっている。
 * CSVにすると見出し「日付」は左端（連番 1,2,3…）の上にだけ残り、本物の日付は右隣の見出しが空の列に入る。
 * 列名の検出が左端を拾うと、entry_date に連番が入ってしまう（2026年9月の本番データで確認）。
 *
 * 「日付列の中身がほぼ連番の整数」かつ「右隣の見出しが空で中身が日付らしい」ときだけ、右隣へ移す。
 * 迷うとき（どちらも日付らしい／連番でない）は動かさない。
 */

const DATE_LIKE = /^\d{1,4}[\/-]\d{1,2}([\/-]\d{1,2})?$/;
const SERIAL_LIKE = /^\d{1,3}$/;

function sample(rows: string[][], headerIdx: number, col: number, max = 10): string[] {
  const out: string[] = [];
  for (let i = headerIdx + 1; i < rows.length && out.length < max; i++) {
    const v = (rows[i]?.[col] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

export function fixSerialDateColumn(
  rows: string[][],
  headerIdx: number,
  dateIdx: number,
): { index: number; moved: boolean } {
  const header = rows[headerIdx] ?? [];
  const nextIdx = dateIdx + 1;
  if (dateIdx < 0 || nextIdx >= header.length) return { index: dateIdx, moved: false };
  const nextHead = (header[nextIdx] ?? "").replace(/[　\s]/g, "");
  if (nextHead !== "" && nextHead !== "日付") return { index: dateIdx, moved: false };

  const cur = sample(rows, headerIdx, dateIdx);
  const nxt = sample(rows, headerIdx, nextIdx);
  if (cur.length < 3 || nxt.length < 3) return { index: dateIdx, moved: false };
  const serialRate = cur.filter((v) => SERIAL_LIKE.test(v)).length / cur.length;
  const nextDateRate = nxt.filter((v) => DATE_LIKE.test(v)).length / nxt.length;
  if (serialRate >= 0.8 && nextDateRate >= 0.5) return { index: nextIdx, moved: true };
  return { index: dateIdx, moved: false };
}
