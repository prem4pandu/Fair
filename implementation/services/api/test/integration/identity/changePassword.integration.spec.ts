import { randomUUID } from "node:crypto";
import { hash, argon2id, verify } from "argon2";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionFields } from "@fairbite/identity-contracts";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

// The exact document the pinned customer app sends.
const document = doc(
  "enatega-multivendor-app",
  "src/apollo/mutations.js",
  "changePassword",
);
const login = `mutation($input:PasswordLoginInput!){loginPassword(input:$input){${sessionFields}}}`;
const me = `query($application:LoginApplication!){me(application:$application){id}}`;

const accessSecret = Buffer.alloc(32, 1).toString("base64url");
const oldPassword = "synthetic-old-password-12";
const newPassword = "synthetic-new-password-34";

type Seeded = {
  id: string;
  email: string;
  currentToken: string;
  otherToken: string;
};

describe(op("mutation.changePassword"), () => {
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

  async function mint(userId: string, sessionId: string) {
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT({ sid: sessionId, app: "CUSTOMER" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(userId)
      .setJti(randomUUID())
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(Buffer.from(accessSecret, "base64url"));
  }

  async function seedCustomer(password = oldPassword): Promise<Seeded> {
    const id = randomUUID();
    const email = `change-${id}@example.test`;
    const sessions: string[] = [];
    await stack.pool.query(
      'INSERT INTO "IdentityUser" (id,email,"displayName",roles) VALUES($1,$2,$3,$4)',
      [id, email, "Synthetic Customer", ["CUSTOMER"]],
    );
    await stack.pool.query(
      'INSERT INTO "IdentityCredential" ("userId","passwordHash") VALUES($1,$2)',
      [
        id,
        await hash(password, {
          type: argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 1,
          hashLength: 32,
        }),
      ],
    );
    for (let index = 0; index < 2; index++) {
      const sessionId = randomUUID();
      sessions.push(sessionId);
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
    }
    return {
      id,
      email,
      currentToken: await mint(id, sessions[0]!),
      otherToken: await mint(id, sessions[1]!),
    };
  }

  const change = (token: string, input: Record<string, unknown>) =>
    api.http
      .withUser(token)
      .query<{ changePassword: string | null }>(document, input);

  const sessionActive = async (token: string) => {
    const result = await api.http
      .withUser(token)
      .query(me, { application: "CUSTOMER" });
    return result.errors.length === 0 && result.data?.me != null;
  };

  it("changes the credential, keeps the caller's session and revokes the others", async () => {
    const customer = await seedCustomer();
    const result = await change(customer.currentToken, {
      oldPassword,
      newPassword,
    });
    expect(result.errors).toEqual([]);
    expect(typeof result.data?.changePassword).toBe("string");
    expect(result.data?.changePassword).toBeTruthy();

    const stored = await stack.pool.query(
      'SELECT "passwordHash" FROM "IdentityCredential" WHERE "userId" = $1',
      [customer.id],
    );
    await expect(
      verify(stored.rows[0].passwordHash, newPassword),
    ).resolves.toBe(true);
    await expect(
      verify(stored.rows[0].passwordHash, oldPassword),
    ).resolves.toBe(false);

    const signedIn = await api.http.query(login, {
      input: {
        email: customer.email,
        password: newPassword,
        application: "CUSTOMER",
      },
    });
    expect(signedIn.errors).toEqual([]);
    expect(signedIn.data?.loginPassword).toBeTruthy();

    expect(await sessionActive(customer.currentToken)).toBe(true);
    expect(await sessionActive(customer.otherToken)).toBe(false);
  });

  it("answers null for a wrong old password and changes nothing", async () => {
    const customer = await seedCustomer();
    const before = await stack.pool.query(
      'SELECT "passwordHash" FROM "IdentityCredential" WHERE "userId" = $1',
      [customer.id],
    );
    const result = await change(customer.currentToken, {
      oldPassword: "synthetic-wrong-password-99",
      newPassword,
    });
    expect(result.data?.changePassword ?? null).toBeNull();
    expect(result.errors).toEqual([]);
    const after = await stack.pool.query(
      'SELECT "passwordHash" FROM "IdentityCredential" WHERE "userId" = $1',
      [customer.id],
    );
    expect(after.rows).toEqual(before.rows);
    expect(await sessionActive(customer.otherToken)).toBe(true);
  });

  it("rejects a new password that fails the shared policy", async () => {
    const customer = await seedCustomer();
    const result = await change(customer.currentToken, {
      oldPassword,
      newPassword: "short",
    });
    expect(result.data?.changePassword ?? null).toBeNull();
    expect(result.errors.map((error) => error.extensions.code)).toEqual([
      "BAD_USER_INPUT",
    ]);
  });

  it("refuses an anonymous caller", async () => {
    const result = await api.http.query(document, {
      oldPassword,
      newPassword,
    });
    expect(result.data?.changePassword ?? null).toBeNull();
    expect(result.errors.map((error) => error.extensions.code)).toEqual([
      "AUTHENTICATION_FAILED",
    ]);
  });
});
