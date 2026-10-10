import { describe, expect, it } from "vitest";
import { toEnategaOwnerSessionFromToken } from "../../../src/identity/enatega.js";
import { op } from "../../support/op.js";

const principal = {
  user: {
    id: "018f0000-0000-7000-8000-0000000000a1",
    email: "owner@example.test",
    displayName: "Synthetic Owner",
    roles: ["ADMIN"],
    emailVerified: true,
    status: "ACTIVE",
  },
  token: "header.payload.signature",
  expiresAt: 1_800_000_000,
};

describe(op("query.ownerSession"), () => {
  it("maps the verified principal to the pinned owner-session shape", () => {
    expect(toEnategaOwnerSessionFromToken(principal)).toEqual({
      userId: "018f0000-0000-7000-8000-0000000000a1",
      email: "owner@example.test",
      userType: "ADMIN",
      userTypeId: "018f0000-0000-7000-8000-0000000000a1",
      permissions: ["ADMIN"],
      name: "Synthetic Owner",
      image: null,
      restaurants: [],
      token: "header.payload.signature",
      tokenExpiration: "1800000000",
      refreshToken: null,
      refreshTokenExpiration: null,
      isActive: true,
    });
  });

  it("never mints or rotates a refresh token and preserves null images", () => {
    const session = toEnategaOwnerSessionFromToken(principal);
    // The pinned client keeps its cached refresh pair, so this root must not
    // return one it did not receive.
    expect(session.refreshToken).toBeNull();
    expect(session.refreshTokenExpiration).toBeNull();
    expect(session.image).toBeNull();
    expect(session.restaurants).toEqual([]);
  });

  it("reports a non-active principal as inactive", () => {
    expect(
      toEnategaOwnerSessionFromToken({
        ...principal,
        user: { ...principal.user, status: "SUSPENDED" },
      }).isActive,
    ).toBe(false);
  });
});
