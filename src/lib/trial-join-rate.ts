// 体験入会率・体験者数まわりの警告（山本様の意向: 体験シートを正にする）。
//
// 体験入会率 = （即日入会 + 後日入会）÷ 体験者数。分子・分母とも trial_sheet_entry から計算する。
//   「検討中」「入会しない」は分子に入れない（分母には入る）。体験シートが無い月は null（画面では「-」）。
// 既存の「入会率」（新規入会数 ÷ 体験者数。新規入会数は hacomono の入会日時ベース）とは別の指標。
//
// 依存を持たない純粋関数（node --experimental-strip-types で単体テスト可能）。

export interface TrialSheetRowLike {
  storeName: string;
  resultType: string;
}

export interface TrialJoinSummary {
  /** 体験シートの行数（体験者数） */
  sheetCount: number;
  /** 即日入会 + 後日入会 */
  joinedCount: number;
}

const JOINED = new Set(["即日入会", "後日入会"]);

export function isJoinedResult(resultType: string): boolean {
  return JOINED.has(resultType);
}

/** 店舗ごとに集計してから合算する（全体ビューの合算は店舗単位の集計の和。分母・分子とも体験シート由来） */
export function summarizeTrialJoin(rows: TrialSheetRowLike[]): TrialJoinSummary {
  const perStore = new Map<string, TrialJoinSummary>();
  for (const r of rows) {
    const cur = perStore.get(r.storeName) ?? { sheetCount: 0, joinedCount: 0 };
    cur.sheetCount += 1;
    if (isJoinedResult(r.resultType)) cur.joinedCount += 1;
    perStore.set(r.storeName, cur);
  }
  let sheetCount = 0;
  let joinedCount = 0;
  for (const s of perStore.values()) {
    sheetCount += s.sheetCount;
    joinedCount += s.joinedCount;
  }
  return { sheetCount, joinedCount };
}

/** 体験入会率（%）。体験シートが無い（0件）なら null。常に 0〜100 */
export function trialJoinRatePercent(s: TrialJoinSummary): number | null {
  if (s.sheetCount <= 0) return null;
  return (Math.min(s.joinedCount, s.sheetCount) / s.sheetCount) * 100;
}

export function formatTrialJoinRate(s: TrialJoinSummary): string {
  const p = trialJoinRatePercent(s);
  return p === null ? "-" : `${p.toFixed(1)}%`;
}

export interface TrialWarnings {
  /** 手入力と体験シートの件数が違う */
  diff: string | null;
  /** 体験シートの件数が hacomono 自動算出（会員のみ）より少ない */
  missing: string | null;
}

/**
 * 警告文を返す（表示値は変えない）。
 * - diff: 体験シートがある（>0）かつ 手入力（生の値）が入力済み（>0）かつ 件数が違うとき。手入力が未入力（0）のときは出さない。
 * - missing: 体験シートがある（>0）かつ hacomono 自動算出より少ないとき。
 */
export function trialWarnings(args: {
  sheetCount: number;
  manualRaw: number;
  autoCount: number;
}): TrialWarnings {
  const { sheetCount, manualRaw, autoCount } = args;
  if (sheetCount <= 0) return { diff: null, missing: null };
  return {
    diff:
      manualRaw > 0 && manualRaw !== sheetCount
        ? `差があります（体験シート${sheetCount}人／手入力${manualRaw}人）`
        : null,
    missing:
      sheetCount < autoCount
        ? `体験シートの記入漏れの可能性があります（体験シート${sheetCount}人／hacomono${autoCount}人）`
        : null,
  };
}
