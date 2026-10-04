// データの鮮度判定（純粋関数）。
// 「ジョブは緑なのに中身が古い／欠けている」を検知する（2026-09-24〜 hacomono 売上が6日間取れていなかった事故の再発防止）。
// 時刻は日本時間（JST）の暦日で比較する。個人情報は一切扱わない（日付と件数の有無のみ）。

export type FreshnessStatus = "ok" | "stale" | "missing";

export interface FreshnessItem {
  key: string;
  label: string;
  /** 店舗別なら店舗名。全店共通なら null */
  store: string | null;
  /** 最新日（JST・YYYY-MM-DD）。データが無ければ null */
  latest: string | null;
  /** 今日（JST）との差（日）。latest が無ければ null */
  ageDays: number | null;
  /** この日数以上更新が無ければ stale */
  thresholdDays: number;
  status: FreshnessStatus;
  /** 判定の根拠（画面表示用） */
  basis: string;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Date → JST の YYYY-MM-DD */
export function toJstDate(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 売上明細の sale_date（例 "2026/09/30 19:31:16" / "2026-09-30"）→ YYYY-MM-DD。解釈できなければ null */
export function parseSaleDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s.trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** YYYY-MM-DD 同士の暦日差（a - b） */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

/** 日付ベースの1項目を判定する */
export function judgeByDate(
  base: { key: string; label: string; store: string | null; thresholdDays: number; basis: string },
  latest: string | null,
  todayJst: string,
): FreshnessItem {
  if (!latest) return { ...base, latest: null, ageDays: null, status: "missing" };
  const age = dayDiff(todayJst, latest);
  return { ...base, latest, ageDays: age, status: age >= base.thresholdDays ? "stale" : "ok" };
}

/** 月ベース（電気料の請求月など）。latest は "YYYY-MM"。当月から monthsThreshold か月以上古ければ stale */
export function judgeByMonth(
  base: { key: string; label: string; store: string | null; thresholdMonths: number; basis: string },
  latestYm: string | null,
  todayJst: string,
): FreshnessItem {
  const common = { key: base.key, label: base.label, store: base.store, basis: base.basis, thresholdDays: base.thresholdMonths * 30 };
  if (!latestYm) return { ...common, latest: null, ageDays: null, status: "missing" };
  const [ly, lm] = latestYm.split("-").map(Number);
  const [ty, tm] = [Number(todayJst.slice(0, 4)), Number(todayJst.slice(5, 7))];
  const monthsOld = ty * 12 + tm - (ly * 12 + lm);
  return {
    ...common,
    latest: latestYm,
    ageDays: monthsOld * 30,
    status: monthsOld >= base.thresholdMonths ? "stale" : "ok",
  };
}

export function summarize(items: FreshnessItem[]): { stale: number; missing: number; ok: number; problems: FreshnessItem[] } {
  const problems = items.filter((i) => i.status !== "ok");
  return {
    stale: items.filter((i) => i.status === "stale").length,
    missing: items.filter((i) => i.status === "missing").length,
    ok: items.filter((i) => i.status === "ok").length,
    problems,
  };
}
