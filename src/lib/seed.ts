import { prisma } from "./prisma";
import { hashPassword } from "./auth";

const INITIAL_OVERRIDES: Array<{
  employeeId: number;
  storeName: string;
  ratio: number;
}> = [
  { employeeId: 5001, storeName: "東日本橋", ratio: 50 },
  { employeeId: 5001, storeName: "春日", ratio: 50 },
  { employeeId: 5002, storeName: "船橋", ratio: 50 },
  { employeeId: 5002, storeName: "巣鴨", ratio: 50 },
];

const INITIAL_EXPENSE_RULES: Array<{
  keyword: string;
  category: string;
}> = [
  { keyword: "Amazon", category: "消耗品費" },
  { keyword: "ヨドバシ", category: "消耗品費" },
  { keyword: "ASKUL", category: "消耗品費" },
  { keyword: "アスクル", category: "消耗品費" },
  { keyword: "Google", category: "広告宣伝費" },
  { keyword: "META", category: "広告宣伝費" },
  { keyword: "Facebook", category: "広告宣伝費" },
  { keyword: "チラシ", category: "広告宣伝費" },
  { keyword: "NTT", category: "通信費" },
  { keyword: "ソフトバンク", category: "通信費" },
  { keyword: "USEN", category: "通信費" },
  { keyword: "freee", category: "支払手数料" },
  { keyword: "Square", category: "支払手数料" },
];

export default async function seed() {
  // Only seed if users table is empty
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (!adminPassword) {
      throw new Error("ADMIN_INITIAL_PASSWORD must be set for initial seeding");
    }
    const hashedPassword = await hashPassword(adminPassword);
    await prisma.user.create({
      data: {
        username: "admin",
        password: hashedPassword,
        role: "admin",
        displayName: "管理者",
      },
    });
    console.log("Admin user created");
  }

  // Only seed if store overrides table is empty
  const overrideCount = await prisma.storeOverride.count();
  if (overrideCount === 0) {
    await prisma.storeOverride.createMany({
      data: INITIAL_OVERRIDES,
    });
    console.log(`${INITIAL_OVERRIDES.length} store overrides created`);
  }

  // Only seed if expense rules table is empty
  const ruleCount = await prisma.expenseRule.count();
  if (ruleCount === 0) {
    await prisma.expenseRule.createMany({
      data: INITIAL_EXPENSE_RULES,
    });
    console.log(`${INITIAL_EXPENSE_RULES.length} expense rules created`);
  }
}
