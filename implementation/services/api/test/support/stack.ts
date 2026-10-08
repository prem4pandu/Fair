import { Redis } from "ioredis";
import { Pool } from "pg";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

const requiredTestUrl = (key: "databaseUrl" | "redisUrl"): string => {
  const value = inject(key);
  if (!value) throw new Error(`Missing shared integration ${key}`);
  return value;
};

export type Stack = {
  databaseUrl: string;
  redisUrl: string;
  pool: Pool;
  redis: Redis;
  reset(): Promise<void>;
  release(): Promise<void>;
};

// The Vitest global setup owns the containers. Each test file opens only its
// own bounded clients and releases them without stopping the shared services.
export async function startStack(): Promise<Stack> {
  const databaseUrl = requiredTestUrl("databaseUrl");
  const redisUrl = requiredTestUrl("redisUrl");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
  });
  pool.on("error", () => {});

  const redis = new Redis(redisUrl, {
    connectTimeout: 5_000,
    commandTimeout: 15_000,
    maxRetriesPerRequest: 2,
    retryStrategy: (attempt) =>
      attempt > 2 ? null : Math.min(attempt * 50, 200),
  });
  redis.on("error", () => {});

  let released = false;
  return {
    databaseUrl,
    redisUrl,
    pool,
    redis,
    async reset() {
      if (released)
        throw new Error("Cannot reset a released integration stack");
      const { rows } = await pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys') ORDER BY tablename",
      );
      if (rows.length > 0) {
        const tables = rows
          .map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
          .join(", ");
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Test isolation must also clear append-only production tables. This
          // privileged setting is scoped to the reset transaction and is never
          // used by application connections.
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      await redis.flushdb();
    },
    async release() {
      if (released) return;
      released = true;
      redis.disconnect(false);
      await pool.end();
    },
  };
}
