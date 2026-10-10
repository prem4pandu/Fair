/**
 * T-026A — the G0 smoke harness (`pnpm e2e:smoke`) must hand every child
 * process one explicitly constructed, deterministic environment.
 *
 * Regression spec for the W24 residual "deterministic smoke secrets" and for the
 * two independent-review findings on the first revision (commit 5353c9f):
 *
 *   A1 — no ambient value that can inject code or carry credentials may reach a
 *        child silently (`NODE_OPTIONS=--require …`, `DOCKER_HOST=tcp://user:password@…`).
 *   A2 — the deterministic secret fingerprint must be run-stable and must not
 *        cover the per-run testcontainers endpoints.
 *
 * Run: node --test e2e/smoke/environment.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCKED_ENVIRONMENT_HAZARDS,
  DETERMINISTIC_SECRET_NAMES,
  PASSTHROUGH_ENVIRONMENT_NAMES,
  assertNoInheritedSecrets,
  buildChildEnvironment,
  describeAmbientHazard,
  describeEphemeralContainerPlumbing,
  fingerprintDeterministicSecrets,
  redactCredentials,
  scanAmbientHazards,
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

/** The A1 vectors: each can execute code or disclose credentials in a child. */
const HAZARDOUS_AMBIENT = {
  ...POISONED_AMBIENT,
  NODE_OPTIONS: "--require /tmp/evil.cjs",
  NODE_PATH: "/tmp/evil-modules",
  NODE_EXTRA_CA_CERTS: "/tmp/evil-ca.pem",
  DOCKER_HOST: "tcp://user:password@docker.internal:2375",
  DOCKER_CONTEXT: "evil-context",
  DOCKER_TLS_VERIFY: "1",
  DOCKER_CERT_PATH: "/home/dev/.docker/evil-client-certs",
  HTTPS_PROXY: "http://proxy-user:proxy-password@proxy.internal:8080",
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

const DETERMINISTIC_OVERRIDES = {
  PUBLIC_ACCESS_SECRET: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  ACCESS_TOKEN_SECRET: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  REFRESH_TOKEN_PEPPER: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
};

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

// --- A1: code-injection and credential vectors ------------------------------

test("A1: node-flag and container-transport names never reach a child", () => {
  const env = buildChildEnvironment(HAZARDOUS_AMBIENT, {});
  for (const name of Object.keys(BLOCKED_ENVIRONMENT_HAZARDS))
    assert.ok(!(name in env), `${name} reached a child environment`);
  const serialised = JSON.stringify(env);
  assert.ok(!serialised.includes("evil.cjs"));
  assert.ok(!serialised.includes("evil-ca.pem"));
  assert.ok(!serialised.includes("password@docker"));
  assert.ok(!serialised.includes("proxy-password"));
});

test("A1: the passthrough allowlist holds no blocked or hazardous name", () => {
  for (const name of PASSTHROUGH_ENVIRONMENT_NAMES) {
    assert.ok(
      !Object.hasOwn(BLOCKED_ENVIRONMENT_HAZARDS, name),
      `${name} is on the passthrough list and in the blocked set`,
    );
    assert.equal(
      describeAmbientHazard(name, "plain-value"),
      null,
      `${name} is on the passthrough list but is hazardous by name`,
    );
  }
});

test("A1: the run-time guard rejects ambient credentials and injection flags", () => {
  const carried = (name, value) => ({ [name]: value });
  assert.throws(
    () =>
      assertNoInheritedSecrets(
        carried("DOCKER_HOST", "tcp://user:password@host:2375"),
        carried("DOCKER_HOST", "tcp://user:password@host:2375"),
        {},
      ),
    /DOCKER_HOST/,
  );
  assert.throws(
    () =>
      assertNoInheritedSecrets(
        carried("NODE_OPTIONS", "--require /tmp/evil.cjs"),
        carried("NODE_OPTIONS", "--require /tmp/evil.cjs"),
        {},
      ),
    /NODE_OPTIONS/,
  );
  assert.throws(
    () =>
      assertNoInheritedSecrets(
        carried("HOME", "https://user:secret@files.internal/share"),
        carried("HOME", "https://user:secret@files.internal/share"),
        {},
      ),
    /URL credentials/,
  );
  assert.throws(
    () =>
      assertNoInheritedSecrets(
        carried("LANG", "en_US.UTF-8 --import /tmp/evil.mjs"),
        carried("LANG", "en_US.UTF-8 --import /tmp/evil.mjs"),
        {},
      ),
    /code-injection flags/,
  );
});

test("A1: the guard accepts credentialed plumbing the harness chose itself", () => {
  const overrides = {
    DATABASE_URL: "postgres://test:test@localhost:32866/test",
    REDIS_URL: "redis://localhost:32867",
  };
  assert.doesNotThrow(() =>
    assertNoInheritedSecrets(
      HAZARDOUS_AMBIENT,
      buildChildEnvironment(HAZARDOUS_AMBIENT, overrides),
      overrides,
    ),
  );
});

test("A1: the ambient hazard scan names each vector with a reason", () => {
  assert.deepEqual(
    scanAmbientHazards(HAZARDOUS_AMBIENT).map((hazard) => hazard.name),
    [
      "DATABASE_URL",
      "DOCKER_CERT_PATH",
      "DOCKER_CONTEXT",
      "DOCKER_HOST",
      "DOCKER_TLS_VERIFY",
      "HTTPS_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "NODE_OPTIONS",
      "NODE_PATH",
      "REDIS_URL",
    ],
  );
  for (const hazard of scanAmbientHazards(HAZARDOUS_AMBIENT))
    assert.ok(
      typeof hazard.reason === "string" && hazard.reason.length > 0,
      `${hazard.name} has no reason`,
    );
  assert.deepEqual(
    scanAmbientHazards({ PATH: "/usr/bin", HOME: "/home/x" }),
    [],
  );
});

// --- A2: run-stable deterministic fingerprint -------------------------------

test("A2: the deterministic fingerprint is a frozen constant", () => {
  const { publicAccessSecret, accessTokenSecret, refreshPepper } =
    smokeSecrets();
  assert.equal(
    fingerprintDeterministicSecrets({
      ACCESS_TOKEN_SECRET: accessTokenSecret,
      PUBLIC_ACCESS_SECRET: publicAccessSecret,
      REFRESH_TOKEN_PEPPER: refreshPepper,
    }),
    "77c151b2309f836b",
  );
});

test("A2: the fingerprint ignores per-run container endpoints", () => {
  const first = buildChildEnvironment(HAZARDOUS_AMBIENT, {
    ...DETERMINISTIC_OVERRIDES,
    DATABASE_URL: "postgres://test:test@localhost:32866/test",
    REDIS_URL: "redis://localhost:32867",
  });
  const second = buildChildEnvironment(HAZARDOUS_AMBIENT, {
    ...DETERMINISTIC_OVERRIDES,
    DATABASE_URL: "postgres://test:test@localhost:49999/test",
    REDIS_URL: "redis://localhost:50000",
  });
  assert.equal(
    fingerprintDeterministicSecrets(first),
    fingerprintDeterministicSecrets(second),
  );
  assert.notEqual(first.DATABASE_URL, second.DATABASE_URL);
});

test("A2: the fingerprint changes when deterministic secret material changes", () => {
  const changed = { ...DETERMINISTIC_OVERRIDES, ACCESS_TOKEN_SECRET: "Zm9v" };
  assert.notEqual(
    fingerprintDeterministicSecrets(
      buildChildEnvironment(HAZARDOUS_AMBIENT, DETERMINISTIC_OVERRIDES),
    ),
    fingerprintDeterministicSecrets(
      buildChildEnvironment(HAZARDOUS_AMBIENT, changed),
    ),
  );
});

test("A2: a child with no deterministic secrets has a defined fingerprint", () => {
  const env = buildChildEnvironment(HAZARDOUS_AMBIENT, {});
  for (const name of DETERMINISTIC_SECRET_NAMES)
    assert.ok(!(name in env), `${name} unexpectedly present`);
  assert.equal(fingerprintDeterministicSecrets(env), "60ecfee0ef6bcd2e");
});

test("A2: per-run plumbing is recorded separately, with credentials redacted", () => {
  const env = buildChildEnvironment(HAZARDOUS_AMBIENT, {
    DATABASE_URL: "postgres://test:test@localhost:32866/test",
    REDIS_URL: "redis://localhost:32867",
  });
  const plumbing = describeEphemeralContainerPlumbing(env);
  assert.deepEqual(Object.keys(plumbing), ["DATABASE_URL", "REDIS_URL"]);
  assert.equal(
    plumbing.DATABASE_URL,
    "postgres://***:***@localhost:32866/test",
  );
  assert.equal(plumbing.REDIS_URL, "redis://localhost:32867");
  assert.ok(!JSON.stringify(plumbing).includes("test:test"));
  assert.deepEqual(
    describeEphemeralContainerPlumbing(
      buildChildEnvironment(HAZARDOUS_AMBIENT, {}),
    ),
    {},
  );
  assert.equal(redactCredentials("plain"), "plain");
});

// --- the smoke secrets and the harness wiring -------------------------------

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
  assert.ok(
    !/fingerprintSecrets/.test(source),
    "run.mjs still uses the superseded all-secrets fingerprint (A2)",
  );
  for (const call of [
    "fingerprintDeterministicSecrets",
    "describeEphemeralContainerPlumbing",
    "scanAmbientHazards",
  ])
    assert.ok(
      new RegExp(`${call}\\(`).test(source),
      `run.mjs does not record ${call} (A1/A2)`,
    );
});
