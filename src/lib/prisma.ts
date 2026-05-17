import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// NODE_TLS_REJECT_UNAUTHORIZED=0 is required because Supabase's PostgreSQL
// connection uses a self-signed SSL certificate. Without this, Node.js rejects
// the TLS handshake with "UNABLE_TO_VERIFY_LEAF_SIGNATURE". In production the
// Pool-level `ssl: { rejectUnauthorized: false }` handles it, but during local
// development / Vercel serverless cold-starts the global flag is also needed to
// cover any connection attempt that bypasses the Pool (e.g. Prisma internals).
// Required for Supabase self-signed SSL certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  // Supabase Supavisor pooler port 5432 = session mode（max 15 接続上限）
  // Vercel サーバーレスは関数インスタンスごとに pg Pool を持つため、
  // インスタンス × max が Supavisor 上限を超えると EMAXCONNSESSION エラーになる。
  // max を低めに抑えて、複数インスタンス同時起動でも上限内に収まるようにする。
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
