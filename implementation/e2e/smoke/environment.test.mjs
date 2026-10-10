/**
 * T-026A — the G0 smoke harness (`pnpm e2e:smoke`) must hand every child
 * process one explicitly constructed, deterministic environment.
 *
 * Regression spec for the W24 residual "deterministic smoke secrets": the
 * harness used to spawn its build, migration and API children with the
 * developer's ambient environment (`env: process.env`, `{ ...process.env }`),
 * so a local `.env`/shell export of real secret material leaked into the run
 * and made it non-reproducible.
 *
 * Run: node --test e2e/smoke/environment.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoInheritedSecrets,
  buildChildEnvironment,
  scanAmbientSecrets,
  smokeSecrets,
} from "./environment.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A deliberately poisoned ambient environment: real-looking secret material. */
const POISONED_AMBIENT = {
  PATH: "/usr/bin:/bin:/opt/toolchain/bin",
  HOME: "/home/smoke-developer",
  TMPDIR: "/tmp",
  DATABASE_URL:
    "postgresql://real-user:real-db-password@db.internal:5432/production",
  REDIS_URL: "redis://:real-redis-password@cache.internal:6379/0",
  PUBLIC_ACCESS_SECRET: "PoisonedAmbientPublicAccessSecretValue000000",
  ACCESS_TOKEN_SECRET: "PoisonedAmbientAccessTokenSecretValue0000000",
  REFRESH_TOKEN_PEPPER: "PoisonedAmbientRefreshPepperValue0000000000",
  STRIPE_SECRET_KEY: "sk_live_poisoned_stripe_key",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----poisoned",
  AWS_SESSION_TOKEN: "poisoned-aws-session-token",
  DB_PASSWORD: "poisoned-db-password",
  GRAPHQL_BODY_LIMIT: "2mb",
};

const SECRET_NAMES = [
  "ACCESS_TOKEN_SECRET",
  "AWS_SESSION_TOKEN",
  "DATABASE_URL",
  "DB_PASSWORD",
  "FIREBASE_PRIVATE_KEY",
  "PUBLIC_ACCESS_SECRET",
  "REDIS_URL",
  "REFRESH_TOKEN_PEPPER",
  "STRIPE_SECRET_KEY",
];

const POISON_VALUES = [
  "real-db-password",
  "real-redis-password",
  "PoisonedAmbient",
  "poisoned",
  "sk_live_poisoned",
];

test("no ambient secret material reaches a child environment", () => {
  const env = buildChildEnvironment(POISONED_AMBIENT, { PORT: "4100" });
  for (const name of SECRET_NAMES)
    assert.ok(
      !(name in env),
      `${name} was carried from the ambient environment into a child`,
    );
  const serialised = JSON.stringify(env);
  for (const poison of POISON_VALUES)
    assert.ok(
      !serialised.includes(poison),
      `ambient value "${poison}" reached a child environment`,
    );
});

test("process plumbing and toolchain basics still reach the child", () => {
  const env = buildChildEnvironment(POISONED_AMBIENT, {});
  assert.equal(env.PATH, POISONED_AMBIENT.PATH);
  assert.equal(env.HOME, POISONED_AMBIENT.HOME);
  assert.equal(env.TMPDIR, POISONED_AMBIENT.TMPDIR);
});

test("explicit overrides are the only source of API configuration", () => {
  const env = buildChildEnvironment(POISONED_AMBIENT, {
    APP_ENV: "development",
    DATABASE_URL: "postgresql://smoke@127.0.0.1:5432/smoke",
    ACCESS_TOKEN_SECRET: "deterministic-access-token-secret-value00000",
  });
  assert.equal(env.APP_ENV, "development");
  assert.equal(env.DATABASE_URL, "postgresql://smoke@127.0.0.1:5432/smoke");
  assert.equal(
    env.ACCESS_TOKEN_SECRET,
    "deterministic-access-token-secret-value00000",
  );
  assert.ok(!JSON.stringify(env).includes("PoisonedAmbient"));
  assert.ok(!JSON.stringify(env).includes("real-db-password"));
});

test("the child environment is deterministic across differing ambient secrets", () => {
  const first = buildChildEnvironment(POISONED_AMBIENT, { PORT: "4100" });
  const second = buildChildEnvironment(
    {
      ...POISONED_AMBIENT,
      ACCESS_TOKEN_SECRET: "a-completely-different-ambient-value00000000000",
      DATABASE_URL: "postgresql://other:other@elsewhere:5432/other",
    },
    { PORT: "4100" },
  );
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [...Object.keys(first)].sort());
});

test("the ambient scan names exactly the variables that must never be inherited", () => {
  assert.deepEqual(scanAmbientSecrets(POISONED_AMBIENT), SECRET_NAMES);
  assert.deepEqual(scanAmbientSecrets({ PATH: "/usr/bin" }), []);
});

test("the smoke secrets are deterministic canonical 32-byte keys", () => {
  const first = smokeSecrets();
  const second = smokeSecrets();
  assert.deepEqual(first, second);
  for (const [name, value] of Object.entries(first)) {
    assert.match(
      value,
      /^[A-Za-z0-9_-]{43}$/,
      `${name} is not canonical base64url`,
    );
    assert.equal(Buffer.from(value, "base64url").length, 32);
  }
  assert.notEqual(first.publicAccessSecret, first.accessTokenSecret);
  assert.notEqual(first.accessTokenSecret, first.refreshPepper);
  assert.notEqual(first.publicAccessSecret, first.refreshPepper);
});

test("the run-time guard fails loudly when ambient secret material is carried", () => {
  assert.throws(
    () =>
      assertNoInheritedSecrets(POISONED_AMBIENT, { ...POISONED_AMBIENT }, {}),
    /ACCESS_TOKEN_SECRET/,
  );
  const overrides = {
    ACCESS_TOKEN_SECRET: "deterministic-access-token-secret-value00000",
  };
  assert.doesNotThrow(() =>
    assertNoInheritedSecrets(
      POISONED_AMBIENT,
      buildChildEnvironment(POISONED_AMBIENT, overrides),
      overrides,
    ),
  );
});

test("run.mjs constructs every child environment through the builder", () => {
  const source = readFileSync(path.join(here, "run.mjs"), "utf8");
  assert.ok(
    !/\.\.\.\s*process\.env/.test(source),
    "run.mjs still spreads the ambient process.env into a child environment",
  );
  assert.ok(
    !/env:\s*process\.env/.test(source),
    "a child process still receives the ambient process.env verbatim",
  );
  assert.ok(
    /from\s+"\.\/environment\.mjs"/.test(source),
    "run.mjs does not import the shared environment builder",
  );
  const builderUses = source.match(/buildChildEnvironment\(/g) ?? [];
  assert.ok(
    builderUses.length >= 3,
    `run.mjs must build the build, migration and API child environments explicitly (found ${builderUses.length})`,
  );
});
