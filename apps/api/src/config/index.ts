import dotenv from "dotenv";
import { z } from "zod";

// Load environment configuration
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z
    .string()
    .transform((val) => val.trim().replace(/^["']|["']$/g, ""))
    .optional(),
  JWT_SECRET: z
    .string()
    .min(16, "JWT_SECRET must be at least 16 characters long")
    .default("newtonite-dev-jwt-secret-key-at-least-32-chars!"),
  JWT_EXPIRES_IN: z.string().default("24h"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.format());
  throw new Error("Invalid environment configuration");
}

export const config = parsed.data;
export type Config = z.infer<typeof envSchema>;
