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
 *   ② 船橋専用フォーマット（実物確認済み・2026-09-20 星崎さん経由で2026年9月分CSVを受領）
 *      列: 連番 / 日付 / 氏名 / 担当 / 体験経路 / スポーツ・目的 / 入会 / 即日 / 後日 /
 *          入会種別 / 学割・ペア割 / アスリート / 後日フォロー / 備考
 *      6店舗共通フォーマットとは列名・列順が大きく異なり、船橋固有の列
 *      （担当・体験経路・スポーツ/目的・入会種別・学割ペア割・アスリート・後日フォロー・備考）
 *      が多数あるため、列名の部分一致に頼らず「入会」「即日」「後日」列を個別に検出する
 *      専用ロジックで判定する。
 *
 *      判定の正本は「入会」列（〇=入会、空欄=未入会・体験のみ）。即日/後日列は
 *      入会=〇の場合の内訳（いつ入会したか）を表す補助列に過ぎない。
 *      実データには「入会は空欄なのに後日列に〇が付いている」ような現場入力の
 *      ブレ（検討中止まりのケース等）があるため、必ず「入会」列を最優先に判定し、
 *      即日/後日列は入会=〇の時だけ参照する（矛盾データは「入会しない」扱いでよい）。
 *      「×」は明示的な「未入会」マークとして使われており、isMarked() では
 *      マーク無し（false）として扱う。
 *
 *      ヘッダー行の上に説明文・凡例行（「⇚入会」等）が複数あるため、ヘッダー行の
 *      自動検出（「日付」「氏名」を含む行を探す）は既存ロジックのまま使えるが、
 *      念のため走査行数に十分な余裕を持たせている。
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

/**
 * header配列から候補キーワードに完全一致する列のindexを探す（部分一致フォールバック無し）。
 * 「入会」のように単独では意味を持つが、他の列名（例: 入会種別・入会しない）の
 * 部分文字列としても現れやすい語を安全に検出するために使う。
 */
function findExactColumnIndex(header: string[], candidates: string[]): number {
  const normalizedHeader = header.map((h) => norm(h));
  for (const cand of candidates) {
    const idx = normalizedHeader.indexOf(norm(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * セルにマーク（〇・○・レ・TRUE等）が入っているかどうか。
 * 「×」は船橋シート等で「明示的に未入会」を表す記号として使われているため、
 * マーク無し（false）として扱う。
 */
function isMarked(cell: string | undefined): boolean {
  if (!cell) return false;
  const v = cell.trim();
  if (v === "") return false;
  if (
    v === "FALSE" ||
    v === "false" ||
    v === "0" ||
    v === "-" ||
    v === "×" ||
    v === "x" ||
    v === "X"
  ) {
    return false;
  }
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
  noJoin: number; // -1 なら該当列なし
  /** 船橋専用: 「入会」列（〇=入会、空欄=未入会）。入会有無の正本。-1なら未検出 */
  joined: number;
}

function buildColumnMap(header: string[]): ColumnMap {
  return {
    date: findColumnIndex(header, ["日付"]),
    name: findColumnIndex(header, ["氏名", "名前", "お名前"]),
    immediate: findColumnIndex(header, ["即日入会", "即日"]),
    later: findColumnIndex(header, ["後日入会", "後日"]),
    noJoin: findColumnIndex(header, ["入会しない", "非入会", "見送り"]),
    // 完全一致のみ（部分一致だと「入会種別」「入会しない」等を誤検出するため）
    joined: findExactColumnIndex(header, ["入会"]),
  };
}

function classifyCommon(row: string[], cols: ColumnMap): TrialResultType {
  if (isMarked(row[cols.immediate])) return "即日入会";
  if (isMarked(row[cols.later])) return "後日入会";
  if (cols.noJoin !== -1 && isMarked(row[cols.noJoin])) return "入会しない";
  return "検討中";
}

/**
 * 船橋専用（実物確認済み・2026-09-20）:
 * 「入会」列（〇=入会、空欄=未入会）を入会有無の正本として最優先で判定する。
 * 即日/後日列は入会=〇の場合の内訳（いつ入会したか）にのみ使う。
 * 現場入力のブレ（入会が空欄なのに即日/後日にマークが付いている等の矛盾データ）は
 * 「入会」列を信頼して「入会しない」として扱う。
 *
 * 「入会」列自体を検出できなかった場合のみ、フォールバックとして
 * 即日/後日どちらかにマークがあれば入会とみなす旧ロジックを使う。
 */
function classifyFunabashi(row: string[], cols: ColumnMap): TrialResultType {
  if (cols.joined !== -1) {
    if (isMarked(row[cols.joined])) {
      if (isMarked(row[cols.immediate])) return "即日入会";
      if (isMarked(row[cols.later])) return "後日入会";
      // 入会〇だが即日/後日どちらも空欄 → 念のため即日扱い（星崎さん合意のフォールバック）
      return "即日入会";
    }
    // 入会列が空欄 = 未入会（体験のみ）。即日/後日列の値（矛盾データ含む）は無視する。
    return "入会しない";
  }
  // 「入会」列が見つからない場合のみ、即日/後日ベースの旧ロジックにフォールバック
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
  if (isFunabashi && cols.joined === -1) {
    warnings.push(
      "「入会」列を検出できませんでした。即日/後日どちらもマークが無い行は「入会しない」として扱います（入会列を優先する判定にフォールバックできていません）。",
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
