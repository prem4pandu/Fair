import { readFileSync } from "node:fs";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import { SignJWT, decodeJwt } from "jose";
import { hash, argon2id } from "argon2";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { sessionFields, userFields } from "@fairbite/identity-contracts";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
let db: StartedPostgreSqlContainer;
let redis: StartedTestContainer;
let pool: Pool;
let app: INestApplication;
let second: INestApplication;
const password = "actual-test-password-12";
const keys = {
  ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64url"),
  REFRESH_TOKEN_PEPPER: randomBytes(32).toString("base64url"),
};
async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  access?: string,
  target = app,
) {
  if (query === meQuery) variables = { application: "CUSTOMER", ...variables };
  if (query === refreshQuery)
    variables = {
      ...variables,
      input: {
        application: "CUSTOMER",
        ...(variables.input as Record<string, unknown>),
      },
    };
  const req = request(target.getHttpServer()).post("/graphql");
  if (access) req.set("Authorization", `Bearer ${access}`);
  return (await req.send({ query, variables })).body;
}
const registerQuery = `mutation($input:CustomerRegistrationInput!){registerCustomer(input:$input){${sessionFields}}}`;
const loginQuery = `mutation($input:PasswordLoginInput!){loginPassword(input:$input){${sessionFields}}}`;
const refreshQuery = `mutation($input:SessionRefreshInput!){refreshSession(input:$input){${sessionFields}}}`;
const meQuery = `query($application:LoginApplication!){me(application:$application){${userFields}}}`;
async function register() {
  return (
    await gql(registerQuery, {
      input: {
        email: `test-${randomUUID()}@example.com`,
        password,
        displayName: "Synthetic user",
      },
    })
  ).data.registerCustomer;
}
async function seed(role: string, application: string) {
  const id = randomUUID();
  const email = `role-${id}@example.com`;
  const encoded = await hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
  await pool.query(
    'INSERT INTO "IdentityUser" (id,email,"displayName",roles) VALUES($1,$2,$3,$4)',
    [id, email, "Synthetic eligible account", [role]],
  );
  await pool.query(
    'INSERT INTO "IdentityCredential" ("userId","passwordHash") VALUES($1,$2)',
    [id, encoded],
  );
  await pool.query(
    'INSERT INTO "IdentityApplicationGrant" ("userId",application) VALUES($1,$2)',
    [id, application],
  );
  return { id, email };
}
beforeAll(async () => {
  db = await new PostgreSqlContainer("postgis/postgis:17-3.5")
    .withPlatform("linux/amd64")
    .start();
  redis = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();
  pool = new Pool({ connectionString: db.getConnectionUri() });
  for (const migration of ["202610080001_foundation", "202610080002_identity"])
    await pool.query(
      readFileSync(
        new URL(
          `../prisma/migrations/${migration}/migration.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  const config = readConfig({
    APP_ENV: "test",
    PUBLIC_ACCESS_ENFORCED: "false",
    PASSWORD_AUTH_ENABLED: "true",
    DATABASE_URL: db.getConnectionUri(),
    REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    ...keys,
  });
  app = await createApp(config);
  second = await createApp(config);
});
afterAll(async () => {
  await app?.close();
  await second?.close();
  await pool?.end();
  await redis?.stop();
  await db?.stop();
});
describe("real GraphQL password identity", () => {
  it("creates only unverified customers with hash-only sessions; duplicate and role injection rejected", async () => {
    const session = await register();
    const claims = decodeJwt(session.accessToken);
    expect(claims.exp! - claims.iat!).toBe(300);
    expect(session.user.roles).toEqual(["CUSTOMER"]);
    expect(session.user.emailVerificationStatus).toBe("UNVERIFIED");
    expect((await gql(meQuery, {}, session.accessToken)).data.me.id).toBe(
      session.user.id,
    );
    const stored = await pool.query(
      'SELECT "passwordHash" FROM "IdentityCredential" WHERE "userId"=$1',
      [session.user.id],
    );
    expect(stored.rows[0].passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0].passwordHash).not.toContain(password);
    const tokens = await pool.query(
      'SELECT "tokenHash" FROM "IdentityRefreshSession" WHERE "userId"=$1',
      [session.user.id],
    );
    expect(tokens.rows[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens.rows[0].tokenHash).not.toBe(session.refreshToken);
    expect(
      (
        await gql(registerQuery, {
          input: {
            email: session.user.email,
            password,
            displayName: "duplicate",
          },
        })
      ).errors[0].extensions.code,
    ).toBe("ACCOUNT_EXISTS");
    expect(
      (
        await gql(registerQuery, {
          input: {
            email: "inject@example.com",
            password,
            displayName: "inject",
            roles: ["ADMIN"],
          },
        })
      ).errors,
    ).toBeDefined();
  });
  it("binds privileged logins to current roles and explicit grants without public onboarding", async () => {
    for (const [role, application] of [
      ["MERCHANT_STAFF", "MERCHANT"],
      ["RIDER", "RIDER"],
      ["ADMIN", "ADMIN"],
    ]) {
      const user = await seed(role, application);
      const input = { email: user.email, password, application };
      const result = await gql(loginQuery, { input });
      expect(result.data.loginPassword.user.roles).toContain(role);
      expect(
        (
          await gql(loginQuery, {
            input: { ...input, application: "CUSTOMER" },
          })
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
      await pool.query(
        'UPDATE "IdentityApplicationGrant" SET active=false WHERE "userId"=$1',
        [user.id],
      );
      expect(
        (
          await gql(
            meQuery,
            { application },
            result.data.loginPassword.accessToken,
          )
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
    }
  });
  it("suspension/current role loss immediately rejects existing JWTs", async () => {
    for (const update of [
      "\"status\"='SUSPENDED'",
      "roles=ARRAY['RIDER']::text[]",
    ]) {
      const session = await register();
      await pool.query(`UPDATE "IdentityUser" SET ${update} WHERE id=$1`, [
        session.user.id,
      ]);
      expect(
        (await gql(meQuery, {}, session.accessToken)).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
    }
  });
  it("rotates atomically, preserves absolute expiry, replay revokes newest access", async () => {
    const initial = await register();
    const before = await pool.query(
      'SELECT "expiresAt" FROM "IdentitySessionFamily" WHERE "userId"=$1',
      [initial.user.id],
    );
    const next = (
      await gql(refreshQuery, { input: { refreshToken: initial.refreshToken } })
    ).data.refreshSession;
    expect((await gql(meQuery, {}, initial.accessToken)).errors).toBeDefined();
    expect((await gql(meQuery, {}, next.accessToken)).data.me.id).toBe(
      initial.user.id,
    );
    expect(
      (
        await pool.query(
          'SELECT "expiresAt" FROM "IdentitySessionFamily" WHERE "userId"=$1',
          [initial.user.id],
        )
      ).rows[0].expiresAt,
    ).toEqual(before.rows[0].expiresAt);
    expect(
      (
        await gql(refreshQuery, {
          input: { refreshToken: initial.refreshToken },
        })
      ).errors[0].extensions.code,
    ).toBe("AUTHENTICATION_FAILED");
    expect((await gql(meQuery, {}, next.accessToken)).errors).toBeDefined();
  });
  it("concurrent refresh has at most one winner and leaves no authorized newest token", async () => {
    const initial = await register();
    const results = await Promise.all([
      gql(refreshQuery, { input: { refreshToken: initial.refreshToken } }),
      gql(
        refreshQuery,
        { input: { refreshToken: initial.refreshToken } },
        undefined,
        second,
      ),
    ]);
    const wins = results.filter((result) => result.data?.refreshSession);
    expect(wins.length).toBeLessThanOrEqual(1);
    expect(results.some((result) => result.errors)).toBe(true);
    for (const winner of wins)
      expect(
        (await gql(meQuery, {}, winner.data.refreshSession.accessToken)).errors,
      ).toBeDefined();
  });
  it("logout of old refresh revokes entire family and logoutAll stays within own identity", async () => {
    const initial = await register();
    const next = (
      await gql(refreshQuery, { input: { refreshToken: initial.refreshToken } })
    ).data.refreshSession;
    expect(
      (
        await gql(
          "mutation($input:SessionLogoutInput!){logoutSession(input:$input){accepted}}",
          { input: { refreshToken: initial.refreshToken } },
        )
      ).data.logoutSession.accepted,
    ).toBe(true);
    expect((await gql(meQuery, {}, next.accessToken)).errors).toBeDefined();
    const own = await register();
    const other = await register();
    expect(
      (
        await gql(
          "mutation{logoutAllSessions(application:CUSTOMER){accepted}}",
          {},
          own.accessToken,
        )
      ).data.logoutAllSessions.accepted,
    ).toBe(true);
    expect((await gql(meQuery, {}, own.accessToken)).errors).toBeDefined();
    expect((await gql(meQuery, {}, other.accessToken)).data.me.id).toBe(
      other.user.id,
    );
  });
  it("bounds password work globally and protects absolute expiry", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        gql(
          loginQuery,
          {
            input: {
              email: `capacity-${randomUUID()}@example.com`,
              password,
              application: "CUSTOMER",
            },
          },
          undefined,
          index % 2 ? app : second,
        ),
      ),
    );
    expect(
      attempts.filter(
        (result) => result.errors[0].extensions.code === "RATE_LIMITED",
      ).length,
    ).toBeGreaterThanOrEqual(1);
    const session = await register();
    const family = (
      await pool.query(
        'SELECT id FROM "IdentitySessionFamily" WHERE "userId"=$1',
        [session.user.id],
      )
    ).rows[0].id;
    // Immutable expiry prevents tests (and production writers) from extending a live family.
    await expect(
      pool.query(
        'UPDATE "IdentitySessionFamily" SET "expiresAt"=CURRENT_TIMESTAMP WHERE id=$1',
        [family],
      ),
    ).rejects.toThrow();
  });
  it("rejects correctly signed JWTs with wrong exact claims or headers", async () => {
    const session = await register();
    const sid = session.refreshToken.split(".")[0];
    for (const item of [
      { issuer: "wrong" },
      { audience: "wrong" },
      { type: "JWT" },
      { ttl: 301 },
      { app: "ADMIN" },
      { sid: randomUUID() },
      { extra: true },
      { headerExtra: true },
    ]) {
      const token = await new SignJWT({
        sid: "sid" in item ? item.sid : sid,
        app: "app" in item ? item.app : "CUSTOMER",
        ...("extra" in item ? { admin: true } : {}),
      })
        .setProtectedHeader({
          alg: "HS256",
          typ: "type" in item ? item.type : "at+jwt",
          ...("headerExtra" in item ? { kid: "unconfigured" } : {}),
        })
        .setSubject(session.user.id)
        .setJti(randomUUID())
        .setIssuer(item.issuer ?? "fairbite-api")
        .setAudience(item.audience ?? "fairbite-apps")
        .setIssuedAt()
        .setExpirationTime(`${"ttl" in item ? item.ttl : 300}s`)
        .sign(Buffer.from(keys.ACCESS_TOKEN_SECRET, "base64url"));
      expect((await gql(meQuery, {}, token)).errors[0].extensions.code).toBe(
        "AUTHENTICATION_FAILED",
      );
    }
  });
  it("denies expired families even when access JWT cryptography and claims are valid", async () => {
    const user = await register();
    const familyId = randomUUID();
    const id = randomUUID();
    const token = `${id}.${randomBytes(32).toString("base64url")}`;
    const createdAt = new Date(Date.now() - 31 * 86400000);
    const expiresAt = new Date(createdAt.getTime() + 30 * 86400000);
    await pool.query(
      'INSERT INTO "IdentitySessionFamily"(id,"userId",application,"createdAt","expiresAt") VALUES($1,$2,$3,$4,$5)',
      [familyId, user.user.id, "CUSTOMER", createdAt, expiresAt],
    );
    await pool.query(
      'INSERT INTO "IdentityRefreshSession"(id,"familyId","userId","tokenHash","createdAt") VALUES($1,$2,$3,$4,$5)',
      [
        id,
        familyId,
        user.user.id,
        createHmac(
          "sha256",
          Buffer.from(keys.REFRESH_TOKEN_PEPPER, "base64url"),
        )
          .update(token)
          .digest("hex"),
        createdAt,
      ],
    );
    const access = await new SignJWT({ sid: id, app: "CUSTOMER" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(user.user.id)
      .setJti(randomUUID())
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setIssuedAt()
      .setExpirationTime("300s")
      .sign(Buffer.from(keys.ACCESS_TOKEN_SECRET, "base64url"));
    expect(
      (await gql(refreshQuery, { input: { refreshToken: token } })).errors[0]
        .extensions.code,
    ).toBe("AUTHENTICATION_FAILED");
    expect((await gql(meQuery, {}, access)).errors[0].extensions.code).toBe(
      "AUTHENTICATION_FAILED",
    );
  });
  it("binds dual-role production CUSTOMER sessions to CUSTOMER for me, refresh and logoutAll", async () => {
    const user = await seed("ADMIN", "ADMIN");
    await pool.query('UPDATE "IdentityUser" SET roles=$2::text[] WHERE id=$1', [
      user.id,
      ["CUSTOMER", "ADMIN"],
    ]);
    const production = await createApp({
      ...readConfig({
        APP_ENV: "test",
        PUBLIC_ACCESS_ENFORCED: "false",
        PASSWORD_AUTH_ENABLED: "true",
        DATABASE_URL: db.getConnectionUri(),
        REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
        ...keys,
      }),
      APP_ENV: "production",
    });
    try {
      const session = (
        await gql(
          loginQuery,
          { input: { email: user.email, password, application: "CUSTOMER" } },
          undefined,
          production,
        )
      ).data.loginPassword;
      expect(session.application).toBe("CUSTOMER");
      expect(
        (
          await gql(
            refreshQuery,
            {
              input: {
                refreshToken: session.refreshToken,
                application: "ADMIN",
              },
            },
            undefined,
            production,
          )
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
      expect(
        (
          await gql(
            meQuery,
            { application: "ADMIN" },
            session.accessToken,
            production,
          )
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
      expect(
        (
          await gql(
            "mutation{logoutAllSessions(application:ADMIN){accepted}}",
            {},
            session.accessToken,
            production,
          )
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
      expect(
        (
          await gql(
            meQuery,
            { application: "CUSTOMER" },
            session.accessToken,
            production,
          )
        ).data.me.id,
      ).toBe(user.id);
      const mixed = await gql(
        `query{customer:me(application:CUSTOMER){${userFields}} admin:me(application:ADMIN){${userFields}}}`,
        {},
        session.accessToken,
        production,
      );
      expect(mixed.errors[0].extensions.code).toBe("AUTHENTICATION_FAILED");
      expect(
        (
          await gql(
            loginQuery,
            { input: { email: user.email, password, application: "ADMIN" } },
            undefined,
            production,
          )
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
      const next = (
        await gql(
          refreshQuery,
          {
            input: {
              refreshToken: session.refreshToken,
              application: "CUSTOMER",
            },
          },
          undefined,
          production,
        )
      ).data.refreshSession;
      expect(next.application).toBe("CUSTOMER");
      expect(
        (
          await gql(
            meQuery,
            { application: "CUSTOMER" },
            next.accessToken,
            production,
          )
        ).data.me.id,
      ).toBe(user.id);
      const missing = await request(production.getHttpServer())
        .post("/graphql")
        .set("Authorization", `Bearer ${next.accessToken}`)
        .send({ query: `query{me{${userFields}}}` });
      expect(missing.body.errors).toBeDefined();
    } finally {
      await production.close();
    }
  });
  it("denies privileged password eligibility in production policy context", async () => {
    const user = await seed("ADMIN", "ADMIN");
    // Test policy with real isolated dependencies; deployment TLS is independently required by readConfig.
    const production = await createApp({
      ...readConfig({
        APP_ENV: "test",
        PUBLIC_ACCESS_ENFORCED: "false",
        PASSWORD_AUTH_ENABLED: "true",
        DATABASE_URL: db.getConnectionUri(),
        REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
        ...keys,
      }),
      APP_ENV: "production",
    });
    try {
      expect(
        (
          await gql(
            loginQuery,
            { input: { email: user.email, password, application: "ADMIN" } },
            undefined,
            production,
          )
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
    } finally {
      await production.close();
    }
  });
  it("enforces family-user binding, absolute expiry, immutable audit and rejects multi-root auth aliases", async () => {
    const first = await register();
    const other = await register();
    const family = (
      await pool.query(
        'SELECT id FROM "IdentitySessionFamily" WHERE "userId"=$1',
        [first.user.id],
      )
    ).rows[0].id;
    await expect(
      pool.query(
        'INSERT INTO "IdentityRefreshSession" (id,"familyId","userId","tokenHash") VALUES($1,$2,$3,$4)',
        [randomUUID(), family, other.user.id, randomBytes(32).toString("hex")],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        'UPDATE "IdentitySessionFamily" SET "expiresAt"="expiresAt"+interval \'1 day\' WHERE id=$1',
        [family],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query("UPDATE \"IdentityAuditEvent\" SET outcome='FAILURE'"),
    ).rejects.toThrow();
    await expect(pool.query('TRUNCATE "IdentityAuditEvent"')).rejects.toThrow();
    await expect(
      pool.query('DELETE FROM "IdentityRefreshSession" WHERE "familyId"=$1', [
        family,
      ]),
    ).rejects.toThrow();
    const result = await gql(
      "mutation($input:SessionLogoutInput!){a:logoutSession(input:$input){accepted} b:logoutSession(input:$input){accepted}}",
      { input: { refreshToken: first.refreshToken } },
    );
    expect(result.errors).toBeDefined();
    expect((await gql(meQuery, {}, first.accessToken)).data.me.id).toBe(
      first.user.id,
    );
  });
  it("shares atomic Redis account limits across API instances; rejects forged access claims", async () => {
    const email = `limits-${randomUUID()}@example.com`;
    for (let index = 0; index < 10; index++)
      expect(
        (
          await gql(
            loginQuery,
            { input: { email, password, application: "CUSTOMER" } },
            undefined,
            index % 2 ? app : second,
          )
        ).errors[0].extensions.code,
      ).toBe("AUTHENTICATION_FAILED");
    expect(
      (
        await gql(loginQuery, {
          input: { email, password, application: "CUSTOMER" },
        })
      ).errors[0].extensions.code,
    ).toBe("RATE_LIMITED");
    const session = await register();
    expect(
      (await gql(meQuery, {}, session.accessToken + "x")).errors[0].extensions
        .code,
    ).toBe("AUTHENTICATION_FAILED");
  });
  it("fails authentication closed during actual Redis outage while public liveness remains available", async () => {
    await redis.stop();
    expect(
      (
        await gql(loginQuery, {
          input: {
            email: "outage@example.com",
            password,
            application: "CUSTOMER",
          },
        })
      ).errors[0].extensions.code,
    ).toBe("SERVICE_UNAVAILABLE");
    await request(app.getHttpServer()).get("/health/live").expect(200);
  });
});
