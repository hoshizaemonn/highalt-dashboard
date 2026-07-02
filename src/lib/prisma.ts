import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

// セキュリティ強化(2026-07): NODE_TLS_REJECT_UNAUTHORIZED=0 のグローバル設定を廃止。
// この設定はDB接続だけでなくNode.jsプロセスの「全ての」外向きTLS通信の証明書検証を
// 無効化してしまうため危険（中間者攻撃を検出できない）。
// Supabaseの自己署名証明書への対応は、下の Pool レベルの
// `ssl: { rejectUnauthorized: false }` だけで足りる
// （driver adapter 経由の接続は全てこの Pool を通る）。

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

// 遅延初期化(2026-07): モジュール読み込み時ではなく、最初にDBアクセスした時に
// クライアントを生成する。Next.jsのビルド（Collecting page data）はAPIルートを
// importするだけでDBに触らないため、DATABASE_URL が無い環境（Vercelプレビュー等）
// でもビルドが通る。実行時の挙動は従来と同一。
function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});
