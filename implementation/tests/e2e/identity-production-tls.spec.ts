import { test, expect, chromium, type Browser } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { randomBytes, X509Certificate, createHash } from "node:crypto";
import { createServer, request as httpsRequest, type Server } from "node:https";
import { request as httpRequest } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = process.cwd();
const children: ChildProcess[] = [];
let database: StartedPostgreSqlContainer | undefined;
let redis: StartedTestContainer | undefined;
let api: ChildProcess | undefined;
function start(argv: string[], cwd = root, extra: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, argv, {
    cwd,
    env: { ...process.env, ...extra },
    stdio: ["ignore", "ignore", "ignore"],
  });
  children.push(child);
  return child;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5000);
  await closed;
  clearTimeout(force);
}
async function wait(url: string, child: ChildProcess) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Application process exited before readiness");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* process is still starting */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("Application readiness deadline exceeded");
}
const password = randomBytes(24).toString("base64url");
const fixtures = ["customer", "merchant", "admin"].map((role) => ({
  role,
  email: `identity-${role}@example.test`,
  name: `QA ${role}`,
}));
async function seedPrivileged(role: string, email: string) {
  const application = role === "merchant" ? "MERCHANT" : "ADMIN";
  const identityRole = role === "merchant" ? "MERCHANT_STAFF" : "ADMIN";
  const result = await database!.exec([
    "psql",
    "-U",
    database!.getUsername(),
    "-d",
    database!.getDatabase(),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `UPDATE "IdentityUser" SET roles=ARRAY['${identityRole}'] WHERE email='${email}'; INSERT INTO "IdentityApplicationGrant" ("userId",application,active) SELECT id,'${application}',true FROM "IdentityUser" WHERE email='${email}';`,
  ]);
  expect(result.exitCode).toBe(0);
}
async function seedDualRole() {
  const result = await fetch("http://127.0.0.1:4300/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query:
        "mutation($input:CustomerRegistrationInput!){registerCustomer(input:$input){user{id}}}",
      variables: {
        input: {
          email: "identity-dual@example.test",
          password,
          displayName: "QA dual application",
        },
      },
    }),
  });
  expect((await result.json()).errors).toBeUndefined();
  const changed = await database!.exec([
    "psql",
    "-U",
    database!.getUsername(),
    "-d",
    database!.getDatabase(),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `UPDATE "IdentityUser" SET roles=ARRAY['CUSTOMER','ADMIN'] WHERE email='identity-dual@example.test'; INSERT INTO "IdentityApplicationGrant" ("userId",application,active) SELECT id,'ADMIN',true FROM "IdentityUser" WHERE email='identity-dual@example.test';`,
  ]);
  expect(changed.exitCode).toBe(0);
}
async function login(
  page: import("@playwright/test").Page,
  port: number,
  email: string,
) {
  await page.goto(`https://localhost:${port}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

let testCertificate: Buffer;
let certificateDirectory: string | undefined;
let browser: Browser | undefined;
const proxies: Server[] = [];
const proxyErrors: string[] = [];
async function trustedPost(port: number, origin?: string): Promise<number> {
  const body = JSON.stringify({ email: fixtures[0].email, password });
  return new Promise((resolveStatus, reject) => {
    const outgoing = httpsRequest(
      {
        hostname: "localhost",
        family: 4,
        port,
        path: "/api/auth/login",
        method: "POST",
        ca: testCertificate,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...(origin ? { origin } : {}),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolveStatus(response.statusCode ?? 0));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
async function proxy(
  port: number,
  upstream: number,
  key: Buffer,
  cert: Buffer,
) {
  const server = createServer({ key, cert }, (incoming, outgoing) => {
    const headers = { ...incoming.headers, host: `localhost:${port}` };
    for (const name of Object.keys(headers))
      if (name === "forwarded" || name.startsWith("x-forwarded-"))
        delete headers[name];
    const forwarded = httpRequest(
      {
        hostname: "127.0.0.1",
        port: upstream,
        path: incoming.url,
        method: incoming.method,
        headers,
      },
      (result) => {
        outgoing.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(outgoing);
      },
    );
    forwarded.on("error", () => {
      proxyErrors.push("upstream unavailable");
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on("aborted", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  proxies.push(server);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
}
test.describe
  .serial("controlled localhost TLS production Next identity boundary", () => {
  test.beforeAll(async () => {
    test.setTimeout(180000);
    certificateDirectory = await mkdtemp(
      resolve(tmpdir(), "fairbite-test-tls-"),
    );
    const config = resolve(certificateDirectory, "openssl.cnf");
    await writeFile(
      config,
      "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
    );
    await promisify(execFile)("/usr/bin/openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-config",
      config,
      "-keyout",
      resolve(certificateDirectory, "key.pem"),
      "-out",
      resolve(certificateDirectory, "cert.pem"),
    ]);
    const key = await readFile(resolve(certificateDirectory, "key.pem"));
    const cert = await readFile(resolve(certificateDirectory, "cert.pem"));
    testCertificate = cert;
    const spki = createHash("sha256")
      .update(
        new X509Certificate(cert).publicKey.export({
          type: "spki",
          format: "der",
        }),
      )
      .digest("base64");
    browser = await chromium.launch({
      args: [`--ignore-certificate-errors-spki-list=${spki}`],
    });
    database = await new PostgreSqlContainer("postgis/postgis:17-3.5")
      .withPlatform("linux/amd64")
      .start();
    redis = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .start();
    const env = {
      DATABASE_URL: database.getConnectionUri(),
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      APP_ENV: "test",
      PORT: "4300",
      PASSWORD_AUTH_ENABLED: "true",
      ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64url"),
      REFRESH_TOKEN_PEPPER: randomBytes(32).toString("base64url"),
    };
    const migration = start(
      [
        resolve(root, "services/api/node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      resolve(root, "services/api"),
      env,
    );
    expect((await once(migration, "exit"))[0]).toBe(0);
    api = start(["services/api/dist/main.js"], root, env);
    await wait("http://127.0.0.1:4300/health/ready", api);
    for (const fixture of fixtures) {
      const result = await fetch("http://127.0.0.1:4300/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query:
            "mutation($input:CustomerRegistrationInput!){registerCustomer(input:$input){user{id}}}",
          variables: {
            input: {
              email: fixture.email,
              password,
              displayName: fixture.name,
            },
          },
        }),
      });
      expect((await result.json()).errors).toBeUndefined();
      if (fixture.role !== "customer")
        await seedPrivileged(fixture.role, fixture.email);
    }
    await seedDualRole();
    for (const [index, role] of ["customer", "merchant", "admin"].entries()) {
      const cwd = resolve(root, `apps/${role}-web`);
      const server = start(
        [
          resolve(cwd, "node_modules/next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(3400 + index),
        ],
        cwd,
        {
          FAIRBITE_API_URL: "http://127.0.0.1:4300/graphql",
          FAIRBITE_WEB_ORIGIN: `https://localhost:${3300 + index}`,
        },
      );
      await wait(`http://127.0.0.1:${3400 + index}`, server);
      await proxy(3300 + index, 3400 + index, key, cert);
    }
  });
  test.afterAll(async () => {
    test.setTimeout(60000);
    await browser?.close();
    await Promise.all(
      proxies.map(
        (server) =>
          new Promise<void>((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      ),
    );
    await Promise.all(children.map(stop));
    await redis?.stop();
    await database?.stop();
    if (certificateDirectory)
      await rm(certificateDirectory, { recursive: true, force: true });
  });
  for (const [index, fixture] of fixtures.entries())
    test(`${fixture.role}: production secure cookies actually round-trip over controlled TLS`, async () => {
      const context = await browser!.newContext();
      try {
        const page = await context.newPage();
        await login(page, 3300 + index, fixture.email);
        await expect(
          page.getByText(fixture.name, { exact: true }),
        ).toBeVisible();
        const cookies = (await context.cookies()).filter((cookie) =>
          cookie.name.includes("fairbite"),
        );
        expect(cookies).toHaveLength(2);
        for (const cookie of cookies) {
          expect(cookie.name).toMatch(/^__Host-/);
          expect(cookie.secure).toBe(true);
          expect(cookie.httpOnly).toBe(true);
          expect(cookie.path).toBe("/");
          expect(cookie.domain).toBe("localhost");
        }
        expect(await page.evaluate(() => document.cookie)).not.toContain(
          "fairbite",
        );
        expect(await page.content()).not.toMatch(/accessToken|refreshToken/);
        const me = await page.evaluate(async () => {
          const result = await fetch("/api/auth/me");
          return {
            status: result.status,
            cache: result.headers.get("cache-control"),
            data: await result.json(),
          };
        });
        expect(me.status).toBe(200);
        expect(me.cache).toContain("no-store");
        expect(JSON.stringify(me.data)).not.toMatch(/accessToken|refreshToken/);
        const beforeRefresh = cookies.find((cookie) =>
          cookie.name.endsWith("-refresh"),
        )!.value;
        await page
          .getByRole("button", { name: "Refresh session", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "Session refreshed",
        );
        const afterRefresh = (await context.cookies()).find((cookie) =>
          cookie.name.endsWith("-refresh"),
        )!.value;
        expect(beforeRefresh === afterRefresh).toBe(false);
        await page.reload();
        await expect(
          page.getByText(fixture.name, { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText("Signed out");
        expect(
          (await context.cookies()).filter((cookie) =>
            cookie.name.includes("fairbite"),
          ),
        ).toHaveLength(0);
        expect(
          await page.evaluate(async () => (await fetch("/api/auth/me")).status),
        ).toBe(401);
      } finally {
        await context.close();
      }
    });
  test("controlled TLS dual-role customer cookies cannot become an admin session", async () => {
    const context = await browser!.newContext();
    try {
      const page = await context.newPage();
      await login(page, 3300, "identity-dual@example.test");
      const cookies = (await context.cookies()).filter((cookie) =>
        cookie.name.includes("fairbite-customer"),
      );
      await context.addCookies(
        cookies.map((cookie) => ({
          ...cookie,
          name: cookie.name.replace("customer", "admin"),
        })),
      );
      expect(
        (await context.cookies()).filter((cookie) =>
          cookie.name.includes("fairbite-admin"),
        ),
      ).toHaveLength(2);
      await page.goto("https://localhost:3302/account");
      expect(
        await page.evaluate(async () => (await fetch("/api/auth/me")).status),
      ).toBe(401);
      const refreshStatus = await page.evaluate(
        async () =>
          (
            await fetch("/api/auth/refresh", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            })
          ).status,
      );
      expect([401, 403]).toContain(refreshStatus);
    } finally {
      await context.close();
    }
  });
  test("controlled TLS rejects foreign/missing origin and application injection on all3", async () => {
    const context = await browser!.newContext();
    try {
      const page = await context.newPage();
      for (let index = 0; index < 3; index++) {
        const origin = `https://localhost:${3300 + index}`;
        await page.goto(origin);
        const statuses = await page.evaluate(
          async ({ email, password }) => {
            const injected = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                email,
                password,
                application: "ADMIN",
                roles: ["ADMIN"],
              }),
            });
            // A controlled browser cannot override Origin; Node requests below verify foreign/missing Origin.
            return { injected: injected.status };
          },
          { email: fixtures[0].email, password },
        );
        expect(statuses.injected).toBe(400);
        expect(await trustedPost(3300 + index, "https://foreign.example")).toBe(
          403,
        );
        expect(await trustedPost(3300 + index)).toBe(403);
      }
      expect(proxyErrors).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});
