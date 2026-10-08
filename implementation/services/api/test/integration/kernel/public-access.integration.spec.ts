import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Kind, parse, type SelectionSetNode } from "graphql";
import { PublicAccessTokens } from "../../../src/kernel/public-access/token.js";
import { handshakeDocuments } from "../../support/documents.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

const secret = Buffer.alloc(32, 7).toString("base64url");
const serviceInfo = "{ serviceInfo { name status } }";

const decodePayload = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));

/** The leaf fields a MetricsGeneral document actually selects. */
const selectedMetrics = (query: string): string[] => {
  const document = parse(query);
  const selections: string[] = [];
  const walk = (selectionSet: SelectionSetNode): void => {
    for (const selection of selectionSet.selections) {
      if (selection.kind !== Kind.FIELD) continue;
      if (selection.selectionSet) walk(selection.selectionSet);
      else selections.push(selection.name.value);
    }
  };
  for (const definition of document.definitions)
    if (definition.kind === Kind.OPERATION_DEFINITION)
      walk(definition.selectionSet);
  return selections.sort();
};

describe("public-access handshake over HTTP", () => {
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

  const expectDenied = (
    body: { status: number; body: unknown },
    message: string,
  ) => {
    expect(body.status).toBe(403);
    expect(body.body).toEqual({
      data: null,
      errors: [{ message, extensions: { code: "PUBLIC_ACCESS_DENIED" } }],
    });
  };

  it("serves every pinned client's exact MetricsGeneral document with a nonce", async () => {
    const documents = handshakeDocuments();
    expect(documents.length).toBeGreaterThanOrEqual(6);
    expect(
      [
        ...new Set(documents.flatMap((item) => selectedMetrics(item.text))),
      ].sort(),
    ).toEqual([
      "excellence",
      "experience",
      "haha",
      "hehe",
      "huhu",
      "rider",
      "skydiver",
      "topgun",
      "turu",
      "yoyo",
    ]);

    for (const document of documents) {
      const nonce = `nonce-${document.app}-${document.line}`;
      const response = await api.http.raw(
        { query: document.text, operationName: "MetricsGeneral" },
        { nonce },
      );
      expect({ status: response.status, app: document.app }).toEqual({
        status: 200,
        app: document.app,
      });

      const metrics = response.body?.data?.metricsGeneral as Record<
        string,
        unknown
      >;
      // Every field the document selects must resolve; the eight decoy fields
      // included, or the client handshake breaks.
      expect(Object.keys(metrics).sort()).toEqual(
        selectedMetrics(document.text),
      );
      for (const [field, value] of Object.entries(metrics))
        expect({ field, type: typeof value }).toEqual({
          field,
          type: "string",
        });
      expect(typeof metrics.experience).toBe("string");
      expect(typeof metrics.hehe).toBe("string");

      const payload = decodePayload(metrics.experience as string);
      expect(payload.nonce).toBe(nonce);
      expect(payload.typ).toBe("public");
      expect(new Date(metrics.hehe as string).toISOString()).toBe(metrics.hehe);
      expect(Date.parse(metrics.hehe as string)).toBe(
        (payload.exp as number) * 1000,
      );

      // The minted token is bound to the nonce it was minted for.
      const tokens = new PublicAccessTokens(secret, 1);
      expect(await tokens.verify(metrics.experience as string, nonce)).toEqual({
        ok: true,
      });
      expect(
        await tokens.verify(metrics.experience as string, "another-nonce"),
      ).toEqual({ ok: false, message: "Unauthorized: fingerprint mismatch" });
    }
  });

  it("accepts re-minting for the same nonce without revoking earlier tokens", async () => {
    const document = handshakeDocuments()[0]!;
    const nonce = "stable-device-nonce";
    const first = await api.http.raw({ query: document.text }, { nonce });
    const second = await api.http.raw({ query: document.text }, { nonce });
    const tokens = new PublicAccessTokens(secret, 1);
    for (const token of [
      first.body.data.metricsGeneral.experience,
      second.body.data.metricsGeneral.experience,
    ])
      expect(await tokens.verify(token, nonce)).toEqual({ ok: true });
  });

  it("returns the S9 envelope when the nonce header is missing", async () => {
    const document = handshakeDocuments()[0]!;
    expectDenied(
      await api.http.raw({ query: document.text }, {}),
      "Unauthorized: nonce header missing",
    );
  });

  it("requires bop-auth and nonce for every other operation", async () => {
    expectDenied(
      await api.http.raw({ query: serviceInfo }, { nonce: "n" }),
      "Unauthorized: token missing",
    );
    expectDenied(
      await api.http.raw({ query: serviceInfo }, { "bop-auth": "Bearer t" }),
      "Unauthorized: nonce header missing",
    );
  });

  it("rejects an invalid, mismatched or expired public token with HTTP 403", async () => {
    expectDenied(
      await api.http.raw(
        { query: serviceInfo },
        { nonce: "n", "bop-auth": "Bearer not-a-jwt" },
      ),
      "Unauthorized: invalid token",
    );

    const tokens = new PublicAccessTokens(secret, 900);
    const valid = await tokens.mint("other-nonce");
    expectDenied(
      await api.http.raw(
        { query: serviceInfo },
        { nonce: "n", "bop-auth": `Bearer ${valid.experience}` },
      ),
      "Unauthorized: fingerprint mismatch",
    );

    const expired = await new PublicAccessTokens(secret, 900, {
      now: () => new Date("2026-10-08T00:00:00Z"),
    }).mint("expired-nonce");
    expectDenied(
      await api.http.raw(
        { query: serviceInfo },
        { nonce: "expired-nonce", "bop-auth": `Bearer ${expired.experience}` },
      ),
      "Unauthorized: jwt expired",
    );
  });

  it("serves a protected operation with a valid token and nonce pair", async () => {
    const nonce = "authorised-device";
    const minted = await api.http.raw(
      { query: handshakeDocuments()[0]!.text },
      { nonce },
    );
    const response = await api.http.raw(
      { query: serviceInfo },
      {
        nonce,
        "bop-auth": `Bearer ${minted.body.data.metricsGeneral.experience}`,
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.serviceInfo).toEqual({
      name: expect.any(String),
      status: "ready",
    });
  });

  it("rejects the x-skip-public-auth header the store and rider send on the mint", async () => {
    // The header is a client-side interceptor flag the server must tolerate,
    // never a server-side bypass (REV-1 blocker; reference/01 §2.5 S2).
    expectDenied(
      await api.http.raw(
        { query: serviceInfo },
        { "x-skip-public-auth": "true" },
      ),
      "Unauthorized: token missing",
    );
  });

  it("rejects GET and batched GraphQL bodies without reaching the resolvers", async () => {
    const viaGet = await request(api.app.getHttpServer())
      .get("/graphql")
      .query({ query: serviceInfo });
    expect(viaGet.status).toBe(405);
    expect(viaGet.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");

    const batched = await api.http.raw(
      [{ query: serviceInfo }] as unknown as object,
      {},
    );
    expect(batched.status).toBe(400);
    expect(batched.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
  });
});
