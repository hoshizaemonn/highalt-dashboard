import { calendarToFiscalYear } from "./fiscal-calendar";

export const DASHBOARD_SELECTION_KEY = "highalt-dashboard-selection-v1";

export function currentDashboardPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return { year: calendarToFiscalYear(year, month), period: String(month) };
}

type Selection = { year: number; period: string; store: string };

export function restoreDashboardSelection(
  raw: string | null, userId: number, allowedStores: string[] | null,
): Selection | null {
  try {
    const saved = JSON.parse(raw ?? "null");
    if (!saved || saved.userId !== userId ||
        !Number.isInteger(saved.year) || saved.year < 2020 ||
        saved.year > currentDashboardPeriod().year + 5 ||
        !["通期", "上期", "下期", ...Array.from({ length: 12 }, (_, i) => String(i + 1))].includes(saved.period) ||
        typeof saved.store !== "string" || !saved.store) return null;
    const storeAllowed = allowedStores === null || allowedStores.includes(saved.store) ||
      (saved.store === "全体" && allowedStores.length > 1);
    return { year: saved.year, period: saved.period,
      store: storeAllowed ? saved.store : (allowedStores?.[0] ?? "全体") };
  } catch {
    return null;
  }
}
