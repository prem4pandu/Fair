import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

// The exact documents the pinned customer app and customer web send.
const appDocument = doc(
  "enatega-multivendor-app",
  "src/apollo/mutations.js",
  "Deactivate",
);
const webDocument = doc(
  "enatega-multivendor-web",
  "lib/api/graphql/mutations/auth/index.ts",
  "DEACTIVATE_USER",
);

const accessSecret = Buffer.alloc(32, 1).toString("base64url");
const me = `query($application:LoginApplication!){me(application:$application){id}}`;

type Seeded = {
  id: string;
  email: string;
  token: string;
  sessionIds: string[];
};

describe(op("mutation.Deactivate"), () => {
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

  async function mint(
    userId: string,
    sessionId: string,
    app: "CUSTOMER" | "RIDER",
  ) {
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT({ sid: sessionId, app })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(userId)
      .setJti(randomUUID())
      .setIssuer("fairbite-api")
      .setAudience("fairbite-apps")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 300)
      .sign(Buffer.from(accessSecret, "base64url"));
  }

  async function seed(
    app: "CUSTOMER" | "RIDER" = "CUSTOMER",
    sessions = 2,
  ): Promise<Seeded> {
    const id = randomUUID();
    const email = `deactivate-${id}@example.test`;
    await stack.pool.query(
      'INSERT INTO "IdentityUser" (id,email,"displayName",roles) VALUES($1,$2,$3,$4)',
      [id, email, "Synthetic Principal", [app]],
    );
    // CUSTOMER principals are eligible by role alone; the grant table only
    // admits MERCHANT/RIDER/ADMIN.
    if (app !== "CUSTOMER")
      await stack.pool.query(
        'INSERT INTO "IdentityApplicationGrant" ("userId",application) VALUES($1,$2)',
        [id, app],
      );
    const sessionIds: string[] = [];
    for (let index = 0; index < sessions; index++) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      await stack.pool.query(
        `INSERT INTO "IdentitySessionFamily" (id,"userId",application,"expiresAt")
         VALUES ($1,$2,$3, now() + interval '1 hour')`,
        [sessionId, id, app],
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
      token: await mint(id, sessionIds[0]!, app),
      sessionIds,
    };
  }

  const deactivate = (
    token: string | null,
    input: Record<string, unknown>,
    document = appDocument,
  ) =>
    api.http.withUser(token).query<{
      Deactivate: {
        _id: string;
        name: string;
        email: string;
        isActive: boolean;
      } | null;
    }>(document, input);

  const stillAuthenticated = async (
    token: string,
    app: "CUSTOMER" | "RIDER" = "CUSTOMER",
  ) => {
    const result = await api.http
      .withUser(token)
      .query(me, { application: app });
    return result.errors.length === 0 && result.data?.me != null;
  };

  it("deactivates the caller's own account and revokes every session", async () => {
    const principal = await seed();
    const result = await deactivate(principal.token, {
      isActive: false,
      email: principal.email,
    });
    expect(result.errors).toEqual([]);
    // The app document selects only isActive.
    expect(result.data?.Deactivate).toEqual({ isActive: false });
    const stored = await stack.pool.query(
      'SELECT status FROM "IdentityUser" WHERE id = $1',
      [principal.id],
    );
    expect(stored.rows[0].status).toBe("SUSPENDED");
    expect(await stillAuthenticated(principal.token)).toBe(false);
    const audit = await stack.pool.query(
      'SELECT action, outcome FROM "IdentityAuditEvent" WHERE "userId" = $1',
      [principal.id],
    );
    expect(audit.rows).toEqual([{ action: "DEACTIVATE", outcome: "SUCCESS" }]);
  });

  it("serves the pinned customer-web document as well", async () => {
    const principal = await seed();
    const result = await deactivate(
      principal.token,
      { isActive: false, email: principal.email },
      webDocument,
    );
    expect(result.errors).toEqual([]);
    expect(result.data?.Deactivate).toMatchObject({
      _id: principal.id,
      isActive: false,
    });
  });

  it("refuses to touch another account by email", async () => {
    const caller = await seed();
    const victim = await seed();
    const result = await deactivate(caller.token, {
      isActive: false,
      email: victim.email,
    });
    expect(result.data?.Deactivate ?? null).toBeNull();
    expect(result.errors.map((error) => error.extensions.code)).toEqual([
      "FORBIDDEN",
    ]);
    for (const principal of [caller, victim]) {
      const stored = await stack.pool.query(
        'SELECT status FROM "IdentityUser" WHERE id = $1',
        [principal.id],
      );
      expect(stored.rows[0].status).toBe("ACTIVE");
    }
    expect(await stillAuthenticated(victim.token)).toBe(true);
  });

  it("serves the rider application principal", async () => {
    const rider = await seed("RIDER");
    const result = await deactivate(rider.token, {
      isActive: false,
      email: rider.email,
    });
    expect(result.errors).toEqual([]);
    expect(result.data?.Deactivate?.isActive).toBe(false);
  });

  it("reactivates the caller's own active account", async () => {
    const principal = await seed();
    const result = await deactivate(principal.token, {
      isActive: true,
      email: principal.email,
    });
    expect(result.errors).toEqual([]);
    expect(result.data?.Deactivate?.isActive).toBe(true);
    const stored = await stack.pool.query(
      'SELECT status FROM "IdentityUser" WHERE id = $1',
      [principal.id],
    );
    expect(stored.rows[0].status).toBe("ACTIVE");
    expect(await stillAuthenticated(principal.token)).toBe(true);
  });

  it("rejects a non-boolean isActive and an anonymous caller", async () => {
    const principal = await seed();
    const malformed = await deactivate(principal.token, {
      isActive: "false",
      email: principal.email,
    });
    expect(malformed.errors.map((error) => error.extensions.code)).toEqual([
      "BAD_USER_INPUT",
    ]);
    const anonymous = await deactivate(null, {
      isActive: false,
      email: principal.email,
    });
    expect(anonymous.errors.map((error) => error.extensions.code)).toEqual([
      "AUTHENTICATION_FAILED",
    ]);
    expect(await stillAuthenticated(principal.token)).toBe(true);
  });
});
