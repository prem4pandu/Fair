import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { argon2id, hash, verify } from "argon2";
import { SignJWT, jwtVerify, decodeJwt } from "jose";
import {
  applicationSchema as application,
  registrationSchema,
  passwordLoginSchema,
  emailSchema,
} from "@fairbite/identity-contracts";
import { GraphQLError } from "graphql";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { Redis } from "ioredis";
import type { Config } from "../config.js";

export const authError = (code: string, message: string): never => {
  throw new GraphQLError(message, { extensions: { code } });
};
const fail = (): never =>
  authError("AUTHENTICATION_FAILED", "Authentication required");
const unavailable = (): never =>
  authError("SERVICE_UNAVAILABLE", "Authentication service unavailable");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function normalizeEmail(value: unknown) {
  if (typeof value !== "string")
    return authError("BAD_USER_INPUT", "Invalid request");
  const email = value.trim().normalize("NFKC").toLowerCase();
  if (!emailSchema.safeParse(value).success)
    return authError("BAD_USER_INPUT", "Invalid request");
  return email;
}
// E.164 is what the pinned apps produce (`toE164(phone, countryCode)`), so the
// stored form is `+` followed by 7–15 digits with no leading zero. Separators
// the clients allow in the input are removed before validation; anything else
// is BAD_USER_INPUT rather than a silently stored near-miss.
const e164 = /^\+?[1-9]\d{6,14}$/;
export function normalizePhone(value: unknown) {
  if (typeof value !== "string")
    return authError("BAD_USER_INPUT", "Invalid request");
  const phone = value.trim().replace(/[\s().-]/g, "");
  if (!e164.test(phone)) return authError("BAD_USER_INPUT", "Invalid request");
  return phone;
}
export function opaqueValid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [id, secret, ...rest] = value.split(".");
  return (
    rest.length === 0 &&
    uuid.test(id ?? "") &&
    typeof secret === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(secret) &&
    Buffer.from(secret, "base64url").toString("base64url") === secret
  );
}
type Application = "CUSTOMER" | "MERCHANT" | "RIDER" | "ADMIN";
const roleFor = {
  CUSTOMER: "CUSTOMER",
  MERCHANT: "MERCHANT_STAFF",
  RIDER: "RIDER",
  ADMIN: "ADMIN",
} as const;
export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  emailVerified: boolean;
  status: string;
};
type IdentityContext = {
  authorization?: string;
  ip: string;
  identities?: Map<Application, Promise<PublicUser>>;
};
export type { IdentityContext };
const userSelect = {
  id: true,
  email: true,
  displayName: true,
  roles: true,
  emailVerified: true,
  status: true,
} as const;
const publicUser = (user: PublicUser) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  roles: user.roles,
  emailVerificationStatus: user.emailVerified ? "VERIFIED" : "UNVERIFIED",
});
const COUNTERS = `local a=redis.call('INCR',KEYS[1]);if a==1 then redis.call('EXPIRE',KEYS[1],60) end;local b=redis.call('INCR',KEYS[2]);if b==1 then redis.call('EXPIRE',KEYS[2],60) end;return {a,b}`;
let activeHashWork = 0;
export class IdentityService {
  readonly prisma: PrismaClient;
  private readonly redis: Redis;
  private readonly key: Uint8Array;
  private dummy: Promise<string> | undefined;
  constructor(private readonly config: Config) {
    this.prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 1500,
        statement_timeout: 3000,
        query_timeout: 3500,
      }),
    });
    this.redis = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    this.redis.on("error", () => {});
    this.key = Buffer.from(config.ACCESS_TOKEN_SECRET ?? "", "base64url");
  }
  async close() {
    this.redis.disconnect();
    await this.prisma.$disconnect();
  }
  private enabled() {
    if (!this.config.PASSWORD_AUTH_ENABLED)
      authError("AUTH_DISABLED", "Password authentication is unavailable");
  }
  private digest(value: string) {
    return createHmac(
      "sha256",
      Buffer.from(this.config.REFRESH_TOKEN_PEPPER ?? "", "base64url"),
    )
      .update(value)
      .digest("hex");
  }
  private opaque() {
    const id = randomUUID();
    const token = `${id}.${randomBytes(32).toString("base64url")}`;
    return { id, token, tokenHash: this.digest(token) };
  }
  private async limit(context: IdentityContext, account: string) {
    this.enabled();
    try {
      if (this.redis.status === "end") await this.redis.connect();
      const key = (value: string) => `identity-limit:${this.digest(value)}`;
      const counts = (await this.redis.eval(
        COUNTERS,
        2,
        key(`ip:${context.ip}`),
        key(`account:${account}`),
      )) as [number, number];
      if (counts[0] > 60 || counts[1] > 10)
        authError("RATE_LIMITED", "Too many authentication attempts");
    } catch (error) {
      if (error instanceof GraphQLError) throw error;
      unavailable();
    }
  }
  private async hashWork<T>(work: () => Promise<T>): Promise<T> {
    if (activeHashWork >= 2)
      return authError("RATE_LIMITED", "Too many authentication attempts");
    activeHashWork++;
    try {
      return await work();
    } finally {
      activeHashWork--;
    }
  }
  private encode(password: string) {
    return hash(password, {
      type: argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
    });
  }
  private eligible(
    user: PublicUser,
    app: Application,
    grants: { application: string; active: boolean }[],
  ) {
    return (
      user.status === "ACTIVE" &&
      user.roles.includes(roleFor[app]) &&
      (app === "CUSTOMER" ||
        (this.config.APP_ENV !== "production" &&
          grants.some((grant) => grant.application === app && grant.active)))
    );
  }
  private audit(
    tx: Prisma.TransactionClient,
    action: string,
    outcome: string,
    userId?: string,
    familyId?: string,
  ) {
    return tx.identityAuditEvent.create({
      data: { action, outcome, userId, familyId },
    });
  }
  private async payload(
    user: PublicUser,
    sessionId: string,
    refreshToken: string,
    app: Application,
    expiry: Date,
  ) {
    if (expiry.getTime() <= Date.now()) return fail();
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sid: sessionId, app })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(user.id)
      .setJti(randomUUID())
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(this.key);
    return {
      application: app,
      accessToken: token,
      refreshToken,
      accessTokenExpiresInSeconds: 300,
      refreshTokenExpiresInSeconds: Math.max(
        1,
        Math.floor((expiry.getTime() - Date.now()) / 1000),
      ),
      user: publicUser(user),
    };
  }
  async register(input: unknown, context: IdentityContext) {
    this.enabled();
    const parsed = registrationSchema.safeParse(input);
    if (!parsed.success) authError("BAD_USER_INPUT", "Invalid request");
    const data = parsed.data!;
    const email = normalizeEmail(data.email);
    await this.limit(context, email);
    const passwordHash = await this.hashWork(() => this.encode(data.password));
    const next = this.opaque();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 2592000000);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const user = await tx.identityUser.create({
          data: {
            id: randomUUID(),
            email,
            displayName: data.displayName,
            roles: ["CUSTOMER"],
            emailVerified: false,
            credential: { create: { passwordHash } },
          },
          select: userSelect,
        });
        const family = await tx.identitySessionFamily.create({
          data: {
            userId: user.id,
            application: "CUSTOMER",
            createdAt,
            expiresAt,
            sessions: {
              create: { id: next.id, tokenHash: next.tokenHash, createdAt },
            },
          },
        });
        await this.audit(tx, "REGISTER", "SUCCESS", user.id, family.id);
        return user;
      });
      return this.payload(user, next.id, next.token, "CUSTOMER", expiresAt);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        authError("ACCOUNT_EXISTS", "Account already exists");
      throw error;
    }
  }
  async login(input: unknown, context: IdentityContext) {
    this.enabled();
    const parsed = passwordLoginSchema.safeParse(input);
    if (!parsed.success) authError("BAD_USER_INPUT", "Invalid request");
    const data = parsed.data!;
    const email = normalizeEmail(data.email);
    await this.limit(context, email);
    const user = await this.prisma.identityUser.findUnique({
      where: { email },
      include: { credential: true, grants: true },
    });
    const valid = await this.hashWork(async () => {
      const encoded =
        user?.credential?.passwordHash ??
        (await (this.dummy ??= this.encode("credential-check-padding")));
      return verify(encoded, data.password);
    });
    if (
      !user ||
      !valid ||
      !this.eligible(user, data.application, user.grants)
    ) {
      await this.audit(
        this.prisma as unknown as Prisma.TransactionClient,
        "LOGIN",
        "FAILURE",
      );
      return fail();
    }
    const next = this.opaque();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 2592000000);
    const current = await this.prisma.$transaction(async (tx) => {
      const current = await tx.identityUser.findUnique({
        where: { id: user.id },
        include: { grants: true },
      });
      if (!current || !this.eligible(current, data.application, current.grants))
        return fail();
      const family = await tx.identitySessionFamily.create({
        data: {
          userId: user.id,
          application: data.application,
          createdAt,
          expiresAt,
          sessions: {
            create: { id: next.id, tokenHash: next.tokenHash, createdAt },
          },
        },
      });
      await this.audit(tx, "LOGIN", "SUCCESS", user.id, family.id);
      return current;
    });
    return this.payload(
      current,
      next.id,
      next.token,
      data.application,
      expiresAt,
    );
  }
  private token(value: unknown) {
    if (!opaqueValid(value))
      return authError("BAD_USER_INPUT", "Invalid request");
    return value;
  }
  async refresh(
    value: unknown,
    requested: Application,
    context: IdentityContext,
  ) {
    this.enabled();
    const token = this.token(value);
    const digest = this.digest(token);
    await this.limit(context, `session:${digest}`);
    const next = this.opaque();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            const session = await tx.identityRefreshSession.findUnique({
              where: { tokenHash: digest },
              include: {
                family: { include: { user: { include: { grants: true } } } },
              },
            });
            if (
              !session ||
              session.family.application !== requested ||
              session.family.revokedAt ||
              session.family.expiresAt <= new Date()
            )
              return null;
            const family = session.family;
            const app = application.parse(family.application);
            if (
              session.consumedAt ||
              !this.eligible(family.user, app, family.user.grants)
            ) {
              await tx.identitySessionFamily.update({
                where: { id: family.id },
                data: { revokedAt: new Date() },
              });
              await this.audit(
                tx,
                "REFRESH_REPLAY",
                "FAILURE",
                session.userId,
                family.id,
              );
              return null;
            }
            const consumedAt = new Date();
            const claimed = await tx.identityRefreshSession.updateMany({
              where: { id: session.id, consumedAt: null },
              data: { consumedAt },
            });
            if (claimed.count !== 1) {
              await tx.identitySessionFamily.update({
                where: { id: family.id },
                data: { revokedAt: new Date() },
              });
              return null;
            }
            await tx.identityRefreshSession.create({
              data: {
                id: next.id,
                userId: session.userId,
                familyId: family.id,
                tokenHash: next.tokenHash,
              },
            });
            await this.audit(
              tx,
              "REFRESH",
              "SUCCESS",
              session.userId,
              family.id,
            );
            return { user: family.user, app, expiry: family.expiresAt };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (!result) return fail();
        return this.payload(
          result.user,
          next.id,
          next.token,
          result.app,
          result.expiry,
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        )
          continue;
        throw error;
      }
    }
    await this.revokeDigest(digest);
    return fail();
  }
  private async revokeDigest(tokenHash: string) {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.identityRefreshSession.findUnique({
        where: { tokenHash },
      });
      if (session) {
        await tx.identitySessionFamily.updateMany({
          where: { id: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit(
          tx,
          "LOGOUT",
          "SUCCESS",
          session.userId,
          session.familyId,
        );
      }
    });
  }
  async logout(value: unknown, context: IdentityContext) {
    this.enabled();
    const token = this.token(value);
    await this.limit(context, `session:${this.digest(token)}`);
    await this.revokeDigest(this.digest(token));
    return { accepted: true };
  }
  /**
   * Whether an account already owns this normalized address. It is deliberately
   * status-independent: the address stays taken for a suspended account, so the
   * onboarding flow routes to sign-in instead of colliding with the unique
   * email. The contract is itself an enumeration oracle, so the lookup is
   * rate-limited per caller and per address and every other path reveals
   * nothing else about the account.
   */
  async emailExists(
    value: unknown,
    context: IdentityContext,
  ): Promise<boolean> {
    this.enabled();
    const email = normalizeEmail(value);
    await this.limit(context, `email-exist:${email}`);
    const user = await this.prisma.identityUser
      .findUnique({ where: { email }, select: { id: true } })
      .catch(() => unavailable());
    return user !== null;
  }
  /**
   * Whether an account already owns this normalized number. Like `emailExists`
   * it is status-independent (a suspended account keeps its unique number) and
   * rate-limited, because the contract answers an existence question about
   * another principal.
   */
  async phoneExists(
    value: unknown,
    context: IdentityContext,
  ): Promise<boolean> {
    this.enabled();
    const phone = normalizePhone(value);
    await this.limit(context, `phone-exist:${phone}`);
    const user = await this.prisma.identityUser
      .findUnique({ where: { phone }, select: { id: true } })
      .catch(() => unavailable());
    return user !== null;
  }
  async identity(
    requested: Application,
    context: IdentityContext,
  ): Promise<PublicUser> {
    this.enabled();
    if (!application.safeParse(requested).success)
      return authError("BAD_USER_INPUT", "Invalid request");
    context.identities ??= new Map();
    let identity = context.identities.get(requested);
    if (!identity) {
      identity = this.authorize(requested, context.authorization);
      context.identities.set(requested, identity);
    }
    return identity;
  }
  private async authorize(
    requested: Application,
    authorization?: string,
  ): Promise<PublicUser> {
    if (!authorization?.startsWith("Bearer ")) return fail();
    const token = authorization.slice(7);
    if (
      token.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
      token
        .split(".")
        .some(
          (part) =>
            Buffer.from(part, "base64url").toString("base64url") !== part,
        )
    )
      return fail();
    let claims;
    try {
      claims = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        issuer: "fairbite-api",
        audience: "fairbite-apps",
      });
    } catch {
      return fail();
    }
    const p = claims.payload;
    if (
      Object.keys(claims.protectedHeader).some(
        (key) => !["alg", "typ"].includes(key),
      ) ||
      Object.keys(p).some(
        (key) =>
          !["sid", "app", "sub", "jti", "iss", "aud", "iat", "exp"].includes(
            key,
          ),
      ) ||
      p.app !== requested ||
      p.aud !== "fairbite-apps" ||
      p.iss !== "fairbite-api" ||
      claims.protectedHeader.typ !== "at+jwt" ||
      !uuid.test(p.sub ?? "") ||
      typeof p.sid !== "string" ||
      !uuid.test(p.sid) ||
      typeof p.jti !== "string" ||
      !uuid.test(p.jti) ||
      typeof p.iat !== "number" ||
      typeof p.exp !== "number" ||
      !Number.isInteger(p.iat) ||
      !Number.isInteger(p.exp) ||
      p.exp - p.iat !== 300 ||
      p.iat > Math.floor(Date.now() / 1000) ||
      !application.safeParse(p.app).success
    )
      return fail();
    const session = await this.prisma.identityRefreshSession
      .findUnique({
        where: { id: p.sid },
        include: {
          family: { include: { user: { include: { grants: true } } } },
        },
      })
      .catch(() => unavailable());
    if (
      !session ||
      session.userId !== p.sub ||
      session.consumedAt ||
      session.family.revokedAt ||
      session.family.expiresAt <= new Date() ||
      session.family.application !== p.app ||
      !this.eligible(
        session.family.user,
        p.app as Application,
        session.family.user.grants,
      )
    )
      return fail();
    return session.family.user;
  }
  async me(requested: Application, context: IdentityContext) {
    return publicUser(await this.identity(requested, context));
  }
  /**
   * The authenticated owner principal plus the access token that proved it.
   * `authorize` has already validated the header, so slicing it here cannot
   * accept an unverified token; the expiry comes from the same claims.
   */
  async ownerPrincipal(context: IdentityContext) {
    const user = await this.identity("ADMIN", context);
    const authorization = context.authorization ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const expiresAt = token ? decodeJwt(token).exp : undefined;
    if (!token || typeof expiresAt !== "number") return fail();
    return { user, token, expiresAt };
  }
  async logoutAll(requested: Application, context: IdentityContext) {
    const user = await this.identity(requested, context);
    await this.limit(context, `user:${user.id}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.identitySessionFamily.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit(tx, "LOGOUT_ALL", "SUCCESS", user.id);
    });
    return { accepted: true };
  }
}
