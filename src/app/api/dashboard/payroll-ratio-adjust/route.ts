import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * 月単位の人件費按分調整 API
 *
 * 用途: 応援勤務・兼務などで「特定の月だけ複数店舗で按分したい」場合に、
 * その月の対象従業員の人件費を任意の比率で再分配する。
 *
 * リクエスト形式:
 *   POST /api/dashboard/payroll-ratio-adjust
 *   {
 *     year: 2026,
 *     month: 4,
 *     employeeId: "1234",
 *     splits: [
 *       { storeName: "東日本橋", ratio: 60 },
 *       { storeName: "春日",     ratio: 40 }
 *     ]
 *   }
 *
 * 動作:
 *   1) その (year, month, employeeId) の既存 PayrollData 行を全件取得し、
 *      「100%換算の元の値」を 1 セットだけ復元する（ratio 100% 相当の生データ）。
 *   2) 既存行を全削除。
 *   3) splits の店舗ごとに新しい行を挿入（金額は 100% 換算のまま、ratio だけ各店舗の値）。
 *
 * 制約:
 *   - admin のみ実行可
 *   - splits の合計 ratio が 100 でなければエラー
 *   - 既存行が 1 件もない employeeId は対象外（拒否）
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const body = await request.json();
    const { year, month, employeeId, splits } = body as {
      year: number;
      month: number;
      employeeId: string;
      splits: { storeName: string; ratio: number }[];
    };

    if (
      !year ||
      !month ||
      !employeeId ||
      !Array.isArray(splits) ||
      splits.length === 0
    ) {
      return NextResponse.json(
        { error: "year, month, employeeId, splits は必須です" },
        { status: 400 },
      );
    }

    // 合計 100% チェック（小数の累積誤差を許容するため誤差±1まで許可）
    const sum = splits.reduce((s, x) => s + (x.ratio || 0), 0);
    if (Math.abs(sum - 100) > 1) {
      return NextResponse.json(
        { error: `合計が100%になりません（現在 ${sum}%）` },
        { status: 400 },
      );
    }

    // 既存行を取得
    const existing = await prisma.payrollData.findMany({
      where: { year, month, employeeId },
    });
    if (existing.length === 0) {
      return NextResponse.json(
        { error: "該当する人件費データがありません。先にCSVを取込んでください。" },
        { status: 404 },
      );
    }

    // 100%換算の生データを復元
    // 既存の各行は (元の値) × (ratio / 100) を反映していたわけではなく、
    // PayrollData の数値フィールドは「元の値そのまま」で ratio は別保持。
    // 集計時に row.value × (ratio / 100) して使う仕様。
    // よって元値の復元は最初の1行をそのまま使えばよい。
    const base = existing[0];

    // splits の中の比率が 0% の店舗は行を作らない
    const validSplits = splits.filter((s) => s.ratio > 0);
    if (validSplits.length === 0) {
      return NextResponse.json(
        { error: "比率が0%の店舗のみは保存できません" },
        { status: 400 },
      );
    }

    // 既存 → 新規 を1トランザクションで置換
    await prisma.$transaction(async (tx) => {
      await tx.payrollData.deleteMany({
        where: { year, month, employeeId },
      });
      await tx.payrollData.createMany({
        data: validSplits.map((s) => ({
          year,
          month,
          employeeId,
          employeeName: base.employeeName,
          contractType: base.contractType,
          storeName: s.storeName,
          ratio: Math.round(s.ratio),
          workDaysWeekday: base.workDaysWeekday,
          workDaysHoliday: base.workDaysHoliday,
          workDaysLegalHoliday: base.workDaysLegalHoliday,
          scheduledHours: base.scheduledHours,
          overtimeHours: base.overtimeHours,
          baseSalary: base.baseSalary,
          positionAllowance: base.positionAllowance,
          overtimePay: base.overtimePay,
          commuteTaxable: base.commuteTaxable,
          commuteNontax: base.commuteNontax,
          taxableTotal: base.taxableTotal,
          grossTotal: base.grossTotal,
          healthInsuranceCo: base.healthInsuranceCo,
          careInsuranceCo: base.careInsuranceCo,
          pensionCo: base.pensionCo,
          childContributionCo: base.childContributionCo,
          pensionFundCo: base.pensionFundCo,
          employmentInsuranceCo: base.employmentInsuranceCo,
          workersCompCo: base.workersCompCo,
          generalContributionCo: base.generalContributionCo,
        })),
      });
    });

    return NextResponse.json({
      ok: true,
      employeeId,
      year,
      month,
      splits: validSplits,
    });
  } catch (err) {
    console.error("payroll-ratio-adjust error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
