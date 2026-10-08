import { describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import { normalizeEmail, opaqueValid } from "../src/identity/service.js";
const env = {
  DATABASE_URL: "postgres://localhost/test",
  REDIS_URL: "redis://localhost",
};
describe("password configuration and strict token inputs", () => {
  it("redacts malformed production connection configuration", () => {
    expect(() =>
      readConfig({
        ...env,
        APP_ENV: "production",
        DATABASE_URL: "private-marker",
      }),
    ).toThrow(/Invalid configuration/);
  });
  it("is disabled unless explicitly enabled", () => {
    expect(readConfig(env).PASSWORD_AUTH_ENABLED).toBe(false);
    expect(() =>
      readConfig({ ...env, PASSWORD_AUTH_ENABLED: "yes" }),
    ).toThrow();
  });
  it("requires canonical distinct configured keys without exposing their values", () => {
    const key = randomBytes(32).toString("base64url");
    for (const keys of [
      {},
      { ACCESS_TOKEN_SECRET: key, REFRESH_TOKEN_PEPPER: key },
      {
        ACCESS_TOKEN_SECRET: key + "=",
        REFRESH_TOKEN_PEPPER: randomBytes(32).toString("base64url"),
      },
    ])
      expect(() =>
        readConfig({ ...env, ...keys, PASSWORD_AUTH_ENABLED: "true" }),
      ).toThrow(/Invalid configuration/);
    expect(
      readConfig({
        ...env,
        PASSWORD_AUTH_ENABLED: "true",
        ACCESS_TOKEN_SECRET: key,
        REFRESH_TOKEN_PEPPER: randomBytes(32).toString("base64url"),
      }).PASSWORD_AUTH_ENABLED,
    ).toBe(true);
  });
  it("normalizes bounded email and rejects noncanonical opaque tokens", () => {
    expect(normalizeEmail(" Test@EXAMPLE.com ")).toBe("test@example.com");
    expect(() => normalizeEmail("x".repeat(513))).toThrow();
    const token = `${randomUUID()}.${randomBytes(32).toString("base64url")}`;
    expect(opaqueValid(token)).toBe(true);
    for (const value of [
      token + "=",
      token + ".x",
      token.toUpperCase(),
      null,
      "garbage",
    ])
      expect(opaqueValid(value)).toBe(false);
  });
});
