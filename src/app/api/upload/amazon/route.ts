import { logError } from "@/lib/log";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { decodeFileBuffer, parseCSV, buildHeaderMap, safeInt } from "@/lib/csv-utils";
import {
  applyAmazonImport,
  assignLineSeq,
  parseAmazonOrderRows,
  planAmazonImport,
  type AmazonParsedRecord,
} from "@/lib/amazon-orders";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";

    // ─── Save action (JSON body) ─────────────────────────────
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { records: inputRecords } = body;

      if (!Array.isArray(inputRecords) || inputRecords.length === 0) {
        return NextResponse.json(
          { error: "records array is required" },
          { status: 400 },
        );
      }

      // 非admin（店長）は自店舗以外のレコードを送信できないように
      // 全レコードの storeName を自店舗に強制する。
      if (session.role !== "admin" && session.storeName) {
        for (const rec of inputRecords) {
          rec.storeName = session.storeName;
        }
      }

      // Save to product master (upsert — always update with latest product name)
      for (const rec of inputRecords) {
        if (rec.asin) {
          await prisma.amazonProductMaster.upsert({
            where: { asin: rec.asin },
            update: {
              productName: rec.productName || rec.shortName || "",
              amazonCategory: rec.amazonCategory || "",
              expenseCategory: rec.expenseCategory || "",
              lastSeenDate: new Date().toISOString().split("T")[0],
              updatedAt: new Date().toISOString(),
            },
            create: {
              asin: rec.asin,
              productName: rec.productName || rec.shortName || "",
              amazonCategory: rec.amazonCategory || "",
              expenseCategory: rec.expenseCategory || "",
              lastSeenDate: new Date().toISOString().split("T")[0],
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }

      // 注文データ（orderId・productName つき）が渡された場合は、注文番号ごとに差し替える
      // （画面からの保存は商品マスタのみで、ここは通らない。API直接利用向け）。
      const orderRecords: AmazonParsedRecord[] = inputRecords
        .filter((rec: { orderId?: string; productName?: string }) => rec.orderId && rec.productName)
        .map((rec: Partial<AmazonParsedRecord>) => ({
          orderDate: rec.orderDate || "", orderId: rec.orderId || "", storeName: rec.storeName || "",
          productName: rec.productName || "", shortName: rec.shortName || "", asin: rec.asin || "",
          amazonCategory: rec.amazonCategory || "", expenseCategory: rec.expenseCategory || "",
          amount: rec.amount || 0, orderTotal: rec.orderTotal || 0, quantity: rec.quantity || 1,
          taxAmount: rec.taxAmount || 0, taxRate: rec.taxRate || "", accountUser: rec.accountUser || "",
          deliveryAddress: rec.deliveryAddress || "", paymentDate: rec.paymentDate || "",
          invoiceNumber: rec.invoiceNumber || "", trackingNo: rec.trackingNo || "", lineSeq: 0,
        }));
      assignLineSeq(orderRecords);
      if (orderRecords.length > 0) {
        await prisma.$transaction((tx) => applyAmazonImport(tx, orderRecords));
      }

      await prisma.uploadLog.create({
        data: {
          userId: session.userId,
          userName: session.displayName || session.storeName || "ユーザー",
          dataType: "amazon",
          fileName: "Amazon CSV",
          recordCount: inputRecords.length,
        },
      });

      return NextResponse.json({
        saved: inputRecords.length,
      });
    }

    // ─── Parse action (FormData) ─────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "file is required" },
        { status: 400 },
      );
    }

    const { validateUploadedFile } = await import("@/lib/upload-validation");
    const fileError = validateUploadedFile(file);
    if (fileError) {
      return NextResponse.json({ error: fileError }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    // Amazon Business CSV is utf-8-sig
    const text = decodeFileBuffer(buffer);
    const allRows = parseCSV(text);

    if (allRows.length < 2) {
      return NextResponse.json(
        { error: "CSVにデータ行がありません" },
        { status: 400 },
      );
    }

    // Load existing product master for auto-classification
    const productMaster = await prisma.amazonProductMaster.findMany();
    const masterByAsin = new Map(productMaster.map((p) => [p.asin, p]));

    const { records, autoClassified } = parseAmazonOrderRows(allRows, masterByAsin, {
      buildHeaderMap,
      safeInt,
    });

    // 取込計画（ファイルに含まれる注文番号の既存行の集計と比べる）。書き込みなしの dryRun でもこれを返す。
    const orderIds = [...new Set(records.filter((r) => r.orderId && r.productName).map((r) => r.orderId))];
    const grouped = orderIds.length
      ? await prisma.amazonOrder.groupBy({
          by: ["orderId"],
          where: { orderId: { in: orderIds } },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : [];
    const plan = planAmazonImport(
      records,
      grouped.map((g) => ({ orderId: g.orderId ?? "", lines: g._count._all, total: g._sum.amount ?? 0 })),
    );

    if (formData.get("dryRun") === "true") {
      // 書き込みなし。個人情報（住所など）を含む records は返さず、集計だけを返す。
      const { perOrder: _perOrder, ...summary } = plan;
      void _perOrder;
      return NextResponse.json({
        dryRun: true,
        plan: summary,
        changedOrders: plan.perOrder.filter((p) => p.status === "changed"),
        autoClassified,
      });
    }

    // 注文番号ごとに差し替え（その注文の既存行を削除して、新しい行を投入）。他の注文には触れない。
    const applied = await prisma.$transaction((tx) => applyAmazonImport(tx, records));

    return NextResponse.json({
      records,
      autoClassified,
      import: {
        orders: applied.orders,
        deleted: applied.deleted,
        created: applied.created,
        warnings: plan.shrunkOrders.length
          ? [`既存より行数が減った注文が${plan.shrunkOrders.length}件あります（部分的なエクスポートの可能性）`]
          : [],
      },
    });
  } catch (error) {
    logError("Amazon upload error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
