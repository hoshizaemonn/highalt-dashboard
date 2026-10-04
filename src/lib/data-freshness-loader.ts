import { prisma } from "@/lib/prisma";
import { STORES } from "@/lib/constants";
import {
  judgeByDate,
  judgeByMonth,
  parseSaleDate,
  toJstDate,
  type FreshnessItem,
} from "@/lib/data-freshness";

// 日次ジョブ（hacomono / 体験シート / 電気料）の「中身の新しさ」を店舗別に集める。読み取りのみ・個人情報なし。
// ジョブが緑でも、売上や取込記録が古ければ stale になる。

const DAILY_DAYS = 2; // 2日以上更新が無ければ警告（定時実行が1回抜けた時点で赤）
const TRIAL_SHEET_STORES = ["巣鴨", "中目黒", "祖師ヶ谷大蔵", "下北沢"]; // 体験シート連携の対象4店舗

const HACOMONO_IMPORTS: { type: string; label: string }[] = [
  { type: "hacomono_pl001", label: "売上一覧（PL001）取込" },
  { type: "hacomono_ps001", label: "商品別売上（PS001）取込" },
  { type: "hacomono_ml001", label: "契約中会員（ML001）取込" },
  { type: "hacomono_ma002", label: "月別集計（MA002）取込" },
];

export async function loadDataFreshness(now: Date = new Date()): Promise<{ generatedAt: string; items: FreshnessItem[] }> {
  const today = toJstDate(now);
  const items: FreshnessItem[] = [];

  // 売上明細: 店舗ごとの最新の売上日（最新月の中の最大）
  const sd = await prisma.salesDetail.groupBy({
    by: ["storeName", "year", "month"],
    _max: { saleDate: true },
  });
  for (const store of STORES) {
    const rows = sd.filter((r) => r.storeName === store);
    const latestMonth = rows.reduce<(typeof rows)[number] | null>(
      (best, r) => (!best || r.year * 12 + r.month > best.year * 12 + best.month ? r : best),
      null,
    );
    items.push(
      judgeByDate(
        { key: "sales_detail", label: "売上明細（最新の売上日）", store, thresholdDays: DAILY_DAYS, basis: "売上明細の最新の売上日" },
        parseSaleDate(latestMonth?._max.saleDate),
        today,
      ),
    );
  }

  // 取込記録（upload_logs）: 種別×店舗の最新取込日時
  const types = [...HACOMONO_IMPORTS.map((h) => h.type), "trial_sheet", "hacomono_enquete_answer", "square_item"];
  const logs = await prisma.uploadLog.groupBy({
    by: ["dataType", "storeName"],
    where: { dataType: { in: types } },
    _max: { createdAt: true },
  });
  const lastLog = (type: string, store: string | null): string | null => {
    const hit = logs.filter((l) => l.dataType === type && (store == null || l.storeName === store));
    const max = hit.reduce<Date | null>((m, l) => (l._max.createdAt && (!m || l._max.createdAt > m) ? l._max.createdAt : m), null);
    return max ? toJstDate(max) : null;
  };

  for (const h of HACOMONO_IMPORTS) {
    for (const store of STORES) {
      items.push(
        judgeByDate(
          { key: h.type, label: h.label, store, thresholdDays: DAILY_DAYS, basis: "最後に取り込まれた日" },
          lastLog(h.type, store),
          today,
        ),
      );
    }
  }
  for (const store of TRIAL_SHEET_STORES) {
    items.push(
      judgeByDate(
        { key: "trial_sheet", label: "体験シート取込", store, thresholdDays: DAILY_DAYS, basis: "最後に取り込まれた日" },
        lastLog("trial_sheet", store),
        today,
      ),
    );
  }
  items.push(
    judgeByDate(
      { key: "hacomono_enquete_answer", label: "アンケート回答取込", store: null, thresholdDays: DAILY_DAYS, basis: "最後に取り込まれた日" },
      lastLog("hacomono_enquete_answer", null),
      today,
    ),
  );
  items.push(
    judgeByDate(
      { key: "square_item", label: "Square アイテム別売上取込", store: null, thresholdDays: DAILY_DAYS, basis: "最後に取り込まれた日" },
      lastLog("square_item", null),
      today,
    ),
  );

  // 電気料: 取込済みの最新の請求月（請求書は月1回・翌月初旬に届くため、3か月以上古ければ警告）
  const elec = await prisma.manualExpenseEntry.findFirst({
    where: { category: "電気料" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { year: true, month: true },
  });
  items.push(
    judgeByMonth(
      { key: "electricity", label: "電気料（最新の取込済み月）", store: null, thresholdMonths: 3, basis: "取込済みの最新の請求月" },
      elec ? `${elec.year}-${String(elec.month).padStart(2, "0")}` : null,
      today,
    ),
  );

  return { generatedAt: now.toISOString(), items };
}
