import { randomBytes } from "node:crypto";
import { errors, jwtVerify, SignJWT } from "jose";
import { appError } from "../errors.js";
import { systemClock, type Clock } from "../time.js";

export const USER_TYPES = [
  "CUSTOMER",
  "RIDER",
  "RESTAURANT",
  "VENDOR",
  "ADMIN",
  "STAFF",
] as const;

export type UserType = (typeof USER_TYPES)[number];

export type TokenClaims = {
  sub: string;
  typ: UserType;
  sid: string;
};

export class UserTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock = systemClock,
  ) {
    this.key = Buffer.from(secret, "base64url");
  }

  // The Enatega store app decodes JWT payloads with atob(), which cannot decode
  // base64url '-' or '_'. Vary a non-security claim until the payload is safe.
  async issue(
    claims: TokenClaims,
  ): Promise<{ token: string; expiresAt: Date }> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;

    for (let attempt = 0; attempt < 256; attempt++) {
      const token = await new SignJWT({
        typ: claims.typ,
        sid: claims.sid,
        n: randomBytes(3).toString("hex"),
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(claims.sub)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(this.key);

      const payload = token.split(".")[1];
      if (payload !== undefined && !/[-_]/.test(payload)) {
        return { token, expiresAt: new Date(expiresAt * 1000) };
      }
    }

    throw new Error("Unable to produce an atob-safe token");
  }

  async verify(token: string): Promise<TokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        currentDate: this.clock.now(),
      });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.sid !== "string" ||
        !USER_TYPES.includes(payload.typ as UserType)
      ) {
        throw appError("INVALID_TOKEN");
      }
      return {
        sub: payload.sub,
        typ: payload.typ as UserType,
        sid: payload.sid,
      };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw appError("TOKEN_EXPIRED");
      }
      throw appError("INVALID_TOKEN");
    }
  }
}
