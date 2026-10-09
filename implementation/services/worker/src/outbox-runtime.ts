import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  dispatchOutboxBatch,
  type OutboxConsumer,
  type OutboxDispatcherOptions,
} from "./jobs/outbox.js";

type BatchResult = Awaited<ReturnType<typeof dispatchOutboxBatch>>;

export type OutboxLoopOptions = {
  database: OutboxDispatcherOptions["database"];
  consumers: readonly OutboxConsumer[];
  signal: AbortSignal;
  workerId?: string;
  idleDelayMs?: number;
  maximumBackoffMs?: number;
  dispatch?: (options: OutboxDispatcherOptions) => Promise<BatchResult>;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
};

const boundedDelay = (value: number | undefined, fallback: number) =>
  Math.max(10, Math.min(60_000, Math.trunc(value ?? fallback)));

export const abortableDelay = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/**
 * Polls serially so one worker process never overlaps outbox claims. Database
 * failures back off, while a successful empty batch returns to the idle rate.
 */
export async function runOutboxLoop(options: OutboxLoopOptions): Promise<void> {
  const idleDelayMs = boundedDelay(options.idleDelayMs, 1_000);
  const maximumBackoffMs = Math.max(
    idleDelayMs,
    boundedDelay(options.maximumBackoffMs, 30_000),
  );
  const dispatch = options.dispatch ?? dispatchOutboxBatch;
  const delay = options.delay ?? abortableDelay;
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  let failureDelayMs = idleDelayMs;

  while (!options.signal.aborted) {
    try {
      const result = await dispatch({
        database: options.database,
        workerId,
        consumers: options.consumers,
      });
      failureDelayMs = idleDelayMs;
      if (options.signal.aborted) break;
      // Drain immediately while a full batch indicates more due work.
      if (result.claimed < 100) await delay(idleDelayMs, options.signal);
    } catch (error) {
      options.onError?.(error);
      if (options.signal.aborted) break;
      await delay(failureDelayMs, options.signal);
      failureDelayMs = Math.min(maximumBackoffMs, failureDelayMs * 2);
    }
  }
}

export function startOutboxRuntime(
  databaseUrl: string,
  consumers: readonly OutboxConsumer[] = [],
) {
  const database = new Pool({
    connectionString: databaseUrl,
    max: 3,
    connectionTimeoutMillis: 1_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });
  database.on("error", () => {});
  const controller = new AbortController();
  const running = runOutboxLoop({
    database,
    consumers,
    signal: controller.signal,
    onError: () => {
      console.error(JSON.stringify({ event: "outbox_dispatch_failed" }));
    },
  });
  let closing: Promise<void> | undefined;
  return {
    close: () =>
      (closing ??= (async () => {
        controller.abort();
        await running;
        await database.end();
      })()),
  };
}
