// 「損益計算書」シート（予算実績対比表.xlsx 内）のパーサ。
//
// クライアント（ハイアルチ）の「2026_9期 予算実績対比表（◯◯スタジオ）」xlsx の
// 「損益計算書」シートをCSVにしたものを取り込む。全費目の実績が入っている。
// （松尾さん指定: 予算書ではなく損益計算書の数値を経費の正とする・2026-07）
//
// CSV構造（7店舗すべてで様式が同一であることを検証済み）:
//   1行目: [「2026/9期　　損益計算書」][店舗名(例: 東日本橋スタジオ)] ... [単位：千円]
//   3行目: [空][10月][11月]…[9月][合計]   ← 会計年度は10月始まり
//   以降 : [費目ラベル][各月の金額...][合計]
//
// 金額は千円表記のため ×1000 して「円」で返す。
// 人件費（正社員・契約社員給与/賞与/通勤手当/法定福利費）は給与データを正とするため
// 取り込み対象外（PL_COST_CATEGORIES に含めない）。

import { STORES } from "@/lib/constants";

/** 取込対象の経費費目（損益計算書の実ラベルと一致させること）。
 *  人件費系（正社員・契約社員給与/賞  与/通勤手当/法定福利費）は給与データを正とするため除外。 */
export const PL_COST_CATEGORIES = [
  "広告宣伝費",
  "福利厚生費",
  "修繕費",
  "減価償却費",
  "賃借料",
  "消耗品費",
  "備品費",
  "電気料",
  "上下水道料",
  "通信費",
  "研修費",
  "支払手数料",
  "リース料",
  "委託料",
  "保険料",
  "接待交際費",
  "開発費償却",
  "租税公課",
] as const;

export interface PlStatementRecord {
  storeName: string;
  year: number;
  month: number;
  category: string;
  amount: number; // 円
}

export interface PlStatementResult {
  storeName: string;
  fiscalYear: number;
  records: PlStatementRecord[];
}

const norm = (s: unknown) => String(s ?? "").replace(/\s/g, "");

/** "1,234" / "(516)" / "" / "#DIV/0!" などを数値化（負号・カンマ・括弧に対応） */
function toNumber(s: unknown): number {
  if (s == null) return 0;
  let t = String(s).trim();
  if (!t || t.startsWith("#")) return 0; // #DIV/0! 等
  const negative = /^\(.*\)$/.test(t);
  t = t.replace(/[(),]/g, "").replace(/[¥￥]/g, "").trim();
  const n = parseFloat(t);
  if (isNaN(n)) return 0;
  return negative ? -n : n;
}

/** 1行目の店舗名セル（例: 「東日本橋スタジオ」）から STORES を解決する */
function resolveStoreFromTitle(rows: string[][]): string | null {
  const first = rows[0] ?? [];
  // 1行目のどのセルに入っていても拾えるように全セルを走査する
  for (const cell of first) {
    const s = norm(cell);
    if (!s) continue;
    for (const st of STORES) {
      if (s.includes(st)) return st;
    }
  }
  return null;
}

/** 「2026/9期」から会計年度(2026)を取り出す */
function resolveFiscalYear(rows: string[][]): number | null {
  const first = norm((rows[0] ?? [])[0]);
  const m = first.match(/(\d{4})\/(\d{1,2})期/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * 損益計算書CSV（parseCSV済みの2次元配列）から経費実績を抽出する。
 * 解析できない場合は Error を投げる（呼び出し側で400を返す）。
 */
export function parsePlStatement(rows: string[][]): PlStatementResult {
  if (!rows.length) throw new Error("ファイルが空です。");

  const title = norm((rows[0] ?? [])[0]);
  if (!title.includes("損益計算書")) {
    throw new Error(
      "「損益計算書」シートではないようです（1行目に『損益計算書』が見つかりません）。予算実績対比表xlsxの『損益計算書』タブをCSVにして取り込んでください。",
    );
  }

  const storeName = resolveStoreFromTitle(rows);
  if (!storeName) {
    throw new Error(
      "1行目から店舗名を判定できませんでした（例: 東日本橋スタジオ）。正しいファイルか確認してください。",
    );
  }

  const fiscalYear = resolveFiscalYear(rows);
  if (!fiscalYear) {
    throw new Error(
      "1行目から会計年度を判定できませんでした（例: 2026/9期）。正しいファイルか確認してください。",
    );
  }

  // 月ヘッダー行（「10月」を含む行）を探す
  const headerIdx = rows.findIndex((r) => r.some((c) => norm(c) === "10月"));
  if (headerIdx < 0) {
    throw new Error("月ヘッダー行（10月〜9月）が見つかりません。");
  }
  const header = rows[headerIdx];

  // 月ラベル列 → (年, 月)。10〜12月は前年、1〜9月は当年（9期=2025/10〜2026/9）
  const monthCols: Array<{ col: number; year: number; month: number }> = [];
  for (let i = 0; i < header.length; i++) {
    const m = norm(header[i]).match(/^(\d{1,2})月$/);
    if (!m) continue;
    const month = parseInt(m[1], 10);
    if (month < 1 || month > 12) continue;
    const year = month >= 10 ? fiscalYear - 1 : fiscalYear;
    monthCols.push({ col: i, year, month });
  }
  if (monthCols.length === 0) {
    throw new Error("月次ヘッダー（例: 10月）が見つかりません。");
  }

  const targets = new Set<string>(PL_COST_CATEGORIES.map((c) => norm(c)));
  const records: PlStatementRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row || !row.length) continue;
    const label = norm(row[0]);
    if (!label || !targets.has(label)) continue;
    // 同じ費目が複数行ある場合は最初の1行のみ採用（合計行の重複取込を防ぐ）
    if (seen.has(label)) continue;
    seen.add(label);

    // 表示用の正式ラベル（PL_COST_CATEGORIES 側の表記に寄せる）
    const category =
      PL_COST_CATEGORIES.find((c) => norm(c) === label) ?? String(row[0]).trim();

    for (const { col, year, month } of monthCols) {
      const sen = toNumber(row[col]);
      if (sen === 0) continue; // 0円は保存しない（未到来月・未発生費目）
      records.push({
        storeName,
        year,
        month,
        category,
        amount: Math.round(sen * 1000),
      });
    }
  }

  if (records.length === 0) {
    throw new Error(
      "取り込める費目が見つかりませんでした。『損益計算書』タブのCSVか確認してください。",
    );
  }

  return { storeName, fiscalYear, records };
}
