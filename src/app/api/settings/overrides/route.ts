import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const overrides = await prisma.storeOverride.findMany({
      orderBy: { employeeId: "asc" },
    });

    // Get unique employee IDs to look up names from payroll_data
    const employeeIds = [...new Set(overrides.map((o) => String(o.employeeId)))];

    const payrollRecords = await prisma.payrollData.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, employeeName: true },
      distinct: ["employeeId"],
    });

    const nameMap: Record<string, string> = {};
    for (const p of payrollRecords) {
      if (p.employeeName) {
        nameMap[p.employeeId] = p.employeeName;
      }
    }

    const result = overrides.map((o) => ({
      ...o,
      employeeName: nameMap[String(o.employeeId)] || "",
    }));

    return NextResponse.json({ overrides: result });
  } catch (error) {
    console.error("Overrides GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Bulk register action
    if (body.action === "bulk-register") {
      // Get all unique employees from payroll_data
      const allEmployees = await prisma.payrollData.findMany({
        select: { employeeId: true, employeeName: true },
        distinct: ["employeeId"],
      });

      // Get existing overrides
      const existingOverrides = await prisma.storeOverride.findMany({
        select: { employeeId: true },
      });
      const existingIds = new Set(existingOverrides.map((o) => o.employeeId));

      let created = 0;
      for (const emp of allEmployees) {
        const empIdNum = parseInt(emp.employeeId, 10);
        if (isNaN(empIdNum) || existingIds.has(empIdNum)) continue;

        // Determine store from thousand digit
        const thousandDigit = Math.floor((empIdNum % 10000) / 1000);
        const storeName = THOUSAND_DIGIT_MAP[thousandDigit];
        if (!storeName) continue;

        await prisma.storeOverride.create({
          data: {
            employeeId: empIdNum,
            storeName,
            ratio: 100,
          },
        });
        created++;
      }

      return NextResponse.json({ created }, { status: 201 });
    }

    // Batch upsert from array
    if (Array.isArray(body.overrides)) {
      let created = 0;
      for (const item of body.overrides) {
        const empId = typeof item.employeeId === "string" ? parseInt(item.employeeId, 10) : item.employeeId;
        const ratioVal = item.ratio ?? 100;
        if (isNaN(empId) || !item.storeName) continue;
        // Delete old overrides for this employee before creating new one
        await prisma.storeOverride.deleteMany({
          where: { employeeId: empId },
        });
        await prisma.storeOverride.create({
          data: { employeeId: empId, storeName: item.storeName, ratio: ratioVal },
        });
        created++;
      }
      return NextResponse.json({ created }, { status: 201 });
    }

    // Single upsert
    const { employeeId, storeName, ratio } = body;
    if (!employeeId || !storeName) {
      return NextResponse.json(
        { error: "employeeId and storeName are required" },
        { status: 400 },
      );
    }

    const empId =
      typeof employeeId === "string" ? parseInt(employeeId, 10) : employeeId;
    const ratioVal =
      typeof ratio === "string" ? parseInt(ratio, 10) : ratio ?? 100;

    // Delete old overrides for this employee before creating new one
    await prisma.storeOverride.deleteMany({
      where: { employeeId: empId },
    });

    const override = await prisma.storeOverride.create({
      data: { employeeId: empId, storeName, ratio: ratioVal },
    });

    return NextResponse.json({ override }, { status: 201 });
  } catch (error) {
    console.error("Overrides POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.storeOverride.delete({
      where: { id: parseInt(id, 10) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Overrides DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
