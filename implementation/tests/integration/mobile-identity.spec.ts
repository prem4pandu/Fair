import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import { createRequire } from "node:module";
const apiRequire = createRequire(
  new URL("../../services/api/package.json", import.meta.url),
);
const { hash, argon2id } = apiRequire(
  "argon2",
) as typeof import("../../services/api/node_modules/argon2");
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../../services/api/src/app";
import { readConfig } from "../../services/api/src/config";
import { NativeIdentityClient as CustomerClient } from "../../apps/customer-mobile/identity-client";
import { NativeIdentityClient as MerchantClient } from "../../apps/merchant-mobile/identity-client";
import { NativeIdentityClient as RiderClient } from "../../apps/rider-mobile/identity-client";
import type { TokenStore } from "../../apps/customer-mobile/identity-client";
// Explicitly synthetic adapter: verifies protocol/state only, never native SecureStore or devices.
class SyntheticTokenStore implements TokenStore {
  readonly values = new Map<string, string>();
  async getItemAsync(key: string) {
    return this.values.get(key) ?? null;
  }
  async setItemAsync(key: string, value: string) {
    this.values.set(key, value);
  }
  async deleteItemAsync(key: string) {
    this.values.delete(key);
  }
  token() {
    const stored = [...this.values.values()][0];
    return stored ? (JSON.parse(stored).token as string) : undefined;
  }
}
let db: StartedPostgreSqlContainer;
let redis: StartedTestContainer;
let pool: Pool;
let app: INestApplication;
let endpoint: string;
const password = "synthetic-password-identity-12";
beforeAll(async () => {
  db = await new PostgreSqlContainer("postgis/postgis:17-3.5")
    .withPlatform("linux/amd64")
    .start();
  redis = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();
  pool = new Pool({ connectionString: db.getConnectionUri() });
  for (const name of ["202610080001_foundation", "202610080002_identity"])
    await pool.query(
      readFileSync(
        new URL(
          `../../services/api/prisma/migrations/${name}/migration.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
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
  await app.listen(0, "127.0.0.1");
  endpoint = (await app.getUrl()) + "/graphql";
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await redis?.stop();
  await db?.stop();
});
async function seed(role: string, application: string) {
  const id = randomUUID();
  const email = `synthetic-${id}@example.com`;
  const encoded = await hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
  await pool.query(
    'INSERT INTO "IdentityUser"(id,email,"displayName",roles)VALUES($1,$2,$3,$4)',
    [id, email, "Synthetic role fixture", [role]],
  );
  await pool.query(
    'INSERT INTO "IdentityCredential"("userId","passwordHash")VALUES($1,$2)',
    [id, encoded],
  );
  await pool.query(
    'INSERT INTO "IdentityApplicationGrant"("userId",application)VALUES($1,$2)',
    [id, application],
  );
  return { id, email };
}
describe("pure native clients against actual identity server with synthetic storage", () => {
  it("customer registration, account, refresh, logout and subsequent password login", async () => {
    const store = new SyntheticTokenStore();
    const client = new CustomerClient(endpoint, "CUSTOMER", store, fetch);
    const email = `synthetic-${randomUUID()}@example.com`;
    const user = await client.register(email, password, "Synthetic customer");
    expect(user.roles).toEqual(["CUSTOMER"]);
    expect(user.emailVerificationStatus).toBe("UNVERIFIED");
    expect((await client.account()).id).toBe(user.id);
    const original = store.token();
    expect((await client.refresh()).id).toBe(user.id);
    expect(store.token()).not.toBe(original);
    await client.logout();
    expect(store.values.size).toBe(0);
    expect(client.user).toBeNull();
    expect((await client.login(email, password)).id).toBe(user.id);
    await client.logout();
  });
  for (const [Client, application, role] of [
    [MerchantClient, "MERCHANT", "MERCHANT_STAFF"],
    [RiderClient, "RIDER", "RIDER"],
  ] as const) {
    it(`${application} validates DB-seeded role and grant and loses access on grant removal`, async () => {
      const fixture = await seed(role, application);
      const store = new SyntheticTokenStore();
      const client = new Client(endpoint, application, store, fetch);
      expect((await client.login(fixture.email, password)).id).toBe(fixture.id);
      expect((await client.account()).roles).toContain(role);
      await client.refresh();
      await pool.query(
        'UPDATE "IdentityApplicationGrant" SET active=false WHERE "userId"=$1',
        [fixture.id],
      );
      await expect(client.account()).rejects.toThrow();
      expect(client.user).toBeNull();
      await expect(client.refresh()).rejects.toThrow();
      expect(store.values.size).toBe(0);
    });
  }
  it("merchant client cannot login as a customer or publicly register", async () => {
    const customer = new CustomerClient(
      endpoint,
      "CUSTOMER",
      new SyntheticTokenStore(),
      fetch,
    );
    const email = `synthetic-${randomUUID()}@example.com`;
    await customer.register(email, password, "Synthetic customer");
    const store = new SyntheticTokenStore();
    const merchant = new MerchantClient(endpoint, "MERCHANT", store, fetch);
    await expect(merchant.login(email, password)).rejects.toThrow();
    await expect(
      merchant.register(email, password, "Injected role"),
    ).rejects.toThrow();
    expect(store.values.size).toBe(0);
    await customer.logout();
  });
  it("refresh replay revokes newest family access through real server", async () => {
    const store = new SyntheticTokenStore();
    const client = new CustomerClient(endpoint, "CUSTOMER", store, fetch);
    await client.register(
      `synthetic-${randomUUID()}@example.com`,
      password,
      "Synthetic replay fixture",
    );
    const old = store.token();
    await client.refresh();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query:
          "mutation Replay($input:SessionRefreshInput!){refreshSession(input:$input){accessToken}}",
        variables: { input: { refreshToken: old, application: "CUSTOMER" } },
      }),
    });
    expect((await response.json()).errors[0].extensions.code).toBe(
      "AUTHENTICATION_FAILED",
    );
    await expect(client.account()).rejects.toThrow();
    await expect(client.refresh()).rejects.toThrow();
    expect(client.user).toBeNull();
    expect(store.values.size).toBe(0);
  });
});
