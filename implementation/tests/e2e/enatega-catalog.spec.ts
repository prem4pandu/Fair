import { test, expect } from "@playwright/test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const root = process.cwd(),
  origin = "http://localhost:3400";
const children: ChildProcess[] = [];
let database: StartedPostgreSqlContainer;
let redis: StartedTestContainer;
let pool: Pool;
const merchant = randomUUID(),
  outlet = "00000000-0000-4000-8000-000000000001",
  hidden = randomUUID(),
  category = randomUUID();
const itemIds = Array.from({ length: 21 }, () => randomUUID()).sort();
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

test.describe
  .serial("pinned catalog presentation against real local backend", () => {
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
      PORT: "4400",
      DATABASE_URL: database.getConnectionUri(),
      REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
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
    await pool.query(
      'INSERT INTO "CatalogMerchant"(id,name,published) VALUES($1,$2,true)',
      [merchant, "Synthetic merchant"],
    );
    for (let index = 0; index < 21; index++) {
      await pool.query(
        'INSERT INTO "CatalogOutlet"(id,"merchantId",name,currency,published) VALUES($1,$2,$3,$4,true)',
        [
          index === 0 ? outlet : randomUUID(),
          merchant,
          index === 0 ? "Synthetic kitchen" : `Synthetic outlet ${index}`,
          "MYR",
        ],
      );
    }
    await pool.query(
      'INSERT INTO "CatalogOutlet"(id,"merchantId",name,currency,published) VALUES($1,$2,$3,$4,false)',
      [hidden, merchant, "Hidden kitchen", "MYR"],
    );
    await pool.query(
      'INSERT INTO "CatalogCategory"(id,"outletId",name,published) VALUES($1,$2,$3,true)',
      [category, outlet, "Synthetic mains"],
    );
    for (const [index, id] of itemIds.entries())
      await pool.query(
        'INSERT INTO "CatalogItem"(id,"outletId","categoryId",name,description,"priceMinor",available,published) VALUES($1,$2,$3,$4,$5,$6,$7,true)',
        [
          id,
          outlet,
          category,
          `Synthetic meal ${index}`,
          "Synthetic description",
          index === 0 ? 1234 : 100,
          index !== 0,
        ],
      );
    const api = start(["services/api/dist/main.js"], root, env);
    await wait("http://127.0.0.1:4400/health/ready", api);
    const cwd = resolve(root, "apps/customer-web");
    const web = start(
      [
        resolve(cwd, "node_modules/next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3400",
      ],
      cwd,
      {
        FAIRBITE_API_URL: "http://127.0.0.1:4400/graphql",
        FAIRBITE_WEB_ORIGIN: origin,
      },
    );
    await wait(`${origin}/restaurants`, web);
  });
  test.afterAll(async () => {
    test.setTimeout(60000);
    await Promise.all(children.map(stop));
    await pool?.end();
    await redis?.stop();
    await database?.stop();
  });
  test("restaurant listing uses cursor links and real outlet menu with sold-out minor price", async ({
    page,
  }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      if (
        /^https?:/.test(request.url()) &&
        new URL(request.url()).hostname !== "localhost" &&
        new URL(request.url()).hostname !== "127.0.0.1"
      )
        external.push(request.url());
    });
    await page.goto(`${origin}/restaurants`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Restaurants" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Next restaurants" }),
    ).toBeVisible();
    const cards = page.locator(`a[href^="/store/"]`);
    expect(await cards.count()).toBe(20);
    await page.getByRole("link", { name: "Next restaurants" }).click();
    await expect(page).toHaveURL(/after=/);
    expect(await cards.count()).toBe(1);
    await expect(
      page.getByRole("link", { name: "Next restaurants" }),
    ).toHaveCount(0);
    await page.goto(`${origin}/restaurants`);
    await page.locator(`a[href$="/${outlet}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/store/[^/]+/${outlet}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Synthetic kitchen" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Menu", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "Synthetic mains" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 4 })).toHaveCount(20);
    await expect(
      page.getByText("Currently unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/12[.,]34/)).toBeVisible();
    await expect(
      page.getByText("Ordering is not available yet.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Next menu items" }).click();
    await expect(page.getByRole("heading", { level: 4 })).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "Next menu items" }),
    ).toHaveCount(0);
    expect(external).toEqual([]);
  });
  test("missing, hidden and malformed outlet IDs produce 404 and invalid cursors fail explicitly", async ({
    page,
  }) => {
    for (const id of [randomUUID(), hidden, "not-a-uuid"]) {
      const response = await page.goto(`${origin}/store/synthetic/${id}`);
      expect(response?.status()).toBe(404);
      await expect(
        page.getByText("Hidden kitchen", { exact: true }),
      ).toHaveCount(0);
    }
    for (const route of [
      "/restaurants?after=invalid",
      `/store/synthetic-kitchen/${outlet}?after=invalid`,
    ]) {
      await page.goto(origin + route);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Invalid catalog request",
        }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 4 })).toHaveCount(0);
    }
  });
  test("responsive source-derived screens support keyboard links without horizontal overflow", async ({
    page,
  }, info) => {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [
        "/restaurants",
        `/store/synthetic-kitchen/${outlet}`,
      ]) {
        await page.goto(origin + route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const next = page.getByRole("link", {
          name:
            route === "/restaurants" ? "Next restaurants" : "Next menu items",
        });
        await next.focus();
        await expect(next).toBeFocused();
        await page.screenshot({
          path: info.outputPath(
            `catalog-${width}-${route === "/restaurants" ? "restaurants" : "menu"}.png`,
          ),
          fullPage: true,
        });
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/after=/);
      }
    }
  });
  test("actual database outage shows bounded error and recovers without cached success", async ({
    page,
  }) => {
    const docker = promisify(execFile);
    await docker("docker", ["pause", database.getId()]);
    try {
      for (const route of [
        "/restaurants",
        `/store/synthetic-kitchen/${outlet}`,
      ]) {
        await page.goto(origin + route);
        await expect(
          page.getByRole("heading", { level: 1, name: "Catalog unavailable" }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Try again" }),
        ).toBeVisible();
        await expect(page.getByRole("heading", { level: 4 })).toHaveCount(0);
        await expect(
          page.getByText("We could not load the catalog. Please try again.", {
            exact: true,
          }),
        ).toBeVisible();
      }
    } finally {
      await docker("docker", ["unpause", database.getId()]);
    }
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Synthetic kitchen" }),
    ).toBeVisible();
  });
});
