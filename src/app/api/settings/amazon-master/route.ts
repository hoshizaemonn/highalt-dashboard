import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, requireAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";

    const where = q
      ? {
          OR: [
            { asin: { contains: q, mode: "insensitive" as const } },
            { productName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const entries = await prisma.amazonProductMaster.findMany({
      where,
      orderBy: { id: "desc" },
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Amazon master GET error:", error);
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

    // Bulk import from CSV
    if (body.action === "bulk-import") {
      const { csvText } = body;
      if (!csvText) {
        return NextResponse.json(
          { error: "csvText is required" },
          { status: 400 },
        );
      }

      const lines = csvText.split("\n").filter((l: string) => l.trim());
      // Skip header line
      const dataLines = lines.slice(1);

      let created = 0;
      let skipped = 0;

      for (const line of dataLines) {
        // Parse CSV line (handle quoted fields)
        const fields = parseCSVLine(line);
        if (fields.length < 1) continue;

        // Try to find ASIN in fields - look for pattern B0... or similar
        let asin = "";
        let productName = "";
        for (const field of fields) {
          const trimmed = field.trim();
          if (/^B[0-9A-Z]{9}$/.test(trimmed)) {
            asin = trimmed;
          }
        }

        // If no ASIN found, skip
        if (!asin) {
          skipped++;
          continue;
        }

        // Use second field as product name if available
        if (fields.length >= 2) {
          productName = fields[1]?.trim() || "";
        }

        // Check if already exists
        const existing = await prisma.amazonProductMaster.findUnique({
          where: { asin },
        });

        if (existing) {
          skipped++;
          continue;
        }

        await prisma.amazonProductMaster.create({
          data: {
            asin,
            productName,
            amazonCategory: "",
            expenseCategory: "消耗品費",
            lastSeenDate: new Date().toISOString().split("T")[0],
            updatedAt: new Date().toISOString().split("T")[0],
          },
        });
        created++;
      }

      return NextResponse.json({ created, skipped }, { status: 201 });
    }

    // Single upsert
    const { asin, productName, amazonCategory, expenseCategory } = body;

    if (!asin || !expenseCategory) {
      return NextResponse.json(
        { error: "asin and expenseCategory are required" },
        { status: 400 },
      );
    }

    const entry = await prisma.amazonProductMaster.upsert({
      where: { asin },
      update: {
        productName: productName || "",
        amazonCategory: amazonCategory || "",
        expenseCategory,
        updatedAt: new Date().toISOString().split("T")[0],
      },
      create: {
        asin,
        productName: productName || "",
        amazonCategory: amazonCategory || "",
        expenseCategory,
        lastSeenDate: new Date().toISOString().split("T")[0],
        updatedAt: new Date().toISOString().split("T")[0],
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error("Amazon master POST error:", error);
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

    await prisma.amazonProductMaster.delete({
      where: { id: parseInt(id, 10) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Amazon master DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
