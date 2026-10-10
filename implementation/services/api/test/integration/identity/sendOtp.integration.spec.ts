import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

// Exact pinned documents. Web/app send only the target; the rider sends a
// client-chosen otp that the server must ignore.
const webEmail = doc(
  "enatega-multivendor-web",
  "lib/api/graphql/mutations/auth/index.ts",
  "SENT_OTP_TO_EMAIL",
);
const webPhone = doc(
  "enatega-multivendor-web",
  "lib/api/graphql/mutations/auth/index.ts",
  "SENT_OTP_TO_PHONE",
);
const riderEmail = doc(
  "enatega-multivendor-rider",
  "lib/apollo/mutations/authentication.mutation.ts",
  "sendOtpToEmail",
);

describe(op("mutation.sendOtpToEmail"), () => {
  let stack: Stack;
  let api: Api;

  beforeAll(async () => {
    stack = await startStack();
    await stack.reset();
    api = await startApi(stack);
  });
  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  const send = (document: string, variables: Record<string, unknown>) =>
    api.http.query<{ sendOtpToEmail?: { result: string | null } | null }>(
      document,
      variables,
    );

  const delivered = async (recipient: string) => {
    const rows = await stack.pool.query(
      'SELECT channel, subject, body FROM "DevOutbox" WHERE recipient = $1 ORDER BY "createdAt" DESC',
      [recipient],
    );
    return rows.rows;
  };

  const challenges = async (channel?: string) =>
    (
      await stack.pool.query(
        `SELECT "purpose", "channel", "targetHash", "codeHash", "attempts", "consumedAt", "expiresAt"
           FROM "IdentityVerificationChallenge"
          ${channel ? 'WHERE "channel" = $1' : ""}
          ORDER BY "createdAt" DESC`,
        channel ? [channel] : [],
      )
    ).rows;

  it("stores a server-generated challenge and delivers it to the dev outbox", async () => {
    const email = `otp-${randomUUID()}@example.test`;
    const result = await send(webEmail, { email });
    expect(result.errors).toEqual([]);
    expect(result.data?.sendOtpToEmail?.result).toBeTruthy();

    const [challenge] = await challenges("EMAIL");
    expect(challenge).toMatchObject({
      purpose: "VERIFY",
      channel: "EMAIL",
      attempts: 0,
      consumedAt: null,
    });
    expect(challenge.targetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      new Date(challenge.expiresAt).getTime() - Date.now(),
    ).toBeGreaterThan(4 * 60_000);

    const messages = await delivered(email);
    expect(messages).toHaveLength(1);
    expect(messages[0].channel).toBe("EMAIL");
    expect(messages[0].body).toMatch(/\b\d{6}\b/);
  });

  it("never stores or delivers the rider's client-chosen code", async () => {
    const email = `rider-otp-${randomUUID()}@example.test`;
    const clientCode = "123456";
    const result = await send(riderEmail, { email, otp: clientCode });
    expect(result.errors).toEqual([]);

    const messages = await delivered(email);
    expect(messages).toHaveLength(1);
    // The delivered code is the server's, not the caller's.
    expect(messages[0].body).not.toContain(clientCode);

    const [challenge] = await challenges("EMAIL");
    expect(challenge.consumedAt).toBeNull();
  });

  // Tagged with its own root: this describe block covers both send roots.
  it(`${op("mutation.sendOtpToPhoneNumber")} serves the pinned phone document over the SMS channel`, async () => {
    const phone = `+6012${Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0")}`;
    const result = await api.http.query<{
      sendOtpToPhoneNumber?: { result: string | null } | null;
    }>(webPhone, { phone });
    expect(result.errors).toEqual([]);
    const [challenge] = await challenges("SMS");
    expect(challenge).toMatchObject({ channel: "SMS", purpose: "VERIFY" });
    const messages = await delivered(phone);
    expect(messages[0].body).toMatch(/\b\d{6}\b/);
  });

  it("bounds resends of the same target with the cooldown", async () => {
    const email = `cooldown-${randomUUID()}@example.test`;
    const first = await send(webEmail, { email });
    expect(first.errors).toEqual([]);
    const second = await send(webEmail, { email });
    expect(second.data?.sendOtpToEmail ?? null).toBeNull();
    expect(second.errors.map((error) => error.extensions.code)).toEqual([
      "RATE_LIMITED",
    ]);
    expect(await delivered(email)).toHaveLength(1);
  });

  it("rejects malformed or ambiguous targets without a challenge or a delivery", async () => {
    for (const [document, variables] of [
      [webEmail, { email: "not-an-email" }],
      [webPhone, { phone: "0123456789" }],
      [webEmail, {}],
    ] as const) {
      const result = await api.http.query(document, variables);
      expect(result.data?.sendOtpToEmail ?? null).toBeNull();
      expect(result.data?.sendOtpToPhoneNumber ?? null).toBeNull();
      expect(result.errors.map((error) => error.extensions.code)).toEqual([
        "BAD_USER_INPUT",
      ]);
    }
  });
});
