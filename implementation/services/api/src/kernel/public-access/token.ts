import { randomBytes } from "node:crypto";
import { errors, jwtVerify, SignJWT } from "jose";
import type { Clock } from "../time.js";
import { systemClock } from "../time.js";

export type Verification = { ok: true } | { ok: false; message: string };

export class PublicAccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly clock: Clock = systemClock,
  ) {
    this.key = Buffer.from(secret, "base64url");
  }

  async mint(nonce: string) {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;
    const experience = await new SignJWT({ nonce, typ: "public" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomBytes(12).toString("base64url"))
      .sign(this.key);
    const decoy = () => randomBytes(9).toString("base64url");

    return {
      excellence: decoy(),
      topgun: decoy(),
      experience,
      skydiver: decoy(),
      rider: decoy(),
      haha: decoy(),
      hehe: new Date(expiresAt * 1000).toISOString(),
      huhu: decoy(),
      yoyo: decoy(),
      turu: decoy(),
    };
  }

  async verify(token: string, nonce: string): Promise<Verification> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        currentDate: this.clock.now(),
      });
      if (payload.typ !== "public")
        return { ok: false, message: "Unauthorized: invalid token" };
      if (payload.nonce !== nonce)
        return { ok: false, message: "Unauthorized: fingerprint mismatch" };
      return { ok: true };
    } catch (error) {
      if (error instanceof errors.JWTExpired)
        return { ok: false, message: "Unauthorized: jwt expired" };
      return { ok: false, message: "Unauthorized: invalid token" };
    }
  }
}
