import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

// The exact document the pinned customer web and app clients send.
const document = doc(
  "enatega-multivendor-web",
  "lib/api/graphql/mutations/auth/index.ts",
  "EMAIL_EXISTS",
);

describe(op("mutation.emailExist"), () => {
  let stack: Stack;
  let api: Api;
  const known = `known-${randomUUID()}@example.test`;

  beforeAll(async () => {
    stack = await startStack();
    await stack.reset();
    await stack.pool.query(
      'INSERT INTO "IdentityUser" (id,email,"displayName",roles) VALUES($1,$2,$3,$4)',
      [randomUUID(), known, "Known Customer", ["CUSTOMER"]],
    );
    api = await startApi(stack);
  });
  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  const ask = (email: unknown) =>
    api.http.query<{ emailExist: boolean | null }>(document, { email });

  it("answers true for an existing account and false for an unknown one", async () => {
    const present = await ask(known);
    expect(present.errors).toEqual([]);
    expect(present.data?.emailExist).toBe(true);

    const absent = await ask(`absent-${randomUUID()}@example.test`);
    expect(absent.errors).toEqual([]);
    expect(absent.data?.emailExist).toBe(false);
  });

  it("normalizes case and surrounding whitespace before the lookup", async () => {
    const result = await ask(`  ${known.toUpperCase()}  `);
    expect(result.errors).toEqual([]);
    expect(result.data?.emailExist).toBe(true);
  });

  it("rejects a malformed address without revealing whether it exists", async () => {
    const result = await ask("not-an-email");
    expect(result.data?.emailExist ?? null).toBeNull();
    expect(result.errors.map((error) => error.extensions.code)).toEqual([
      "BAD_USER_INPUT",
    ]);
  });

  it("requires the public-access handshake like every other non-handshake operation", async () => {
    const denied = await api.http.raw({
      query: document,
      variables: { email: known },
    });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      errors: [{ extensions: { code: "PUBLIC_ACCESS_DENIED" } }],
    });
  });

  it("bounds repeated probing of the same address", async () => {
    const codes: string[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await ask(known);
      for (const error of result.errors) codes.push(error.extensions.code);
    }
    expect(codes).toContain("RATE_LIMITED");
  });

  it("never writes on a lookup", async () => {
    const before = await stack.pool.query(
      'SELECT count(*)::int AS n FROM "IdentityUser"',
    );
    await ask(`count-${randomUUID()}@example.test`);
    const after = await stack.pool.query(
      'SELECT count(*)::int AS n FROM "IdentityUser"',
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
