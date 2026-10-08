import { describe, it, expect } from "vitest";
import { readConfig } from "../src/config.js";
const env = {
  DATABASE_URL: "postgres://user:secret@localhost/db",
  REDIS_URL: "redis://localhost:6379",
};
const productionTransport = {
  PUBLIC_BASE_URL: "https://api.example.com",
  PUBLIC_ACCESS_SECRET: Buffer.alloc(32, 3).toString("base64url"),
};
describe("configuration", () => {
  it("rejects missing infrastructure without exposing secrets", () => {
    expect(() => readConfig({ ...env, REDIS_URL: "secret-data" })).toThrow(
      "Invalid configuration: REDIS_URL",
    );
  });
  it("rejects invalid ports and origins", () => {
    for (const PORT of ["0", "65536", "1.5"])
      expect(() => readConfig({ ...env, PORT })).toThrow();
    for (const CORS_ORIGINS of ["*", "https://example.com/path"])
      expect(() => readConfig({ ...env, CORS_ORIGINS })).toThrow();
  });
  it("rejects empty hosts and Redis driver overrides", () => {
    for (const REDIS_URL of [
      "rediss:///",
      "redis://localhost?tls=false",
      "redis://localhost/#fragment",
      "redis://localhost/not-a-db",
    ])
      expect(() => readConfig({ ...env, REDIS_URL })).toThrow();
    expect(() =>
      readConfig({
        ...env,
        DATABASE_URL: "postgres:///db?sslmode=verify-full",
      }),
    ).toThrow();
  });
  it("requires verified production TLS", () => {
    expect(() => readConfig({ ...env, APP_ENV: "production" })).toThrow();
    expect(() =>
      readConfig({
        ...env,
        ...productionTransport,
        APP_ENV: "production",
        DATABASE_URL:
          "postgres://localhost/db?sslmode=verify-full&sslmode=require",
        REDIS_URL: "rediss://localhost",
      }),
    ).toThrow();
    expect(
      readConfig({
        ...env,
        ...productionTransport,
        APP_ENV: "production",
        DATABASE_URL: "postgres://localhost/db?sslmode=verify-full",
        REDIS_URL: "rediss://localhost",
      }).APP_ENV,
    ).toBe("production");
  });
});
