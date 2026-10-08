import { describe, it, expect } from "vitest";
import {
  registrationSchema,
  passwordLoginSchema,
  refreshTokenSchema,
  identityUserSchema,
  sessionPayloadSchema,
} from "./index.js";
const id = "12345678-1234-4234-8234-123456789abc";
const user = {
  id,
  email: "test@example.invalid",
  displayName: "Test",
  roles: ["CUSTOMER"],
  emailVerificationStatus: "UNVERIFIED",
};
const refresh = id + "." + "A".repeat(43);
describe("identity trust boundary", () => {
  it("normalizes email without altering password and rejects role injection", () => {
    const input = {
      email: " TEST@EXAMPLE.INVALID ",
      password: "  unchanged secret  ",
      displayName: " Test ",
    };
    expect(registrationSchema.parse(input)).toMatchObject({
      email: "test@example.invalid",
      password: input.password,
      displayName: "Test",
    });
    expect(
      registrationSchema.safeParse({ ...input, roles: ["ADMIN"] }).success,
    ).toBe(false);
    expect(
      passwordLoginSchema.safeParse({ ...input, application: "ROOT" }).success,
    ).toBe(false);
  });
  it("rejects noncanonical opaque tokens", () => {
    expect(refreshTokenSchema.safeParse(refresh).success).toBe(true);
    for (const value of [
      refresh + "=",
      refresh.slice(0, -1) + "B",
      refresh.toUpperCase(),
      id + ".short",
    ])
      expect(refreshTokenSchema.safeParse(value).success).toBe(false);
  });
  it("rejects forged/expanded user authorities and unsafe expiries", () => {
    expect(identityUserSchema.safeParse(user).success).toBe(true);
    for (const change of [
      { roles: ["ROOT"] },
      { roles: ["CUSTOMER", "CUSTOMER"] },
      { passwordHash: "must never leave server" },
    ])
      expect(identityUserSchema.safeParse({ ...user, ...change }).success).toBe(
        false,
      );
    const session = {
      application: "CUSTOMER",
      accessToken: "a.b.c",
      refreshToken: refresh,
      accessTokenExpiresInSeconds: 300,
      refreshTokenExpiresInSeconds: 2592000,
      user,
    };
    expect(sessionPayloadSchema.safeParse(session).success).toBe(true);
    for (const expiry of [0, 301, Infinity, 1.5])
      expect(
        sessionPayloadSchema.safeParse({
          ...session,
          accessTokenExpiresInSeconds: expiry,
        }).success,
      ).toBe(false);
  });
});
