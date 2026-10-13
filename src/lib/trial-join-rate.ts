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

/**
 * 体験者数（実効値）の優先順位: 体験シート実データ ＞ 店長の手入力 ＞ hacomono自動算出（入会者のみ）。
 * 月次・全体・期間・年間・店舗比較のすべてで同じ規則を使う（店舗×月ごとに判定してから合算する）。
 */
export function pickEffectiveTrial(args: { sheet: number; manual: number; auto: number }): number {
  const { sheet, manual, auto } = args;
  return sheet > 0 ? sheet : manual > 0 ? manual : auto;
}

/**
 * 全体ビュー（店舗未指定）の体験者数: 店舗ごとに pickEffectiveTrial で判定してから合算する。
 * /api/dashboard（全体）と鮮度チェックの「体験者数の一致」確認で同じ関数を使う。
 */
export function sumEffectiveTrialByStore(
  sheetByStore: Map<string, number>,
  manualByStore: Map<string, number>,
  autoByStore: Map<string, number>,
): number {
  const names = new Set([...sheetByStore.keys(), ...manualByStore.keys(), ...autoByStore.keys()]);
  let total = 0;
  for (const sn of names) {
    total += pickEffectiveTrial({
      sheet: sheetByStore.get(sn) ?? 0,
      manual: manualByStore.get(sn) ?? 0,
      auto: autoByStore.get(sn) ?? 0,
    });
  }
  return total;
}

/**
 * 店舗比較（/api/dashboard/store-compare）の1店舗×1か月の体験者数。
 * 自動算出（hacomono）は体験シート・手入力がどちらも無いときだけ数える。
 */
export function storeCompareTrialForMonth(args: {
  storeName: string;
  year: number;
  month: number;
  sheetRows: ReadonlyArray<{ storeName: string; year: number; month: number }>;
  manualRows: ReadonlyArray<{ storeName: string; year: number; month: number; trialCount: number }>;
  memberRows: ReadonlyArray<{ storeName: string; trialDate: string | null; firstTrialDate: string | null }>;
}): number {
  const { storeName, year, month, sheetRows, manualRows, memberRows } = args;
  const sheet = sheetRows.filter(
    (r) => r.storeName === storeName && r.year === year && r.month === month,
  ).length;
  const me = manualRows.find(
    (m) => m.storeName === storeName && m.year === year && m.month === month,
  );
  const manual = me?.trialCount ?? 0;
  let auto = 0;
  if (sheet === 0 && manual === 0) {
    const mm = String(month).padStart(2, "0");
    const prefixes = [`${year}/${mm}/`, `${year}-${mm}-`];
    for (const r of memberRows) {
      if (r.storeName !== storeName) continue;
      if (
        (r.trialDate && prefixes.some((pref) => r.trialDate!.startsWith(pref))) ||
        (r.firstTrialDate && prefixes.some((pref) => r.firstTrialDate!.startsWith(pref)))
      ) {
        auto++;
      }
    }
  }
  return pickEffectiveTrial({ sheet, manual, auto });
}

// ---- 体験者数の「画面間の一致」判定（鮮度チェック・警告バナー用。読み込みは trial-consistency.ts）----
export interface TrialConsistencyStore {
  store: string;
  monthly: number;
  storeCompare: number;
}

export interface TrialConsistencyMonth {
  year: number;
  month: number;
  ok: boolean;
  /** 全体ビューの体験者数 */
  overall: number;
  /** 月次（店舗別）の合計 */
  sumMonthly: number;
  stores: TrialConsistencyStore[];
  /** 不一致の説明（件数のみ） */
  problems: string[];
}

export interface TrialConsistencyInput {
  year: number;
  month: number;
  sheetRows: ReadonlyArray<{ storeName: string; year: number; month: number }>;
  manualRows: ReadonlyArray<{ storeName: string; year: number; month: number; trialCount: number }>;
  memberRows: ReadonlyArray<{ storeName: string; trialDate: string | null; firstTrialDate: string | null }>;
  /** 全体集計から外す店舗（本部・非表示店舗） */
  excluded: ReadonlyArray<string>;
}

const countBy = <T,>(rows: ReadonlyArray<T>, key: (r: T) => string, val: (r: T) => number = () => 1) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r));
  return m;
};

/** 純粋関数: 3画面の体験者数を同じ材料から計算して突き合わせる */
export function judgeTrialConsistency(input: TrialConsistencyInput): TrialConsistencyMonth {
  const { year, month, excluded } = input;
  const keep = (s: string) => !excluded.includes(s);
  const sheetRows = input.sheetRows.filter((r) => r.year === year && r.month === month && keep(r.storeName));
  const manualRows = input.manualRows.filter((r) => r.year === year && r.month === month && keep(r.storeName));
  const memberRows = input.memberRows.filter((r) => keep(r.storeName));

  const sheetByStore = countBy(sheetRows, (r) => r.storeName);
  const manualByStore = countBy(manualRows, (r) => r.storeName, (r) => r.trialCount);
  const monthMembers = memberRows.filter((r) => {
    const mm = String(month).padStart(2, "0");
    const prefixes = [`${year}/${mm}/`, `${year}-${mm}-`];
    return (
      (r.trialDate != null && prefixes.some((p) => r.trialDate!.startsWith(p))) ||
      (r.firstTrialDate != null && prefixes.some((p) => r.firstTrialDate!.startsWith(p)))
    );
  });
  const autoByStore = countBy(monthMembers, (r) => r.storeName);

  const overall = sumEffectiveTrialByStore(sheetByStore, manualByStore, autoByStore);
  const names = [...new Set([...sheetByStore.keys(), ...manualByStore.keys(), ...autoByStore.keys()])].sort();
  const stores: TrialConsistencyStore[] = names.map((store) => ({
    store,
    monthly: pickEffectiveTrial({
      sheet: sheetByStore.get(store) ?? 0,
      manual: manualByStore.get(store) ?? 0,
      auto: autoByStore.get(store) ?? 0,
    }),
    storeCompare: storeCompareTrialForMonth({
      storeName: store,
      year,
      month,
      sheetRows,
      manualRows,
      memberRows: monthMembers,
    }),
  }));
  const sumMonthly = stores.reduce((s, r) => s + r.monthly, 0);
  const problems: string[] = [];
  for (const r of stores) {
    if (r.monthly !== r.storeCompare) {
      problems.push(`${year}/${month} ${r.store}: 月次 ${r.monthly}人 / 店舗比較 ${r.storeCompare}人`);
    }
  }
  if (overall !== sumMonthly) {
    problems.push(`${year}/${month} 全体 ${overall}人 / 店舗別の合計 ${sumMonthly}人`);
  }
  return { year, month, ok: problems.length === 0, overall, sumMonthly, stores, problems };
}

