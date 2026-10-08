import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type OutboxEvent = {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
};

type QueryClient = Pick<PoolClient, "query">;
type Database = Pick<Pool, "connect">;

export type OutboxConsumer = {
  name: string;
  eventTypes: readonly string[];
  handle: (
    client: QueryClient,
    event: OutboxEvent,
    providerIdempotencyKey: string,
  ) => Promise<void>;
};

export type OutboxDispatcherOptions = {
  database: Database;
  workerId: string;
  consumers: readonly OutboxConsumer[];
  leaseSeconds?: number;
  batchSize?: number;
  maxAttempts?: number;
  alertDeadLetter?: (event: OutboxEvent, error: unknown) => Promise<void>;
};

const boundedInteger = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.trunc(value)));

export function providerIdempotencyKey(consumer: string, eventId: string) {
  return createHash("sha256").update(`${consumer}:${eventId}`).digest("hex");
}

async function transaction<T>(
  database: Database,
  effect: (client: QueryClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await effect(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimDue(
  options: OutboxDispatcherOptions,
): Promise<OutboxEvent[]> {
  const leaseSeconds = boundedInteger(options.leaseSeconds ?? 30, 1, 300);
  const batchSize = boundedInteger(options.batchSize ?? 100, 1, 100);
  return transaction(options.database, async (client) => {
    const result = await client.query<OutboxEvent>(
      `WITH due AS (
         SELECT id FROM "DomainEvent"
         WHERE "processedAt" IS NULL AND "deadLetteredAt" IS NULL
           AND "availableAt" <= now()
           AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" <= now())
         ORDER BY "createdAt", id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE "DomainEvent" AS event
       SET "claimedBy" = $2,
           "claimExpiresAt" = now() + make_interval(secs => $3),
           attempts = attempts + 1
       FROM due WHERE event.id = due.id
       RETURNING event.id, event.type, event.payload, event.attempts`,
      [batchSize, options.workerId, leaseSeconds],
    );
    return result.rows;
  });
}

async function consume(
  options: OutboxDispatcherOptions,
  consumer: OutboxConsumer,
  event: OutboxEvent,
) {
  await transaction(options.database, async (client) => {
    const inserted = await client.query(
      `INSERT INTO "EventInbox" (consumer, "eventId") VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING consumer`,
      [consumer.name, event.id],
    );
    if (inserted.rowCount === 0) return;
    await consumer.handle(
      client,
      event,
      providerIdempotencyKey(consumer.name, event.id),
    );
  });
}

async function markProcessed(
  options: OutboxDispatcherOptions,
  event: OutboxEvent,
) {
  await transaction(options.database, async (client) => {
    await client.query(
      `UPDATE "DomainEvent"
       SET "processedAt" = now(), "claimedBy" = NULL, "claimExpiresAt" = NULL
       WHERE id = $1 AND "claimedBy" = $2 AND "processedAt" IS NULL`,
      [event.id, options.workerId],
    );
  });
}

async function recordFailure(
  options: OutboxDispatcherOptions,
  event: OutboxEvent,
  error: unknown,
) {
  const maxAttempts = boundedInteger(options.maxAttempts ?? 10, 1, 100);
  const message = error instanceof Error ? error.message : String(error);
  await transaction(options.database, async (client) => {
    await client.query(
      `UPDATE "DomainEvent"
       SET "claimedBy" = NULL, "claimExpiresAt" = NULL,
           "lastError" = left($3, 500),
           "availableAt" = CASE WHEN attempts >= $4 THEN "availableAt"
             ELSE now() + make_interval(secs => LEAST(3600, (2 ^ LEAST(attempts, 11))::integer)) END,
           "deadLetteredAt" = CASE WHEN attempts >= $4 THEN now() ELSE NULL END
       WHERE id = $1 AND "claimedBy" = $2 AND "processedAt" IS NULL`,
      [event.id, options.workerId, message, maxAttempts],
    );
  });
  if (event.attempts >= maxAttempts)
    await options.alertDeadLetter?.(event, error);
}

export async function dispatchOutboxBatch(
  options: OutboxDispatcherOptions,
): Promise<{ claimed: number; processed: number; failed: number }> {
  const events = await claimDue(options);
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const consumers = options.consumers.filter((consumer) =>
        consumer.eventTypes.includes(event.type),
      );
      if (consumers.length === 0)
        throw new Error(`No outbox consumer for ${event.type}`);
      for (const consumer of consumers) await consume(options, consumer, event);
      await markProcessed(options, event);
      processed += 1;
    } catch (error) {
      failed += 1;
      await recordFailure(options, event, error);
    }
  }
  return { claimed: events.length, processed, failed };
}
