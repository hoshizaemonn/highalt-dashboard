import "dotenv/config";
import { defineConfig } from "prisma/config";

const dbUrl = process.env["DATABASE_URL"] || "";
// Ensure pgbouncer and SSL params are set for Supabase pooler
const url = dbUrl.includes("sslmode=") ? dbUrl : `${dbUrl}${dbUrl.includes("?") ? "&" : "?"}sslmode=require`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url,
  },
});
