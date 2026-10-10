import { execFile } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
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
type ColumnSet = Record<string, string[]>;

/**
 * The columns each tracked table has at this moment. Captured after the
 * populated 005 baseline and again after the full history so the preservation
 * assertion can ignore columns later migrations add: an additive column must
 * not rewrite a baseline row, and it must not make the comparison fail either.
 */
async function tableColumns(pool: Pool): Promise<ColumnSet> {
  const result = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [tables],
  );
  const columns: ColumnSet = {};
  for (const row of result.rows)
    (columns[row.table_name] ??= []).push(row.column_name);
  return columns;
}

function columnsAddedSince(baseline: ColumnSet, current: ColumnSet): ColumnSet {
  const added: ColumnSet = {};
  for (const table of tables) {
    const existing = new Set(baseline[table] ?? []);
    added[table] = (current[table] ?? []).filter(
      (column) => !existing.has(column),
    );
  }
  return added;
}

async function snapshot(pool: Pool, subtract: ColumnSet = {}) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const added = subtract[table] ?? [];
    result[table] = (
      await pool.query(
        `SELECT (to_jsonb(t) - $1::text[]) AS row FROM "${table}" t
         ORDER BY (to_jsonb(t) - $1::text[])::text`,
        [added],
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
  // These sessions are persisted and signed against schema 005 before upgrade.
  // Relative dates retain the original thirty-day family constraint on reruns.
  const userId = "11111111-1111-4111-8111-111111111111";
  const sessions = [];
  for (const state of ["active", "revoked", "consumed"]) {
    const familyId = randomUUID();
    const sessionId = randomUUID();
    const refreshToken = `${sessionId}.${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHmac("sha256", Buffer.alloc(32, 2))
      .update(refreshToken)
      .digest("hex");
    await upgraded.pool.query(
      `INSERT INTO "IdentitySessionFamily" VALUES
      ($1,$2,'CUSTOMER',CURRENT_TIMESTAMP - INTERVAL '1 hour',CURRENT_TIMESTAMP + INTERVAL '1 day',
       CASE WHEN $3 = 'revoked' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      [familyId, userId, state],
    );
    await upgraded.pool.query(
      `INSERT INTO "IdentityRefreshSession" VALUES
      ($1,$2,$3,$4,CURRENT_TIMESTAMP - INTERVAL '30 minutes',
       CASE WHEN $5 = 'consumed' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      [sessionId, familyId, userId, tokenHash, state],
    );
    const issuedAt = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ sid: sessionId, app: "CUSTOMER" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(userId)
      .setJti(randomUUID())
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(Buffer.alloc(32, 1));
    sessions.push({ state, accessToken, refreshToken });
  }
  const foreignAddressId = "abababab-abab-4bab-8bab-abababababab";
  await upgraded.pool.query(
    `INSERT INTO "CustomerAddress" VALUES
      ($1,'22222222-2222-4222-8222-222222222222','Private','Private Road','',103.7,1.2,true)`,
    [foreignAddressId],
  );
  const baselineColumns = await tableColumns(upgraded.pool);
  const before = await snapshot(upgraded.pool);
  await migrate(upgraded.databaseUrl, ["deploy"]);
  const addedColumns = columnsAddedSince(
    baselineColumns,
    await tableColumns(upgraded.pool),
  );
  expect(await snapshot(upgraded.pool, addedColumns)).toEqual(before);
  // Additive extension only: every column the upgrade introduced is nullable
  // and empty for the preserved rows, so no baseline value was rewritten.
  expect(
    (
      await upgraded.pool.query(
        'SELECT count(*)::int AS n FROM "IdentityUser" WHERE "phone" IS NOT NULL',
      )
    ).rows[0].n,
  ).toBe(0);
  expect(addedColumns.IdentityUser).toEqual(["phone"]);
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
  expect(await snapshot(upgraded.pool, addedColumns)).toEqual(before);
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
  const addressesQuery =
    "{ customerAddresses { id label deliveryAddress details longitude latitude selected } }";
  const expectedAddresses = [
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      label: "Home",
      deliveryAddress: "10 Historical Road",
      details: "Floor 2",
      longitude: 103.8,
      latitude: 1.3,
      selected: true,
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      label: "Office",
      deliveryAddress: "20 Historical Road",
      details: "",
      longitude: 103.9,
      latitude: 1.4,
      selected: false,
    },
  ];
  const refreshMutation =
    "mutation($input:SessionRefreshInput!){ refreshSession(input:$input){ accessToken refreshToken user { id } } }";
  for (const session of sessions) {
    const addresses = await api.http
      .withUser(session.accessToken)
      .query(addressesQuery);
    if (session.state === "active") {
      expect(addresses.errors).toEqual([]);
      expect(addresses.data?.customerAddresses).toEqual(expectedAddresses);
    } else {
      expect(addresses.data).toBeNull();
      expect(addresses.errors.map((error) => error.extensions.code)).toEqual([
        "AUTHENTICATION_FAILED",
      ]);
    }
  }
  const activeSession = sessions.find((session) => session.state === "active")!;
  const foreignSelection = await api.http
    .withUser(activeSession.accessToken)
    .query("mutation($id:ID!){ selectCustomerAddress(id:$id){ id } }", {
      id: foreignAddressId,
    });
  expect(foreignSelection.data).toBeNull();
  expect(foreignSelection.errors.map((error) => error.extensions.code)).toEqual(
    ["NOT_FOUND"],
  );
  const afterReads = await snapshot(upgraded.pool, addedColumns);
  for (const table of [
    "CustomerAddress",
    "IdentityRefreshSession",
    "IdentitySessionFamily",
  ])
    expect(afterReads[table]).toEqual(before[table]);
  for (const session of sessions) {
    const refreshed = await api.http.query<{
      refreshSession: {
        accessToken: string;
        refreshToken: string;
        user: { id: string };
      };
    }>(refreshMutation, {
      input: { application: "CUSTOMER", refreshToken: session.refreshToken },
    });
    if (session.state === "active") {
      expect(refreshed.errors).toEqual([]);
      const rotated = refreshed.data!.refreshSession;
      expect(rotated.user.id).toBe(userId);
      expect(rotated.refreshToken).not.toBe(session.refreshToken);
      const addresses = await api.http
        .withUser(rotated.accessToken)
        .query(addressesQuery);
      expect(addresses.errors).toEqual([]);
      expect(addresses.data?.customerAddresses).toEqual(expectedAddresses);
      const consumed = await api.http
        .withUser(session.accessToken)
        .query(addressesQuery);
      expect(consumed.errors.map((error) => error.extensions.code)).toEqual([
        "AUTHENTICATION_FAILED",
      ]);
      const replay = await api.http.query(refreshMutation, {
        input: { application: "CUSTOMER", refreshToken: session.refreshToken },
      });
      expect(replay.errors.map((error) => error.extensions.code)).toEqual([
        "AUTHENTICATION_FAILED",
      ]);
      const revoked = await api.http
        .withUser(rotated.accessToken)
        .query(addressesQuery);
      expect(revoked.errors.map((error) => error.extensions.code)).toEqual([
        "AUTHENTICATION_FAILED",
      ]);
    } else {
      expect(refreshed.data).toBeNull();
      expect(refreshed.errors.map((error) => error.extensions.code)).toEqual([
        "AUTHENTICATION_FAILED",
      ]);
    }
  }
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
