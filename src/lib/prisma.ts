import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// NODE_TLS_REJECT_UNAUTHORIZED=0 is required because Supabase's PostgreSQL
// connection uses a self-signed SSL certificate. Without this, Node.js rejects
// the TLS handshake with "UNABLE_TO_VERIFY_LEAF_SIGNATURE". In production the
// Pool-level `ssl: { rejectUnauthorized: false }` handles it, but during local
// development / Vercel serverless cold-starts the global flag is also needed to
// cover any connection attempt that bypasses the Pool (e.g. Prisma internals).
if (process.env.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 10000,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
