import { describe, it, expect, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import {
  IdentityService,
  normalizeEmail,
  opaqueValid,
} from "../src/identity/service.js";
import { SignJWT } from "jose";
const env = {
  APP_ENV: "test",
  DATABASE_URL: "postgres://localhost/test",
  REDIS_URL: "redis://localhost",
};
describe("password configuration and strict token inputs", () => {
  it("bounds authorization dependency errors without changing authentication denials", async () => {
    const key = randomBytes(32);
    const service = new IdentityService(
      readConfig({
        ...env,
        PASSWORD_AUTH_ENABLED: "true",
        ACCESS_TOKEN_SECRET: key.toString("base64url"),
        REFRESH_TOKEN_PEPPER: randomBytes(32).toString("base64url"),
      }),
    );
    const lookup = vi.spyOn(
      service.prisma.identityRefreshSession,
      "findUnique",
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sid: randomUUID(), app: "CUSTOMER" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setSubject(randomUUID())
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(key);
    try {
      lookup.mockRejectedValueOnce(
        new Error("private database connection and token details"),
      );
      await expect(
        service.identity("CUSTOMER", {
          ip: "127.0.0.1",
          authorization: `Bearer ${token}`,
        }),
      ).rejects.toMatchObject({
        message: "Authentication service unavailable",
        extensions: { code: "SERVICE_UNAVAILABLE" },
      });
      lookup.mockResolvedValueOnce(null);
      await expect(
        service.identity("CUSTOMER", {
          ip: "127.0.0.1",
          authorization: `Bearer ${token}`,
        }),
      ).rejects.toMatchObject({
        extensions: { code: "AUTHENTICATION_FAILED" },
      });
      await expect(
        service.identity("CUSTOMER", {
          ip: "127.0.0.1",
          authorization: "Bearer invalid",
        }),
      ).rejects.toMatchObject({
        extensions: { code: "AUTHENTICATION_FAILED" },
      });
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      lookup.mockRestore();
      await service.close();
    }
  });
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
