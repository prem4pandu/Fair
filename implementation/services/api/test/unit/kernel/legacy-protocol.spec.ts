import { EventEmitter } from "node:events";
import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { LegacySubscriptionSession } from "../../../src/kernel/ws/legacy-protocol.js";

class FakeSocket extends EventEmitter {
  readonly sent: unknown[] = [];
  closed: number | null = null;
  readyState = 1;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown);
  }

  close(code: number): void {
    this.closed = code;
  }
}

async function* ticks() {
  yield { tick: 1 };
  yield { tick: 2 };
}

const schema = buildSchema(
  "type Query { a: Int } type Subscription { tick: Int }",
);
schema.getSubscriptionType()!.getFields().tick.subscribe = () => ticks();
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("legacy subscriptions-transport-ws session", () => {
  it("acks connection_init and passes its payload to onConnect", async () => {
    const socket = new FakeSocket();
    let params: unknown;
    new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async (value) => {
        params = value;
        return { ok: true };
      },
      keepAliveMs: 0,
    });

    socket.emit(
      "message",
      JSON.stringify({
        type: "connection_init",
        payload: { authorization: "" },
      }),
    );
    await flush();

    expect(params).toEqual({ authorization: "" });
    expect(socket.sent).toEqual([{ type: "connection_ack" }]);
  });

  it("streams data messages then completes a started operation", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async () => ({}),
      keepAliveMs: 0,
    });

    socket.emit("message", JSON.stringify({ type: "connection_init" }));
    socket.emit(
      "message",
      JSON.stringify({
        type: "start",
        id: "1",
        payload: { query: "subscription { tick }" },
      }),
    );
    await flush();

    expect(socket.sent).toEqual([
      { type: "connection_ack" },
      { type: "data", id: "1", payload: { data: { tick: 1 } } },
      { type: "data", id: "1", payload: { data: { tick: 2 } } },
      { type: "complete", id: "1" },
    ]);
  });

  it("returns validation errors using an error message", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async () => ({}),
      keepAliveMs: 0,
    });
    socket.emit("message", JSON.stringify({ type: "connection_init" }));
    socket.emit(
      "message",
      JSON.stringify({
        type: "start",
        id: "2",
        payload: { query: "subscription { nope }" },
      }),
    );
    await flush();

    expect(socket.sent[1]).toMatchObject({ type: "error", id: "2" });
  });

  it("rejects start before connection_init", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async () => ({}),
      keepAliveMs: 0,
    });
    socket.emit(
      "message",
      JSON.stringify({
        type: "start",
        id: "1",
        payload: { query: "subscription { tick }" },
      }),
    );
    await flush();

    expect(socket.sent[0]).toMatchObject({ type: "error", id: "1" });
  });

  it("sends connection_error and closes when onConnect rejects", async () => {
    const socket = new FakeSocket();
    new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async () => {
        throw new Error("Invalid token");
      },
      keepAliveMs: 0,
    });
    socket.emit("message", JSON.stringify({ type: "connection_init" }));
    await flush();

    expect(socket.sent[0]).toEqual({
      type: "connection_error",
      payload: { message: "Invalid token" },
    });
    expect(socket.closed).toBe(1011);
  });

  it("sends keep-alive messages after acknowledgement", async () => {
    const socket = new FakeSocket();
    const session = new LegacySubscriptionSession(socket as never, schema, {
      onConnect: async () => ({}),
      keepAliveMs: 5,
    });
    socket.emit("message", JSON.stringify({ type: "connection_init" }));
    await flush();

    expect(socket.sent).toContainEqual({ type: "ka" });
    session.dispose();
  });
});
