import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkOrigin } from "@/lib/csrf";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const categories = await prisma.expenseCategory.findMany({
      orderBy: { id: "asc" },
    });

    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Expense categories GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Bulk import from CSV
    if (Array.isArray(body.categories)) {
      let created = 0;
      let updated = 0;
      let rulesCreated = 0;

      for (const cat of body.categories) {
        if (!cat.name) continue;
        const existing = await prisma.expenseCategory.findFirst({
          where: { name: cat.name },
        });
        if (existing) {
          await prisma.expenseCategory.update({
            where: { id: existing.id },
            data: {
              description: cat.description || existing.description,
              examples: cat.examples || existing.examples,
              categoryType: cat.categoryType || existing.categoryType,
            },
          });
          updated++;
        } else {
          await prisma.expenseCategory.create({
            data: {
              name: cat.name,
              description: cat.description || "",
              examples: cat.examples || "",
              categoryType: cat.categoryType || "expense",
            },
          });
          created++;
        }

        // Auto-generate expense rules from examples (for expense type only)
        if (cat.categoryType === "expense" && cat.examples) {
          // Split examples by common separators: ・、/,
          const keywords = cat.examples
            .split(/[・、/,／]/)
            .map((k: string) => k.trim())
            .filter((k: string) => k.length >= 2 && k.length <= 30);

          for (const keyword of keywords) {
            // Skip generic/unhelpful keywords
            if (["など", "等", "その他", "ほか"].includes(keyword)) continue;

            const existingRule = await prisma.expenseRule.findFirst({
              where: { keyword },
            });
            if (!existingRule) {
              try {
                await prisma.expenseRule.create({
                  data: { keyword, category: cat.name },
                });
                rulesCreated++;
              } catch {
                // Ignore duplicate key errors
              }
            }
          }
        }
      }
      return NextResponse.json({ created, updated, rulesCreated }, { status: 201 });
    }

    // Single add
    const { name, description, examples, categoryType } = body;
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const category = await prisma.expenseCategory.upsert({
      where: { name },
      update: { description: description || "", examples: examples || "", categoryType: categoryType || "expense" },
      create: { name, description: description || "", examples: examples || "", categoryType: categoryType || "expense" },
    });

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    console.error("Expense categories POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.expenseCategory.delete({
      where: { id: parseInt(id, 10) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Expense categories DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
