import { readFileSync, readdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
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
import { sessionFields } from "@fairbite/identity-contracts";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

let db: StartedPostgreSqlContainer,
  redis: StartedTestContainer,
  pool: Pool,
  app: INestApplication;
const fields = "id label deliveryAddress details longitude latitude selected";
const listQuery = `query{customerAddresses{${fields}}}`;
const createQuery = `mutation($input:CustomerAddressInput!){createCustomerAddress(input:$input){${fields}}}`;
const updateQuery = `mutation($id:ID!,$input:CustomerAddressInput!){updateCustomerAddress(id:$id,input:$input){${fields}}}`;
const selectQuery = `mutation($id:ID!){selectCustomerAddress(id:$id){${fields}}}`;
const deleteQuery =
  "mutation($id:ID!){deleteCustomerAddress(id:$id){accepted}}";
const input = {
  label: "Home",
  deliveryAddress: "Synthetic street",
  details: "Synthetic instructions",
  longitude: 101.69,
  latitude: 3.14,
};
async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  access?: string,
) {
  const req = request(app.getHttpServer()).post("/graphql");
  if (access) req.set("Authorization", `Bearer ${access}`);
  return (await req.send({ query, variables })).body;
}
async function customer() {
  const email = `addresses-${randomUUID()}@example.test`,
    password = "synthetic-address-password-12";
  const registered = await gql(
    `mutation($input:CustomerRegistrationInput!){registerCustomer(input:$input){${sessionFields}}}`,
    { input: { email, password, displayName: "Synthetic customer" } },
  );
  expect(registered.errors).toBeUndefined();
  const login = await gql(
    `mutation($input:PasswordLoginInput!){loginPassword(input:$input){${sessionFields}}}`,
    { input: { email, password, application: "CUSTOMER" } },
  );
  expect(login.errors).toBeUndefined();
  return login.data.loginPassword as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  };
}
async function create(access: string, override = {}) {
  const response = await gql(
    createQuery,
    { input: { ...input, ...override } },
    access,
  );
  expect(response.errors).toBeUndefined();
  return response.data.createCustomerAddress as {
    id: string;
    selected: boolean;
  };
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
    .sort())
    await pool.query(
      readFileSync(new URL(`${directory}/migration.sql`, migrations), "utf8"),
    );
  app = await createApp(
    readConfig({
      APP_ENV: "test",
      PASSWORD_AUTH_ENABLED: "true",
      DATABASE_URL: db.getConnectionUri(),
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64url"),
      REFRESH_TOKEN_PEPPER: randomBytes(32).toString("base64url"),
    }),
  );
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await redis?.stop();
  await db?.stop();
});
describe("customer addresses through real GraphQL and PostgreSQL", () => {
  it("authenticates real sessions and persists trimmed data, updates, selection and deletion", async () => {
    const owner = await customer();
    const address = await create(owner.accessToken, {
      label: " Home ",
      deliveryAddress: " Synthetic street ",
      details: " instructions ",
    });
    expect(address.selected).toBe(false);
    const selected = await gql(
      selectQuery,
      { id: address.id },
      owner.accessToken,
    );
    expect(selected.errors).toBeUndefined();
    expect(selected.data.selectCustomerAddress.selected).toBe(true);
    const updated = await gql(
      updateQuery,
      { id: address.id, input: { ...input, label: "Office" } },
      owner.accessToken,
    );
    expect(updated.errors).toBeUndefined();
    expect(updated.data.updateCustomerAddress).toMatchObject({
      label: "Office",
      selected: true,
    });
    expect(
      (await gql(listQuery, {}, owner.accessToken)).data.customerAddresses,
    ).toHaveLength(1);
    const stored = (
      await pool.query('SELECT * FROM "CustomerAddress" WHERE id=$1', [
        address.id,
      ])
    ).rows[0];
    expect(stored.userId).toBe(owner.user.id);
    expect(stored.label).toBe("Office");
    expect(
      (await gql(deleteQuery, { id: address.id }, owner.accessToken)).data
        .deleteCustomerAddress,
    ).toEqual({ accepted: true });
    expect(
      (await gql(listQuery, {}, owner.accessToken)).data.customerAddresses,
    ).toEqual([]);
  });
  it("rejects anonymous and cross-customer mutation while preserving existing selection", async () => {
    const owner = await customer(),
      foreign = await customer();
    const mine = await create(owner.accessToken),
      theirs = await create(foreign.accessToken);
    await gql(selectQuery, { id: mine.id }, owner.accessToken);
    for (const [query, variables] of [
      [listQuery, {}],
      [createQuery, { input }],
      [selectQuery, { id: mine.id }],
      [deleteQuery, { id: mine.id }],
      [updateQuery, { id: mine.id, input }],
    ] as const)
      expect((await gql(query, variables)).errors).toBeDefined();
    for (const id of [theirs.id, randomUUID()]) {
      for (const query of [selectQuery, updateQuery])
        expect(
          (await gql(query, { id, input }, owner.accessToken)).errors[0]
            .extensions.code,
        ).toBe("NOT_FOUND");
      expect(
        (await gql(deleteQuery, { id }, owner.accessToken)).data
          .deleteCustomerAddress,
      ).toEqual({ accepted: true });
    }
    const list = (await gql(listQuery, {}, owner.accessToken)).data
      .customerAddresses;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: mine.id, selected: true });
    expect(
      (await gql(listQuery, {}, foreign.accessToken)).data.customerAddresses[0]
        .id,
    ).toBe(theirs.id);
  });
  it("rejects revoked, suspended, removed-role and wrong-application sessions for address operations", async () => {
    for (const invalidation of ["logout", "suspended", "roleLoss"] as const) {
      const owner = await customer();
      const address = await create(owner.accessToken);
      if (invalidation === "logout") {
        const loggedOut = await gql(
          "mutation($input:SessionLogoutInput!){logoutSession(input:$input){accepted}}",
          { input: { refreshToken: owner.refreshToken } },
        );
        expect(loggedOut.errors).toBeUndefined();
        expect(loggedOut.data.logoutSession.accepted).toBe(true);
      } else if (invalidation === "suspended") {
        await pool.query(
          "UPDATE \"IdentityUser\" SET status='SUSPENDED' WHERE id=$1",
          [owner.user.id],
        );
      } else {
        const changed = await pool.query(
          "UPDATE \"IdentityUser\" SET roles=ARRAY['RIDER']::text[] WHERE id=$1",
          [owner.user.id],
        );
        expect(changed.rowCount).toBe(1);
      }
      for (const [query, variables] of [
        [listQuery, {}],
        [createQuery, { input }],
        [updateQuery, { id: address.id, input }],
        [selectQuery, { id: address.id }],
        [deleteQuery, { id: address.id }],
      ] as const) {
        expect(
          (await gql(query, variables, owner.accessToken)).errors[0].extensions
            .code,
        ).toBe("AUTHENTICATION_FAILED");
      }
      expect(
        (
          await pool.query(
            'SELECT id FROM "CustomerAddress" WHERE "userId"=$1',
            [owner.user.id],
          )
        ).rows,
      ).toHaveLength(1);
    }
    const dual = await customer();
    const address = await create(dual.accessToken);
    await pool.query(
      "UPDATE \"IdentityUser\" SET roles=ARRAY['CUSTOMER','MERCHANT_STAFF']::text[] WHERE id=$1",
      [dual.user.id],
    );
    await pool.query(
      'INSERT INTO "IdentityApplicationGrant"("userId",application) VALUES($1,\'MERCHANT\')',
      [dual.user.id],
    );
    const merchant = await gql(
      `mutation($input:PasswordLoginInput!){loginPassword(input:$input){${sessionFields}}}`,
      {
        input: {
          email: dual.user.email,
          password: "synthetic-address-password-12",
          application: "MERCHANT",
        },
      },
    );
    expect(merchant.errors).toBeUndefined();
    for (const [query, variables] of [
      [listQuery, {}],
      [createQuery, { input }],
      [updateQuery, { id: address.id, input }],
      [selectQuery, { id: address.id }],
      [deleteQuery, { id: address.id }],
    ] as const)
      expect(
        (await gql(query, variables, merchant.data.loginPassword.accessToken))
          .errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
    const own = await gql(listQuery, {}, dual.accessToken);
    expect(own.errors).toBeUndefined();
    expect(own.data.customerAddresses).toHaveLength(1);
    expect(JSON.stringify(own.data)).not.toContain("userId");
    expect(
      (await gql("query{customerAddresses{id userId}}", {}, dual.accessToken))
        .errors,
    ).toBeDefined();
  });
  it("serializes concurrent selections to exactly one selected owned address", async () => {
    const owner = await customer();
    const addresses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        create(owner.accessToken, { label: `Location ${index}` }),
      ),
    );
    const results = await Promise.all(
      addresses.map((address) =>
        gql(selectQuery, { id: address.id }, owner.accessToken),
      ),
    );
    expect(results.every((result) => !result.errors)).toBe(true);
    const selected = (
      await pool.query(
        'SELECT id FROM "CustomerAddress" WHERE "userId"=$1 AND selected=true',
        [owner.user.id],
      )
    ).rows;
    expect(selected).toHaveLength(1);
    expect(addresses.map((address) => address.id)).toContain(selected[0].id);
    await expect(
      pool.query(
        'UPDATE "CustomerAddress" SET selected=true WHERE "userId"=$1',
        [owner.user.id],
      ),
    ).rejects.toThrow();
  });
  it("enforces the owner cap atomically under simultaneous requests", async () => {
    const owner = await customer();
    for (let index = 0; index < 49; index++)
      await create(owner.accessToken, { label: `Location ${index}` });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        gql(
          createQuery,
          { input: { ...input, label: `Concurrent ${index}` } },
          owner.accessToken,
        ),
      ),
    );
    expect(results.filter((result) => !result.errors)).toHaveLength(1);
    expect(
      results
        .filter((result) => result.errors)
        .every(
          (result) =>
            result.errors[0].extensions.code === "ADDRESS_LIMIT_REACHED",
        ),
    ).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "CustomerAddress" WHERE "userId"=$1',
          [owner.user.id],
        )
      ).rows[0].count,
    ).toBe(50);
  });
  it("rejects malformed inputs and enforces database bounds independently of resolver validation", async () => {
    const owner = await customer(),
      address = await create(owner.accessToken);
    for (const override of [
      { label: " " },
      { label: "x".repeat(101) },
      { deliveryAddress: "" },
      { deliveryAddress: "x".repeat(501) },
      { details: "x".repeat(1001) },
      { details: "\0" },
      { longitude: 180.01 },
      { latitude: -90.01 },
    ]) {
      const response = await gql(
        createQuery,
        { input: { ...input, ...override } },
        owner.accessToken,
      );
      expect(response.errors[0].extensions.code).toBe("BAD_USER_INPUT");
      expect(JSON.stringify(response)).not.toMatch(
        /SELECT|INSERT|postgresql:\/\/|passwordHash/,
      );
    }
    for (const id of ["invalid", address.id.toUpperCase()])
      expect(
        (await gql(selectQuery, { id }, owner.accessToken)).errors[0].extensions
          .code,
      ).toBe("BAD_USER_INPUT");
    for (const [column, value] of [
      ["label", ""],
      ["label", " untrimmed"],
      ["label", "\tName\t"],
      ["details", " untrimmed"],
      ["label", "x".repeat(101)],
      ["deliveryAddress", ""],
      ["deliveryAddress", "x".repeat(501)],
      ["details", "x".repeat(1001)],
      ["longitude", 181],
      ["latitude", -91],
      ["longitude", "NaN"],
      ["latitude", "Infinity"],
    ] as const)
      await expect(
        pool.query(`UPDATE "CustomerAddress" SET "${column}"=$2 WHERE id=$1`, [
          address.id,
          value,
        ]),
      ).rejects.toThrow();
    await expect(
      pool.query('UPDATE "CustomerAddress" SET "userId"=$2 WHERE id=$1', [
        address.id,
        randomUUID(),
      ]),
    ).rejects.toThrow();
    const boundary = await create(owner.accessToken, {
      longitude: -180,
      latitude: 90,
      label: "x".repeat(100),
      deliveryAddress: "x".repeat(500),
      details: "x".repeat(1000),
    });
    expect(boundary.id).toBeTruthy();
  });
  it("fails closed through an actual database outage and recovers", async () => {
    const owner = await customer();
    const docker = promisify(execFile);
    await docker("docker", ["pause", db.getId()]);
    try {
      const response = await gql(listQuery, {}, owner.accessToken);
      expect(response.errors[0].extensions.code).toBe("SERVICE_UNAVAILABLE");
      expect(
        response.data == null || response.data.customerAddresses === null,
      ).toBe(true);
      expect(JSON.stringify(response)).not.toMatch(
        /SELECT|postgresql:\/\/|passwordHash/,
      );
      await request(app.getHttpServer()).get("/health/ready").expect(503);
      await request(app.getHttpServer()).get("/health/live").expect(200);
    } finally {
      await docker("docker", ["unpause", db.getId()]);
    }
    await expect
      .poll(
        async () =>
          (await gql(listQuery, {}, owner.accessToken)).data?.customerAddresses,
        { timeout: 10000 },
      )
      .toEqual([]);
  });
});
