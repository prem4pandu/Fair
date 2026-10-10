import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

// The exact documents the pinned customer app and customer web send. Both
// include client-supplied verification flags, which the server must ignore.
const appDocument = doc(
  "enatega-multivendor-app",
  "src/apollo/mutations.js",
  "updateUser",
);
const webDocument = doc(
  "enatega-multivendor-web",
  "lib/api/graphql/mutations/auth/index.ts",
  "UPDATE_USER",
);

const accessSecret = Buffer.alloc(32, 1).toString("base64url");

type Seeded = { id: string; email: string; token: string };

describe(op("mutation.updateUser"), () => {
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

  async function seed(
    options: { phone?: string; emailVerified?: boolean } = {},
  ): Promise<Seeded> {
    const id = randomUUID();
    const email = `update-${id}@example.test`;
    const sessionId = randomUUID();
    await stack.pool.query(
      'INSERT INTO "IdentityUser" (id,email,"displayName",roles,phone,"emailVerified") VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        email,
        "Synthetic Customer",
        ["CUSTOMER"],
        options.phone ?? null,
        options.emailVerified ?? false,
      ],
    );
    await stack.pool.query(
      `INSERT INTO "IdentitySessionFamily" (id,"userId",application,"expiresAt")
       VALUES ($1,$2,'CUSTOMER', now() + interval '1 hour')`,
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
    const token = await new SignJWT({ sid: sessionId, app: "CUSTOMER" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(id)
      .setJti(randomUUID())
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(Buffer.from(accessSecret, "base64url"));
    return { id, email, token };
  }

  const update = (
    token: string | null,
    variables: Record<string, unknown>,
    document = appDocument,
  ) =>
    // Both pinned documents pass the input fields as individual variables
    // rather than a single $input object.
    api.http.withUser(token).query<{
      updateUser: {
        _id: string;
        name: string;
        phone: string | null;
        phoneIsVerified: boolean;
        emailIsVerified: boolean;
      } | null;
    }>(document, { name: "Updated Name", ...variables });

  it("updates the caller's own name and phone", async () => {
    const customer = await seed();
    const result = await update(customer.token, {
      name: "  Updated Name  ",
      phone: "+60 12-345 6789",
    });
    expect(result.errors).toEqual([]);
    expect(result.data?.updateUser).toMatchObject({
      _id: customer.id,
      name: "Updated Name",
      phone: "+60123456789",
    });
    const stored = await stack.pool.query(
      'SELECT "displayName", phone FROM "IdentityUser" WHERE id = $1',
      [customer.id],
    );
    expect(stored.rows[0]).toEqual({
      displayName: "Updated Name",
      phone: "+60123456789",
    });
  });

  it("serves the pinned customer-web document as well", async () => {
    const customer = await seed();
    const result = await update(
      customer.token,
      { name: "Web Name", phone: "+60111111111" },
      webDocument,
    );
    expect(result.errors).toEqual([]);
    expect(result.data?.updateUser).toMatchObject({
      name: "Web Name",
      phone: "+60111111111",
    });
  });

  it("never trusts the client's verification flags", async () => {
    const unverified = await seed();
    const claimed = await update(unverified.token, {
      name: "Claimed Verified",
      phone: "+60222222222",
      phoneIsVerified: true,
      emailIsVerified: true,
    });
    expect(claimed.errors).toEqual([]);
    expect(claimed.data?.updateUser).toMatchObject({
      phoneIsVerified: false,
      emailIsVerified: false,
    });
    const stored = await stack.pool.query(
      'SELECT "emailVerified" FROM "IdentityUser" WHERE id = $1',
      [unverified.id],
    );
    expect(stored.rows[0].emailVerified).toBe(false);

    // The opposite direction too: a server-verified email stays verified even
    // when the client sends false.
    const verified = await seed({ emailVerified: true });
    const honest = await update(verified.token, {
      name: "Honest",
      phoneIsVerified: false,
      emailIsVerified: false,
    });
    expect(honest.data?.updateUser?.emailIsVerified).toBe(true);
  });

  it("refuses a phone number another account already owns", async () => {
    const taken = "+60333333333";
    await seed({ phone: taken });
    const customer = await seed();
    const result = await update(customer.token, {
      name: "Conflict",
      phone: taken,
    });
    expect(result.data?.updateUser ?? null).toBeNull();
    expect(result.errors.map((error) => error.extensions.code)).toEqual([
      "CONFLICT",
    ]);
    const stored = await stack.pool.query(
      'SELECT "displayName", phone FROM "IdentityUser" WHERE id = $1',
      [customer.id],
    );
    expect(stored.rows[0]).toEqual({
      displayName: "Synthetic Customer",
      phone: null,
    });
  });

  it("rejects malformed input without changing anything", async () => {
    const customer = await seed();
    for (const input of [
      { name: "", phone: "+60444444444" },
      { name: "Valid", phone: "not-a-phone" },
      { name: undefined, phone: "+60555555555" },
    ]) {
      const result = await update(customer.token, input);
      expect(result.data?.updateUser ?? null).toBeNull();
      expect(result.errors.map((error) => error.extensions.code)).toEqual([
        "BAD_USER_INPUT",
      ]);
    }
    const stored = await stack.pool.query(
      'SELECT "displayName", phone FROM "IdentityUser" WHERE id = $1',
      [customer.id],
    );
    expect(stored.rows[0]).toEqual({
      displayName: "Synthetic Customer",
      phone: null,
    });
  });

  it("refuses an anonymous caller and never touches another principal", async () => {
    const caller = await seed();
    const other = await seed();
    const anonymous = await update(null, { name: "Anonymous" });
    expect(caller.id).not.toBe(other.id);
    expect(anonymous.errors.map((error) => error.extensions.code)).toEqual([
      "AUTHENTICATION_FAILED",
    ]);
    // The caller always updates itself; the other account is untouched.
    const stored = await stack.pool.query(
      'SELECT "displayName" FROM "IdentityUser" WHERE id = $1',
      [other.id],
    );
    expect(stored.rows[0].displayName).toBe("Synthetic Customer");
  });
});
