import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

let db: StartedPostgreSqlContainer;
let redis: StartedTestContainer;
let pool: Pool;
let app: INestApplication;
const outletFields = "id name merchantName currency";
const itemFields =
  "id outletId name description priceMinor available category{id name}";
const outletsQuery = `query($limit:Int,$after:ID){catalogOutlets(limit:$limit,after:$after){nodes{${outletFields}} endCursor hasNextPage}}`;
const outletQuery = `query($id:ID!){catalogOutlet(id:$id){${outletFields}}}`;
const itemsQuery = `query($outletId:ID!,$limit:Int,$after:ID){catalogItems(outletId:$outletId,limit:$limit,after:$after){nodes{${itemFields}} endCursor hasNextPage}}`;
async function gql(query: string, variables: Record<string, unknown> = {}) {
  return (
    await request(app.getHttpServer())
      .post("/graphql")
      .send({ query, variables })
  ).body;
}
async function fixture() {
  const merchant = randomUUID();
  const outlet = randomUUID();
  const category = randomUUID();
  await pool.query(
    'INSERT INTO "CatalogMerchant"(id,name,published) VALUES($1,$2,true)',
    [merchant, "Synthetic merchant"],
  );
  await pool.query(
    'INSERT INTO "CatalogOutlet"(id,"merchantId",name,currency,published) VALUES($1,$2,$3,$4,true)',
    [outlet, merchant, "Synthetic outlet", "MYR"],
  );
  await pool.query(
    'INSERT INTO "CatalogCategory"(id,"outletId",name,published) VALUES($1,$2,$3,true)',
    [category, outlet, "Synthetic category"],
  );
  return { merchant, outlet, category };
}
async function item(
  owner: Awaited<ReturnType<typeof fixture>>,
  priceMinor = 100,
  available = true,
  published = true,
) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "CatalogItem"(id,"outletId","categoryId",name,description,"priceMinor",available,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      id,
      owner.outlet,
      owner.category,
      "Synthetic item",
      "Synthetic description",
      priceMinor,
      available,
      published,
    ],
  );
  return id;
}
beforeAll(async () => {
  db = await new PostgreSqlContainer("postgis/postgis:17-3.5")
    .withPlatform("linux/amd64")
    .start();
  redis = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();
  pool = new Pool({ connectionString: db.getConnectionUri() });
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  for (const directory of readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    await pool.query(
      readFileSync(new URL(`${directory}/migration.sql`, migrations), "utf8"),
    );
  }
  app = await createApp(
    readConfig({
      APP_ENV: "test",
      PUBLIC_ACCESS_ENFORCED: "false",
      DATABASE_URL: db.getConnectionUri(),
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    }),
  );
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await redis?.stop();
  await db?.stop();
});
describe("real public catalog GraphQL and storage", () => {
  it("returns allowlisted public fields and exact integer boundary prices, including unavailable items", async () => {
    const owner = await fixture();
    const zero = await item(owner, 0, false);
    const maximum = await item(owner, 2147483647);
    const outlet = await gql(outletQuery, { id: owner.outlet });
    expect(outlet.errors).toBeUndefined();
    expect(outlet.data.catalogOutlet).toEqual({
      id: owner.outlet,
      name: "Synthetic outlet",
      merchantName: "Synthetic merchant",
      currency: "MYR",
    });
    const result = await gql(itemsQuery, { outletId: owner.outlet });
    expect(result.errors).toBeUndefined();
    expect(result.data.catalogItems.nodes).toEqual(
      [zero, maximum].sort().map((id) => ({
        id,
        outletId: owner.outlet,
        name: "Synthetic item",
        description: "Synthetic description",
        priceMinor: id === zero ? 0 : 2147483647,
        available: id !== zero,
        category: { id: owner.category, name: "Synthetic category" },
      })),
    );
    for (const forbidden of [
      "merchantId",
      "published",
      "memberships",
      "email",
      "passwordHash",
    ])
      expect(JSON.stringify(result.data)).not.toContain(forbidden);
    expect(
      (
        await gql(
          `query($id:ID!){catalogOutlet(id:$id){merchantId published}}`,
          { id: owner.outlet },
        )
      ).errors,
    ).toBeDefined();
  });
  it("hides each unpublished ancestor or item immediately, and hidden/missing outlets have equal responses", async () => {
    for (const entity of ["Merchant", "Outlet", "Category", "Item"] as const) {
      const owner = await fixture();
      const id = await item(owner);
      const target =
        entity === "Merchant"
          ? owner.merchant
          : entity === "Outlet"
            ? owner.outlet
            : entity === "Category"
              ? owner.category
              : id;
      await pool.query(
        `UPDATE "Catalog${entity}" SET published=false WHERE id=$1`,
        [target],
      );
      expect(
        (await gql(itemsQuery, { outletId: owner.outlet })).data.catalogItems,
      ).toEqual({ nodes: [], endCursor: null, hasNextPage: false });
      if (entity === "Merchant" || entity === "Outlet") {
        expect((await gql(outletQuery, { id: owner.outlet })).data).toEqual(
          (await gql(outletQuery, { id: randomUUID() })).data,
        );
        const visible = (await gql(outletsQuery, { limit: 50 })).data
          .catalogOutlets.nodes;
        expect(visible.map((value: { id: string }) => value.id)).not.toContain(
          owner.outlet,
        );
      }
      await pool.query(
        `UPDATE "Catalog${entity}" SET published=true WHERE id=$1`,
        [target],
      );
      expect(
        (await gql(itemsQuery, { outletId: owner.outlet })).data.catalogItems
          .nodes,
      ).toHaveLength(1);
    }
  });
  it("uses stable UUID keyset pagination without duplicates and accurate terminal cursors", async () => {
    const owner = await fixture();
    const expected = (
      await Promise.all(Array.from({ length: 5 }, () => item(owner)))
    ).sort();
    const actual: string[] = [];
    let after: string | undefined;
    for (const count of [2, 2, 1]) {
      const response = await gql(itemsQuery, {
        outletId: owner.outlet,
        limit: 2,
        ...(after ? { after } : {}),
      });
      expect(response.errors).toBeUndefined();
      const page = response.data.catalogItems;
      expect(page.nodes).toHaveLength(count);
      actual.push(...page.nodes.map((value: { id: string }) => value.id));
      expect(page.endCursor).toBe(actual.at(-1));
      expect(page.hasNextPage).toBe(actual.length < expected.length);
      after = page.endCursor;
    }
    expect(actual).toEqual(expected);
    expect(
      (await gql(itemsQuery, { outletId: owner.outlet, after })).data
        .catalogItems,
    ).toEqual({ nodes: [], endCursor: null, hasNextPage: false });
    // Exercise default 20 and maximum 50 using a separate outlet.
    const many = await fixture();
    for (let index = 0; index < 51; index++) await item(many);
    expect(
      (await gql(itemsQuery, { outletId: many.outlet })).data.catalogItems
        .nodes,
    ).toHaveLength(20);
    const maximum = (
      await gql(itemsQuery, { outletId: many.outlet, limit: 50 })
    ).data.catalogItems;
    expect(maximum.nodes).toHaveLength(50);
    expect(maximum.hasNextPage).toBe(true);
    const outletPage = (await gql(outletsQuery, { limit: 1 })).data
      .catalogOutlets;
    expect(outletPage.nodes).toHaveLength(1);
    expect(outletPage.hasNextPage).toBe(true);
    const next = (
      await gql(outletsQuery, { limit: 1, after: outletPage.endCursor })
    ).data.catalogOutlets;
    expect(next.nodes[0].id > outletPage.endCursor).toBe(true);
  });
  it("bounds malformed IDs/cursors and out-of-range limits without SQL or private diagnostic leakage", async () => {
    const owner = await fixture();
    const invalid = [
      "",
      "not-a-uuid",
      "' OR true; --",
      owner.outlet.toUpperCase(),
      ` ${owner.outlet}`,
      "00000000000000000000000000000000",
    ];
    for (const value of invalid) {
      for (const [query, variables] of [
        [outletQuery, { id: value }],
        [itemsQuery, { outletId: value }],
        [outletsQuery, { after: value }],
        [itemsQuery, { outletId: owner.outlet, after: value }],
      ] as const) {
        const response = await gql(query, variables);
        expect(response.errors[0].extensions.code).toBe("BAD_USER_INPUT");
        expect(JSON.stringify(response)).not.toMatch(
          /SELECT|INSERT|CatalogMerchant|passwordHash|postgresql:\/\//,
        );
      }
    }
    for (const limit of [0, -1, 51, 2147483647]) {
      for (const [query, variables] of [
        [outletsQuery, { limit }],
        [itemsQuery, { outletId: owner.outlet, limit }],
      ] as const)
        expect((await gql(query, variables)).errors[0].extensions.code).toBe(
          "BAD_USER_INPUT",
        );
    }
  });
  it("enforces unpublished defaults, storage checks, restrict deletion and composite tenant foreign keys", async () => {
    const owner = await fixture();
    const other = await fixture();
    const draft = randomUUID();
    await pool.query('INSERT INTO "CatalogMerchant"(id,name) VALUES($1,$2)', [
      draft,
      "Synthetic draft",
    ]);
    expect(
      (
        await pool.query(
          'SELECT published FROM "CatalogMerchant" WHERE id=$1',
          [draft],
        )
      ).rows[0].published,
    ).toBe(false);
    const draftOutlet = randomUUID(),
      draftCategory = randomUUID(),
      draftItem = randomUUID();
    await pool.query(
      'INSERT INTO "CatalogOutlet"(id,"merchantId",name,currency) VALUES($1,$2,$3,$4)',
      [draftOutlet, draft, "Synthetic draft outlet", "USD"],
    );
    await pool.query(
      'INSERT INTO "CatalogCategory"(id,"outletId",name) VALUES($1,$2,$3)',
      [draftCategory, draftOutlet, "Synthetic draft category"],
    );
    await pool.query(
      'INSERT INTO "CatalogItem"(id,"outletId","categoryId",name,description,"priceMinor") VALUES($1,$2,$3,$4,$5,$6)',
      [draftItem, draftOutlet, draftCategory, "Synthetic draft item", "", 0],
    );
    for (const [table, id] of [
      ["Outlet", draftOutlet],
      ["Category", draftCategory],
      ["Item", draftItem],
    ])
      expect(
        (
          await pool.query(
            `SELECT published FROM "Catalog${table}" WHERE id=$1`,
            [id],
          )
        ).rows[0].published,
      ).toBe(false);
    const ownedItem = await item(owner);
    for (const name of [
      "",
      " ",
      " untrimmed",
      "\tName\t",
      "\nName",
      "x".repeat(101),
    ]) {
      for (const [table, id] of [
        ["Merchant", owner.merchant],
        ["Outlet", owner.outlet],
        ["Category", owner.category],
        ["Item", ownedItem],
      ])
        await expect(
          pool.query(`UPDATE "Catalog${table}" SET name=$2 WHERE id=$1`, [
            id,
            name,
          ]),
        ).rejects.toThrow();
    }
    for (const currency of ["usd", "US", "USDD", "1AB", "ÅBC"])
      await expect(
        pool.query('UPDATE "CatalogOutlet" SET currency=$2 WHERE id=$1', [
          owner.outlet,
          currency,
        ]),
      ).rejects.toThrow();
    for (const price of [-1, 2147483648, 1.5])
      await expect(
        pool.query('UPDATE "CatalogItem" SET "priceMinor"=$2 WHERE id=$1', [
          ownedItem,
          price,
        ]),
      ).rejects.toThrow();
    await expect(
      pool.query('UPDATE "CatalogItem" SET description=$2 WHERE id=$1', [
        ownedItem,
        "x".repeat(2001),
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query('UPDATE "CatalogItem" SET "categoryId"=$2 WHERE id=$1', [
        ownedItem,
        other.category,
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query('DELETE FROM "CatalogMerchant" WHERE id=$1', [owner.merchant]),
    ).rejects.toThrow();
    await expect(
      pool.query('DELETE FROM "CatalogOutlet" WHERE id=$1', [owner.outlet]),
    ).rejects.toThrow();
    await expect(
      pool.query('DELETE FROM "CatalogCategory" WHERE id=$1', [owner.category]),
    ).rejects.toThrow();
  });
  it("fails closed during an actual isolated database outage and recovers after unpause", async () => {
    const owner = await fixture();
    await item(owner);
    const docker = promisify(execFile);
    await docker("docker", ["pause", db.getId()]);
    try {
      const started = Date.now();
      for (const [query, variables] of [
        [outletQuery, { id: owner.outlet }],
        [outletsQuery, {}],
        [itemsQuery, { outletId: owner.outlet }],
      ] as const) {
        const response = await gql(query, variables);
        expect(response.errors[0].extensions.code).toBe("SERVICE_UNAVAILABLE");
        expect(
          response.data == null ||
            Object.values(response.data).every((value) => value === null),
        ).toBe(true);
        expect(JSON.stringify(response)).not.toMatch(
          /SELECT|passwordHash|postgresql:\/\//,
        );
      }
      expect(Date.now() - started).toBeLessThan(15000);
      await request(app.getHttpServer()).get("/health/ready").expect(503);
      await request(app.getHttpServer()).get("/health/live").expect(200);
    } finally {
      await docker("docker", ["unpause", db.getId()]);
    }
    await expect
      .poll(
        async () =>
          (await gql(outletQuery, { id: owner.outlet })).data?.catalogOutlet
            ?.id,
        { timeout: 10000 },
      )
      .toBe(owner.outlet);
    await request(app.getHttpServer()).get("/health/ready").expect(200);
  });
});
