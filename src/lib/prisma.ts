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
  // 接続文字列の sslmode パラメータを除去し、SSL設定は下の Pool の ssl オプションに
  // 一本化する。pg 8.x では URL 側の sslmode=require が Pool の ssl 設定より優先され、
  // Supabase の自己署名証明書が検証エラー（self-signed certificate in certificate
  // chain）になるため。従来はプロセス全体の NODE_TLS_REJECT_UNAUTHORIZED=0 で
  // 隠れていた問題で、除去により「検証緩和はDB接続のみ」に限定される。
  let poolConnectionString = connectionString;
  try {
    const u = new URL(connectionString);
    if (u.searchParams.has("sslmode")) {
      u.searchParams.delete("sslmode");
      poolConnectionString = u.toString();
    }
  } catch {
    // URLとして解釈できない形式ならそのまま使う
  }
  // ★接続プーラーを transaction mode（port 6543）に統一する。
  //   Supabase Supavisor の session pooler（port 5432）は同時接続が最大15と少なく、
  //   Vercel サーバーレスで全体ダッシュボードのように複数APIを同時に叩くと
  //   （インスタンス × pool.max が15を超えて）EMAXCONNSESSION で500になる。
  //   transaction pooler（6543）は接続が各クエリ/トランザクション単位で短命に
  //   使い回されるため同時接続上限に強く、サーバーレスではこちらが推奨構成。
  //   （インタラクティブ・トランザクションが 6543 で動作することは検証済み・2026-07）
  //   ※本番の DATABASE_URL が既に 6543 の場合はこの置換は no-op。
  const pooledConnectionString = poolConnectionString.replace(
    /:5432\b/,
    ":6543",
  );
  const pool = new Pool({
    connectionString: pooledConnectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
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
