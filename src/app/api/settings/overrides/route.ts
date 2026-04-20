import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";
import { checkOrigin } from "@/lib/csrf";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const overrides = await prisma.storeOverride.findMany({
      orderBy: { employeeId: "asc" },
    });

    // Supplement names from payroll_data for records that don't have employee_name
    const needNames = overrides.filter((o) => !o.employeeName);
    if (needNames.length > 0) {
      const ids = [...new Set(needNames.map((o) => String(o.employeeId)))];
      const payrollRecords = await prisma.payrollData.findMany({
        where: { employeeId: { in: ids } },
        select: { employeeId: true, employeeName: true },
        distinct: ["employeeId"],
      });
      const nameMap: Record<string, string> = {};
      for (const p of payrollRecords) {
        if (p.employeeName) nameMap[p.employeeId] = p.employeeName;
      }

      const result = overrides.map((o) => ({
        ...o,
        employeeName: o.employeeName || nameMap[String(o.employeeId)] || "",
      }));
      return NextResponse.json({ overrides: result });
    }

    return NextResponse.json({ overrides });
  } catch (error) {
    console.error("Overrides GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Bulk register action (from payroll data)
    if (body.action === "bulk-register") {
      const allEmployees = await prisma.payrollData.findMany({
        select: { employeeId: true, employeeName: true },
        distinct: ["employeeId"],
      });

      const existingOverrides = await prisma.storeOverride.findMany({
        select: { employeeId: true },
      });
      const existingIds = new Set(existingOverrides.map((o) => o.employeeId));

      let created = 0;
      for (const emp of allEmployees) {
        const empIdNum = parseInt(emp.employeeId, 10);
        if (isNaN(empIdNum) || existingIds.has(empIdNum)) continue;

        const thousandDigit = Math.floor((empIdNum % 10000) / 1000);
        const storeName = THOUSAND_DIGIT_MAP[thousandDigit];
        if (!storeName) continue;

        await prisma.storeOverride.create({
          data: {
            employeeId: empIdNum,
            storeName,
            ratio: 100,
            employeeName: emp.employeeName || "",
          },
        });
        created++;
      }

      return NextResponse.json({ created }, { status: 201 });
    }

    // Batch upsert from array (upload unresolved registration)
    if (Array.isArray(body.overrides)) {
      let created = 0;
      await prisma.$transaction(async (tx) => {
        for (const item of body.overrides) {
          const empId = typeof item.employeeId === "string" ? parseInt(item.employeeId, 10) : item.employeeId;
          const ratioVal = item.ratio ?? 100;
          const empName = item.employeeName || "";
          if (isNaN(empId) || !item.storeName) continue;
          // Replace all overrides for this employee
          await tx.storeOverride.deleteMany({ where: { employeeId: empId } });
          await tx.storeOverride.create({
            data: { employeeId: empId, storeName: item.storeName, ratio: ratioVal, employeeName: empName },
          });
          created++;
        }
      });
      return NextResponse.json({ created }, { status: 201 });
    }

    // Dual assignment (兼務): replace all overrides with 2 new ones
    if (body.action === "dual") {
      const empId = typeof body.employeeId === "string" ? parseInt(body.employeeId, 10) : body.employeeId;
      const empName = body.employeeName || "";
      if (isNaN(empId) || !body.store1 || !body.store2) {
        return NextResponse.json({ error: "Invalid dual params" }, { status: 400 });
      }
      await prisma.$transaction(async (tx) => {
        // Delete all existing for this employee
        await tx.storeOverride.deleteMany({ where: { employeeId: empId } });
        // Create 2 records
        await tx.storeOverride.create({
          data: { employeeId: empId, storeName: body.store1, ratio: body.ratio1 ?? 50, employeeName: empName },
        });
        await tx.storeOverride.create({
          data: { employeeId: empId, storeName: body.store2, ratio: body.ratio2 ?? 50, employeeName: empName },
        });
      });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    // Check duplicate (for new employee validation)
    if (body.action === "check-duplicate") {
      const empId = typeof body.employeeId === "string" ? parseInt(body.employeeId, 10) : body.employeeId;
      const exists = await prisma.storeOverride.findFirst({ where: { employeeId: empId } });
      return NextResponse.json({ exists: !!exists });
    }

    // Single upsert
    const { employeeId, storeName, ratio, employeeName: bodyName } = body;
    if (!employeeId || !storeName) {
      return NextResponse.json(
        { error: "employeeId and storeName are required" },
        { status: 400 },
      );
    }

    const empId = typeof employeeId === "string" ? parseInt(employeeId, 10) : employeeId;
    const ratioVal = typeof ratio === "string" ? parseInt(ratio, 10) : ratio ?? 100;
    const empName = bodyName || "";

    const existing = await prisma.storeOverride.findFirst({
      where: { employeeId: empId, storeName },
    });

    let override;
    if (existing) {
      override = await prisma.storeOverride.update({
        where: { id: existing.id },
        data: { ratio: ratioVal, ...(empName ? { employeeName: empName } : {}) },
      });
    } else {
      override = await prisma.storeOverride.create({
        data: { employeeId: empId, storeName, ratio: ratioVal, employeeName: empName },
      });
    }

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
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
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
