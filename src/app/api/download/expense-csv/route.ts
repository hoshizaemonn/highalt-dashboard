import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);
    const store = searchParams.get("store") ?? "";

    if (isNaN(year) || isNaN(month)) {
      return NextResponse.json(
        { error: "year and month are required" },
        { status: 400 },
      );
    }

    const rows = await prisma.expenseData.findMany({
      where: {
        year,
        month,
        storeName: store,
        isRevenue: 0,
      },
      orderBy: { day: "asc" },
    });

    // Build CSV
    const header = "年,月,日,摘要,金額,勘定科目,内訳";
    const lines = rows.map((r) => {
      const desc = (r.description ?? "").replace(/"/g, '""');
      const cat = (r.category ?? "").replace(/"/g, '""');
      const bd = (r.breakdown ?? "").replace(/"/g, '""');
      return `${r.year},${r.month},${r.day},"${desc}",${r.amount},"${cat}","${bd}"`;
    });

    const csv = "\uFEFF" + header + "\r\n" + lines.join("\r\n") + "\r\n";

    const mm = String(month).padStart(2, "0");
    const filename = `${year}${mm}_${store}_経費明細.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error("GET /api/download/expense-csv error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
