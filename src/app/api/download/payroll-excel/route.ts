import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { STORES } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    // Admin check
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { error: "管理者権限が必要です" },
        { status: 403 },
      );
    }

    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    const payrollRows = await prisma.payrollData.findMany({
      where: { year, month },
    });

    // Group by store and compute summaries
    const storeData: Record<
      string,
      {
        fulltime_salary: number;
        parttime_salary: number;
        legal_welfare: number;
        commute: number;
        total_hours: number;
        total_salary: number;
      }
    > = {};

    // Initialize all stores
    for (const s of STORES) {
      storeData[s] = {
        fulltime_salary: 0,
        parttime_salary: 0,
        legal_welfare: 0,
        commute: 0,
        total_hours: 0,
        total_salary: 0,
      };
    }

    for (const row of payrollRows) {
      const store = row.storeName;
      if (!storeData[store]) {
        storeData[store] = {
          fulltime_salary: 0,
          parttime_salary: 0,
          legal_welfare: 0,
          commute: 0,
          total_hours: 0,
          total_salary: 0,
        };
      }

      const ratio = row.ratio / 100;
      const gross = row.grossTotal * ratio;
      const hours = (row.scheduledHours + row.overtimeHours) * ratio;
      const commute = (row.commuteTaxable + row.commuteNontax) * ratio;
      const welfare =
        (row.healthInsuranceCo +
          row.careInsuranceCo +
          row.pensionCo +
          row.childContributionCo +
          row.pensionFundCo +
          row.employmentInsuranceCo +
          row.workersCompCo +
          row.generalContributionCo) *
        ratio;

      const ct = (row.contractType ?? "").toLowerCase();
      const isFulltime =
        ct.includes("正社員") ||
        ct.includes("fulltime") ||
        ct.includes("full-time") ||
        ct === "";

      if (isFulltime) {
        storeData[store].fulltime_salary += gross;
      } else {
        storeData[store].parttime_salary += gross;
      }

      storeData[store].legal_welfare += welfare;
      storeData[store].commute += commute;
      storeData[store].total_hours += hours;
      storeData[store].total_salary += gross;
    }

    // Build CSV rows
    const stores = STORES.filter((s) => storeData[s].total_salary > 0 || storeData[s].total_hours > 0);

    const categories = [
      "正社員・契約社員給与",
      "法定福利",
      "通勤手当",
      "総勤務時間",
      "正社員給与",
      "契約社員給与",
    ];

    const header = ["科目", ...stores, "合計"].join(",");

    const csvRows: string[] = [];
    for (const cat of categories) {
      const values: number[] = [];
      for (const s of stores) {
        const d = storeData[s];
        let val = 0;
        switch (cat) {
          case "正社員・契約社員給与":
            val = d.total_salary;
            break;
          case "法定福利":
            val = d.legal_welfare;
            break;
          case "通勤手当":
            val = d.commute;
            break;
          case "総勤務時間":
            val = d.total_hours;
            break;
          case "正社員給与":
            val = d.fulltime_salary;
            break;
          case "契約社員給与":
            val = d.parttime_salary;
            break;
        }
        values.push(Math.round(val));
      }
      const total = values.reduce((a, b) => a + b, 0);
      csvRows.push(`"${cat}",${values.join(",")},${total}`);
    }

    const csv =
      "\uFEFF" + header + "\r\n" + csvRows.join("\r\n") + "\r\n";

    const mm = String(month).padStart(2, "0");
    const filename = `${year}${mm}_人件費サマリ.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("GET /api/download/payroll-excel error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
