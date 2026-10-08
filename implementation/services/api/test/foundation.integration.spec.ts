import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { Pool } from "pg";
import request from "supertest";
import { Queue, QueueEvents } from "bullmq";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { startWorker, FOUNDATION_QUEUE } from "../../worker/src/worker.js";
let postgres: StartedPostgreSqlContainer;
let redis: StartedTestContainer;
let pool: Pool;
let app: INestApplication;
let redisUrl: string;
beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgis/postgis:17-3.5")
    .withPlatform("linux/amd64")
    .start();
  redis = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();
  redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  pool = new Pool({ connectionString: postgres.getConnectionUri() });
  await pool.query(
    readFileSync(
      new URL(
        "../prisma/migrations/202610080001_foundation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  app = await createApp(
    readConfig({
      APP_ENV: "test",
      DATABASE_URL: postgres.getConnectionUri(),
      REDIS_URL: redisUrl,
    }),
  );
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await redis?.stop();
  await postgres?.stop();
});
describe("real foundation stack", () => {
  it("applies PostGIS migration and reports real dependencies ready", async () => {
    expect(
      (await pool.query('SELECT id FROM "FoundationMigration"')).rows,
    ).toEqual([{ id: "fb01" }]);
    expect(
      (await pool.query("SELECT PostGIS_Version() AS version")).rows[0].version,
    ).toContain("3.5");
    await request(app.getHttpServer()).get("/health/ready").expect(200);
  });
  it("API cannot consume jobs; separate worker processes only synthetic probes", async () => {
    const connection = {
      host: redis.getHost(),
      port: redis.getMappedPort(6379),
    };
    const queue = new Queue(FOUNDATION_QUEUE, { connection });
    const events = new QueueEvents(FOUNDATION_QUEUE, { connection });
    await events.waitUntilReady();
    const job = await queue.add("probe", { probeId: randomUUID() });
    expect(await job.getState()).toBe("waiting");
    const runtime = await startWorker(redisUrl);
    try {
      expect(await job.waitUntilFinished(events, 10000)).toMatchObject({
        status: "ok",
      });
      const unsupported = await queue.add("capture-payment", {});
      await expect(
        unsupported.waitUntilFinished(events, 10000),
      ).rejects.toThrow("Unsupported foundation job");
    } finally {
      await runtime.close();
      await events.close();
      await queue.close();
    }
  });
  it("fails readiness during Redis outage while liveness remains available", async () => {
    await redis.stop();
    await request(app.getHttpServer()).get("/health/ready").expect(503);
    await request(app.getHttpServer()).get("/health/live").expect(200);
  });
});
