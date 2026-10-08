import { describe, expect, it } from "vitest";
import { readConfig } from "../../../src/config.js";

const base = {
  APP_ENV: "test",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};
const key = (fill: string) => Buffer.alloc(32, fill).toString("base64url");

describe("transport configuration", () => {
  it("defaults to loopback, 1mb bodies and enforced public access", () => {
    const config = readConfig(base);
    expect(config.HOST).toBe("127.0.0.1");
    expect(config.GRAPHQL_BODY_LIMIT).toBe("1mb");
    expect(config.PUBLIC_ACCESS_ENFORCED).toBe(true);
    expect(config.PUBLIC_ACCESS_TTL_SECONDS).toBe(900);
    expect(config.PUBLIC_ACCESS_SECRET).toBe(key("\x07"));
  });

  it("requires a canonical public-access secret when enforcement is on outside test", () => {
    expect(() => readConfig({ ...base, APP_ENV: "development" })).toThrow(
      /PUBLIC_ACCESS_SECRET/,
    );
    expect(
      readConfig({
        ...base,
        APP_ENV: "development",
        PUBLIC_ACCESS_SECRET: key("a"),
      }).PUBLIC_ACCESS_SECRET,
    ).toBe(key("a"));
  });

  it("permits an absent public-access secret when enforcement is disabled", () => {
    expect(
      readConfig({
        ...base,
        APP_ENV: "development",
        PUBLIC_ACCESS_ENFORCED: "false",
      }).PUBLIC_ACCESS_ENFORCED,
    ).toBe(false);
  });

  it("rejects TTL values at or below the client refresh buffer", () => {
    expect(() =>
      readConfig({ ...base, PUBLIC_ACCESS_TTL_SECONDS: "30" }),
    ).toThrow(/PUBLIC_ACCESS_TTL_SECONDS/);
  });

  it("accepts a LAN bind address", () => {
    expect(readConfig({ ...base, HOST: "0.0.0.0" }).HOST).toBe("0.0.0.0");
  });

  it("requires an HTTPS public base URL in production", () => {
    expect(() =>
      readConfig({
        ...base,
        APP_ENV: "production",
        PUBLIC_BASE_URL: "http://api.example.com",
      }),
    ).toThrow(/PUBLIC_BASE_URL/);
  });
});
