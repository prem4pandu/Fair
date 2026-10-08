import { EventEmitter } from "node:events";
import { buildSchema, type ExecutionResult } from "graphql";
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

  it("cancels an operation stopped while subscription setup is pending", async () => {
    let release!: () => void;
    const setup = new Promise<void>((resolve) => {
      release = resolve;
    });
    let returned = 0;
    const delayedSchema = buildSchema(
      "type Query { a: Int } type Subscription { tick: Int }",
    );
    delayedSchema.getSubscriptionType()!.getFields().tick.subscribe =
      async () => {
        await setup;
        return {
          next: () => new Promise<IteratorResult<ExecutionResult>>(() => {}),
          return: async () => {
            returned += 1;
            return { value: undefined, done: true };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      };
    const socket = new FakeSocket();
    const session = new LegacySubscriptionSession(
      socket as never,
      delayedSchema,
      { onConnect: async () => ({}), keepAliveMs: 0 },
    );
    socket.emit("message", JSON.stringify({ type: "connection_init" }));
    socket.emit(
      "message",
      JSON.stringify({
        type: "start",
        id: "pending",
        payload: { query: "subscription { tick }" },
      }),
    );
    await flush();
    socket.emit("message", JSON.stringify({ type: "stop", id: "pending" }));
    release();
    await flush();

    expect(returned).toBe(1);
    expect(socket.sent).toEqual([{ type: "connection_ack" }]);
    await session.disposeAsync();
  });

  it("cancels a pending operation when the session is disposed", async () => {
    let release!: () => void;
    const setup = new Promise<void>((resolve) => {
      release = resolve;
    });
    let returned = 0;
    const delayedSchema = buildSchema(
      "type Query { a: Int } type Subscription { tick: Int }",
    );
    delayedSchema.getSubscriptionType()!.getFields().tick.subscribe =
      async () => {
        await setup;
        return {
          next: () => new Promise<IteratorResult<ExecutionResult>>(() => {}),
          return: async () => {
            returned += 1;
            return { value: undefined, done: true };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      };
    const socket = new FakeSocket();
    const session = new LegacySubscriptionSession(
      socket as never,
      delayedSchema,
      { onConnect: async () => ({}), keepAliveMs: 0 },
    );
    socket.emit("message", JSON.stringify({ type: "connection_init" }));
    socket.emit(
      "message",
      JSON.stringify({
        type: "start",
        id: "pending",
        payload: { query: "subscription { tick }" },
      }),
    );
    await flush();
    const disposed = session.disposeAsync();
    release();
    await disposed;
    await flush();

    expect(returned).toBe(1);
    expect(socket.sent).toEqual([{ type: "connection_ack" }]);
  });

  it("keeps only the newest operation when an id is started twice", async () => {
    let release!: () => void;
    const firstSetup = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let firstReturned = 0;
    const duplicateSchema = buildSchema(
      "type Query { a: Int } type Subscription { tick: Int }",
    );
    duplicateSchema.getSubscriptionType()!.getFields().tick.subscribe =
      async () => {
        calls += 1;
        if (calls === 1) {
          await firstSetup;
          return {
            next: () => new Promise<IteratorResult<ExecutionResult>>(() => {}),
            return: async () => {
              firstReturned += 1;
              return { value: undefined, done: true };
            },
            [Symbol.asyncIterator]() {
              return this;
            },
          };
        }
        return ticks();
      };
    const socket = new FakeSocket();
    const session = new LegacySubscriptionSession(
      socket as never,
      duplicateSchema,
      { onConnect: async () => ({}), keepAliveMs: 0 },
    );
    socket.emit("message", JSON.stringify({ type: "connection_init" }));
    socket.emit(
      "message",
      JSON.stringify({
        type: "start",
        id: "same",
        payload: { query: "subscription { tick }" },
      }),
    );
    await flush();
    socket.emit(
      "message",
      JSON.stringify({
        type: "start",
        id: "same",
        payload: { query: "subscription { tick }" },
      }),
    );
    await flush();
    release();
    await flush();

    expect(firstReturned).toBe(1);
    expect(socket.sent).toEqual([
      { type: "connection_ack" },
      { type: "data", id: "same", payload: { data: { tick: 1 } } },
      { type: "data", id: "same", payload: { data: { tick: 2 } } },
      { type: "complete", id: "same" },
    ]);
    await session.disposeAsync();
  });
});
