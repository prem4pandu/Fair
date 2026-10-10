#!/usr/bin/env node
/**
 * G0 smoke — W1 (ROADMAP.md §7, ROADMAP.json → gates.G0 → `pnpm e2e:smoke`).
 *
 * Boots the real stack (PostGIS 17 + Redis 7 containers, migrations applied,
 * the built API process over a real TCP socket) and loads the exact pinned
 * admin-web and customer-web request documents over the real HTTP and
 * WebSocket transports:
 *
 *   1. `mutation MetricsGeneral` — every document the pinned admin and
 *      customer web apps send, with the real `nonce` header, minting a
 *      public-access token that is bound to that nonce.
 *   2. `query Configuration` — the customer web document, authorised with the
 *      minted `bop-auth` token, returning the active server-owned
 *      configuration version (never fabricated values).
 *   3. Both WebSocket frame sets — the legacy `subscriptions-transport-ws`
 *      frames under the `graphql-ws` subprotocol and the modern
 *      `graphql-transport-ws` frames — negotiating, carrying the exact pinned
 *      subscription document to its honest terminal frame, and delivering a
 *      real configured response for the customer web `configuration` query.
 *   4. Readiness — `/health/live` and `/health/ready` must both answer.
 *   5. Limits — the bounded-operation rule measured against the largest real
 *      pinned document, so the limit is proven against the real maximum.
 *
 * Nothing here is mocked: no in-process Nest app, no fabricated data, no
 * upstream endpoint. A domain operation that is not built yet must return the
 * explicit `NOT_IMPLEMENTED` contract, and this harness asserts that shape
 * rather than substituting data.
 *
 * Environment (T-026A): every child process this harness spawns — the API
 * build, `prisma migrate deploy` and the built API — receives one explicitly
 * constructed, deterministic environment from `environment.mjs`. No child
 * inherits the ambient `process.env`, so a developer `.env` cannot leak a real
 * secret into the run. The artifact records which ambient secret names were
 * excluded and the exact key set each child was given.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Kind, parse } from "graphql";
import { Pool } from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer } from "testcontainers";
import { listDocuments, loadDocument } from "../../tools/lib/documents.mjs";
import {
  assertNoInheritedSecrets,
  buildChildEnvironment,
  describeEnvironment,
  fingerprintSecrets,
  scanAmbientSecrets,
  smokeSecrets,
} from "./environment.mjs";

const require = createRequire(import.meta.url);
const WebSocket = require(
  require.resolve("ws", { paths: [path.join(process.cwd(), "services/api")] }),
);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const apiRoot = path.join(root, "services/api");
const artifactPath = path.join(root, "test-results/e2e-smoke.json");
const pnpm = path.join(root, "tools/pnpm.sh");

// Deterministic secrets for the whole run. Every child process is configured
// with exactly these values; nothing is read from the ambient environment, so
// a developer `.env` cannot change what this smoke proves (see
// `environment.mjs`).
const { publicAccessSecret, accessTokenSecret, refreshPepper } = smokeSecrets();

const DB_DOCUMENT = {
  countryCode: "MY",
  currency: "MYR",
  currencySymbol: "RM",
  currencyMinorUnits: 2,
  skipEmailVerification: false,
  skipMobileVerification: false,
};

/** The pinned documents the admin and customer web apps actually send. */
const PINNED = [
  {
    id: "admin.metricsGeneral",
    app: "enatega-multivendor-admin",
    file: "lib/api/graphql/mutations/metrics/index.ts",
    exportName: "METRICS_GENERAL",
    role: "handshake",
  },
  {
    id: "web.metricsGeneral",
    app: "enatega-multivendor-web",
    file: "lib/api/graphql/mutations/metrics/index.ts",
    exportName: "METRICS_GENERAL",
    role: "handshake",
  },
  {
    id: "web.configuration",
    app: "enatega-multivendor-web",
    file: "lib/api/graphql/queries/config.ts",
    exportName: "GET_CONFIG",
    role: "configuration",
  },
  {
    id: "admin.subscribePlaceOrder",
    app: "enatega-multivendor-admin",
    file: "lib/api/graphql/subscription/order-subscription/index.ts",
    exportName: "SUBSCRIPTION_PLACE_ORDER",
    role: "subscription",
  },
  {
    id: "web.orderStatusChanged",
    app: "enatega-multivendor-web",
    file: "lib/api/graphql/subscription/orders/index.ts",
    exportName: "orderStatusChanged",
    role: "subscription",
  },
];

const APPS = [
  "enatega-multivendor-admin",
  "enatega-multivendor-web",
  "enatega-multivendor-app",
  "enatega-multivendor-store",
  "enatega-multivendor-rider",
  "enatega-singlevendor-admin",
];

const log = (message) => process.stdout.write(`[e2e:smoke] ${message}\n`);

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal frame-level client, same shapes the pinned clients speak. */
class FrameClient {
  constructor(url, protocol) {
    this.frames = [];
    this.socket = new WebSocket(url, protocol);
    this.closed = new Promise((resolve) => {
      this.socket.on("close", (code, reason) =>
        resolve({ code, reason: String(reason) }),
      );
    });
    this.socket.on("message", (data) => {
      this.frames.push(JSON.parse(String(data)));
    });
    this.socket.on("error", () => {});
  }

  async open(timeoutMs = 5_000) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket open timed out")),
        timeoutMs,
      );
      this.socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send(frame) {
    this.socket.send(JSON.stringify(frame));
  }

  async take(predicate, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.find(predicate);
      if (found) return found;
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(
          `No WebSocket frame matched within ${timeoutMs}ms: ${JSON.stringify(this.frames)}`,
        );
      await sleep(Math.min(50, remaining));
    }
  }

  close() {
    this.socket.close();
  }
}

async function openFrameClient(url, protocol, params = {}) {
  const client = new FrameClient(url, protocol);
  await client.open();
  client.send({ type: "connection_init", payload: params });
  await client.take((frame) => frame.type === "connection_ack");
  return client;
}

/** Replicates the server's bounded-operation rule to measure real documents. */
function measureDocument(text, limits) {
  const document = parse(text);
  const fragments = new Map();
  for (const definition of document.definitions)
    if (definition.kind === Kind.FRAGMENT_DEFINITION)
      fragments.set(definition.name.value, definition);

  let fields = 0;
  let aliases = 0;
  let depth = 0;
  let exceeded = document.definitions.length > limits.definitions;

  const walk = (selection, level, seen) => {
    depth = Math.max(depth, level);
    if (level > limits.depth || fields > limits.fields) {
      exceeded = true;
      return;
    }
    for (const entry of selection.selections) {
      if (entry.kind === Kind.FIELD) {
        fields += 1;
        if (entry.alias) aliases += 1;
        if (entry.selectionSet) walk(entry.selectionSet, level + 1, seen);
      } else if (entry.kind === Kind.INLINE_FRAGMENT) {
        walk(entry.selectionSet, level, seen);
      } else {
        const name = entry.name.value;
        if (seen.has(name)) {
          exceeded = true;
          return;
        }
        const fragment = fragments.get(name);
        if (fragment)
          walk(fragment.selectionSet, level, new Set([...seen, name]));
      }
      if (fields > limits.fields || aliases > limits.aliases) {
        exceeded = true;
        return;
      }
    }
  };

  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    if (
      definition.operation === "mutation" &&
      definition.selectionSet.selections.filter(
        (selection) => selection.kind === Kind.FIELD,
      ).length > 1
    )
      exceeded = true;
    walk(definition.selectionSet, 1, new Set());
  }
  return {
    fields,
    aliases,
    depth,
    definitions: document.definitions.length,
    exceeded,
  };
}

async function post(port, body, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, body: payload };
}

async function main() {
  const startedAt = new Date().toISOString();
  const checks = [];
  const record = (name, detail) => {
    checks.push({ name, at: new Date().toISOString(), ...detail });
    log(`${name}: ${detail.summary}`);
  };

  let postgres;
  let redis;
  let api;
  let pool;
  let apiLog = "";
  // The environment evidence every child process was given. Recorded in the
  // artifact so a run proves for itself that no ambient secret material was
  // inherited (T-026A).
  const environmentRecord = {
    ambientSecretNames: scanAmbientSecrets(process.env),
    children: {},
  };

  const writeArtifact = (passed, error) => {
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          gate: "G0",
          workstream: "W1",
          command: "pnpm e2e:smoke",
          startedAt,
          finishedAt: new Date().toISOString(),
          passed,
          error: error ? String(error.stack ?? error) : null,
          transport: "real stack (PostGIS 17 + Redis 7 + built API process)",
          environment: environmentRecord,
          pinnedDocuments: PINNED.map(
            ({ id, app, file, exportName, role }) => ({
              id,
              app,
              file,
              exportName,
              role,
            }),
          ),
          checks,
          apiLogTail: apiLog.slice(-4000),
        },
        null,
        2,
      )}\n`,
    );
  };

  try {
    log("starting PostGIS and Redis containers");
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer("postgis/postgis:17-3.5")
        .withPlatform("linux/amd64")
        .withStartupTimeout(120_000)
        .start(),
      new GenericContainer("redis:7-alpine")
        .withExposedPorts(6379)
        .withStartupTimeout(120_000)
        .start(),
    ]);
    const databaseUrl = postgres.getConnectionUri();
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    pool.on("error", () => {});

    if (environmentRecord.ambientSecretNames.length > 0)
      log(
        `excluding ${environmentRecord.ambientSecretNames.length} ambient secret variable(s) from every child process: ${environmentRecord.ambientSecretNames.join(", ")}`,
      );
    else log("no ambient secret variables were present to exclude");

    log("building the API and applying migrations");
    const buildOverrides = {};
    const buildEnv = assertNoInheritedSecrets(
      process.env,
      buildChildEnvironment(process.env, buildOverrides),
      buildOverrides,
    );
    const build = spawnSync(pnpm, ["--filter", "@fairbite/api", "build"], {
      cwd: root,
      stdio: "inherit",
      env: buildEnv,
    });
    if (build.status !== 0)
      throw new Error(`API build failed with exit code ${build.status}`);

    const prisma = path.join(apiRoot, "node_modules/.bin/prisma");
    const migrateOverrides = { DATABASE_URL: databaseUrl };
    const migrateEnv = assertNoInheritedSecrets(
      process.env,
      buildChildEnvironment(process.env, migrateOverrides),
      migrateOverrides,
    );
    const migrate = spawnSync(prisma, ["migrate", "deploy"], {
      cwd: apiRoot,
      stdio: "inherit",
      env: migrateEnv,
    });
    if (migrate.status !== 0)
      throw new Error(
        `prisma migrate deploy failed with exit code ${migrate.status}`,
      );

    log("activating one server-owned configuration version");
    const version = Number(
      (
        await pool.query(
          'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM "RuntimeConfigurationVersion"',
        )
      ).rows[0].version,
    );
    const configurationId = randomUUID();
    await pool.query(
      'INSERT INTO "RuntimeConfigurationVersion"(id,version,document) VALUES($1,$2,$3)',
      [configurationId, version, DB_DOCUMENT],
    );
    await pool.query(
      'INSERT INTO "RuntimeConfigurationPointer"(id,"versionId") VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET "versionId"=EXCLUDED."versionId"',
      [configurationId],
    );

    const port = await freePort();
    log(`starting the built API on 127.0.0.1:${port}`);
    const apiOverrides = {
      APP_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      PUBLIC_ACCESS_ENFORCED: "true",
      PUBLIC_ACCESS_SECRET: publicAccessSecret,
      PASSWORD_AUTH_ENABLED: "true",
      ACCESS_TOKEN_SECRET: accessTokenSecret,
      REFRESH_TOKEN_PEPPER: refreshPepper,
      CORS_ORIGINS: "http://localhost:3000,http://localhost:3001",
    };
    const apiEnv = assertNoInheritedSecrets(
      process.env,
      buildChildEnvironment(process.env, apiOverrides),
      apiOverrides,
    );
    environmentRecord.children = {
      build: {
        cwd: root,
        keys: describeEnvironment(buildEnv),
        secretFingerprint: fingerprintSecrets(buildEnv),
      },
      migrate: {
        cwd: apiRoot,
        keys: describeEnvironment(migrateEnv),
        secretFingerprint: fingerprintSecrets(migrateEnv),
      },
      api: {
        cwd: root,
        keys: describeEnvironment(apiEnv),
        secretFingerprint: fingerprintSecrets(apiEnv),
      },
    };
    api = spawn("node", ["services/api/dist/main.js"], {
      cwd: root,
      env: apiEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    api.stdout.on("data", (data) => (apiLog += data));
    api.stderr.on("data", (data) => (apiLog += data));

    const base = `http://127.0.0.1:${port}`;
    const healthDeadline = Date.now() + 30_000;
    for (;;) {
      try {
        const live = await fetch(`${base}/health/live`);
        if (live.ok) break;
      } catch {
        /* not listening yet */
      }
      if (Date.now() > healthDeadline)
        throw new Error(`API did not answer /health/live. Log:\n${apiLog}`);
      await sleep(250);
    }
    const live = await fetch(`${base}/health/live`);
    const ready = await fetch(`${base}/health/ready`);
    if (!live.ok || !ready.ok)
      throw new Error(
        `Health checks failed: live=${live.status} ready=${ready.status}`,
      );
    record("health.live", { summary: `HTTP ${live.status}` });
    record("health.ready", {
      summary: `HTTP ${ready.status} (Postgres and Redis reachable)`,
    });

    // --- pinned documents ---------------------------------------------------
    const documents = new Map();
    for (const entry of PINNED) {
      const text = loadDocument(entry.app, entry.file, entry.exportName);
      if (/\$\{/.test(text))
        throw new Error(
          `${entry.id} still contains an unresolved interpolation`,
        );
      documents.set(entry.id, text);
    }

    const { PublicAccessTokens } = await import(
      pathToFileURL(path.join(apiRoot, "dist/kernel/public-access/token.js"))
        .href
    );
    const tokens = new PublicAccessTokens(publicAccessSecret, 900);

    // --- 1 + 2: handshake then an authorised real read ----------------------
    let minted;
    for (const entry of PINNED.filter((item) => item.role === "handshake")) {
      const nonce = `smoke-${entry.id}-${randomUUID()}`;
      const response = await post(
        port,
        { query: documents.get(entry.id), operationName: "MetricsGeneral" },
        { nonce },
      );
      if (response.status !== 200)
        throw new Error(
          `${entry.id} handshake returned HTTP ${response.status}: ${JSON.stringify(response.body)}`,
        );
      const metrics = response.body?.data?.metricsGeneral;
      if (!metrics || typeof metrics.experience !== "string")
        throw new Error(
          `${entry.id} handshake returned no token: ${JSON.stringify(response.body)}`,
        );
      const verified = await tokens.verify(metrics.experience, nonce);
      if (!verified.ok)
        throw new Error(`${entry.id} token did not verify for its nonce`);
      if (entry.id === "web.metricsGeneral") minted = { nonce, metrics };
      record(`handshake.${entry.id}`, {
        summary: `HTTP 200, token bound to its nonce (${Object.keys(metrics).length} pinned fields)`,
      });
    }

    const denied = await post(port, {
      query: documents.get("web.configuration"),
    });
    if (
      denied.status !== 403 ||
      denied.body?.errors?.[0]?.extensions?.code !== "PUBLIC_ACCESS_DENIED"
    )
      throw new Error(
        `configuration without a token was not denied: ${JSON.stringify(denied)}`,
      );
    record("gate.enforced", {
      summary:
        "unauthenticated configuration rejected with PUBLIC_ACCESS_DENIED",
    });

    const configurationResponse = await post(
      port,
      {
        query: documents.get("web.configuration"),
        operationName: "Configuration",
      },
      {
        nonce: minted.nonce,
        "bop-auth": `Bearer ${minted.metrics.experience}`,
      },
    );
    if (configurationResponse.status !== 200)
      throw new Error(
        `configuration returned HTTP ${configurationResponse.status}: ${JSON.stringify(configurationResponse.body)}`,
      );
    if (configurationResponse.body?.errors)
      throw new Error(
        `configuration returned errors: ${JSON.stringify(configurationResponse.body.errors)}`,
      );
    const configuration = configurationResponse.body?.data?.configuration;
    if (
      configuration?._id !== configurationId ||
      configuration.currency !== DB_DOCUMENT.currency ||
      configuration.currencySymbol !== DB_DOCUMENT.currencySymbol
    )
      throw new Error(
        `configuration did not return the active server-owned version: ${JSON.stringify(configuration)}`,
      );
    record("configuration.web", {
      summary: `HTTP 200, active version ${configuration._id} (${configuration.currency})`,
    });

    // --- 3: both WebSocket frame sets --------------------------------------
    const wsUrl = `ws://127.0.0.1:${port}/graphql`;
    const subscriptionChecks = [];
    for (const entry of PINNED.filter((item) => item.role === "subscription")) {
      const variables =
        entry.id === "admin.subscribePlaceOrder"
          ? { restaurant: "smoke" }
          : { userId: "018f0000-0000-7000-8000-0000000000a1" };

      const legacy = await openFrameClient(wsUrl, "graphql-ws", {
        nonce: "smoke",
      });
      legacy.send({
        type: "start",
        id: "legacy-sub",
        payload: { query: documents.get(entry.id), variables },
      });
      const legacyFrame = await legacy.take(
        (frame) => frame.id === "legacy-sub",
      );
      await legacy.take(
        (frame) => frame.type === "complete" && frame.id === "legacy-sub",
      );
      const legacyError = legacyFrame.payload?.errors?.[0];
      if (legacyError?.extensions?.code !== "NOT_IMPLEMENTED")
        throw new Error(
          `${entry.id} legacy frames did not deliver the explicit NOT_IMPLEMENTED terminal: ${JSON.stringify(legacyFrame)}`,
        );
      legacy.send({ type: "stop", id: "legacy-sub" });
      legacy.close();
      await legacy.closed;

      const modern = await openFrameClient(wsUrl, "graphql-transport-ws", {
        nonce: "smoke",
      });
      modern.send({
        type: "subscribe",
        id: "modern-sub",
        payload: { query: documents.get(entry.id), variables },
      });
      const modernFrame = await modern.take(
        (frame) =>
          frame.id === "modern-sub" &&
          (frame.type === "next" || frame.type === "error"),
      );
      const modernPayload = modernFrame.payload ?? modernFrame;
      const modernError = Array.isArray(modernPayload)
        ? modernPayload[0]
        : (modernPayload?.errors?.[0] ?? modernPayload);
      if (modernError?.extensions?.code !== "NOT_IMPLEMENTED")
        throw new Error(
          `${entry.id} modern frames did not deliver the explicit NOT_IMPLEMENTED terminal: ${JSON.stringify(modernFrame)}`,
        );
      await modern.take(
        (frame) => frame.type === "complete" && frame.id === "modern-sub",
      );
      modern.close();
      await modern.closed;

      subscriptionChecks.push(entry.id);
      record(`websocket.subscription.${entry.id}`, {
        summary:
          "legacy (graphql-ws) and modern (graphql-transport-ws) both delivered the subscription to its explicit NOT_IMPLEMENTED terminal",
      });
    }

    // Real data over both frame sets: the exact customer-web configuration
    // query executed through the WebSocket execution path.
    for (const [protocol, id] of [
      ["graphql-ws", "legacy-query"],
      ["graphql-transport-ws", "modern-query"],
    ]) {
      const client = await openFrameClient(wsUrl, protocol, { nonce: "smoke" });
      client.send({
        type: protocol === "graphql-ws" ? "start" : "subscribe",
        id,
        payload: {
          query: documents.get("web.configuration"),
          operationName: "Configuration",
        },
      });
      const frame = await client.take((candidate) => candidate.id === id);
      const payload = frame.payload ?? frame;
      const data = payload?.data ?? payload;
      if (data?.configuration?.currency !== DB_DOCUMENT.currency)
        throw new Error(
          `${protocol} did not deliver the configuration read: ${JSON.stringify(frame)}`,
        );
      client.close();
      await client.closed;
      record(`websocket.data.${protocol}`, {
        summary: `real configuration data delivered over ${protocol}`,
      });
    }

    // --- 5: limits against the largest real pinned document -----------------
    const { LIMITS } = await import(
      pathToFileURL(path.join(apiRoot, "dist/kernel/limits.js")).href
    );
    let largest = null;
    for (const app of APPS) {
      for (const document of listDocuments(app)) {
        if (!document.resolved) continue;
        const measured = measureDocument(document.text, LIMITS);
        if (measured.exceeded)
          throw new Error(
            `pinned document ${app} ${document.file}:${document.line} exceeds the server limits`,
          );
        if (!largest || measured.fields > largest.measured.fields)
          largest = { app, document, measured };
      }
    }
    if (!largest) throw new Error("no pinned documents were measured");
    if (
      largest.measured.fields > LIMITS.fields ||
      largest.measured.depth > LIMITS.depth ||
      largest.measured.aliases > LIMITS.aliases ||
      largest.measured.definitions > LIMITS.definitions
    )
      throw new Error(
        `the largest pinned document exceeds the server limits: ${JSON.stringify(largest.measured)}`,
      );
    const operations = [];
    for (const definition of parse(largest.document.text).definitions)
      if (definition.kind === Kind.OPERATION_DEFINITION)
        operations.push(definition.name?.value);
    const limitsResponse = await post(
      port,
      {
        query: largest.document.text,
        operationName: operations[0],
      },
      {
        nonce: minted.nonce,
        "bop-auth": `Bearer ${minted.metrics.experience}`,
      },
    );
    const limitError = JSON.stringify(limitsResponse.body ?? {}).includes(
      "Operation exceeds allowed limits",
    );
    if (limitError)
      throw new Error(
        `the largest pinned document was rejected by the limit rule: ${JSON.stringify(limitsResponse.body)}`,
      );

    // Negative control: the size check above only means something if the served
    // rule can actually reject an over-limit document. Build one that exceeds
    // the alias budget with a real, servable root and require the exact limit
    // error, so a removed validation rule fails this smoke instead of passing.
    const overLimit = `query OverLimit { ${Array.from(
      { length: LIMITS.aliases + 1 },
      (_, index) => `a${index}: configuration { currency }`,
    ).join(" ")} }`;
    const overLimitResponse = await post(
      port,
      { query: overLimit, operationName: "OverLimit" },
      {
        nonce: minted.nonce,
        "bop-auth": `Bearer ${minted.metrics.experience}`,
      },
    );
    const overLimitRejected = JSON.stringify(
      overLimitResponse.body ?? {},
    ).includes("Operation exceeds allowed limits");
    if (!overLimitRejected)
      throw new Error(
        `the server did not enforce the bounded-operation rule on an over-limit document (aliases ${LIMITS.aliases + 1}): HTTP ${overLimitResponse.status} ${JSON.stringify(overLimitResponse.body).slice(0, 300)}`,
      );

    record("limits.largest-document", {
      summary: `${largest.app} ${largest.document.file} measured ${largest.measured.fields}/${LIMITS.fields} fields, depth ${largest.measured.depth}/${LIMITS.depth}; served without a limit error`,
    });
    record("limits.negative-control", {
      summary: `an over-limit document (${LIMITS.aliases + 1} aliases > ${LIMITS.aliases}) was rejected with "Operation exceeds allowed limits"`,
    });

    writeArtifact(true, null);
    log(
      `PASS — ${checks.length} checks; artifact ${path.relative(root, artifactPath)}`,
    );
    log(`WS subscriptions: ${subscriptionChecks.join(", ")}`);
    return 0;
  } catch (error) {
    writeArtifact(false, error);
    process.stderr.write(`[e2e:smoke] FAIL: ${error?.stack ?? error}\n`);
    if (apiLog)
      process.stderr.write(
        `[e2e:smoke] API log tail:\n${apiLog.slice(-4000)}\n`,
      );
    return 1;
  } finally {
    api?.kill("SIGTERM");
    await Promise.allSettled([pool?.end(), redis?.stop(), postgres?.stop()]);
  }
}

main().then((code) => process.exit(code));
