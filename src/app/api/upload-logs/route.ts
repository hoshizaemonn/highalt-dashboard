import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const logs = await prisma.uploadLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Upload logs GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { userId, userName, dataType, storeName, year, month, fileName, recordCount, note } =
      body;

    if (!userId || !userName || !dataType) {
      return NextResponse.json(
        { error: "userId, userName, and dataType are required" },
        { status: 400 },
      );
    }

    const log = await prisma.uploadLog.create({
      data: {
        userId: typeof userId === "string" ? parseInt(userId, 10) : userId,
        userName,
        dataType,
        storeName: storeName || null,
        year: year ? parseInt(String(year), 10) : null,
        month: month ? parseInt(String(month), 10) : null,
        fileName: fileName || null,
        recordCount: recordCount ? parseInt(String(recordCount), 10) : 0,
        note: note || null,
      },
    });

    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    console.error("Upload logs POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
