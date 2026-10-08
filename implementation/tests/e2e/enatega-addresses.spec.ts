import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

const root = process.cwd(),
  origin = "http://localhost:3500",
  route = `${origin}/profile/addresses`,
  endpoint = `${origin}/api/customer/addresses`;
const children: ChildProcess[] = [];
let database: StartedPostgreSqlContainer,
  redis: StartedTestContainer,
  pool: Pool,
  api: ChildProcess;
const input = {
  label: "Home",
  deliveryAddress: "Synthetic street",
  details: "Synthetic instructions",
  longitude: 101.69,
  latitude: 3.14,
};
function start(argv: string[], cwd = root, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, argv, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}
async function wait(url: string, child: ChildProcess) {
  for (let index = 0; index < 150; index++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Server exited before readiness");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* still starting */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("Server readiness deadline exceeded");
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(force);
}
async function account(page: Page) {
  const email = `address-web-${randomUUID()}@example.test`,
    password = randomBytes(24).toString("base64url");
  await page.goto(`${origin}/register`);
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Synthetic address customer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create customer account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Signed out");
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto(route);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your addresses" }),
  ).toBeVisible();
  return email;
}
async function fillAddress(page: Page, value = input) {
  await page.getByLabel("Label", { exact: true }).fill(value.label);
  await page
    .getByLabel("Delivery address", { exact: true })
    .fill(value.deliveryAddress);
  await page.getByLabel("Details", { exact: true }).fill(value.details);
  await page
    .getByLabel("Longitude", { exact: true })
    .fill(String(value.longitude));
  await page
    .getByLabel("Latitude", { exact: true })
    .fill(String(value.latitude));
}
async function add(page: Page, value = input) {
  await page
    .getByRole("button", { name: "Add new address", exact: true })
    .click();
  await fillAddress(page, value);
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Address saved.");
  await expect(
    page.getByRole("button", { name: `Edit ${value.label}`, exact: true }),
  ).toBeVisible();
}
function localRequests(page: Page) {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      external.push(request.url());
  });
  return external;
}
async function assertPrivate(page: Page) {
  const response = await page.request.get(endpoint);
  expect(response.status()).toBe(200);
  expect(JSON.stringify(await response.json())).not.toMatch(
    /accessToken|refreshToken|userId|passwordHash|postgresql:\/\//,
  );
  expect(await page.content()).not.toMatch(
    /accessToken|refreshToken|passwordHash/,
  );
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(await page.evaluate(() => document.cookie)).not.toContain("fairbite");
}

test.describe
  .serial("source-derived address workflow against real local backend", () => {
  test.beforeAll(async () => {
    test.setTimeout(180000);
    database = await new PostgreSqlContainer("postgis/postgis:17-3.5")
      .withPlatform("linux/amd64")
      .start();
    redis = await new GenericContainer("redis:7-alpine")
      .withExposedPorts(6379)
      .start();
    const env = {
      APP_ENV: "test",
      PORT: "4500",
      DATABASE_URL: database.getConnectionUri(),
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
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
    pool = new Pool({ connectionString: database.getConnectionUri() });
    api = start(["services/api/dist/main.js"], root, env);
    await wait("http://127.0.0.1:4500/health/ready", api);
    const cwd = resolve(root, "apps/customer-web");
    const web = start(
      [
        resolve(cwd, "node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3500",
      ],
      cwd,
      {
        FAIRBITE_API_URL: "http://127.0.0.1:4500/graphql",
        FAIRBITE_WEB_ORIGIN: origin,
      },
    );
    await wait(`${origin}/login`, web);
  });
  test.afterAll(async () => {
    test.setTimeout(60000);
    await Promise.all(children.map(stop));
    await pool?.end();
    await redis?.stop();
    await database?.stop();
  });
  test("real registration/login creates, edits, selects, persists reload and deletes without browser tokens", async ({
    page,
  }) => {
    const external = localRequests(page);
    await account(page);
    await expect(
      page.getByText("No saved addresses yet.", { exact: true }),
    ).toBeVisible();
    await add(page);
    await page.getByRole("button", { name: "Edit Home", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Edit address", exact: true }),
    ).toBeVisible();
    await fillAddress(page, {
      ...input,
      label: "Office",
      deliveryAddress: "Synthetic office street",
    });
    const reply = page.waitForResponse(
      (response) =>
        response.url() === endpoint && response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save address", exact: true })
      .click();
    expect(await (await reply).json()).toEqual({ accepted: true });
    await expect(
      page.getByRole("button", { name: "Edit Office", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Select Office", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Address selected.");
    await page.reload();
    await expect(
      page.getByText("Selected address", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic office street", { exact: true }),
    ).toBeVisible();
    await assertPrivate(page);
    await page
      .getByRole("button", { name: "Delete Office", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Address deleted.");
    await expect(
      page.getByText("No saved addresses yet.", { exact: true }),
    ).toBeVisible();
    expect(external).toEqual([]);
  });
  test("two browser owners cannot alter foreign records; missing/foreign origins reject state changes", async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = [];
    try {
      const owner = await browser.newContext(),
        attacker = await browser.newContext();
      contexts.push(owner, attacker);
      const page = await owner.newPage(),
        other = await attacker.newPage();
      await account(page);
      await account(other);
      await add(page);
      await add(other, { ...input, label: "Other home" });
      const own = (await (await page.request.get(endpoint)).json())
        .addresses[0];
      for (const action of ["update", "select", "delete"]) {
        const response = await other.request.post(endpoint, {
          headers: { Origin: origin },
          data: {
            action,
            id: own.id,
            ...(action === "update"
              ? { input: { ...input, label: "Unauthorized" } }
              : {}),
          },
        });
        expect(response.status()).toBe(action === "delete" ? 200 : 404);
      }
      expect(
        (await (await page.request.get(endpoint)).json()).addresses,
      ).toEqual([own]);
      expect(
        (await (await other.request.get(endpoint)).json()).addresses,
      ).toHaveLength(1);
      for (const headers of [{ Origin: "https://foreign.example" }, {}]) {
        const response = await page.request.post(endpoint, {
          headers,
          data: { action: "create", input: { ...input, label: "CSRF" } },
        });
        expect(response.status()).toBe(403);
      }
      const injected = await page.request.post(endpoint, {
        headers: { Origin: origin },
        data: {
          action: "create",
          input: { ...input, userId: randomUUID(), selected: true },
        },
      });
      expect(injected.status()).toBe(400);
      expect(
        (await (await page.request.get(endpoint)).json()).addresses,
      ).toEqual([own]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
  test("invalid manual coordinates fail native validation and revoked sessions cannot access saved addresses", async ({
    page,
  }) => {
    const email = await account(page);
    await add(page);
    await page
      .getByRole("button", { name: "Add new address", exact: true })
      .click();
    await fillAddress(page, { ...input, label: "Invalid", latitude: 91 });
    const submitted: string[] = [];
    page.on("request", (request) => {
      if (request.url() === endpoint && request.method() === "POST")
        submitted.push(request.url());
    });
    await page
      .getByRole("button", { name: "Save address", exact: true })
      .click();
    expect(
      await page
        .getByLabel("Latitude", { exact: true })
        .evaluate((element: HTMLInputElement) => element.validity.valid),
    ).toBe(false);
    expect(submitted).toEqual([]);
    expect(
      (await (await page.request.get(endpoint)).json()).addresses,
    ).toHaveLength(1);
    await pool.query(
      'UPDATE "IdentitySessionFamily" SET "revokedAt"=now() WHERE "userId"=(SELECT id FROM "IdentityUser" WHERE email=$1) AND "revokedAt" IS NULL',
      [email],
    );
    expect((await page.request.get(endpoint)).status()).toBe(401);
    await page.reload();
    await expect(
      page.getByText("Your session is no longer valid. Sign in again.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit Home", exact: true }),
    ).toHaveCount(0);
  });
  test("manual address form and saved cards are responsive and keyboard accessible", async ({
    page,
  }, info) => {
    await account(page);
    await add(page);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await page
        .getByRole("button", { name: "Add new address", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Add address", exact: true }),
      ).toBeVisible();
      for (const label of [
        "Label",
        "Delivery address",
        "Details",
        "Longitude",
        "Latitude",
      ])
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Label", { exact: true })).toBeFocused();
      await expect(page.getByLabel("Longitude", { exact: true })).toHaveValue(
        "",
      );
      await expect(page.getByLabel("Latitude", { exact: true })).toHaveValue(
        "",
      );
      await expect(
        page.getByText(
          "Enter coordinates manually. Maps and address lookup are unavailable.",
          { exact: true },
        ),
      ).toBeVisible();
      await fillAddress(page, { ...input, label: `Keyboard ${width}` });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`addresses-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Save address", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", {
          name: `Edit Keyboard ${width}`,
          exact: true,
        }),
      ).toBeVisible();
    }
    await assertPrivate(page);
  });
  test("actual API outage reports bounded failure without false create success", async ({
    page,
  }) => {
    await account(page);
    await add(page);
    await stop(api);
    const response = await page.request.get(endpoint);
    expect(response.status()).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(
      /SELECT|postgresql:\/\/|accessToken|refreshToken/,
    );
    await page.reload();
    await expect(page.getByRole("status")).toContainText(/unavailable/i);
    await expect(
      page.getByText("No saved addresses yet.", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.post(endpoint, {
          headers: { Origin: origin },
          data: { action: "create", input },
        })
      ).status(),
    ).toBe(503);
  });
});
