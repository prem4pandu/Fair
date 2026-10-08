import { Redis } from "ioredis";

type Listener = (payload: unknown) => void;

export interface PubSub {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe<T>(
    topic: string,
    filter?: (payload: T) => boolean,
  ): AsyncIterable<T>;
}

export const PUBSUB = Symbol("PUBSUB");

// Each API instance owns a subscriber connection while Redis fans events out
// across every instance. Domain services only depend on the PubSub interface.
export class RedisPubSub implements PubSub {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly subscriptions = new Map<string, Promise<unknown>>();
  private readonly activeIterators = new Set<() => Promise<unknown>>();
  private closed = false;

  constructor(url: string) {
    this.publisher = new Redis(url, { maxRetriesPerRequest: 2 });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: null });
    this.publisher.on("error", () => {});
    this.subscriber.on("error", () => {});
    this.subscriber.on("message", (topic: string, message: string) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }
      for (const listener of this.listeners.get(topic) ?? []) listener(payload);
    });
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    if (this.closed) throw new Error("Redis pub/sub is closed");
    await this.publisher.publish(topic, JSON.stringify(payload));
  }

  ready(topic: string): Promise<unknown> {
    return this.subscriptions.get(topic) ?? Promise.resolve();
  }

  listenerCount(topic: string): number {
    return this.listeners.get(topic)?.size ?? 0;
  }

  subscribe<T>(
    topic: string,
    filter?: (payload: T) => boolean,
  ): AsyncIterable<T> {
    if (this.closed) throw new Error("Redis pub/sub is closed");
    const { activeIterators, listeners, subscriptions, subscriber } = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        const queue: T[] = [];
        const waiting: Array<(result: IteratorResult<T>) => void> = [];
        let done = false;

        const listener: Listener = (payload) => {
          if (done || (filter && !filter(payload as T))) return;
          const resolve = waiting.shift();
          if (resolve) resolve({ value: payload as T, done: false });
          else queue.push(payload as T);
        };

        let topicListeners = listeners.get(topic);
        if (!topicListeners) {
          topicListeners = new Set();
          listeners.set(topic, topicListeners);
          subscriptions.set(topic, subscriber.subscribe(topic));
        }
        topicListeners.add(listener);

        const finish = async (): Promise<IteratorResult<T>> => {
          if (done) return { value: undefined, done: true };
          done = true;
          activeIterators.delete(finish);
          topicListeners.delete(listener);
          if (topicListeners.size === 0) {
            const subscription = subscriptions.get(topic);
            await subscription?.catch(() => undefined);
            if (
              listeners.get(topic) === topicListeners &&
              topicListeners.size === 0
            ) {
              listeners.delete(topic);
              subscriptions.delete(topic);
              await subscriber.unsubscribe(topic).catch(() => undefined);
            }
          }
          for (const resolve of waiting.splice(0)) {
            resolve({ value: undefined, done: true });
          }
          return { value: undefined, done: true };
        };
        activeIterators.add(finish);

        return {
          next: () => {
            const value = queue.shift();
            if (value !== undefined)
              return Promise.resolve({ value, done: false });
            if (done) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => waiting.push(resolve));
          },
          return: finish,
          throw: async (error) => {
            await finish();
            throw error;
          },
        };
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(
      [...this.activeIterators].map((finish) => finish()),
    );
    this.activeIterators.clear();
    this.listeners.clear();
    this.subscriptions.clear();
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
