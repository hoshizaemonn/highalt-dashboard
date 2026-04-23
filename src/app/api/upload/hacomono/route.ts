import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  decodeFileBuffer,
  parseCSV,
  buildHeaderMap,
  getCell,
  safeInt,
  parseDateLoose,
  isInMonth,
} from "@/lib/csv-utils";

const HACOMONO_STORE_MAP: Record<string, string> = {
  "ハイアルチ東日本橋スタジオ": "東日本橋",
  "ハイアルチ春日スタジオ": "春日",
  "ハイアルチ船橋スタジオ": "船橋",
  "ハイアルチ巣鴨スタジオ": "巣鴨",
  "ハイアルチ祖師ヶ谷大蔵スタジオ": "祖師ヶ谷大蔵",
  "ハイアルチ下北沢スタジオ": "下北沢",
  "ハイアルチ中目黒スタジオ": "中目黒",
  "ハイアルチ東陽町スタジオ": "東陽町",
};

function mapHacomonoStore(fullName: string): string {
  const trimmed = fullName.trim();
  if (HACOMONO_STORE_MAP[trimmed]) return HACOMONO_STORE_MAP[trimmed];
  const short = trimmed.replace("ハイアルチ", "").replace("スタジオ", "").trim();
  return short || trimmed;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "";
    const year = parseInt(searchParams.get("year") || "", 10);
    const month = parseInt(searchParams.get("month") || "", 10);
    const store = searchParams.get("store") || "";

    if (!type) {
      return NextResponse.json(
        { error: "type is required" },
        { status: 400 },
      );
    }

    let count = 0;

    if (type === "ml001") {
      if (!store) {
        return NextResponse.json(
          { error: "store is required for ML001" },
          { status: 400 },
        );
      }
      count = await prisma.memberData.count({
        where: { storeName: store },
      });
    } else if (type === "pl001") {
      if (!store || isNaN(year) || isNaN(month)) {
        return NextResponse.json(
          { error: "store, year, month are required for PL001" },
          { status: 400 },
        );
      }
      count = await prisma.salesDetail.count({
        where: { year, month, storeName: store },
      });
    } else if (type === "ma002") {
      if (!store || isNaN(year) || isNaN(month)) {
        return NextResponse.json(
          { error: "store, year, month are required for MA002" },
          { status: 400 },
        );
      }
      count = await prisma.monthlySummary.count({
        where: { year, month, storeName: store },
      });
    } else {
      return NextResponse.json(
        { error: "Invalid type. Use ml001, pl001, or ma002." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      exists: count > 0,
      count,
    });
  } catch (error) {
    console.error("Hacomono check error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as string; // ml001, pl001, ma002
    const store = formData.get("store") as string;
    const year = parseInt(formData.get("year") as string, 10);
    const month = parseInt(formData.get("month") as string, 10);
    // dryRun: CSV を解析して検知した (年, 月) に対する既存レコード件数だけ返し、
    // DB への書き込みは行わない。アップロード前の上書き警告用。
    const dryRun = formData.get("dryRun") === "true";

    if (!file || !type) {
      return NextResponse.json(
        { error: "file and type are required" },
        { status: 400 },
      );
    }

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const text = decodeFileBuffer(buffer);
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return NextResponse.json(
        { error: "CSVにデータ行がありません" },
        { status: 400 },
      );
    }

    const header = allRows[0];
    const hmap = buildHeaderMap(header);
    const dataRows = allRows.slice(1);

    // ─── ML001: Member Data ───────────────────────────────────
    if (type === "ml001") {
      if (!store) {
        return NextResponse.json(
          { error: "store is required for ML001" },
          { status: 400 },
        );
      }

      const colIdx = (name: string, fallback: number) =>
        hmap[name] !== undefined ? hmap[name] : fallback;

      const idxMemberId = colIdx("メンバーID", 0);
      const idxMemberName = colIdx("氏名", 2);
      const idxTrialDate = colIdx("無料体験会 受講日時", 37);
      const idxFirstTrial = colIdx("トライアル 初回受講日時", 38);
      const idxJoinDate = colIdx("入会日時", 39);
      const idxMemberStore = colIdx("メンバー所属店舗名", 44);
      const idxPlanName = colIdx("契約プラン名", 47);
      const idxCurrentStore = colIdx("所属店舗名", 49);
      const idxPlanEndDate = colIdx("プラン契約適用終了日", 52);
      const idxInitialPlan = colIdx("初回契約プラン", 55);
      const idxTenure = colIdx("在籍期間", 56);
      const idxPlanContractDate = colIdx("プラン契約日", 50);

      const now = new Date();
      const effectiveYear = isNaN(year) ? now.getFullYear() : year;
      const effectiveMonth = isNaN(month) ? now.getMonth() + 1 : month;
      const today = new Date();

      if (dryRun) {
        const existingCount = await prisma.memberData.count({
          where: { storeName: store },
        });
        return NextResponse.json({
          dryRun: true,
          type: "ml001",
          exists: existingCount > 0,
          existingCount,
          store,
          year: effectiveYear,
          month: effectiveMonth,
        });
      }

      interface MemberRecord {
        year: number;
        month: number;
        storeName: string;
        memberId: string | null;
        memberName: string | null;
        planName: string | null;
        joinDate: string | null;
        tenure: string | null;
        isActive: number;
        isNew: number;
        hadTrial: number;
        planEndDate: string | null;
        trialDate: string | null;
        firstTrialDate: string | null;
        initialPlan: string | null;
      }

      const records: MemberRecord[] = [];

      for (const row of dataRows) {
        if (row.length < 10) continue;

        const planName = getCell(row, idxPlanName);
        if (!planName) continue;

        let storeFull = getCell(row, idxCurrentStore);
        if (!storeFull) storeFull = getCell(row, idxMemberStore);
        const storeShort = storeFull ? mapHacomonoStore(storeFull) : store;

        const trialDateStr = getCell(row, idxTrialDate);
        const firstTrialStr = getCell(row, idxFirstTrial);
        const joinDateStr = getCell(row, idxJoinDate);
        const planEndStr = getCell(row, idxPlanEndDate);
        const planContractDateStr = getCell(row, idxPlanContractDate);
        const tenure = getCell(row, idxTenure);
        const initialPlan = getCell(row, idxInitialPlan);

        const planEndDt = parseDateLoose(planEndStr);
        const planContractDt = parseDateLoose(planContractDateStr);
        const trialDt = parseDateLoose(trialDateStr);
        const firstTrialDt = parseDateLoose(firstTrialStr);

        const isSuspended = planName.includes("休会");
        const hasEnded = planEndDt !== null && planEndDt < today;
        const isActive = isSuspended || hasEnded ? 0 : 1;

        let isNew = 0;
        if (tenure === "1ヶ月目") {
          isNew = 1;
        } else if (
          isInMonth(planContractDt, effectiveYear, effectiveMonth)
        ) {
          isNew = 1;
        }

        let hadTrial = 0;
        if (
          isInMonth(trialDt, effectiveYear, effectiveMonth) ||
          isInMonth(firstTrialDt, effectiveYear, effectiveMonth)
        ) {
          hadTrial = 1;
        }

        records.push({
          year: effectiveYear,
          month: effectiveMonth,
          storeName: storeShort,
          memberId: getCell(row, idxMemberId) || null,
          memberName: getCell(row, idxMemberName) || null,
          planName,
          joinDate: joinDateStr || null,
          tenure: tenure || null,
          isActive,
          isNew,
          hadTrial,
          planEndDate: planEndStr || null,
          trialDate: trialDateStr || null,
          firstTrialDate: firstTrialStr || null,
          initialPlan: initialPlan || null,
        });
      }

      // Delete existing member data for this store, then insert
      await prisma.$transaction(async (tx) => {
        await tx.memberData.deleteMany({
          where: { storeName: store },
        });

        if (records.length > 0) {
          await tx.memberData.createMany({ data: records });
        }

        await tx.uploadLog.create({
          data: {
            userId: session.userId,
            userName:
              session.displayName || session.storeName || "ユーザー",
            dataType: "hacomono_ml001",
            storeName: store,
            year: effectiveYear,
            month: effectiveMonth,
            fileName: file.name,
            recordCount: records.length,
          },
        });
      });

      return NextResponse.json({
        records: records.length,
        type: "ml001",
      });
    }

    // ─── PL001: Sales Detail ──────────────────────────────────
    if (type === "pl001") {
      if (!store || isNaN(year) || isNaN(month)) {
        return NextResponse.json(
          { error: "store, year, month are required for PL001" },
          { status: 400 },
        );
      }

      const getVal = (row: string[], colName: string): string => {
        const idx = hmap[colName];
        return idx !== undefined && idx < row.length ? row[idx].trim() : "";
      };
      const getIntVal = (row: string[], colName: string): number => {
        return safeInt(getVal(row, colName));
      };

      interface SalesRecord {
        year: number;
        month: number;
        storeName: string;
        saleId: string | null;
        saleDate: string | null;
        paymentMethod: string | null;
        description: string | null;
        category: string | null;
        amount: number;
        tax: number;
        discount: number;
      }

      // dryRun: 先頭データ行から年月を検知して既存件数を返すだけ
      if (dryRun) {
        let detYear: number | null = null;
        let detMonth: number | null = null;
        for (const row of dataRows) {
          const saleDate = getVal(row, "精算日時");
          if (!saleDate) continue;
          const dt = parseDateLoose(saleDate);
          if (dt) {
            detYear = dt.getFullYear();
            detMonth = dt.getMonth() + 1;
            break;
          }
        }
        const y = detYear ?? (isNaN(year) ? null : year);
        const m = detMonth ?? (isNaN(month) ? null : month);
        let existingCount = 0;
        if (y !== null && m !== null) {
          existingCount = await prisma.salesDetail.count({
            where: { year: y, month: m, storeName: store },
          });
        }
        return NextResponse.json({
          dryRun: true,
          type: "pl001",
          exists: existingCount > 0,
          existingCount,
          store,
          year: y,
          month: m,
        });
      }

      const records: SalesRecord[] = [];
      let detectedYear: number | null = null;
      let detectedMonth: number | null = null;

      for (const row of dataRows) {
        if (row.length < 5) continue;

        const saleId = getVal(row, "売上ID");
        const saleDate = getVal(row, "精算日時");
        const storeFull = getVal(row, "購入店舗");
        const paymentMethod = getVal(row, "支払方法");
        const description = getVal(row, "摘要");
        const amount = getIntVal(row, "合計金額");
        const tax = getIntVal(row, "内税");
        const discount = getIntVal(row, "割引金額");

        const storeShort = storeFull
          ? mapHacomonoStore(storeFull)
          : store;

        // Auto-detect year/month from first row
        if (detectedYear === null && saleDate) {
          const dt = parseDateLoose(saleDate);
          if (dt) {
            detectedYear = dt.getFullYear();
            detectedMonth = dt.getMonth() + 1;
          }
        }

        // Simple category classification based on description
        // NOTE: 月会費/月額 を 入会金 より先に判定する。hacomono の新規入会行は
        // 「初月会費(日割) + 翌月分月会費 + 入会金 + 事務手数料 ...」が 1 行にまとまっており、
        // 「入会」で先にマッチさせると月会費分まで入会金カテゴリに吸収され、客単価実績が過少になる。
        // また「入会」→「入会金」と厳密化し、プロモ名等の誤マッチを防ぐ。
        let category: string | null = null;
        if (description) {
          if (description.includes("パーソナル")) category = "パーソナル";
          else if (description.includes("体験")) category = "体験";
          else if (description.includes("月会費") || description.includes("月額"))
            category = "月会費";
          else if (description.includes("入会金")) category = "入会金";
          else if (description.includes("スポット")) category = "スポット";
          else if (description.includes("ロッカー")) category = "ロッカー";
          else if (description.includes("オプション")) category = "オプション";
          else if (description.includes("クーポン") || description.includes("割引"))
            category = "クーポン/割引";
          else category = "その他";
        }

        records.push({
          year: detectedYear || year,
          month: detectedMonth || month,
          storeName: storeShort,
          saleId: saleId || null,
          saleDate: saleDate || null,
          paymentMethod: paymentMethod || null,
          description: description || null,
          category,
          amount,
          tax,
          discount,
        });
      }

      const saveYear = detectedYear || year;
      const saveMonth = detectedMonth || month;

      // Override year/month on all records
      for (const r of records) {
        r.year = saveYear;
        r.month = saveMonth;
      }

      await prisma.$transaction(async (tx) => {
        await tx.salesDetail.deleteMany({
          where: { year: saveYear, month: saveMonth, storeName: store },
        });

        if (records.length > 0) {
          await tx.salesDetail.createMany({ data: records });
        }

        await tx.uploadLog.create({
          data: {
            userId: session.userId,
            userName:
              session.displayName || session.storeName || "ユーザー",
            dataType: "hacomono_pl001",
            storeName: store,
            year: saveYear,
            month: saveMonth,
            fileName: file.name,
            recordCount: records.length,
          },
        });
      });

      return NextResponse.json({
        records: records.length,
        type: "pl001",
        year: saveYear,
        month: saveMonth,
      });
    }

    // ─── MA002: Monthly Summary ───────────────────────────────
    if (type === "ma002") {
      if (!store) {
        return NextResponse.json(
          { error: "store is required for MA002" },
          { status: 400 },
        );
      }

      const getVal = (row: string[], colName: string): string => {
        const idx = hmap[colName];
        return idx !== undefined && idx < row.length ? row[idx].trim() : "";
      };
      const getIntVal = (row: string[], colName: string): number => {
        return safeInt(getVal(row, colName));
      };

      interface SummaryRecord {
        year: number;
        month: number;
        storeName: string;
        totalMembers: number;
        planSubscribers: number;
        planSubscribers1st: number;
        newRegistrations: number;
        newPlanApplications: number;
        newPlanSignups: number;
        planChanges: number;
        suspensions: number;
        cancellations: number;
        cancellationRate: string;
      }

      // dryRun: 対象年月 列から (年, 月) を抽出し、既存件数を合計して返す
      if (dryRun) {
        const periods = new Set<string>();
        for (const row of dataRows) {
          if (row.length < 3) continue;
          const targetYm = getVal(row, "対象年月");
          if (targetYm.length === 6) {
            const y = parseInt(targetYm.slice(0, 4), 10);
            const m = parseInt(targetYm.slice(4, 6), 10);
            if (!isNaN(y) && !isNaN(m)) periods.add(`${y}-${m}`);
          }
        }
        let existingCount = 0;
        let firstY: number | null = null;
        let firstM: number | null = null;
        for (const key of periods) {
          const [y, m] = key.split("-").map(Number);
          if (firstY === null) {
            firstY = y;
            firstM = m;
          }
          existingCount += await prisma.monthlySummary.count({
            where: { year: y, month: m, storeName: store },
          });
        }
        return NextResponse.json({
          dryRun: true,
          type: "ma002",
          exists: existingCount > 0,
          existingCount,
          store,
          year: firstY,
          month: firstM,
          periodCount: periods.size,
        });
      }

      const records: SummaryRecord[] = [];

      for (const row of dataRows) {
        if (row.length < 3) continue;

        // Try to detect year/month from 対象年月 column
        const targetYm = getVal(row, "対象年月");
        let rowYear = year;
        let rowMonth = month;
        if (targetYm.length === 6) {
          const y = parseInt(targetYm.slice(0, 4), 10);
          const m = parseInt(targetYm.slice(4, 6), 10);
          if (!isNaN(y) && !isNaN(m)) {
            rowYear = y;
            rowMonth = m;
          }
        }

        // NOTE: hacomono の MA002 CSV 列名が途中で変更されているため、
        // 旧名（店舗在籍〜 / プラン新規入会数）でも拾えるようフォールバックを入れる。
        const totalMembers =
          getIntVal(row, "店舗全体会員数") || getIntVal(row, "店舗在籍会員数");
        const newRegistrations =
          getIntVal(row, "店舗全体新規会員登録数") ||
          getIntVal(row, "店舗在籍新規会員登録数");
        const newPlanSignups =
          getIntVal(row, "プラン新規契約数") || getIntVal(row, "プラン新規入会数");

        records.push({
          year: rowYear,
          month: rowMonth,
          storeName: store,
          totalMembers,
          planSubscribers: getIntVal(row, "プラン契約者数"),
          planSubscribers1st: getIntVal(row, "プラン契約者数 (1日時点)"),
          newRegistrations,
          newPlanApplications: getIntVal(row, "プラン新規申込数"),
          newPlanSignups,
          planChanges: getIntVal(row, "プラン変更数"),
          suspensions: getIntVal(row, "休会数"),
          cancellations: getIntVal(row, "退会数"),
          cancellationRate: getVal(row, "退会率"),
        });
      }

      await prisma.$transaction(async (tx) => {
        // Delete existing summaries for this store and these year/month combos
        for (const rec of records) {
          await tx.monthlySummary.deleteMany({
            where: {
              year: rec.year,
              month: rec.month,
              storeName: store,
            },
          });
        }

        if (records.length > 0) {
          await tx.monthlySummary.createMany({ data: records });
        }

        await tx.uploadLog.create({
          data: {
            userId: session.userId,
            userName:
              session.displayName || session.storeName || "ユーザー",
            dataType: "hacomono_ma002",
            storeName: store,
            year: records[0]?.year || year,
            month: records[0]?.month || month,
            fileName: file.name,
            recordCount: records.length,
          },
        });
      });

      return NextResponse.json({
        records: records.length,
        type: "ma002",
      });
    }

    return NextResponse.json(
      { error: "Invalid type. Use ml001, pl001, or ma002." },
      { status: 400 },
    );
  } catch (error) {
    console.error("Hacomono upload error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
