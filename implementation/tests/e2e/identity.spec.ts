import { test, expect } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

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
  const result = await fetch("http://127.0.0.1:4200/graphql", {
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
  await page.goto(`http://localhost:${port}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}
test.describe
  .serial("real identity stack with development Next browser transport", () => {
  test.beforeAll(async () => {
    test.setTimeout(180000);
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
      PORT: "4200",
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
    await wait("http://127.0.0.1:4200/health/ready", api);
    for (const fixture of fixtures) {
      const response = await fetch("http://127.0.0.1:4200/graphql", {
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
      const value = await response.json();
      expect(
        value.errors,
        "synthetic fixture registration must succeed",
      ).toBeUndefined();
      if (fixture.role !== "customer")
        await seedPrivileged(fixture.role, fixture.email);
    }
    await seedDualRole();
    for (const [index, role] of ["customer", "merchant", "admin"].entries()) {
      const cwd = resolve(root, `apps/${role}-web`);
      const server = start(
        [
          resolve(cwd, "node_modules/next/dist/bin/next"),
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(3200 + index),
        ],
        cwd,
        {
          FAIRBITE_API_URL: "http://127.0.0.1:4200/graphql",
          FAIRBITE_WEB_ORIGIN: `http://localhost:${3200 + index}`,
        },
      );
      await wait(`http://localhost:${3200 + index}`, server);
    }
  });
  test.afterAll(async () => {
    test.setTimeout(60000);
    await Promise.all(children.map(stop));
    await redis?.stop();
    await database?.stop();
  });
  test("customer registration creates unverified account and has no browser token exposure", async ({
    page,
  }) => {
    await page.goto("http://localhost:3200/register");
    await page
      .getByLabel("Display name", { exact: true })
      .fill("QA new customer");
    await page
      .getByLabel("Email", { exact: true })
      .fill("identity-new@example.test");
    await page.getByLabel("Password", { exact: true }).fill(password);
    const registered = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/register") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create customer account", exact: true })
      .click();
    const reply = await registered;
    expect(reply.status()).toBe(200);
    const json = await reply.json();
    expect(json).not.toHaveProperty("accessToken");
    expect(json).not.toHaveProperty("refreshToken");
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText("UNVERIFIED", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "fairbite",
    );
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.content()).not.toMatch(/accessToken|refreshToken/);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Signed out");
  });
  for (const [index, fixture] of fixtures.entries()) {
    test(`${fixture.role}: login/account/refresh/logout and cookie privacy`, async ({
      page,
    }, info) => {
      await login(page, 3200 + index, fixture.email);
      await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
      const me = await page.request.get(
        `http://localhost:${3200 + index}/api/auth/me`,
      );
      expect(me.status()).toBe(200);
      expect(me.headers()["cache-control"]).toContain("no-store");
      const json = await me.json();
      expect(json).not.toHaveProperty("accessToken");
      expect(json).not.toHaveProperty("refreshToken");
      expect(JSON.stringify(json)).not.toMatch(/accessToken|refreshToken/);
      const cookies = await page.context().cookies();
      const auth = cookies.filter((c) => c.name.includes("fairbite"));
      expect(auth.length).toBe(2);
      for (const cookie of auth) {
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.sameSite).toBe("Lax");
        expect(cookie.path).toBe("/");
        expect(cookie.name).toMatch(/^dev-/);
      }
      expect(await page.evaluate(() => document.cookie)).not.toContain(
        "fairbite",
      );
      expect(await page.evaluate(() => localStorage.length)).toBe(0);
      expect(await page.content()).not.toMatch(/accessToken|refreshToken/);
      await page
        .getByRole("button", { name: "Refresh session", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText("Session refreshed");
      await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
      await page.reload();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main")).toBeFocused();
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${fixture.role}-identity-${width}.png`),
          fullPage: true,
        });
      }
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Signed out");
      expect(
        (await page.context().cookies()).filter((c) =>
          c.name.includes("fairbite"),
        ),
      ).toHaveLength(0);
      expect(
        (
          await page.request.get(`http://localhost:${3200 + index}/api/auth/me`)
        ).status(),
      ).toBe(401);
    });
    test(`${fixture.role}: wrong application role rejected and password field accessible`, async ({
      page,
    }) => {
      await page.goto(`http://localhost:${3200 + index}/login`);
      await page
        .getByLabel("Email", { exact: true })
        .fill(index === 0 ? fixtures[1].email : fixtures[0].email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "Email, password or session is invalid.",
      );
      await expect(page).toHaveURL(/\/login$/);
      expect(
        (await page.context().cookies()).filter((c) =>
          c.name.includes("fairbite"),
        ),
      ).toHaveLength(0);
    });
  }
  test("dual-role customer session cannot be relabelled into admin cookies", async ({
    page,
  }) => {
    await login(page, 3200, "identity-dual@example.test");
    const customerCookies = (await page.context().cookies()).filter((cookie) =>
      cookie.name.includes("fairbite-customer"),
    );
    await page.context().addCookies(
      customerCookies.map((cookie) => ({
        ...cookie,
        name: cookie.name.replace("customer", "admin"),
      })),
    );
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.includes("fairbite-admin"),
      ),
    ).toHaveLength(2);
    expect(
      (await page.request.get("http://localhost:3202/api/auth/me")).status(),
    ).toBe(401);
    const refreshed = await page.request.post(
      "http://localhost:3202/api/auth/refresh",
      { headers: { origin: "http://localhost:3202" }, data: {} },
    );
    expect([401, 403]).toContain(refreshed.status());
  });
  test("BFF CSRF and role/application injection fail closed", async ({
    request,
  }) => {
    for (const port of [3200, 3201, 3202]) {
      const url = `http://localhost:${port}`;
      for (const headers of [
        { "content-type": "application/json" },
        {
          "content-type": "application/json",
          origin: "https://foreign.example",
        },
      ])
        expect(
          (
            await request.post(`${url}/api/auth/login`, {
              headers,
              data: { email: fixtures[0].email, password },
            })
          ).status(),
        ).toBe(403);
      expect(
        (
          await request.post(`${url}/api/auth/login`, {
            headers: { origin: url },
            data: {
              email: fixtures[0].email,
              password,
              application: "ADMIN",
              roles: ["ADMIN"],
            },
          })
        ).status(),
      ).toBe(400);
    }
  });
  test("real API outage clears browser session but does not pretend server revocation", async ({
    page,
  }) => {
    await login(page, 3200, fixtures[0].email);
    await stop(api);
    const logout = await page.request.post(
      "http://localhost:3200/api/auth/logout",
      { headers: { origin: "http://localhost:3200" }, data: {} },
    );
    expect(logout.status()).toBe(200);
    expect(await logout.json()).toMatchObject({
      accepted: true,
      serverRevoked: false,
    });
    expect(
      (await page.context().cookies()).filter((c) =>
        c.name.includes("fairbite"),
      ),
    ).toHaveLength(0);
    await page.goto("http://localhost:3200/login");
    await page.getByLabel("Email", { exact: true }).fill(fixtures[0].email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("unavailable");
  });
});
