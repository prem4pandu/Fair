import { describe, expect, it, vi } from "vitest";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  dispatchOutboxBatch,
  providerIdempotencyKey,
  type OutboxEvent,
} from "../src/jobs/outbox.js";

const result = <T extends QueryResultRow>(rows: T[], rowCount = rows.length) =>
  ({ rows, rowCount }) as QueryResult<T>;

function database(events: OutboxEvent[], inboxInserted = true) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("RETURNING event.id")) return result(events);
      if (sql.includes('INSERT INTO "EventInbox"'))
        return result(
          inboxInserted ? [{ consumer: values?.[0] }] : [],
          inboxInserted ? 1 : 0,
        );
      return result([]);
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    calls,
    pool: { connect: vi.fn(async () => client) },
  };
}

describe("outbox dispatcher", () => {
  const event: OutboxEvent = {
    id: "0199c154-7f82-7a16-a839-911ff29084c2",
    type: "user.otp",
    payload: { channel: "email" },
    attempts: 1,
  };

  it("commits the short claim transaction before dispatching consumers", async () => {
    const db = database([event]);
    const observed: string[] = [];
    const outcome = await dispatchOutboxBatch({
      database: db.pool as never,
      workerId: "worker-1",
      consumers: [
        {
          name: "notifications",
          eventTypes: ["user.otp"],
          handle: async () => {
            observed.push(db.calls.map((call) => call.sql).join("\n"));
          },
        },
      ],
    });

    expect(outcome).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(observed[0]).toContain("COMMIT");
    expect(
      db.calls.find((call) => call.sql.includes("FOR UPDATE SKIP LOCKED"))
        ?.values,
    ).toEqual([100, "worker-1", 30]);
  });

  it("skips an already acknowledged consumer effect", async () => {
    const db = database([event], false);
    const handle = vi.fn(async () => undefined);
    await dispatchOutboxBatch({
      database: db.pool as never,
      workerId: "worker-1",
      consumers: [{ name: "notifications", eventTypes: ["user.otp"], handle }],
    });
    expect(handle).not.toHaveBeenCalled();
    expect(
      db.calls.some((call) => call.sql.includes('SET "processedAt" = now()')),
    ).toBe(true);
  });

  it("uses the same provider idempotency key on every attempt", async () => {
    const first = database([event]);
    const second = database([{ ...event, attempts: 2 }]);
    const keys: string[] = [];
    const consumer = {
      name: "email-provider",
      eventTypes: ["user.otp"],
      handle: async (_client: unknown, _event: unknown, key: string) => {
        keys.push(key);
      },
    };
    await dispatchOutboxBatch({
      database: first.pool as never,
      workerId: "w1",
      consumers: [consumer],
    });
    await dispatchOutboxBatch({
      database: second.pool as never,
      workerId: "w2",
      consumers: [consumer],
    });
    expect(keys).toEqual([
      providerIdempotencyKey("email-provider", event.id),
      providerIdempotencyKey("email-provider", event.id),
    ]);
  });

  it("rolls back a failed consumer and schedules retry without processing", async () => {
    const db = database([event]);
    const outcome = await dispatchOutboxBatch({
      database: db.pool as never,
      workerId: "worker-1",
      consumers: [
        {
          name: "email-provider",
          eventTypes: ["user.otp"],
          handle: async () => {
            throw new Error("provider unavailable");
          },
        },
      ],
    });
    expect(outcome).toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(db.calls.some((call) => call.sql === "ROLLBACK")).toBe(true);
    expect(
      db.calls.some((call) => call.sql.includes('"availableAt" = CASE')),
    ).toBe(true);
    expect(
      db.calls.some((call) => call.sql.includes('SET "processedAt" = now()')),
    ).toBe(false);
  });

  it("does not acknowledge an event before its consumer is registered", async () => {
    const db = database([event]);
    const outcome = await dispatchOutboxBatch({
      database: db.pool as never,
      workerId: "worker-1",
      consumers: [],
    });
    expect(outcome).toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(
      db.calls.some((call) => call.sql.includes('SET "processedAt" = now()')),
    ).toBe(false);
    expect(
      db.calls.some((call) =>
        call.values?.includes("No outbox consumer for user.otp"),
      ),
    ).toBe(true);
  });

  it("alerts when the bounded attempt limit is reached", async () => {
    const db = database([{ ...event, attempts: 10 }]);
    const alert = vi.fn(async () => undefined);
    await dispatchOutboxBatch({
      database: db.pool as never,
      workerId: "worker-1",
      maxAttempts: 10,
      alertDeadLetter: alert,
      consumers: [
        {
          name: "email-provider",
          eventTypes: ["user.otp"],
          handle: async () => Promise.reject(new Error("still unavailable")),
        },
      ],
    });
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({ id: event.id }),
      expect.any(Error),
    );
  });
});
