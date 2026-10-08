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
const origin = "http://localhost:3300";
const password = randomBytes(24).toString("base64url");
const email = "presentation-customer@example.test";
async function fill(
  page: import("@playwright/test").Page,
  address = email,
  secret = password,
) {
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(secret);
}

test.describe
  .serial("customer identity presentation against real dependencies", () => {
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
    const cwd = resolve(root, "apps/customer-web");
    const server = start(
      [
        resolve(cwd, "node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3300",
      ],
      cwd,
      {
        FAIRBITE_API_URL: "http://127.0.0.1:4300/graphql",
        FAIRBITE_WEB_ORIGIN: "http://localhost:3300",
      },
    );
    await wait("http://localhost:3300/login", server);
  });
  test.afterAll(async () => {
    test.setTimeout(60000);
    await Promise.all(children.map(stop));
    await redis?.stop();
    await database?.stop();
  });

  test("login and registration layouts expose labels, honest availability and keyboard password controls", async ({
    page,
  }, info) => {
    for (const route of ["login", "register"]) {
      await page.goto(`${origin}/${route}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        route === "login" ? "Sign in" : "Create customer account",
      );
      const form = page.getByRole("form", {
        name: route === "login" ? "Password sign in" : "Customer registration",
      });
      await expect(form.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(
        form.getByLabel("Password", { exact: true }),
      ).toHaveAttribute("type", "password");
      await expect(page.getByRole("status")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      await expect(page.getByRole("status")).toHaveAttribute(
        "aria-atomic",
        "true",
      );
      await expect(page.getByRole("status")).toBeAttached();
      await expect(page.getByText(/Google sign-in.*unavailable/)).toBeVisible();
      if (route === "register") {
        await expect(
          form.getByLabel("Display name", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(/Email verification is currently unavailable/),
        ).toBeVisible();
      }
      await page.reload();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main")).toBeFocused();
      await form.getByLabel("Password", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        form.getByRole("button", { name: "Show password" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        form.getByLabel("Password", { exact: true }),
      ).toHaveAttribute("type", "text");
      await expect(
        form.getByRole("button", { name: "Hide password" }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Enter");
      await expect(
        form.getByLabel("Password", { exact: true }),
      ).toHaveAttribute("type", "password");
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(
          form.getByRole("button", {
            name: route === "login" ? "Sign in" : "Create customer account",
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`customer-${route}-${width}.png`),
          fullPage: true,
        });
      }
    }
  });
  test("invalid and duplicate registrations report failures; real registration exposes no browser tokens or upstream requests", async ({
    page,
  }) => {
    const destinations: string[] = [];
    page.on("request", (request) => destinations.push(request.url()));
    await page.goto(`${origin}/register`);
    await page
      .getByLabel("Display name", { exact: true })
      .fill("QA presentation customer");
    await fill(page, "bad-email", "short");
    await page
      .getByRole("button", { name: "Create customer account", exact: true })
      .click();
    expect(
      await page
        .getByLabel("Email", { exact: true })
        .evaluate((element: HTMLInputElement) => element.validity.valid),
    ).toBe(false);
    expect(
      destinations.filter((url) => url.endsWith("/api/auth/register")),
    ).toHaveLength(0);
    await fill(page);
    const replyPromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/register"),
    );
    await page
      .getByRole("button", { name: "Create customer account", exact: true })
      .click();
    const reply = await replyPromise;
    expect(reply.status()).toBe(200);
    expect(JSON.stringify(await reply.json())).not.toMatch(
      /accessToken|refreshToken/,
    );
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByText("UNVERIFIED", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ local: 0, session: 0 });
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "fairbite",
    );
    expect(await page.content()).not.toMatch(/accessToken|refreshToken/);
    expect(destinations.every((url) => new URL(url).origin === origin)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Signed out");
    await page.goto(`${origin}/register`);
    await page.getByLabel("Display name", { exact: true }).fill("Duplicate");
    await fill(page);
    await page
      .getByRole("button", { name: "Create customer account", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "already uses this email",
    );
    await expect(page).toHaveURL(/\/register$/);
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.includes("fairbite"),
      ),
    ).toHaveLength(0);
  });
  test("unknown account and wrong password have equal live-region errors", async ({
    page,
  }) => {
    const messages: string[] = [];
    for (const address of [email, "unknown-presentation@example.test"]) {
      await page.goto(`${origin}/login`);
      await fill(page, address, "wrong-password-12345");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "Email, password or session is invalid.",
      );
      await expect(page.getByRole("status")).toBeVisible();
      messages.push((await page.getByRole("status").textContent())!);
      await expect(page).toHaveURL(/\/login$/);
    }
    expect(messages[0]).toBe(messages[1]);
  });
  test("keyboard sign-in completes account access and keyboard sign-out clears cookies", async ({
    page,
  }) => {
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email", { exact: true }).focus();
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.keyboard.type(password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/account$/);
    await expect(
      page.getByText("QA presentation customer", { exact: true }),
    ).toBeVisible();
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.includes("fairbite"),
      ),
    ).toHaveLength(2);
    await page
      .getByRole("button", { name: "Refresh session", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Signed out");
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.includes("fairbite"),
      ),
    ).toHaveLength(0);
    expect((await page.request.get(`${origin}/api/auth/me`)).status()).toBe(
      401,
    );
  });
  test("actual API outage reports unavailable in new presentation without granting cookies", async ({
    page,
  }) => {
    await stop(api);
    await page.goto(`${origin}/login`);
    await fill(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("unavailable");
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await page.context().cookies()).filter((cookie) =>
        cookie.name.includes("fairbite"),
      ),
    ).toHaveLength(0);
  });
});
