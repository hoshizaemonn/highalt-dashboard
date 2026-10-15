import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireAdmin } from "@/lib/auth";
import { THOUSAND_DIGIT_MAP } from "@/lib/constants";
import {
  captureBaseStore,
  loadAllEmployeeMappings,
  loadEmployeeMapping,
  recomputeEmployeePayroll,
} from "@/lib/payroll-reallocate";
import { validatePeriods } from "@/lib/payroll-allocation";

/** body の employeeId を数値に（不正は NaN） */
function parseEmpId(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) ? v : NaN;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return NaN;
}

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

    const [overrides, periodRows, mappings] = await Promise.all([
      prisma.storeOverride.findMany({ orderBy: { employeeId: "asc" } }),
      prisma.storeOverridePeriod.findMany({
        orderBy: [{ employeeId: "asc" }, { id: "asc" }],
        select: { employeeId: true, employeeName: true },
      }),
      loadAllEmployeeMappings(prisma),
    ]);

    // 氏名: 期間テーブル → store_overrides → 人件費データ の順で補完
    const nameMap = new Map<number, string>();
    for (const o of overrides) if (o.employeeName && !nameMap.has(o.employeeId)) nameMap.set(o.employeeId, o.employeeName);
    for (const p of periodRows) if (p.employeeName) nameMap.set(p.employeeId, p.employeeName);
    const missing = [...mappings.keys()].filter((id) => !nameMap.get(id));
    if (missing.length > 0) {
      const payrollRecords = await prisma.payrollData.findMany({
        where: { employeeId: { in: missing.map(String) } },
        select: { employeeId: true, employeeName: true },
        distinct: ["employeeId"],
      });
      for (const p of payrollRecords) {
        if (p.employeeName) nameMap.set(parseInt(p.employeeId, 10), p.employeeName);
      }
    }

    const periodEmpIds = new Set(periodRows.map((p) => p.employeeId));
    // 従業員ごとの期間一覧（期間テーブルが無い従業員は旧 store_overrides を1期間として表示）
    const employees = [...mappings.entries()]
      .sort(([a], [b]) => a - b)
      .map(([employeeId, m]) => ({
        employeeId,
        employeeName: nameMap.get(employeeId) || "",
        source: periodEmpIds.has(employeeId) ? "periods" : "legacy",
        baseStore: m.baseStore,
        periods: m.periods,
      }));

    const result = overrides.map((o) => ({
      ...o,
      employeeName: o.employeeName || nameMap.get(o.employeeId) || "",
    }));
    return NextResponse.json({ overrides: result, employees });
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
      const existingPeriods = await prisma.storeOverridePeriod.findMany({
        select: { employeeId: true },
        distinct: ["employeeId"],
      });
      const existingIds = new Set([
        ...existingOverrides.map((o) => o.employeeId),
        ...existingPeriods.map((o) => o.employeeId),
      ]);

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
          // この従業員のマッピングを丸ごと置き換える（期間も含む・削除は従業員単位）
          await tx.storeOverridePeriod.deleteMany({ where: { employeeId: empId } });
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
        await tx.storeOverridePeriod.deleteMany({ where: { employeeId: empId } });
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
        await tx.storeOverridePeriod.deleteMany({ where: { employeeId: empId } });
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
      const exists =
        (await prisma.storeOverride.findFirst({ where: { employeeId: empId } })) ??
        (await prisma.storeOverridePeriod.findFirst({ where: { employeeId: empId } }));
      return NextResponse.json({ exists: !!exists });
    }

    // 期間の保存（従業員1人分の期間をまとめて置き換える）
    // body = { action: "periods", employeeId, employeeName, baseStore, periods: [{ startYear, startMonth, endYear, endMonth, stores: [{ storeName, ratio }] }] }
    if (body.action === "periods") {
      const empId = parseEmpId(body.employeeId);
      if (isNaN(empId)) {
        return NextResponse.json({ error: "従業員番号が正しくありません" }, { status: 400 });
      }
      const checked = validatePeriods(body.periods);
      if (!checked.ok) {
        return NextResponse.json({ error: checked.error }, { status: 400 });
      }
      // 期間外の店舗。空＝社員番号のルールで決める（null で保存）
      const baseStore = typeof body.baseStore === "string" && body.baseStore ? body.baseStore : null;
      const updatedBy = auth.session.displayName || auth.session.storeName || "admin";
      await prisma.$transaction(async (tx) => {
        const empName =
          (typeof body.employeeName === "string" && body.employeeName) ||
          (await tx.storeOverridePeriod.findFirst({ where: { employeeId: empId, NOT: { employeeName: "" } } }))?.employeeName ||
          (await tx.storeOverride.findFirst({ where: { employeeId: empId, NOT: { employeeName: "" } } }))?.employeeName ||
          "";
        // この従業員のマッピングだけを置き換える（削除スコープは employeeId）
        await tx.storeOverridePeriod.deleteMany({ where: { employeeId: empId } });
        await tx.storeOverride.deleteMany({ where: { employeeId: empId } });
        await tx.storeOverridePeriod.createMany({
          data: checked.periods.flatMap((p) =>
            p.stores.map((s) => ({
              employeeId: empId,
              employeeName: empName,
              startYear: p.startYear,
              startMonth: p.startMonth,
              endYear: p.endYear,
              endMonth: p.endMonth,
              storeName: s.storeName,
              ratio: Math.round(s.ratio),
              baseStore,
              updatedBy,
              updatedAt: new Date(),
            })),
          ),
        });
        // 既存人件費データを全月組み直す（月別調整がある月はそのまま残す）
        const mapping = await loadEmployeeMapping(tx, empId);
        await recomputeEmployeePayroll(tx, empId, String(empId), mapping);
      });
      return NextResponse.json({ ok: true, periods: checked.periods.length }, { status: 201 });
    }

    // 従業員のマッピングをすべて解除（期間・旧マッピングとも。人件費データは消さず社員番号ルールで組み直す）
    if (body.action === "remove-employee") {
      const empId = parseEmpId(body.employeeId);
      if (isNaN(empId)) {
        return NextResponse.json({ error: "従業員番号が正しくありません" }, { status: 400 });
      }
      await prisma.$transaction(async (tx) => {
        await tx.storeOverridePeriod.deleteMany({ where: { employeeId: empId } });
        await tx.storeOverride.deleteMany({ where: { employeeId: empId } });
        await recomputeEmployeePayroll(tx, empId, String(empId), null);
      });
      return NextResponse.json({ ok: true });
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
      // 期間を登録済みの従業員は、この操作で旧形式のマッピングに置き換える（後勝ち）
      await tx.storeOverridePeriod.deleteMany({ where: { employeeId: empId } });
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
