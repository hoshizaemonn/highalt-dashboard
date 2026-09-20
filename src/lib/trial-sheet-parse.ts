/**
 * 体験シート（各店舗運用の Google スプレッドシート → CSV エクスポート）のパーサー。
 *
 * 背景（山本様要望 2026-09-20）:
 *   hacomono の会員エクスポート(ML001)は「最終的に入会した人」しか含まれないため、
 *   体験者数・入会率の分母が構造的に不正確（体験して入会しなかった人が漏れる）。
 *   各店舗の体験シートを正本として取り込み、1体験者=1行で保存する。
 *
 * フォーマット:
 *   ① 6店舗共通フォーマット（東日本橋・春日・巣鴨・祖師ヶ谷大蔵・下北沢・中目黒）
 *      列: 日付 / 氏名 / 即日入会 / 後日入会 / 入会しない（＋任意の付随列）
 *      実物確認（2026-09-20、Google Drive「体験会情報」シート）:
 *        No | 日付 | 氏名 | 即日入会 | コース | 後日入会 | 入会しない | 検討 | ... |
 *      即日入会/後日入会/入会しない の各列は「〇」等のマークで結果を表す。
 *      いずれのマークも無い行（検討中・記入待ち）は「検討中」として体験者数には
 *      カウントするが、入会/非入会のどちらにも数えない。
 *
 *   ② 船橋専用フォーマット（B案・星崎さん決定 2026-09-20）
 *      列: 日付 / 氏名 / 即日 / 後日 のみで「入会しない」に相当する列が無い。
 *      → 即日 or 後日にマークがあれば入会、どちらも無ければ「入会しない」とみなす
 *        （＝船橋シートには「検討中」の概念を別途持たないという運用前提。
 *          実物のシートは未確認のため、想定と異なる場合は要修正）。
 *
 * 列名は完全一致→部分一致（trim・全角スペース除去後）の順でゆらぎに対応する。
 */

export type TrialResultType =
  | "即日入会"
  | "後日入会"
  | "入会しない"
  | "検討中";

export interface TrialSheetRecord {
  storeName: string;
  year: number;
  month: number;
  entryDate: string | null;
  memberName: string | null;
  resultType: TrialResultType;
}

export interface TrialSheetParseResult {
  records: TrialSheetRecord[];
  warnings: string[];
}

/** 全角スペース・前後空白を除去して比較用に正規化する */
function norm(s: string): string {
  return s.replace(/[　\s]/g, "").trim();
}

/** header配列から、候補キーワードのいずれかを含む列のindexを探す（完全一致優先） */
function findColumnIndex(header: string[], candidates: string[]): number {
  const normalizedHeader = header.map((h) => norm(h));
  // 完全一致
  for (const cand of candidates) {
    const idx = normalizedHeader.indexOf(norm(cand));
    if (idx !== -1) return idx;
  }
  // 部分一致（例: "検討期限 後日CP適用制度〆切日選択" に "後日" を含むなど、
  // 誤検出しやすい列は candidates の書き方側で対策する）
  for (const cand of candidates) {
    const idx = normalizedHeader.findIndex((h) => h.includes(norm(cand)));
    if (idx !== -1) return idx;
  }
  return -1;
}

/** セルにマーク（〇・○・レ・TRUE等）が入っているかどうか */
function isMarked(cell: string | undefined): boolean {
  if (!cell) return false;
  const v = cell.trim();
  if (v === "") return false;
  if (v === "FALSE" || v === "false" || v === "0" || v === "-") return false;
  return true;
}

/**
 * 体験シートのヘッダー行を探す。
 * 実シートは先頭に「今月の目標入会数」等のタイトル行があるため、
 * 「日付」「氏名」を含む行をヘッダーとして探索する。
 */
function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const normalized = rows[i].map((c) => norm(c));
    if (normalized.some((c) => c === "日付") && normalized.some((c) => c === "氏名" || c === "名前")) {
      return i;
    }
  }
  return -1;
}

interface ColumnMap {
  date: number;
  name: number;
  immediate: number;
  later: number;
  noJoin: number; // -1 なら該当列なし（船橋パターン）
}

function buildColumnMap(header: string[]): ColumnMap {
  return {
    date: findColumnIndex(header, ["日付"]),
    name: findColumnIndex(header, ["氏名", "名前", "お名前"]),
    immediate: findColumnIndex(header, ["即日入会", "即日"]),
    later: findColumnIndex(header, ["後日入会", "後日"]),
    noJoin: findColumnIndex(header, ["入会しない", "非入会", "見送り"]),
  };
}

function classifyCommon(row: string[], cols: ColumnMap): TrialResultType {
  if (isMarked(row[cols.immediate])) return "即日入会";
  if (isMarked(row[cols.later])) return "後日入会";
  if (cols.noJoin !== -1 && isMarked(row[cols.noJoin])) return "入会しない";
  return "検討中";
}

/**
 * 船橋専用（B案）: 「入会しない」列が無いため、即日/後日どちらのマークも無ければ
 * 「入会しない」とみなす（＝検討中という中間状態を持たない前提）。
 */
function classifyFunabashi(row: string[], cols: ColumnMap): TrialResultType {
  if (isMarked(row[cols.immediate])) return "即日入会";
  if (isMarked(row[cols.later])) return "後日入会";
  return "入会しない";
}

/**
 * 体験シートCSVをパースする。
 * @param allRows parseCSV() の結果（デコード・CSVパース済みの2次元配列）
 * @param storeName 取込先店舗名
 * @param year 対象年（UIで選択）
 * @param month 対象月（UIで選択）
 * @param isFunabashi 船橋専用フォーマット（B案）で解釈するかどうか
 */
export function parseTrialSheetCsv(
  allRows: string[][],
  storeName: string,
  year: number,
  month: number,
  isFunabashi: boolean,
): TrialSheetParseResult {
  const warnings: string[] = [];
  const headerIdx = findHeaderRowIndex(allRows);
  if (headerIdx === -1) {
    return {
      records: [],
      warnings: ["ヘッダー行（日付・氏名を含む行）が見つかりませんでした。体験シートの体裁をご確認ください。"],
    };
  }
  const header = allRows[headerIdx];
  const cols = buildColumnMap(header);

  if (cols.date === -1 || cols.name === -1) {
    return {
      records: [],
      warnings: ["「日付」「氏名」列を検出できませんでした。体験シートの体裁をご確認ください。"],
    };
  }
  if (cols.immediate === -1 && cols.later === -1) {
    return {
      records: [],
      warnings: ["「即日入会」「後日入会」に相当する列を検出できませんでした。"],
    };
  }
  if (!isFunabashi && cols.noJoin === -1) {
    warnings.push(
      "「入会しない」列を検出できませんでした。即日/後日どちらもマークが無い行は「検討中」として扱います。",
    );
  }

  const records: TrialSheetRecord[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    if (!row || row.length === 0) continue;
    const date = (row[cols.date] ?? "").trim();
    const name = (row[cols.name] ?? "").trim();
    // 日付・氏名どちらも空 = 未記入テンプレ行（実シートに大量に存在する）→ スキップ
    if (!date && !name) continue;
    // 氏名だけでも埋まっていれば体験者としてカウントする
    // （日付未記入は転記漏れの可能性があるため警告のみ、除外はしない）
    if (!name) continue;

    const resultType = isFunabashi ? classifyFunabashi(row, cols) : classifyCommon(row, cols);
    records.push({
      storeName,
      year,
      month,
      entryDate: date || null,
      memberName: name,
      resultType,
    });
  }

  if (records.length === 0) {
    warnings.push("取り込める体験者の行がありませんでした（氏名列が全て空）。");
  }

  return { records, warnings };
}

/** 体験シートの集計結果（体験者数・入会率の算出用） */
export interface TrialSheetSummary {
  trialCount: number;
  joinCount: number; // 即日入会 + 後日入会
  immediateCount: number;
  laterCount: number;
  noJoinCount: number;
  pendingCount: number; // 検討中（6店舗共通フォーマットのみ発生）
}

export function summarizeTrialSheet(records: { resultType: string }[]): TrialSheetSummary {
  const summary: TrialSheetSummary = {
    trialCount: records.length,
    joinCount: 0,
    immediateCount: 0,
    laterCount: 0,
    noJoinCount: 0,
    pendingCount: 0,
  };
  for (const r of records) {
    if (r.resultType === "即日入会") {
      summary.immediateCount++;
      summary.joinCount++;
    } else if (r.resultType === "後日入会") {
      summary.laterCount++;
      summary.joinCount++;
    } else if (r.resultType === "入会しない") {
      summary.noJoinCount++;
    } else {
      summary.pendingCount++;
    }
  }
  return summary;
}
