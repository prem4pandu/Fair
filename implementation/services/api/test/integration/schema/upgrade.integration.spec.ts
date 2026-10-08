import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";
import { newId, parseId } from "../../../src/kernel/ids.js";

const exec = promisify(execFile);
const apiDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const migrationsDirectory = new URL(
  "../../../prisma/migrations/",
  import.meta.url,
);
const prisma = fileURLToPath(
  new URL("../../../node_modules/.bin/prisma", import.meta.url),
);
const tables = [
  "FoundationMigration",
  "IdentityUser",
  "IdentityCredential",
  "IdentityApplicationGrant",
  "IdentitySessionFamily",
  "IdentityRefreshSession",
  "IdentityAuditEvent",
  "CatalogMerchant",
  "CatalogOutlet",
  "CatalogCategory",
  "CatalogItem",
  "CustomerAddress",
  "RuntimeConfigurationVersion",
  "RuntimeConfigurationPointer",
];
let stack: Stack;
let api: Api | undefined;
const databases: { name: string; pool: Pool }[] = [];

beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await api?.close();
  for (const database of databases) {
    await database.pool.end();
    // Do not terminate live clients: a leaked connection must fail cleanup
    // instead of emitting asynchronous administrator-termination errors.
    await stack.pool.query(`DROP DATABASE "${database.name}"`);
  }
  await stack?.release();
});

async function database(label: string) {
  const name = `upgrade_${label}_${process.pid}`;
  await stack.pool.query(`CREATE DATABASE "${name}"`);
  const url = new URL(stack.databaseUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  databases.push({ name, pool });
  return { pool, databaseUrl: url.toString() };
}
async function migrate(databaseUrl: string, args: string[]) {
  await exec(prisma, ["migrate", ...args], {
    cwd: apiDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 120_000,
  });
}
async function snapshot(pool: Pool) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    result[table] = (
      await pool.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
  }
  return result;
}

it("preserves every populated migration-005 row through the complete deployed history and API reads", async () => {
  const upgraded = await database("populated");
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d/.test(name))
    .sort();
  const baseline = migrations.filter((name) => name.startsWith("20261008000"));
  expect(baseline).toHaveLength(5);
  for (const name of baseline) {
    await upgraded.pool.query(
      await readFile(
        new URL(`${name}/migration.sql`, migrationsDirectory),
        "utf8",
      ),
    );
    await migrate(upgraded.databaseUrl, ["resolve", "--applied", name]);
  }
  await upgraded.pool.query(
    await readFile(
      new URL("migration-005.fixture.sql", import.meta.url),
      "utf8",
    ),
  );
  const before = await snapshot(upgraded.pool);
  await migrate(upgraded.databaseUrl, ["deploy"]);
  expect(await snapshot(upgraded.pool)).toEqual(before);
  const applied = await upgraded.pool.query(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name',
  );
  expect(applied.rows.map((row) => row.migration_name)).toEqual(migrations);

  // Original immutability, relationship and uniqueness guarantees still hold.
  for (const sql of [
    'UPDATE "RuntimeConfigurationVersion" SET version=10',
    'DELETE FROM "IdentityRefreshSession"',
    'UPDATE "IdentitySessionFamily" SET "userId"=\'22222222-2222-4222-8222-222222222222\'',
    'UPDATE "CustomerAddress" SET selected=true',
    'UPDATE "CatalogItem" SET "priceMinor"=-1',
    'UPDATE "CatalogItem" SET "outletId"=\'11111111-1111-4111-8111-111111111111\'',
  ])
    await expect(upgraded.pool.query(sql)).rejects.toThrow();
  expect(await snapshot(upgraded.pool)).toEqual(before);
  await expect(
    upgraded.pool.query(
      'INSERT INTO "RuntimeConfigurationVersion"(id,version,document) SELECT $1,3,document || \'{"deliveryFleets":{}}\'::jsonb FROM "RuntimeConfigurationVersion" WHERE version=2',
      [newId()],
    ),
  ).rejects.toThrow();
  const id = newId();
  expect(id[14]).toBe("7");
  expect(parseId(id, "user")).toBe(id);
  expect(parseId("11111111-1111-4111-8111-111111111111", "user")).toBe(
    "11111111-1111-4111-8111-111111111111",
  );
  await upgraded.pool.query(
    "INSERT INTO \"IdentityUser\"(id,email,\"displayName\",roles) VALUES($1,'new@example.test','New User',ARRAY['CUSTOMER'])",
    [id],
  );

  api = await startApi({ ...stack, ...upgraded });
  const configuration = await api.http.query<{
    configuration: { currency: string; currencySymbol: string };
  }>("{ configuration { currency currencySymbol } }");
  expect(configuration.errors).toEqual([]);
  expect(configuration.data?.configuration).toEqual({
    currency: "SGD",
    currencySymbol: "S$",
  });
  const catalog = await api.http.query<{
    restaurant: { _id: string; name: string };
  }>("query($id:String!){ restaurant(id:$id){ _id name } }", {
    id: "99999999-9999-4999-8999-999999999999",
  });
  expect(catalog.errors).toEqual([]);
  expect(catalog.data?.restaurant).toEqual({
    _id: "99999999-9999-4999-8999-999999999999",
    name: "Historical Outlet",
  });
}, 120_000);

it("deploys the same complete history to a fresh database", async () => {
  const fresh = await database("fresh");
  await migrate(fresh.databaseUrl, ["deploy"]);
  const migrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d/.test(name))
    .sort();
  const applied = await fresh.pool.query(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name',
  );
  expect(applied.rows.map((row) => row.migration_name)).toEqual(migrations);
  expect(
    (
      await fresh.pool.query(
        'SELECT count(*)::int AS n FROM "RuntimeConfigurationPointer"',
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await fresh.pool.query('SELECT count(*)::int AS n FROM "Order"')).rows[0]
      .n,
  ).toBe(0);
}, 120_000);
