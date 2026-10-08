import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { ConfigurationService } from "../src/configuration/service.js";
let db: StartedPostgreSqlContainer;
let pool: Pool;
let service: ConfigurationService;
let version = 0;
let app: INestApplication;
let redis: StartedTestContainer;
// Exact pinned Enatega query, license and source hashes retained beside fixture.
const originalQuery = readFileSync(
  new URL("./fixtures/enatega-customer-configuration.graphql", import.meta.url),
  "utf8",
);
async function gql(query: string) {
  return (await request(app.getHttpServer()).post("/graphql").send({ query }))
    .body;
}
const document = {
  countryCode: "MY",
  currency: "MYR",
  currencySymbol: "RM",
  currencyMinorUnits: 2,
  skipEmailVerification: false,
  skipMobileVerification: false,
};
async function insert(value: unknown) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "RuntimeConfigurationVersion"(id,version,document) VALUES($1,$2,$3)',
    [id, ++version, value],
  );
  return id;
}
async function activate(id: string) {
  await pool.query(
    'INSERT INTO "RuntimeConfigurationPointer"(id,"versionId") VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET "versionId"=EXCLUDED."versionId"',
    [id],
  );
}
beforeAll(async () => {
  db = await new PostgreSqlContainer("postgis/postgis:17-3.5")
    .withPlatform("linux/amd64")
    .start();
  pool = new Pool({
    connectionString: db.getConnectionUri(),
    max: 3,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
    query_timeout: 1500,
  });
  pool.on("error", () => {});
  await pool.query(
    readFileSync(
      new URL(
        "../prisma/migrations/202610080005_configuration/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pool.query(
    readFileSync(
      new URL(
        "../prisma/migrations/202610090100_l2_runtime_configuration/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  version = Number(
    (
      await pool.query(
        'SELECT COALESCE(MAX(version), 0) AS version FROM "RuntimeConfigurationVersion"',
      )
    ).rows[0].version,
  );
  service = new ConfigurationService(pool);
  redis = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();
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
  await redis?.stop();
  await pool?.end();
  await db?.stop();
});
it("boots Malaysia, MYR and own-fleet defaults without claiming an external provider", async () => {
  await expect(service.read()).resolves.toMatchObject({
    countryCode: "MY",
    currency: "MYR",
    currencySymbol: "RM",
    currencyMinorUnits: 2,
    deliveryRate: 0,
    costType: "fixed",
    checkoutAvailable: true,
  });
  const active = (
    await pool.query(
      'SELECT v.document FROM "RuntimeConfigurationPointer" p JOIN "RuntimeConfigurationVersion" v ON v.id=p."versionId" WHERE p.id=1',
    )
  ).rows[0].document;
  expect(active).toMatchObject({
    deliveryFleets: [
      {
        id: "own-fleet-my",
        kind: "OWN_FLEET",
        enabled: true,
        provider: null,
        capability: "LIVE_VERIFIED",
      },
    ],
    paymentMethods: [
      {
        id: "cash",
        kind: "CASH",
        enabled: true,
        provider: null,
        capability: "LIVE_VERIFIED",
      },
    ],
    rules: { coreFoodCommissionBasisPoints: 0 },
  });
  expect(JSON.stringify(active)).not.toMatch(/secret|stripe|twilio|sendgrid/i);
  await pool.query('DELETE FROM "RuntimeConfigurationPointer" WHERE id=1');
});
it("fails closed without an active version, including when a draft exists", async () => {
  await expect(service.read()).rejects.toMatchObject({
    extensions: { code: "CONFIGURATION_UNAVAILABLE" },
  });
  const response = await gql(originalQuery);
  expect(response.data.configuration).toBeNull();
  expect(response.errors[0].extensions.code).toBe("CONFIGURATION_UNAVAILABLE");
  expect(JSON.stringify(response)).not.toMatch(
    /SELECT|RuntimeConfiguration|postgres/,
  );
  await insert(document);
  await expect(service.read()).rejects.toMatchObject({
    extensions: { code: "CONFIGURATION_UNAVAILABLE" },
  });
});
it("reads actual active versions and retains immutable historical currency settings", async () => {
  const id = await insert(document);
  await activate(id);
  expect(await service.read()).toEqual({
    _id: id,
    version,
    ...document,
    deliveryRate: null,
    costType: null,
    twilioEnabled: false,
    checkoutAvailable: false,
    enableCustomerDemoMode: false,
    customerDemoZoneId: null,
  });
  const response = await gql(originalQuery);
  expect(response.errors).toBeUndefined();
  expect(response.data.configuration).toMatchObject({
    _id: id,
    currency: "MYR",
    deliveryRate: null,
    costType: null,
    twilioEnabled: false,
  });
  const publicResponse = await gql(`query SingleVendorConfiguration {
    configuration: publicConfiguration {
      _id currency currencySymbol deliveryRate twilioEnabled
      appAmplitudeApiKey customerAppSentryUrl termsAndConditions privacyPolicy
      skipMobileVerification skipEmailVerification costType publishableKey
    }
  }`);
  expect(publicResponse.errors).toBeUndefined();
  expect(publicResponse.data.configuration).toMatchObject({
    _id: id,
    currency: "MYR",
    currencySymbol: "RM",
    deliveryRate: null,
    twilioEnabled: false,
    skipEmailVerification: false,
    skipMobileVerification: false,
    costType: null,
  });
  expect(
    (await gql("query { configuration { secretKey } }")).errors,
  ).toBeDefined();
  const second = await insert({
    ...document,
    countryCode: "JP",
    currency: "JPY",
    currencySymbol: "¥",
    currencyMinorUnits: 0,
  });
  await activate(second);
  expect(await service.read()).toMatchObject({
    _id: second,
    currency: "JPY",
    currencyMinorUnits: 0,
    checkoutAvailable: false,
  });
  expect(
    (
      await pool.query(
        'SELECT document FROM "RuntimeConfigurationVersion" WHERE id=$1',
        [id],
      )
    ).rows[0].document,
  ).toEqual(document);
  await expect(
    pool.query(
      'UPDATE "RuntimeConfigurationVersion" SET version=99 WHERE id=$1',
      [id],
    ),
  ).rejects.toThrow();
  await expect(
    pool.query('DELETE FROM "RuntimeConfigurationVersion" WHERE id=$1', [id]),
  ).rejects.toThrow();
  await expect(
    pool.query(
      'INSERT INTO "RuntimeConfigurationPointer"(id,"versionId") VALUES(2,$1)',
      [id],
    ),
  ).rejects.toThrow();
  await expect(activate(randomUUID())).rejects.toThrow();
  await expect(
    pool.query('TRUNCATE "RuntimeConfigurationVersion" CASCADE'),
  ).rejects.toThrow();
});
it("rejects private fields, malformed core values and unsupported capability flags in storage", async () => {
  for (const extra of [
    { secretKey: "synthetic-secret" },
    { secretReference: "vault/test" },
    { checkoutAvailable: true },
    { twilioEnabled: true },
    { deliveryRate: 0 },
    { currency: "myr" },
    { countryCode: "MYS" },
    { currencyMinorUnits: 1.5 },
    { currencySymbol: " " },
    { skipEmailVerification: "false" },
  ])
    await expect(insert({ ...document, ...extra })).rejects.toThrow();
});
it("validates optional public metadata on read and never leaks invalid diagnostic values", async () => {
  const id = await insert({
    ...document,
    webClientID: { private: "synthetic-secret" },
  });
  await activate(id);
  try {
    await service.read();
    throw new Error("Expected failure");
  } catch (error) {
    expect(error).toMatchObject({
      extensions: { code: "CONFIGURATION_UNAVAILABLE" },
    });
    expect(JSON.stringify(error)).not.toMatch(
      /synthetic-secret|webClientID|SELECT/,
    );
  }
  for (const invalid of [
    { currency: "ZZZ" },
    { countryCode: "ZZ" },
    { currencyMinorUnits: 0 },
    { publishableKey: "sk_test_synthetic-secret" },
    { privacyPolicy: "javascript:alert(1)" },
    { termsAndConditions: "https://user:password@example.test/legal" },
    { webSentryUrl: "file:///tmp/secrets" },
    {
      webSentryUrl:
        "https://0123456789abcdef0123456789abcdef:secret@sentry.example.test/1",
    },
  ]) {
    await activate(await insert({ ...document, ...invalid }));
    await expect(service.read()).rejects.toMatchObject({
      extensions: { code: "CONFIGURATION_UNAVAILABLE" },
    });
  }
  const valid = await insert({
    ...document,
    webClientID: "synthetic-client.apps.googleusercontent.com",
    webSentryUrl:
      "https://0123456789abcdef0123456789abcdef@sentry.example.test/1",
  });
  await activate(valid);
  expect(await service.read()).toMatchObject({
    webClientID: "synthetic-client.apps.googleusercontent.com",
    webSentryUrl:
      "https://0123456789abcdef0123456789abcdef@sentry.example.test/1",
    checkoutAvailable: false,
  });
});
it("bounds real database outage and recovers", async () => {
  const docker = promisify(execFile);
  await docker("docker", ["pause", db.getId()]);
  try {
    const start = Date.now();
    await expect(service.read()).rejects.toMatchObject({
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
    const response = await gql(originalQuery);
    expect(response.data.configuration).toBeNull();
    expect(response.errors[0].extensions.code).toBe("SERVICE_UNAVAILABLE");
    expect(JSON.stringify(response)).not.toMatch(
      /SELECT|RuntimeConfiguration|postgres/,
    );
    expect(Date.now() - start).toBeLessThan(5000);
  } finally {
    await docker("docker", ["unpause", db.getId()]);
  }
  await expect
    .poll(async () => (await service.read()).currency, { timeout: 10000 })
    .toBe("MYR");
});
