import { SignJWT } from "jose";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  applicationForEnategaPrincipal,
  EnategaIdentityAdapter,
  toEnategaCustomerSession,
  toEnategaOwnerSession,
} from "../../../src/identity/enatega.js";

async function fixture() {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ sid: randomUUID(), app: "CUSTOMER" })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(randomBytes(32));
  return {
    application: "CUSTOMER" as const,
    accessToken: token,
    refreshToken: `${randomUUID()}.secret`,
    accessTokenExpiresInSeconds: 300,
    refreshTokenExpiresInSeconds: 3600,
    user: {
      id: randomUUID(),
      email: "person@example.com",
      displayName: "Person",
      roles: ["CUSTOMER"],
      emailVerificationStatus: "VERIFIED" as const,
    },
  };
}

describe("Enatega identity compatibility adapters", () => {
  it("maps only supported principal kinds to server-owned applications", () => {
    expect(applicationForEnategaPrincipal("email")).toBe("CUSTOMER");
    expect(applicationForEnategaPrincipal("RIDER")).toBe("RIDER");
    expect(applicationForEnategaPrincipal("restaurant")).toBe("MERCHANT");
    expect(applicationForEnategaPrincipal("owner")).toBe("ADMIN");
    for (const value of ["admin", "google", "", null])
      expect(() => applicationForEnategaPrincipal(value)).toThrowError(
        expect.objectContaining({ extensions: { code: "BAD_USER_INPUT" } }),
      );
  });

  it("projects the exact customer transport fields without a refresh token", async () => {
    const session = await fixture();
    const result = toEnategaCustomerSession(session as never);
    expect(result).toEqual({
      userId: session.user.id,
      token: session.accessToken,
      tokenExpiration: expect.stringMatching(/^\d+$/),
      name: "Person",
      email: "person@example.com",
      emailIsVerified: true,
      phone: null,
      phoneIsVerified: false,
      picture: null,
      addresses: [],
      isNewUser: false,
      userTypeId: "CUSTOMER",
      isActive: true,
    });
    expect(result).not.toHaveProperty("refreshToken");
  });

  it("preserves the owner refresh pair needed by the admin client", async () => {
    const session = await fixture();
    const result = toEnategaOwnerSession(session as never);
    expect(result).toMatchObject({
      userId: session.user.id,
      token: session.accessToken,
      refreshToken: session.refreshToken,
      email: session.user.email,
      userType: "ADMIN",
      permissions: ["CUSTOMER"],
      restaurants: [],
      name: "Person",
      isActive: true,
    });
    expect(Number(result.refreshTokenExpiration)).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
  });

  it("routes customer, rider, restaurant and owner credentials to distinct applications", async () => {
    const sessions = [
      await fixture(),
      await fixture(),
      await fixture(),
      await fixture(),
    ];
    const login = vi
      .fn()
      .mockResolvedValueOnce(sessions[0])
      .mockResolvedValueOnce(sessions[1])
      .mockResolvedValueOnce(sessions[2])
      .mockResolvedValueOnce(sessions[3]);
    const adapter = new EnategaIdentityAdapter({ login } as never);
    const context = { ip: "127.0.0.1" };
    await adapter.login(
      { email: "a@b.com", password: "secret", type: "email" },
      context,
    );
    await adapter.riderLogin("rider@b.com", "secret", context);
    await adapter.restaurantLogin("store@b.com", "secret", context);
    await adapter.ownerLogin("owner@b.com", "secret", context);
    expect(login.mock.calls.map(([input]) => input.application)).toEqual([
      "CUSTOMER",
      "RIDER",
      "MERCHANT",
      "ADMIN",
    ]);
  });

  it("rejects missing password credentials before reaching identity storage", async () => {
    const login = vi.fn();
    const adapter = new EnategaIdentityAdapter({ login } as never);
    await expect(
      adapter.login(
        { email: "person@example.com", type: "email" },
        { ip: "127.0.0.1" },
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(login).not.toHaveBeenCalled();
  });

  it("registers an Enatega customer through hardened customer onboarding", async () => {
    const session = await fixture();
    const register = vi.fn().mockResolvedValue(session);
    const adapter = new EnategaIdentityAdapter({ register } as never);
    const result = await adapter.createUser(
      {
        email: "person@example.com",
        password: "actual-test-password-12",
        name: "Person",
      },
      { ip: "127.0.0.1" },
    );
    expect(register).toHaveBeenCalledWith(
      {
        email: "person@example.com",
        password: "actual-test-password-12",
        displayName: "Person",
      },
      { ip: "127.0.0.1" },
    );
    expect(result).toMatchObject({
      userId: session.user.id,
      isNewUser: true,
      emailIsVerified: true,
    });
    expect(result).not.toHaveProperty("refreshToken");
  });

  it("rejects unsupported Apple onboarding instead of fabricating provider success", async () => {
    const register = vi.fn();
    const adapter = new EnategaIdentityAdapter({ register } as never);
    await expect(
      adapter.createUser(
        { appleId: "provider-id", name: "Person" },
        { ip: "127.0.0.1" },
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_IMPLEMENTED" } });
    expect(register).not.toHaveBeenCalled();
  });

  it("rotates the admin refresh token and preserves the owner response contract", async () => {
    const session = await fixture();
    const refresh = vi.fn().mockResolvedValue(session);
    const adapter = new EnategaIdentityAdapter({ refresh } as never);
    const result = await adapter.refreshToken(session.refreshToken, "ADMIN", {
      ip: "127.0.0.1",
    });
    expect(refresh).toHaveBeenCalledWith(session.refreshToken, "ADMIN", {
      ip: "127.0.0.1",
    });
    expect(result).toMatchObject({
      userId: session.user.id,
      refreshToken: session.refreshToken,
      userType: "ADMIN",
    });
  });

  it("maps the authenticated customer profile without private session data", async () => {
    const me = vi.fn().mockResolvedValue({
      id: "user-id",
      email: "person@example.com",
      displayName: "Person",
      roles: ["CUSTOMER"],
      emailVerificationStatus: "UNVERIFIED",
    });
    const adapter = new EnategaIdentityAdapter({ me } as never);
    const result = await adapter.profile({
      ip: "127.0.0.1",
      authorization: "Bearer token",
    });
    expect(me).toHaveBeenCalledWith("CUSTOMER", expect.any(Object));
    expect(result).toMatchObject({
      _id: "user-id",
      email: "person@example.com",
      emailIsVerified: false,
      addresses: [],
      isActive: true,
      userType: "CUSTOMER",
    });
    expect(result).not.toHaveProperty("token");
  });

  it("requires an admin identity before evaluating owner permissions", async () => {
    const me = vi.fn().mockResolvedValue({ roles: ["ADMIN"] });
    const adapter = new EnategaIdentityAdapter({ me } as never);
    await expect(
      adapter.hasOwnerPermission("restaurants", { ip: "127.0.0.1" }),
    ).resolves.toBe(true);
    expect(me).toHaveBeenCalledWith("ADMIN", expect.any(Object));
    await expect(
      adapter.hasOwnerPermission("", { ip: "127.0.0.1" }),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });
});
