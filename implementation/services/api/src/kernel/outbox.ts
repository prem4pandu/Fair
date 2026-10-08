import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { DomainEvent } from "./events.js";
import { newId } from "./ids.js";

type QueryClient = Pick<PoolClient, "query">;

export type ClaimedEvent = {
  id: string;
  type: DomainEvent["type"];
  payload: unknown;
  attempts: number;
};

const jsonPayload = (payload: DomainEvent["payload"]): string =>
  JSON.stringify(payload, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );

/** Enqueue through the same transaction client used for the business write. */
export async function enqueue(
  client: QueryClient,
  event: DomainEvent,
): Promise<string> {
  const id = newId();
  await client.query(
    'INSERT INTO "DomainEvent"(id, type, payload) VALUES ($1, $2, $3::jsonb)',
    [id, event.type, jsonPayload(event.payload)],
  );
  return id;
}

/** Claim work in a short transaction; handlers must run only after it commits. */
export async function claimDue(
  client: QueryClient,
  workerId: string,
  leaseSeconds = 30,
  limit = 100,
): Promise<ClaimedEvent[]> {
  const result = await client.query<ClaimedEvent>(
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
    [Math.max(1, Math.min(limit, 100)), workerId, Math.max(1, leaseSeconds)],
  );
  return result.rows;
}

export async function consumeOnce(
  client: QueryClient,
  consumer: string,
  eventId: string,
  effect: (client: QueryClient) => Promise<void>,
): Promise<boolean> {
  const claimed = await client.query(
    `INSERT INTO "EventInbox" (consumer, "eventId") VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING consumer`,
    [consumer, eventId],
  );
  if (claimed.rowCount === 0) return false;
  await effect(client);
  return true;
}

export async function markProcessed(
  client: QueryClient,
  eventId: string,
  workerId: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE "DomainEvent" SET "processedAt" = now(), "claimedBy" = NULL, "claimExpiresAt" = NULL
     WHERE id = $1 AND "claimedBy" = $2 AND "processedAt" IS NULL`,
    [eventId, workerId],
  );
  return result.rowCount === 1;
}

export async function recordFailure(
  client: QueryClient,
  eventId: string,
  workerId: string,
  error: unknown,
  maxAttempts = 10,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await client.query(
    `UPDATE "DomainEvent"
     SET "claimedBy" = NULL, "claimExpiresAt" = NULL,
         "lastError" = left($3, 500),
         "availableAt" = CASE WHEN attempts >= $4 THEN "availableAt"
           ELSE now() + make_interval(secs => LEAST(3600, (2 ^ LEAST(attempts, 11))::integer)) END,
         "deadLetteredAt" = CASE WHEN attempts >= $4 THEN now() ELSE NULL END
     WHERE id = $1 AND "claimedBy" = $2 AND "processedAt" IS NULL`,
    [eventId, workerId, message, maxAttempts],
  );
}

/** Stable across retries and suitable for providers that accept idempotency keys. */
export function providerIdempotencyKey(
  consumer: string,
  eventId: string,
): string {
  return createHash("sha256").update(`${consumer}:${eventId}`).digest("hex");
}
