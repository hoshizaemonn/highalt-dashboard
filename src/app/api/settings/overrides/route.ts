import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireAdmin } from "@/lib/auth";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";
import {
  captureBaseStore,
  loadEmployeeMapping,
  recomputeEmployeePayroll,
} from "@/lib/payroll-reallocate";

/** body から適用開始年月を取り出す（未指定・不正は null＝全期間適用） */
function parseEffective(body: {
  effectiveYear?: unknown;
  effectiveMonth?: unknown;
}): { effectiveYear: number | null; effectiveMonth: number | null } {
  const ey = Number(body.effectiveYear);
  const em = Number(body.effectiveMonth);
  if (!Number.isInteger(ey) || !Number.isInteger(em) || em < 1 || em > 12) {
    return { effectiveYear: null, effectiveMonth: null };
  }
  return { effectiveYear: ey, effectiveMonth: em };
}

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
    logError("Overrides GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

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
      const created = await prisma.$transaction(async (tx) => {
        let count = 0;
        for (const item of body.overrides) {
          const empId = typeof item.employeeId === "string" ? parseInt(item.employeeId, 10) : item.employeeId;
          const ratioVal = item.ratio ?? 100;
          const empName = item.employeeName || "";
          if (isNaN(empId) || !item.storeName) continue;
          await tx.storeOverride.deleteMany({ where: { employeeId: empId } });
          await tx.storeOverride.create({
            data: { employeeId: empId, storeName: item.storeName, ratio: ratioVal, employeeName: empName },
          });
          count++;
        }
        return count;
      });
      return NextResponse.json({ created }, { status: 201 });
    }

    // Multi assignment (兼務・N店舗): replace all overrides with N new ones
    // body.stores = [{ storeName, ratio }, ...]（3店舗以上対応）
    if (body.action === "multi") {
      const empId = typeof body.employeeId === "string" ? parseInt(body.employeeId, 10) : body.employeeId;
      const empName = body.employeeName || "";
      const stores = Array.isArray(body.stores) ? body.stores : [];
      const valid = stores.filter(
        (s: { storeName?: string; ratio?: number }) =>
          s && s.storeName && Number(s.ratio) > 0,
      );
      if (isNaN(empId) || valid.length === 0) {
        return NextResponse.json({ error: "Invalid multi params" }, { status: 400 });
      }
      // 店舗の重複は不可（unique制約）
      const uniqStores = new Set(valid.map((s: { storeName: string }) => s.storeName));
      if (uniqStores.size !== valid.length) {
        return NextResponse.json({ error: "店舗が重複しています" }, { status: 400 });
      }
      const eff = parseEffective(body);
      const providedBase = typeof body.baseStore === "string" && body.baseStore ? body.baseStore : null;
      await prisma.$transaction(async (tx) => {
        // 削除前に移転前店舗を確定（既存baseStore→最初の所属→社員番号）
        const baseStore = providedBase ?? (await captureBaseStore(tx, empId, String(empId)));
        await tx.storeOverride.deleteMany({ where: { employeeId: empId } });
        for (const s of valid) {
          await tx.storeOverride.create({
            data: {
              employeeId: empId,
              storeName: s.storeName,
              ratio: Math.round(Number(s.ratio)),
              employeeName: empName,
              effectiveYear: eff.effectiveYear,
              effectiveMonth: eff.effectiveMonth,
              baseStore,
            },
          });
        }
        // 既存人件費データを新マッピングで全月再計算（明細＝PLを一致させる）
        const mapping = await loadEmployeeMapping(tx, empId);
        await recomputeEmployeePayroll(tx, empId, String(empId), mapping);
      });
      return NextResponse.json({ ok: true, count: valid.length }, { status: 201 });
    }

    // Dual assignment (兼務): replace all overrides with 2 new ones
    if (body.action === "dual") {
      const empId = typeof body.employeeId === "string" ? parseInt(body.employeeId, 10) : body.employeeId;
      const empName = body.employeeName || "";
      if (isNaN(empId) || !body.store1 || !body.store2) {
        return NextResponse.json({ error: "Invalid dual params" }, { status: 400 });
      }
      const effDual = parseEffective(body);
      const providedBaseDual = typeof body.baseStore === "string" && body.baseStore ? body.baseStore : null;
      await prisma.$transaction(async (tx) => {
        const baseStore = providedBaseDual ?? (await captureBaseStore(tx, empId, String(empId)));
        await tx.storeOverride.deleteMany({ where: { employeeId: empId } });
        await tx.storeOverride.create({
          data: { employeeId: empId, storeName: body.store1, ratio: body.ratio1 ?? 50, employeeName: empName, effectiveYear: effDual.effectiveYear, effectiveMonth: effDual.effectiveMonth, baseStore },
        });
        await tx.storeOverride.create({
          data: { employeeId: empId, storeName: body.store2, ratio: body.ratio2 ?? 50, employeeName: empName, effectiveYear: effDual.effectiveYear, effectiveMonth: effDual.effectiveMonth, baseStore },
        });
        const mapping = await loadEmployeeMapping(tx, empId);
        await recomputeEmployeePayroll(tx, empId, String(empId), mapping);
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
    const effSingle = parseEffective(body);
    const providedBaseSingle = typeof body.baseStore === "string" && body.baseStore ? body.baseStore : null;

    const override = await prisma.$transaction(async (tx) => {
      const baseStore = providedBaseSingle ?? (await captureBaseStore(tx, empId, String(empId)));
      const existing = await tx.storeOverride.findFirst({
        where: { employeeId: empId, storeName },
      });
      let ov;
      if (existing) {
        ov = await tx.storeOverride.update({
          where: { id: existing.id },
          data: {
            ratio: ratioVal,
            ...(empName ? { employeeName: empName } : {}),
            effectiveYear: effSingle.effectiveYear,
            effectiveMonth: effSingle.effectiveMonth,
            baseStore,
          },
        });
      } else {
        ov = await tx.storeOverride.create({
          data: {
            employeeId: empId,
            storeName,
            ratio: ratioVal,
            employeeName: empName,
            effectiveYear: effSingle.effectiveYear,
            effectiveMonth: effSingle.effectiveMonth,
            baseStore,
          },
        });
      }
      // 適用開始月・移転前店舗は従業員単位で統一（同一従業員の全行に反映）
      await tx.storeOverride.updateMany({
        where: { employeeId: empId },
        data: {
          effectiveYear: effSingle.effectiveYear,
          effectiveMonth: effSingle.effectiveMonth,
          baseStore,
        },
      });
      const mapping = await loadEmployeeMapping(tx, empId);
      await recomputeEmployeePayroll(tx, empId, String(empId), mapping);
      return ov;
    });

    return NextResponse.json({ override }, { status: 201 });
  } catch (error) {
    logError("Overrides POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      const target = await tx.storeOverride.findUnique({
        where: { id: parseInt(id, 10) },
        select: { employeeId: true },
      });
      await tx.storeOverride.delete({ where: { id: parseInt(id, 10) } });
      if (target) {
        // 残ったマッピングで再計算（1件も残らなければ home 店舗へ戻す）
        const mapping = await loadEmployeeMapping(tx, target.employeeId);
        await recomputeEmployeePayroll(
          tx,
          target.employeeId,
          String(target.employeeId),
          mapping,
        );
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Overrides DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
