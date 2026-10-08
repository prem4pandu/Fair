import { decodeJwt } from "jose";
import { authError, type IdentityContext, IdentityService } from "./service.js";

type Application = "CUSTOMER" | "MERCHANT" | "RIDER" | "ADMIN";

type Session = Awaited<ReturnType<IdentityService["login"]>>;

export type EnategaPasswordLogin = {
  email?: unknown;
  password?: unknown;
  type?: unknown;
  notificationToken?: unknown;
};

const applicationByPrincipal: Readonly<Record<string, Application>> = {
  customer: "CUSTOMER",
  email: "CUSTOMER",
  rider: "RIDER",
  restaurant: "MERCHANT",
  owner: "ADMIN",
};

export function applicationForEnategaPrincipal(value: unknown): Application {
  if (typeof value !== "string")
    return authError("BAD_USER_INPUT", "Invalid request");
  const application = applicationByPrincipal[value.trim().toLowerCase()];
  if (!application) return authError("BAD_USER_INPUT", "Invalid request");
  return application;
}

function expiration(token: string): string {
  const expiresAt = decodeJwt(token).exp;
  if (!expiresAt)
    return authError("AUTHENTICATION_FAILED", "Authentication required");
  return String(expiresAt);
}

/** Maps the internal session without exposing the opaque refresh token to customer clients. */
export function toEnategaCustomerSession(session: Session) {
  return {
    userId: session.user.id,
    token: session.accessToken,
    tokenExpiration: expiration(session.accessToken),
    name: session.user.displayName,
    email: session.user.email,
    emailIsVerified: session.user.emailVerificationStatus === "VERIFIED",
    phone: null,
    phoneIsVerified: false,
    picture: null,
    addresses: [],
    isNewUser: false,
    userTypeId: session.user.roles[0] ?? null,
    isActive: true,
  };
}

/** Owner clients require the refresh pair for their existing rotation flow. */
export function toEnategaOwnerSession(session: Session) {
  const now = Math.floor(Date.now() / 1000);
  return {
    userId: session.user.id,
    token: session.accessToken,
    tokenExpiration: expiration(session.accessToken),
    refreshToken: session.refreshToken,
    refreshTokenExpiration: String(now + session.refreshTokenExpiresInSeconds),
    email: session.user.email,
    userType: "ADMIN",
    userTypeId: session.user.roles[0] ?? null,
    permissions: session.user.roles,
    restaurants: [],
    image: null,
    name: session.user.displayName,
    isActive: true,
  };
}

export class EnategaIdentityAdapter {
  constructor(private readonly identity: IdentityService) {}

  async login(input: EnategaPasswordLogin, context: IdentityContext) {
    if (typeof input.email !== "string" || typeof input.password !== "string")
      return authError("BAD_USER_INPUT", "Invalid request");
    const application = applicationForEnategaPrincipal(input.type);
    const session = await this.identity.login(
      { email: input.email, password: input.password, application },
      context,
    );
    return toEnategaCustomerSession(session);
  }

  async ownerLogin(
    email: unknown,
    password: unknown,
    context: IdentityContext,
  ) {
    if (typeof email !== "string" || typeof password !== "string")
      return authError("BAD_USER_INPUT", "Invalid request");
    const session = await this.identity.login(
      { email, password, application: "ADMIN" },
      context,
    );
    return toEnategaOwnerSession(session);
  }

  async restaurantLogin(
    username: unknown,
    password: unknown,
    context: IdentityContext,
  ) {
    if (typeof username !== "string" || typeof password !== "string")
      return authError("BAD_USER_INPUT", "Invalid request");
    const session = await this.identity.login(
      { email: username, password, application: "MERCHANT" },
      context,
    );
    return {
      token: session.accessToken,
      restaurantId: session.user.id,
    };
  }

  async riderLogin(
    username: unknown,
    password: unknown,
    context: IdentityContext,
  ) {
    if (typeof username !== "string" || typeof password !== "string")
      return authError("BAD_USER_INPUT", "Invalid request");
    const session = await this.identity.login(
      { email: username, password, application: "RIDER" },
      context,
    );
    return { userId: session.user.id, token: session.accessToken };
  }
}
