import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const body = await request.json();
    const { year, month, storeName, fields } = body as {
      year: number;
      month: number;
      storeName: string;
      fields: Record<string, number | string>;
    };

    if (!year || !month || !storeName || !fields) {
      return NextResponse.json(
        { error: "year, month, storeName, fields are required" },
        { status: 400 },
      );
    }

    // Map frontend field names to Prisma model fields
    const fieldMap: Record<string, string> = {
      total_members: "totalMembers",
      plan_subscribers: "planSubscribers",
      new_plan_signups: "newPlanSignups",
      new_plan_applications: "newPlanApplications",
      new_registrations: "newRegistrations",
      cancellations: "cancellations",
      suspensions: "suspensions",
      plan_changes: "planChanges",
      cancellation_rate: "cancellationRate",
    };

    const updateData: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(fields)) {
      const prismaField = fieldMap[key];
      if (!prismaField) continue;
      updateData[prismaField] = key === "cancellation_rate" ? String(value) : Number(value);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Find existing record
    const existing = await prisma.monthlySummary.findFirst({
      where: { year, month, storeName },
    });

    if (existing) {
      await prisma.monthlySummary.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      // Create new record if none exists
      await prisma.monthlySummary.create({
        data: {
          year,
          month,
          storeName,
          ...updateData,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Member summary update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
