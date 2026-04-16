import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fiscalYearParam = searchParams.get("fiscalYear");
    const store = searchParams.get("store") || undefined;

    if (!fiscalYearParam) {
      return NextResponse.json(
        { error: "fiscalYear is required" },
        { status: 400 },
      );
    }

    const fiscalYear = parseInt(fiscalYearParam, 10);

    // Fiscal year: Oct of (fiscalYear - 1) through Sep of fiscalYear
    // e.g. fiscalYear=2026 → 2025/10 〜 2026/9
    const yearMonthPairs: { year: number; month: number }[] = [];
    for (let m = 10; m <= 12; m++) {
      yearMonthPairs.push({ year: fiscalYear - 1, month: m });
    }
    for (let m = 1; m <= 9; m++) {
      yearMonthPairs.push({ year: fiscalYear, month: m });
    }

    // Query each month sequentially
    const results: Array<{
      year: number;
      month: number;
      month_label: string;
      report: Record<string, unknown> | null;
    }> = [];

    for (const ym of yearMonthPairs) {
      const where: { year: number; month: number; storeName?: string } = {
        year: ym.year,
        month: ym.month,
      };
      if (store) {
        where.storeName = store;
      }

      const reports = await prisma.promotionReport.findMany({ where });

      if (store) {
        // Single store — return one report or null
        results.push({
          year: ym.year,
          month: ym.month,
          month_label: `${ym.month}月`,
          report: reports.length > 0 ? (reports[0] as unknown as Record<string, unknown>) : null,
        });
      } else {
        // All stores — aggregate
        if (reports.length === 0) {
          results.push({
            year: ym.year,
            month: ym.month,
            month_label: `${ym.month}月`,
            report: null,
          });
        } else {
          const agg: Record<string, unknown> = {
            year: ym.year,
            month: ym.month,
            storeName: "全体",
            trialReferral: 0,
            trialNonReferral: 0,
            trialTotal: 0,
            postingStaff: 0,
            postingVendor: 0,
            postingTotal: 0,
            adGoogle: 0,
            adMeta: 0,
            adPosting: 0,
            adDesign: 0,
            adPrint: 0,
            adGift: 0,
            adEvent: 0,
            adRecruit: 0,
            adOther: 0,
            adTotal: 0,
            unitPrice: 0,
            optAthlete4: 0,
            optAthlete8: 0,
            optDrinkHyalchi: 0,
            optDrinkNmn: 0,
            optBoost4: 0,
            optBoost8: 0,
            personalRevenue: 0,
            merchandiseRevenue: 0,
          };

          const intFields = [
            "trialReferral", "trialNonReferral", "trialTotal",
            "postingStaff", "postingVendor", "postingTotal",
            "adGoogle", "adMeta", "adPosting", "adDesign", "adPrint",
            "adGift", "adEvent", "adRecruit", "adOther", "adTotal",
            "unitPrice",
            "optAthlete4", "optAthlete8", "optDrinkHyalchi", "optDrinkNmn",
            "optBoost4", "optBoost8",
            "personalRevenue", "merchandiseRevenue",
          ];

          for (const r of reports) {
            const rec = r as unknown as Record<string, number>;
            for (const f of intFields) {
              (agg[f] as number) += rec[f] ?? 0;
            }
          }

          // Average rates
          const ratesCount = reports.filter(
            (r) =>
              (r as unknown as Record<string, number>).trialTotal > 0,
          ).length;
          if (ratesCount > 0) {
            let joinRateSum = 0;
            let sameDaySum = 0;
            for (const r of reports) {
              const rec = r as unknown as Record<string, number>;
              if (rec.trialTotal > 0) {
                joinRateSum += rec.trialJoinRate ?? 0;
                sameDaySum += rec.trialSameDayRate ?? 0;
              }
            }
            agg.trialJoinRate = joinRateSum / ratesCount;
            agg.trialSameDayRate = sameDaySum / ratesCount;
          } else {
            agg.trialJoinRate = 0;
            agg.trialSameDayRate = 0;
          }

          // Average unitPrice
          if (reports.length > 0) {
            agg.unitPrice = Math.round(
              (agg.unitPrice as number) / reports.length,
            );
          }

          results.push({
            year: ym.year,
            month: ym.month,
            month_label: `${ym.month}月`,
            report: agg,
          });
        }
      }
    }

    return NextResponse.json({ monthly: results });
  } catch (err) {
    console.error("GET /api/promotion/annual error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
