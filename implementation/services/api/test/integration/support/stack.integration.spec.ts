import { afterAll, beforeAll, expect, it } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
});

afterAll(async () => {
  await stack?.pool.query('DROP TABLE IF EXISTS "StackHarnessProbe"');
  await stack?.release();
});

it("starts PostGIS and Redis with every migration applied", async () => {
  const { rows } = await stack.pool.query(
    "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
  );
  expect(rows).toHaveLength(1);

  const migrations = await stack.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
  );
  expect(migrations.rows[0]?.n).toBeGreaterThanOrEqual(5);
  expect(await stack.redis.ping()).toBe("PONG");
});

it("truncates application tables and Redis without dropping migrations", async () => {
  await stack.pool.query(
    'CREATE TABLE IF NOT EXISTS "StackHarnessProbe" (id integer PRIMARY KEY)',
  );
  await stack.pool.query('INSERT INTO "StackHarnessProbe" (id) VALUES (1)');
  await stack.redis.set("stack-harness-probe", "present");

  await stack.reset();

  const probes = await stack.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "StackHarnessProbe"',
  );
  expect(probes.rows[0]?.n).toBe(0);
  expect(await stack.redis.get("stack-harness-probe")).toBeNull();
  const migrations = await stack.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
  );
  expect(migrations.rows[0]?.n).toBeGreaterThanOrEqual(5);
});
