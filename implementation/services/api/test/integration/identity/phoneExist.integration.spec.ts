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
  "PHONE_EXISTS",
);

const knownPhone = "+60123456789";

describe(op("mutation.phoneExist"), () => {
  let stack: Stack;
  let api: Api;

  beforeAll(async () => {
    stack = await startStack();
    await stack.reset();
    await stack.pool.query(
      'INSERT INTO "IdentityUser" (id,email,"displayName",roles,phone) VALUES($1,$2,$3,$4,$5)',
      [
        randomUUID(),
        `phone-${randomUUID()}@example.test`,
        "Known Phone",
        ["CUSTOMER"],
        knownPhone,
      ],
    );
    api = await startApi(stack);
  });
  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  const ask = (phone: unknown) =>
    api.http.query<{ phoneExist: boolean | null }>(document, { phone });

  it("answers true for a registered number and false for an unknown one", async () => {
    const present = await ask(knownPhone);
    expect(present.errors).toEqual([]);
    expect(present.data?.phoneExist).toBe(true);

    const absent = await ask("+60199999999");
    expect(absent.errors).toEqual([]);
    expect(absent.data?.phoneExist).toBe(false);
  });

  it("normalizes separators before the lookup", async () => {
    const result = await ask("+60 12-345 6789");
    expect(result.errors).toEqual([]);
    expect(result.data?.phoneExist).toBe(true);
  });

  it("rejects a malformed number without revealing whether it exists", async () => {
    for (const value of ["not-a-phone", "0123456789", "+123", "", undefined]) {
      const result = await ask(value);
      expect(result.data?.phoneExist ?? null).toBeNull();
      expect(result.errors.map((error) => error.extensions.code)).toEqual([
        "BAD_USER_INPUT",
      ]);
    }
  });

  it("requires the public-access handshake like every other non-handshake operation", async () => {
    const denied = await api.http.raw({
      query: document,
      variables: { phone: knownPhone },
    });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      errors: [{ extensions: { code: "PUBLIC_ACCESS_DENIED" } }],
    });
  });

  it("bounds repeated probing of the same number", async () => {
    const codes: string[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await ask(knownPhone);
      for (const error of result.errors) codes.push(error.extensions.code);
    }
    expect(codes).toContain("RATE_LIMITED");
  });

  it("keeps the number unique across accounts", async () => {
    await expect(
      stack.pool.query(
        'INSERT INTO "IdentityUser" (id,email,"displayName",roles,phone) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          `duplicate-${randomUUID()}@example.test`,
          "Duplicate Phone",
          ["CUSTOMER"],
          knownPhone,
        ],
      ),
    ).rejects.toThrow();
  });

  it("never writes on a lookup", async () => {
    const before = await stack.pool.query(
      'SELECT count(*)::int AS n FROM "IdentityUser"',
    );
    await ask("+60188888888");
    const after = await stack.pool.query(
      'SELECT count(*)::int AS n FROM "IdentityUser"',
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
