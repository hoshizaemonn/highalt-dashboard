import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { decodeFileBuffer, parseCSV, buildHeaderMap, safeInt } from "@/lib/csv-utils";
import { checkOrigin } from "@/lib/csrf";
import { validateUploadFile } from "@/lib/upload-validation";

const AMAZON_ACCOUNT_USER_MAP: Record<string, string> = {
  "東日本橋スタジオ": "東日本橋",
  "春日スタジオ": "春日",
  "船橋スタジオ": "船橋",
  "巣鴨スタジオ": "巣鴨",
  "ハイアルチ祖師ヶ谷大蔵スタジオ": "祖師ヶ谷大蔵",
  "下北沢スタジオ": "下北沢",
  "中目黒スタジオ": "中目黒",
  "東陽町スタジオ": "東陽町",
  "High Altitude Management株式会社": "本部",
};

/**
 * Detect store from account_user field using AMAZON_ACCOUNT_USER_MAP.
 */
function detectStoreFromAccountUser(accountUser: string): string | null {
  if (!accountUser) return null;
  const trimmed = accountUser.trim();
  if (AMAZON_ACCOUNT_USER_MAP[trimmed]) {
    return AMAZON_ACCOUNT_USER_MAP[trimmed];
  }
  // Partial match
  for (const [key, value] of Object.entries(AMAZON_ACCOUNT_USER_MAP)) {
    if (trimmed.includes(key) || key.includes(trimmed)) {
      return value;
    }
  }
  return null;
}

/**
 * Detect store from delivery address.
 */
function detectStoreFromAddress(address: string): string | null {
  if (!address) return null;
  const storeKeywords: Record<string, string> = {
    "東日本橋": "東日本橋",
    "春日": "春日",
    "船橋": "船橋",
    "巣鴨": "巣鴨",
    "祖師ヶ谷": "祖師ヶ谷大蔵",
    "下北沢": "下北沢",
    "中目黒": "中目黒",
    "東陽町": "東陽町",
  };
  for (const [keyword, store] of Object.entries(storeKeywords)) {
    if (address.includes(keyword)) {
      return store;
    }
  }
  return null;
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

      // Also save to amazon_orders if full order data is provided
      for (const rec of inputRecords) {
        if (rec.orderId && rec.productName) {
          await prisma.amazonOrder.upsert({
            where: {
              orderId_productName: {
                orderId: rec.orderId,
                productName: rec.productName,
              },
            },
            update: {
              asin: rec.asin || "",
              shortName: rec.shortName || "",
              expenseCategory: rec.expenseCategory || "",
              amazonCategory: rec.amazonCategory || "",
            },
            create: {
              orderDate: rec.orderDate || null,
              orderId: rec.orderId,
              storeName: rec.storeName || null,
              productName: rec.productName,
              shortName: rec.shortName || null,
              amount: rec.amount || 0,
              orderTotal: rec.orderTotal || 0,
              paymentDate: rec.paymentDate || null,
              deliveryAddress: rec.deliveryAddress || null,
              asin: rec.asin || "",
              amazonCategory: rec.amazonCategory || "",
              expenseCategory: rec.expenseCategory || "",
              quantity: rec.quantity || 1,
              taxAmount: rec.taxAmount || 0,
              taxRate: rec.taxRate || "",
              accountUser: rec.accountUser || "",
              invoiceNumber: rec.invoiceNumber || "",
            },
          });
        }
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
    if (file) {
      const validationError = validateUploadFile(file);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
    }

    if (!file) {
      return NextResponse.json(
        { error: "file is required" },
        { status: 400 },
      );
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

    const header = allRows[0];
    const hmap = buildHeaderMap(header);
    const dataRows = allRows.slice(1);

    // Load existing product master for auto-classification
    const productMaster = await prisma.amazonProductMaster.findMany();
    const masterByAsin = new Map(productMaster.map((p) => [p.asin, p]));

    const getVal = (row: string[], colName: string): string => {
      const idx = hmap[colName];
      return idx !== undefined && idx < row.length ? row[idx].trim() : "";
    };

    interface AmazonParsedRecord {
      orderDate: string;
      orderId: string;
      storeName: string;
      productName: string;
      shortName: string;
      asin: string;
      amazonCategory: string;
      expenseCategory: string;
      amount: number;
      orderTotal: number;
      quantity: number;
      taxAmount: number;
      taxRate: string;
      accountUser: string;
      deliveryAddress: string;
      paymentDate: string;
      invoiceNumber: string;
    }

    const records: AmazonParsedRecord[] = [];
    let autoClassified = 0;

    for (const row of dataRows) {
      if (row.length < 5) continue;

      const orderDate = getVal(row, "注文日");
      const orderId = getVal(row, "注文番号");
      const productName = getVal(row, "商品名");
      const asin = getVal(row, "ASIN") || getVal(row, "ASIN/ISBN");
      const amazonCategory = getVal(row, "商品カテゴリー") || getVal(row, "カテゴリー");
      const accountUser = getVal(row, "アカウントユーザー") || getVal(row, "注文者");
      const deliveryAddress = getVal(row, "配送先住所") || getVal(row, "届け先住所");
      const paymentDate = getVal(row, "支払い確定日") || getVal(row, "支払い日");
      const invoiceNumber = getVal(row, "適格請求書（または支払い明細書）番号") || getVal(row, "請求書番号");
      const quantity = safeInt(getVal(row, "商品の数量") || getVal(row, "数量")) || 1;
      const amount = safeInt(getVal(row, "商品および配送料の合計（税込）") || getVal(row, "商品小計"));
      const orderTotal = safeInt(getVal(row, "注文の合計（税込）") || getVal(row, "合計"));
      const taxAmount = safeInt(getVal(row, "商品の小計（消費税）") || getVal(row, "税額"));
      const taxRate = getVal(row, "商品の小計（税率）") || getVal(row, "税率");

      // Detect store
      let storeName =
        detectStoreFromAccountUser(accountUser) ||
        detectStoreFromAddress(deliveryAddress) ||
        "";

      // Short name: truncate product name to 30 chars (matching Streamlit version)
      const cleaned = productName.replace(/\s*[\[【（(].*?[\]】）)]/g, "").trim();
      const shortName =
        cleaned.length > 30
          ? cleaned.substring(0, 30) + "…"
          : cleaned;

      // Auto-classify from product master
      let expenseCategory = "";
      const master = masterByAsin.get(asin);
      if (master && master.expenseCategory) {
        expenseCategory = master.expenseCategory;
        autoClassified++;
      }

      records.push({
        orderDate,
        orderId,
        storeName,
        productName,
        shortName,
        asin,
        amazonCategory,
        expenseCategory,
        amount,
        orderTotal,
        quantity,
        taxAmount,
        taxRate,
        accountUser,
        deliveryAddress,
        paymentDate,
        invoiceNumber,
      });
    }

    // Also save all parsed records to amazon_orders for expense breakdown matching
    for (const rec of records) {
      if (rec.orderId && rec.productName) {
        await prisma.amazonOrder.upsert({
          where: {
            orderId_productName: {
              orderId: rec.orderId,
              productName: rec.productName,
            },
          },
          update: {
            asin: rec.asin || "",
            shortName: rec.shortName || "",
            storeName: rec.storeName || null,
            amount: rec.amount || 0,
            orderTotal: rec.orderTotal || 0,
            paymentDate: rec.paymentDate || null,
            amazonCategory: rec.amazonCategory || "",
          },
          create: {
            orderDate: rec.orderDate || null,
            orderId: rec.orderId,
            storeName: rec.storeName || null,
            productName: rec.productName,
            shortName: rec.shortName || null,
            amount: rec.amount || 0,
            orderTotal: rec.orderTotal || 0,
            paymentDate: rec.paymentDate || null,
            deliveryAddress: rec.deliveryAddress || null,
            asin: rec.asin || "",
            amazonCategory: rec.amazonCategory || "",
            expenseCategory: rec.expenseCategory || "",
            quantity: rec.quantity || 1,
            taxAmount: rec.taxAmount || 0,
            taxRate: rec.taxRate || "",
            accountUser: rec.accountUser || "",
            invoiceNumber: rec.invoiceNumber || "",
          },
        });
      }
    }

    return NextResponse.json({
      records,
      autoClassified,
    });
  } catch (error) {
    console.error("Amazon upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
