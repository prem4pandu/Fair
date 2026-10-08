import { test, expect } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

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
test.describe.serial("real stack foundation", () => {
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
      PORT: "4100",
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
    const [exitCode] = await once(migration, "exit");
    expect(exitCode, "real Prisma migration must succeed").toBe(0);
    api = start(["services/api/dist/main.js"], root, env);
    await wait("http://127.0.0.1:4100/health/ready", api);
    for (const [index, role] of ["customer", "merchant", "admin"].entries()) {
      const cwd = resolve(root, `apps/${role}-web`);
      for (const unconfigured of [false, true]) {
        const port = 3100 + index + (unconfigured ? 3 : 0);
        const child = start(
          [
            resolve(cwd, "node_modules/next/dist/bin/next"),
            "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
          ],
          cwd,
          {
            FAIRBITE_API_URL: unconfigured
              ? ""
              : "http://127.0.0.1:4100/graphql",
          },
        );
        await wait(`http://127.0.0.1:${port}`, child);
      }
    }
  });
  test.afterAll(async () => {
    test.setTimeout(60000);
    await Promise.all(children.map(stop));
    await redis?.stop();
    await database?.stop();
  });
  for (const [index, role] of ["customer", "merchant", "admin"].entries()) {
    test(`${role}: ready home/status, keyboard and responsive layout`, async ({
      page,
    }, info) => {
      await page.goto(`http://127.0.0.1:${3100 + index}`);
      await expect(
        page.getByText("Service FairBite reports: ready."),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main")).toBeFocused();
      await page
        .getByRole("link", { name: "Service status", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Service status", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("ready", { exact: true })).toBeVisible();
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 800 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await expect(
          page.getByRole("link", { name: "Home", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`${role}-${width}.png`),
          fullPage: true,
        });
      }
    });
    test(`${role}: absent configuration fails closed`, async ({ page }) => {
      await page.goto(`http://127.0.0.1:${3103 + index}`);
      await expect(
        page.getByText("API endpoint is not configured."),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Service status", exact: true })
        .click();
      await expect(
        page.getByText("API endpoint is not configured."),
      ).toBeVisible();
    });
  }
  test("all web applications report real API outage safely", async ({
    page,
  }) => {
    await stop(api);
    for (let index = 0; index < 3; index++) {
      await page.goto(`http://127.0.0.1:${3100 + index}/status`);
      await expect(
        page.getByText(
          "API service is unavailable or returned an invalid response.",
        ),
      ).toBeVisible();
      await expect(page.getByText("ready", { exact: true })).toHaveCount(0);
    }
  });
});
