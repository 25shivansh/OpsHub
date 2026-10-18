import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = (process.env.DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
