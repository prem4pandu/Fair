import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

// The exact document the pinned admin and single-vendor admin apps send.
const document = doc(
  "enatega-multivendor-admin",
  "lib/api/graphql/queries/authentication/index.ts",
  "OWNER_SESSION",
);

const accessSecret = Buffer.alloc(32, 1).toString("base64url");

type Seeded = {
  id: string;
  email: string;
  sessionId: string;
  token: string;
};

describe(op("query.ownerSession"), () => {
  let stack: Stack;
  let api: Api;

  beforeAll(async () => {
    stack = await startStack();
    api = await startApi(stack);
  });
  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  async function seedOwner(
    roles: string[] = ["ADMIN"],
    options: { status?: string; granted?: boolean } = {},
  ): Promise<Seeded> {
    const id = randomUUID();
    const email = `owner-${id}@example.test`;
    const sessionId = randomUUID();
    await stack.pool.query(
      'INSERT INTO "IdentityUser" (id,email,"displayName",roles,status,"emailVerified") VALUES($1,$2,$3,$4,$5,true)',
      [id, email, "Synthetic Owner", roles, options.status ?? "ACTIVE"],
    );
    if (options.granted !== false)
      await stack.pool.query(
        'INSERT INTO "IdentityApplicationGrant" ("userId",application) VALUES($1,\'ADMIN\')',
        [id],
      );
    await stack.pool.query(
      `INSERT INTO "IdentitySessionFamily" (id,"userId",application,"expiresAt")
       VALUES ($1,$2,'ADMIN', now() + interval '1 hour')`,
      [sessionId, id],
    );
    await stack.pool.query(
      'INSERT INTO "IdentityRefreshSession" (id,"familyId","userId","tokenHash") VALUES($1,$2,$3,$4)',
      [
        sessionId,
        sessionId,
        id,
        randomUUID().replaceAll("-", "").padEnd(64, "a"),
      ],
    );
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sid: sessionId, app: "ADMIN" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(id)
      .setJti(randomUUID())
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(Buffer.from(accessSecret, "base64url"));
    return { id, email, sessionId, token };
  }

  const read = (token?: string) =>
    api.http.withUser(token ?? null).query<{
      ownerSession: Record<string, unknown> | null;
    }>(document);

  it("resolves the owner session for the bearer token with every pinned field", async () => {
    const owner = await seedOwner();
    const result = await read(owner.token);
    expect(result.errors).toEqual([]);
    const session = result.data?.ownerSession;
    expect(session).toBeTruthy();
    expect(session).toMatchObject({
      userId: owner.id,
      email: owner.email,
      userType: "ADMIN",
      userTypeId: owner.id,
      permissions: ["ADMIN"],
      name: "Synthetic Owner",
      image: null,
      restaurants: [],
      token: owner.token,
      isActive: true,
    });
    expect(typeof session!.tokenExpiration).toBe("string");
    expect(Number(session!.tokenExpiration)).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
    // The private credential and session hash must never be serialized.
    expect(JSON.stringify(session)).not.toMatch(/password|tokenHash|family/i);
  });

  it("does not return another owner's session", async () => {
    const first = await seedOwner();
    const second = await seedOwner();
    const result = await read(second.token);
    expect(result.errors).toEqual([]);
    expect(result.data?.ownerSession).toMatchObject({
      userId: second.id,
      email: second.email,
    });
    expect(result.data?.ownerSession?.userId).not.toBe(first.id);
  });

  it("refuses an anonymous caller without data", async () => {
    const result = await read();
    expect(result.data?.ownerSession ?? null).toBeNull();
    expect(result.errors.map((error) => error.extensions.code)).toEqual([
      "AUTHENTICATION_FAILED",
    ]);
  });

  it("refuses a revoked session without data", async () => {
    const owner = await seedOwner();
    await stack.pool.query(
      'UPDATE "IdentitySessionFamily" SET "revokedAt" = now() WHERE id = $1',
      [owner.sessionId],
    );
    const result = await read(owner.token);
    expect(result.data?.ownerSession ?? null).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("refuses a suspended owner without data", async () => {
    const owner = await seedOwner(["ADMIN"], { status: "SUSPENDED" });
    const result = await read(owner.token);
    expect(result.data?.ownerSession ?? null).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("refuses a customer token that is not an owner principal", async () => {
    const customer = await seedOwner(["CUSTOMER"], { granted: false });
    const result = await read(customer.token);
    expect(result.data?.ownerSession ?? null).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("leaves persisted rows unchanged on every rejection", async () => {
    const owner = await seedOwner(["CUSTOMER"], { granted: false });
    const before = await stack.pool.query(
      'SELECT to_jsonb(t) AS row FROM "IdentityUser" t WHERE id = $1',
      [owner.id],
    );
    await read(owner.token);
    const after = await stack.pool.query(
      'SELECT to_jsonb(t) AS row FROM "IdentityUser" t WHERE id = $1',
      [owner.id],
    );
    expect(after.rows).toEqual(before.rows);
  });
});
