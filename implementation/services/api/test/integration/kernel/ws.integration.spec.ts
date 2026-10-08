import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GraphQLSchemaHost } from "@nestjs/graphql";
import WebSocket from "ws";
import { UserTokens } from "../../../src/kernel/auth/tokens.js";
import { doc } from "../../support/documents.js";
import { openFrameClient, type FrameClient } from "../../support/ws.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";

const storeDocument = doc(
  "enatega-multivendor-store",
  "lib/apollo/subscriptions.ts",
  "SUBSCRIBE_PLACE_ORDER",
);

type Observed = {
  args: Record<string, unknown>;
  context: {
    nonce: string;
    transport: string;
    ready: () => Promise<boolean>;
  };
  principal: unknown;
};

describe("WebSocket subscription transport", () => {
  let stack: Stack;
  let api: Api;
  let userToken: string;
  const userId = "018f0000-0000-7000-8000-0000000000a1";
  const sessionId = "018f0000-0000-7000-8000-0000000000b1";
  const observed: Observed[] = [];

  const legacyClient = (authorization: string): Promise<FrameClient> =>
    openFrameClient(api.wsUrl, "graphql-ws", {
      authorization,
      nonce: "ws-nonce",
      "x-platform": "ios",
    });

  const start = (client: FrameClient, id: string, restaurant: string): void =>
    client.send({
      type: "start",
      id,
      payload: { query: storeDocument, variables: { restaurant } },
    });

  const dataFor = (client: FrameClient, id: string): unknown => {
    const frame = client.frames.find(
      (candidate) => candidate.type === "data" && candidate.id === id,
    );
    return (frame?.payload as { data: Record<string, unknown> } | undefined)
      ?.data;
  };

  beforeAll(async () => {
    stack = await startStack();
    await stack.pool.query(
      'INSERT INTO "IdentityUser" (id, email, "displayName", roles) VALUES ($1, $2, $3, $4)',
      [userId, "ws-tester@example.test", "WS Tester", ["CUSTOMER"]],
    );
    await stack.pool.query(
      `INSERT INTO "IdentitySessionFamily" (id, "userId", application, "expiresAt")
       VALUES ($1, $2, 'CUSTOMER', now() + interval '1 hour')`,
      [sessionId, userId],
    );
    await stack.pool.query(
      'INSERT INTO "IdentityRefreshSession" (id, "familyId", "userId", "tokenHash") VALUES ($1, $2, $3, $4)',
      [sessionId, sessionId, userId, "a".repeat(64)],
    );
    userToken = (
      await new UserTokens(
        Buffer.alloc(32, 1).toString("base64url"),
        900,
      ).issue({ sub: userId, typ: "CUSTOMER", sid: sessionId })
    ).token;

    api = await startApi(stack);

    // No domain subscription is implemented yet, so the real app schema's
    // subscription field is backed by a controlled source. Everything else —
    // endpoint, protocol negotiation, context factory, framing, error
    // formatting — is the real kernel transport.
    const schema = api.app.get(GraphQLSchemaHost).schema;
    const field = schema
      .getSubscriptionType()!
      .getFields().subscribePlaceOrder!;
    field.resolve = (event: unknown) => event;
    field.subscribe = async function* (
      _source: unknown,
      args: Record<string, unknown>,
      context: Observed["context"] & { auth: () => Promise<unknown> },
    ) {
      const principal = await context.auth();
      observed.push({ args, context, principal });
      yield { origin: String(args.restaurant), userId, order: null };
      if (args.restaurant === "complete") return;
      await new Promise(() => {});
    };

    // A resolver that fails internally must never leak its raw message over
    // either WebSocket protocol.
    schema.getQueryType()!.getFields().serviceInfo!.resolve = () => {
      throw new Error("internal detail: postgres://secret@host/db");
    };
  });

  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  it("delivers a subscription with the legacy subscriptions-transport-ws frames", async () => {
    const client = await legacyClient(`Bearer ${userToken}`);
    // The legacy clients drop a socket after 30s without a keep-alive ping.
    await client.take((frame) => frame.type === "ka");

    start(client, "store-smoke", "complete");
    await client.take(
      (frame) => frame.type === "data" && frame.id === "store-smoke",
    );
    expect(dataFor(client, "store-smoke")).toEqual({
      subscribePlaceOrder: { origin: "complete", userId, order: null },
    });
    await client.take(
      (frame) => frame.type === "complete" && frame.id === "store-smoke",
    );

    client.send({ type: "connection_terminate" });
    await expect(client.closed).resolves.toMatchObject({ code: 1000 });

    const last = observed.at(-1)!;
    expect(last.principal).toEqual({
      userId,
      type: "CUSTOMER",
      sessionId,
      permissions: [],
      restaurantIds: [],
      vendorId: null,
      riderId: null,
    });
    expect(last.context.nonce).toBe("ws-nonce");
    expect(last.context.transport).toBe("ws");
    expect(last.args).toEqual({ restaurant: "complete" });
  });

  it("stops a legacy subscription on the client stop frame", async () => {
    const client = await legacyClient(`Bearer ${userToken}`);
    start(client, "capture", "stream");
    await client.take(
      (frame) => frame.type === "data" && frame.id === "capture",
    );
    client.send({ type: "stop", id: "capture" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      client.frames.filter(
        (frame) => frame.type === "data" && frame.id === "capture",
      ),
    ).toHaveLength(1);
    client.send({ type: "connection_terminate" });
    await client.closed;
  });

  it("accepts anonymous sockets and authorises each subscription separately", async () => {
    const client = await legacyClient("");
    start(client, "anonymous", "complete");
    await client.take(
      (frame) => frame.type === "data" && frame.id === "anonymous",
    );
    client.send({ type: "connection_terminate" });
    await client.closed;
    expect(observed.at(-1)!.principal).toBeNull();
  });

  it("re-validates the session for every subscription on a live socket", async () => {
    const client = await legacyClient(`Bearer ${userToken}`);
    start(client, "before-revocation", "complete");
    await client.take(
      (frame) => frame.type === "data" && frame.id === "before-revocation",
    );

    await stack.pool.query(
      'UPDATE "IdentitySessionFamily" SET "revokedAt" = now() WHERE id = $1',
      [sessionId],
    );
    start(client, "after-revocation", "complete");
    const rejected = await client.take(
      (frame) => frame.type === "error" && frame.id === "after-revocation",
    );
    expect(
      (rejected.payload as { extensions?: { code?: string } }).extensions?.code,
    ).toBe("INVALID_TOKEN");
    expect(dataFor(client, "after-revocation")).toBeUndefined();

    client.send({ type: "connection_terminate" });
    await client.closed;

    await stack.pool.query(
      'UPDATE "IdentitySessionFamily" SET "revokedAt" = NULL WHERE id = $1',
      [sessionId],
    );
  });

  it("serves a query needing the WS context ready() over both protocols", async () => {
    const query = "{ serviceInfo { name status } }";
    const legacy = await legacyClient("");
    legacy.send({
      type: "start",
      id: "ready",
      payload: { query },
    });
    const data = await legacy.take(
      (frame) => frame.type === "data" && frame.id === "ready",
    );
    expect(
      (data.payload as { data: unknown; errors?: unknown[] }).errors,
    ).toBeUndefined();
    expect(dataFor(legacy, "ready")).toEqual({
      serviceInfo: { name: expect.any(String), status: "ready" },
    });
    legacy.send({ type: "connection_terminate" });
    await legacy.closed;

    const modern = await openFrameClient(api.wsUrl, "graphql-transport-ws", {});
    modern.send({
      type: "subscribe",
      id: "ready-modern",
      payload: { query },
    });
    const next = await modern.take(
      (frame) => frame.type === "next" && frame.id === "ready-modern",
    );
    expect(
      (next.payload as { data: { serviceInfo: unknown } }).data.serviceInfo,
    ).toEqual({ name: expect.any(String), status: "ready" });
    modern.close();
    await modern.closed;
  });

  it("masks internal resolver failures on both protocols", async () => {
    const query = "{ serviceInfo { name } }";
    const legacy = await legacyClient("");
    legacy.send({ type: "start", id: "leak", payload: { query } });
    const frame = await legacy.take(
      (candidate) => candidate.type === "data" && candidate.id === "leak",
    );
    const payload = frame.payload as { errors?: { message: string }[] };
    expect(payload.errors?.[0]?.message).toBe("GraphQL request failed");
    expect(JSON.stringify(frame)).not.toContain("postgres://secret");
    legacy.send({ type: "connection_terminate" });
    await legacy.closed;

    const modern = await openFrameClient(api.wsUrl, "graphql-transport-ws", {});
    modern.send({
      type: "subscribe",
      id: "leak-modern",
      payload: { query },
    });
    const next = await modern.take(
      (candidate) =>
        candidate.type === "next" && candidate.id === "leak-modern",
    );
    expect(
      (next.payload as { errors?: { message: string }[] }).errors?.[0]?.message,
    ).toBe("GraphQL request failed");
    expect(JSON.stringify(next)).not.toContain("postgres://secret");
    modern.close();
    await modern.closed;
  });

  it("verifies a supplied bop-auth token and ignores an empty one", async () => {
    const forged = await openFrameClient(api.wsUrl, "graphql-ws", {
      authorization: "",
      nonce: "n",
      "bop-auth": "Bearer not-a-real-token",
    }).then(
      (client) => {
        client.close();
        return "acknowledged";
      },
      (error: Error) => error.message,
    );
    expect(forged).not.toBe("acknowledged");

    // Store and rider send bop-auth: "" after a failed mint.
    const empty = await legacyClientWith(api.wsUrl, "graphql-ws", {
      authorization: "",
      nonce: "n",
      "bop-auth": "",
    });
    empty.send({ type: "connection_terminate" });
    await empty.closed;
  });

  it("delivers a subscription over graphql-transport-ws", async () => {
    const client = await openFrameClient(api.wsUrl, "graphql-transport-ws", {
      authorization: `Bearer ${userToken}`,
    });
    client.send({ type: "ping" });
    await client.take((frame) => frame.type === "pong");

    client.send({
      type: "subscribe",
      id: "modern-1",
      payload: { query: storeDocument, variables: { restaurant: "complete" } },
    });
    const next = await client.take(
      (frame) => frame.type === "next" && frame.id === "modern-1",
    );
    expect(
      (next.payload as { data: { subscribePlaceOrder: unknown } }).data
        .subscribePlaceOrder,
    ).toEqual({ origin: "complete", userId, order: null });
    await client.take(
      (frame) => frame.type === "complete" && frame.id === "modern-1",
    );
    client.close();
    await client.closed;
    expect(observed.at(-1)!.principal).toMatchObject({ userId });
  });

  it("destroys an upgrade that speaks neither protocol", async () => {
    const socket = new WebSocket(api.wsUrl);
    const closed = await new Promise<boolean>((resolve) => {
      socket.on("close", () => resolve(true));
      socket.on("error", () => resolve(true));
      setTimeout(() => resolve(false), 2_000);
    });
    expect(closed).toBe(true);
  });
});

const legacyClientWith = (
  url: string,
  protocol: "graphql-ws" | "graphql-transport-ws",
  params: Record<string, unknown>,
) => openFrameClient(url, protocol, params);
