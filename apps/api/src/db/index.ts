import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

let clientInstance: postgres.Sql | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

/**
 * Initializes and returns the postgres.js client.
 * Configured specifically for Supabase pooler compatibility (prepare: false when in transaction mode).
 */
export function getClient(): postgres.Sql {
  if (!clientInstance) {
    if (!config.DATABASE_URL) {
      throw new Error("DATABASE_URL is not configured in environment");
    }

    // Inspect whether transaction pooling is in use (e.g. Supabase port 6543)
    const isTransactionPooler =
      config.DATABASE_URL.includes(":6543") ||
      config.DATABASE_URL.includes("pooler.supabase.com");

    clientInstance = postgres(config.DATABASE_URL, {
      prepare: isTransactionPooler ? false : true,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return clientInstance;
}

/**
 * Returns the Drizzle ORM instance.
 */
export function getDb() {
  if (!dbInstance) {
    const client = getClient();
    dbInstance = drizzle({ client });
  }
  return dbInstance;
}

/**
 * Convenience getter for standard database usage.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    const instance = getDb();
    return Reflect.get(instance, prop, receiver);
  },
});

/**
 * Gracefully closes the database connection pool.
 */
export async function closeDb(): Promise<void> {
  if (clientInstance) {
    await clientInstance.end({ timeout: 5 });
    clientInstance = null;
    dbInstance = null;
  }
}

export * from "./schema";
export { schema };
