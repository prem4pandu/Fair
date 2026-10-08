import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  requireAuth,
  requireOwnership,
  requirePermission,
  resolveAuth,
} from "../../../src/kernel/auth/guards.js";
import { UserTokens } from "../../../src/kernel/auth/tokens.js";

const secret = Buffer.alloc(32, 3).toString("base64url");
const clock = (iso: string) => ({ now: () => new Date(iso) });
const sessions = { isActive: async (sid: string) => sid !== "revoked" };

describe("user tokens", () => {
  it("issues JWTs with exp whose payload segment is atob-safe", async () => {
    const tokens = new UserTokens(secret, 900, clock("2026-10-08T00:00:00Z"));
    for (let i = 0; i < 50; i++) {
      const { token, expiresAt } = await tokens.issue({
        sub: `user-${i}`,
        typ: "RESTAURANT",
        sid: `s-${i}`,
      });
      const payload = token.split(".")[1];
      expect(payload).not.toMatch(/[-_]/);
      expect(
        JSON.parse(atob(payload + "=".repeat((4 - (payload.length % 4)) % 4)))
          .exp,
      ).toBe(Math.floor(expiresAt.getTime() / 1000));
    }
  });

  it("rejects malformed claims", async () => {
    const tokens = new UserTokens(secret, 900, clock("2026-10-08T00:00:00Z"));
    await expect(tokens.verify("not-a-jwt")).rejects.toMatchObject({
      extensions: { code: "INVALID_TOKEN" },
    });
  });

  it("accepts legacy identity tokens during the Wave 1 cutover", async () => {
    const token = await new SignJWT({ sid: "session-1", app: "MERCHANT" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject("restaurant-user")
      .setIssuedAt(
        Math.floor(new Date("2026-10-08T00:00:00Z").getTime() / 1000),
      )
      .setExpirationTime(
        Math.floor(new Date("2026-10-08T00:15:00Z").getTime() / 1000),
      )
      .sign(Buffer.from(secret, "base64url"));
    const tokens = new UserTokens(secret, 900, clock("2026-10-08T00:01:00Z"));
    await expect(tokens.verify(token)).resolves.toEqual({
      sub: "restaurant-user",
      typ: "RESTAURANT",
      sid: "session-1",
    });
  });
});

describe("guards", () => {
  const tokens = new UserTokens(secret, 900, clock("2026-10-08T00:00:00Z"));
  const later = new UserTokens(secret, 900, clock("2026-10-08T01:00:00Z"));

  it("returns null for anonymous requests and auth for valid tokens", async () => {
    expect(await resolveAuth(undefined, tokens, sessions)).toBeNull();
    expect(await resolveAuth("", tokens, sessions)).toBeNull();
    const { token } = await tokens.issue({
      sub: "u1",
      typ: "CUSTOMER",
      sid: "s1",
    });
    expect(
      await resolveAuth(`Bearer ${token}`, tokens, sessions),
    ).toMatchObject({
      userId: "u1",
      type: "CUSTOMER",
      sessionId: "s1",
    });
  });

  it("distinguishes expired, invalid and revoked tokens", async () => {
    const { token } = await tokens.issue({
      sub: "u1",
      typ: "CUSTOMER",
      sid: "s1",
    });
    await expect(
      resolveAuth(`Bearer ${token}`, later, sessions),
    ).rejects.toMatchObject({ extensions: { code: "TOKEN_EXPIRED" } });
    await expect(
      resolveAuth("Bearer nope", tokens, sessions),
    ).rejects.toMatchObject({ extensions: { code: "INVALID_TOKEN" } });
    const revoked = await tokens.issue({
      sub: "u1",
      typ: "CUSTOMER",
      sid: "revoked",
    });
    await expect(
      resolveAuth(`Bearer ${revoked.token}`, tokens, sessions),
    ).rejects.toMatchObject({ extensions: { code: "INVALID_TOKEN" } });
  });

  it("enforces types, permissions and ownership", () => {
    const staff = {
      userId: "s",
      type: "STAFF" as const,
      sessionId: "x",
      permissions: ["Riders"],
      restaurantIds: [],
      vendorId: null,
      riderId: null,
    };
    expect(() => requireAuth(null)).toThrow(/Unauthenticated/);
    expect(() => requireAuth(staff, "CUSTOMER")).toThrow(/Forbidden/);
    expect(requireAuth(staff, "STAFF", "ADMIN")).toBe(staff);
    expect(() => requirePermission(staff, "Users")).toThrow(/Forbidden/);
    expect(() => requirePermission(staff, "Riders")).not.toThrow();

    const owner = {
      ...staff,
      type: "RESTAURANT" as const,
      restaurantIds: ["r1"],
    };
    expect(() => requireOwnership(owner, { restaurantId: "r2" })).toThrow(
      /Forbidden/,
    );
    expect(() => requireOwnership(owner, { restaurantId: "r1" })).not.toThrow();

    const admin = { ...staff, type: "ADMIN" as const, permissions: [] };
    expect(() => requirePermission(admin, "Users")).not.toThrow();
    expect(() =>
      requireOwnership(admin, { restaurantId: "any" }),
    ).not.toThrow();
  });
});
