import { afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { Redis } from "ioredis";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
const env = {
  APP_ENV: "test",
  DATABASE_URL: "postgres://localhost:1/missing",
  REDIS_URL: "redis://localhost:1",
};
describe("foundation HTTP boundaries", () => {
  it("serves live and GraphQL while failing readiness on unavailable dependencies", async () => {
    app = await createApp(readConfig(env));
    await request(app.getHttpServer()).get("/health/live").expect(200);
    const result = await request(app.getHttpServer())
      .post("/graphql")
      .send({ query: "{serviceInfo{name status}}" })
      .expect(200);
    expect(result.body.data.serviceInfo.status).toBe("unavailable");
    await request(app.getHttpServer()).get("/health/ready").expect(503);
  });
  it("shares one dependency probe pair across aliases in one request", async () => {
    app = await createApp(readConfig(env));
    const database = vi.spyOn(Pool.prototype, "query");
    const redis = vi.spyOn(Redis.prototype, "ping");
    try {
      const result = await request(app.getHttpServer())
        .post("/graphql")
        .send({
          query: `{${Array.from({ length: 25 }, (_, i) => `a${i}:serviceInfo{name status}`).join(" ")}}`,
        })
        .expect(200);
      expect(Object.keys(result.body.data)).toHaveLength(25);
      expect(database).toHaveBeenCalledTimes(1);
      expect(redis).toHaveBeenCalledTimes(1);
    } finally {
      database.mockRestore();
      redis.mockRestore();
    }
  });
  it("rejects malformed, oversized, excessive and unsupported GraphQL operations", async () => {
    app = await createApp(readConfig(env));
    for (const query of [
      "{",
      `{${Array.from({ length: 101 }, (_, i) => `a${i}:serviceInfo{name}`).join(" ")}}`,
      "mutation { serviceInfo {name} }",
    ]) {
      const result = await request(app.getHttpServer())
        .post("/graphql")
        .send({ query });
      expect(result.body.errors).toBeDefined();
    }
    await request(app.getHttpServer())
      .post("/graphql")
      .send({ query: " ".repeat(17000) })
      .expect(413);
  });
  it("masks production errors and disables introspection", async () => {
    app = await createApp(
      readConfig({
        ...env,
        APP_ENV: "production",
        DATABASE_URL: "postgres://localhost:1/db?sslmode=verify-full",
        REDIS_URL: "rediss://localhost:1",
      }),
    );
    const result = await request(app.getHttpServer())
      .post("/graphql")
      .send({ query: "{__schema {types{name}}}" });
    expect(result.body.errors[0].message).toBe("GraphQL request failed");
    expect(result.body.data).toBeUndefined();
  });
  it("masks malformed JSON without reflecting request content", async () => {
    app = await createApp(
      readConfig({
        ...env,
        APP_ENV: "production",
        DATABASE_URL: "postgres://localhost:1/db?sslmode=verify-full",
        REDIS_URL: "rediss://localhost:1",
      }),
    );
    const response = await request(app.getHttpServer())
      .post("/graphql")
      .set("Content-Type", "application/json")
      .send('{"secret-marker":bad}')
      .expect(400);
    expect(response.body).toEqual({ message: "Invalid JSON request" });
    expect(response.text).not.toContain("secret-marker");
  });
  it("does not grant unknown cross origin access", async () => {
    app = await createApp(
      readConfig({ ...env, CORS_ORIGINS: "https://allowed.example" }),
    );
    const response = await request(app.getHttpServer())
      .get("/health/live")
      .set("Origin", "https://evil.example");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
