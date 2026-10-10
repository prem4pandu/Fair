import { decodeJwt } from "jose";
import {
  authError,
  type IdentityContext,
  IdentityService,
  type PublicUser,
} from "./service.js";

type Application = "CUSTOMER" | "MERCHANT" | "RIDER" | "ADMIN";

type Session = Awaited<ReturnType<IdentityService["login"]>>;

export type EnategaPasswordLogin = {
  email?: unknown;
  password?: unknown;
  type?: unknown;
  notificationToken?: unknown;
};

export type EnategaCreateUser = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  appleId?: unknown;
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
export function toEnategaCustomerSession(session: Session, isNewUser = false) {
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
    isNewUser,
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

/**
 * `ownerSession` resolves purely from the bearer token: it echoes the current
 * access token and never mints or rotates a refresh token, because the pinned
 * client deliberately keeps its cached refresh pair (normalizeOwnerSession in
 * the admin app). The admin application is only issuable to an ADMIN-role user
 * today (`IdentityService.eligible`), so ADMIN is the only reachable userType;
 * STAFF/VENDOR/RESTAURANT need the ownership records W5a adds. `userTypeId` is
 * the caller's own id — the same convention `restaurantLogin` already uses for
 * a merchant principal. `restaurants: []` is what the reference accepts for
 * ADMIN/STAFF.
 */
export function toEnategaOwnerSessionFromToken(principal: {
  user: PublicUser;
  token: string;
  expiresAt: number;
}) {
  const { user, token, expiresAt } = principal;
  return {
    userId: user.id,
    email: user.email,
    userType: "ADMIN",
    userTypeId: user.id,
    permissions: user.roles,
    name: user.displayName,
    image: null,
    restaurants: [],
    token,
    tokenExpiration: String(expiresAt),
    refreshToken: null,
    refreshTokenExpiration: null,
    isActive: user.status === "ACTIVE",
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

  async createUser(input: EnategaCreateUser, context: IdentityContext) {
    if (input.appleId != null)
      return authError(
        "NOT_IMPLEMENTED",
        "Apple authentication is unavailable",
      );
    if (
      typeof input.email !== "string" ||
      typeof input.password !== "string" ||
      typeof input.name !== "string"
    )
      return authError("BAD_USER_INPUT", "Invalid request");
    const session = await this.identity.register(
      {
        email: input.email,
        password: input.password,
        displayName: input.name,
      },
      context,
    );
    return toEnategaCustomerSession(session, true);
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

  async refreshToken(
    refreshToken: unknown,
    userType: unknown,
    context: IdentityContext,
  ) {
    const application =
      typeof userType === "string" && userType.trim().toUpperCase() === "ADMIN"
        ? "ADMIN"
        : applicationForEnategaPrincipal(userType);
    const session = await this.identity.refresh(
      refreshToken,
      application,
      context,
    );
    return application === "ADMIN"
      ? toEnategaOwnerSession(session)
      : toEnategaCustomerSession(session);
  }

  async profile(context: IdentityContext) {
    const user = await this.identity.me("CUSTOMER", context);
    return {
      _id: user.id,
      name: user.displayName,
      email: user.email,
      emailIsVerified: user.emailVerificationStatus === "VERIFIED",
      phone: null,
      phoneIsVerified: false,
      addresses: [],
      favourite: null,
      notificationToken: null,
      isOfferNotification: false,
      isOrderNotification: false,
      isActive: true,
      userType: user.roles[0] ?? null,
      stripe_plan_id: null,
    };
  }

  async emailExist(email: unknown, context: IdentityContext) {
    return this.identity.emailExists(email, context);
  }

  async phoneExist(phone: unknown, context: IdentityContext) {
    return this.identity.phoneExists(phone, context);
  }

  async changePassword(
    input: { oldPassword?: unknown; newPassword?: unknown },
    context: IdentityContext,
  ) {
    return this.identity.changePassword(input, context);
  }

  async deactivate(
    input: { email?: unknown; isActive?: unknown },
    context: IdentityContext,
  ) {
    return this.identity.deactivate(input, context);
  }

  async updateUser(
    input: {
      name?: unknown;
      phone?: unknown;
      phoneIsVerified?: unknown;
      emailIsVerified?: unknown;
    },
    context: IdentityContext,
  ) {
    return this.identity.updateUser(input ?? {}, context);
  }

  async sendOtpToEmail(
    input: { email?: unknown; otp?: unknown },
    context: IdentityContext,
  ) {
    return this.identity.sendOtp(
      { email: input?.email, otp: input?.otp },
      context,
    );
  }

  async sendOtpToPhoneNumber(
    input: { phone?: unknown; otp?: unknown },
    context: IdentityContext,
  ) {
    return this.identity.sendOtp(
      { phone: input?.phone, otp: input?.otp },
      context,
    );
  }

  async ownerSession(context: IdentityContext) {
    return toEnategaOwnerSessionFromToken(
      await this.identity.ownerPrincipal(context),
    );
  }

  async hasOwnerPermission(permission: unknown, context: IdentityContext) {
    if (typeof permission !== "string" || permission.trim().length === 0)
      return authError("BAD_USER_INPUT", "Invalid request");
    const user = await this.identity.me("ADMIN", context);
    return (
      user.roles.includes("ADMIN") || user.roles.includes(permission.trim())
    );
  }
}
