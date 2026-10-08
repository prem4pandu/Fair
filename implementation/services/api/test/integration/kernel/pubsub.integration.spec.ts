import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisPubSub } from "../../../src/kernel/pubsub.js";
import { startStack, type Stack } from "../../support/stack.js";

let stack: Stack;
let publisher: RedisPubSub;
let subscriber: RedisPubSub;

beforeAll(async () => {
  stack = await startStack();
  publisher = new RedisPubSub(stack.redisUrl);
  subscriber = new RedisPubSub(stack.redisUrl);
});

afterAll(async () => {
  await publisher?.close();
  await subscriber?.close();
  await stack?.release();
});

describe("redis pub/sub", () => {
  it("delivers events published by one instance to another", async () => {
    const iterator = subscriber
      .subscribe<{ n: number }>("order:1")
      [Symbol.asyncIterator]();
    await subscriber.ready("order:1");

    await publisher.publish("order:1", { n: 1 });
    await publisher.publish("order:1", { n: 2 });

    expect((await iterator.next()).value).toEqual({ n: 1 });
    expect((await iterator.next()).value).toEqual({ n: 2 });
    await iterator.return?.();
  });

  it("filters events and unsubscribes after the iterator returns", async () => {
    const iterator = subscriber
      .subscribe<{ rider: string }>("zone:z", (event) => event.rider === "r1")
      [Symbol.asyncIterator]();
    await subscriber.ready("zone:z");

    await publisher.publish("zone:z", { rider: "r2" });
    await publisher.publish("zone:z", { rider: "r1" });

    expect((await iterator.next()).value).toEqual({ rider: "r1" });
    await iterator.return?.();
    expect(subscriber.listenerCount("zone:z")).toBe(0);
  });

  it("finishes pending iterator reads when the instance closes", async () => {
    const closing = new RedisPubSub(stack.redisUrl);
    const iterator = closing
      .subscribe<{ n: number }>("closing")
      [Symbol.asyncIterator]();
    await closing.ready("closing");
    const pending = iterator.next();

    await closing.close();

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
    expect(closing.listenerCount("closing")).toBe(0);
  });
});
