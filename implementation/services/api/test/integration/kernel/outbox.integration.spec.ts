import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimDue,
  consumeOnce,
  enqueue,
  providerIdempotencyKey,
  recordFailure,
} from "../../../src/kernel/outbox.js";
import { withUnitOfWork } from "../../../src/kernel/unit-of-work.js";
import { startStack, type Stack } from "../../support/stack.js";

describe("transactional outbox", () => {
  let stack: Stack;

  beforeAll(async () => {
    stack = await startStack();
    await stack.pool.query(`
      CREATE TABLE IF NOT EXISTS "DomainEvent" (
        id uuid PRIMARY KEY, type varchar(64) NOT NULL, payload jsonb NOT NULL,
        "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
        "availableAt" timestamptz(3) NOT NULL DEFAULT now(),
        "claimedBy" varchar(100), "claimExpiresAt" timestamptz(3),
        "processedAt" timestamptz(3), attempts integer NOT NULL DEFAULT 0,
        "lastError" varchar(500), "deadLetteredAt" timestamptz(3)
      );
      CREATE TABLE IF NOT EXISTS "EventInbox" (
        consumer varchar(100) NOT NULL, "eventId" uuid NOT NULL,
        "processedAt" timestamptz(3) NOT NULL DEFAULT now(),
        PRIMARY KEY (consumer, "eventId")
      );
      CREATE TABLE IF NOT EXISTS "OutboxProbe" (id uuid PRIMARY KEY);
    `);
  });
  beforeEach(async () => stack.reset());
  afterAll(async () => stack.release());

  it("commits a state write and event together", async () => {
    const id = "018f0000-0000-7000-8000-000000000001";
    await withUnitOfWork(stack.pool, async (client) => {
      await client.query('INSERT INTO "OutboxProbe" (id) VALUES ($1)', [id]);
      await enqueue(client, {
        type: "withdraw.updated",
        payload: { requestId: id, status: "PENDING" },
      });
    });
    const rows = await stack.pool.query(
      'SELECT (SELECT count(*) FROM "OutboxProbe") AS states, (SELECT count(*) FROM "DomainEvent") AS events',
    );
    expect(rows.rows[0]).toEqual({ states: "1", events: "1" });
  });

  it("rolls back a state write and event together", async () => {
    await expect(
      withUnitOfWork(stack.pool, async (client) => {
        await client.query('INSERT INTO "OutboxProbe" (id) VALUES ($1)', [
          "018f0000-0000-7000-8000-000000000002",
        ]);
        await enqueue(client, {
          type: "ticket.message",
          payload: { ticketId: "ticket-1", senderType: "USER" },
        });
        throw new Error("reject state change");
      }),
    ).rejects.toThrow("reject state change");
    const rows = await stack.pool.query(
      'SELECT (SELECT count(*) FROM "OutboxProbe") AS states, (SELECT count(*) FROM "DomainEvent") AS events',
    );
    expect(rows.rows[0]).toEqual({ states: "0", events: "0" });
  });

  it("reclaims expired leases while excluding a live claim", async () => {
    const eventId = await withUnitOfWork(stack.pool, (client) =>
      enqueue(client, {
        type: "withdraw.updated",
        payload: { requestId: "request-1", status: "PENDING" },
      }),
    );
    const first = await withUnitOfWork(stack.pool, (client) =>
      claimDue(client, "worker-a", 30),
    );
    expect(first.map(({ id }) => id)).toEqual([eventId]);
    expect(
      await withUnitOfWork(stack.pool, (client) =>
        claimDue(client, "worker-b", 30),
      ),
    ).toEqual([]);
    await stack.pool.query(
      'UPDATE "DomainEvent" SET "claimExpiresAt" = now() - interval \'1 second\' WHERE id = $1',
      [eventId],
    );
    const reclaimed = await withUnitOfWork(stack.pool, (client) =>
      claimDue(client, "worker-b", 30),
    );
    expect(reclaimed.map(({ id }) => id)).toEqual([eventId]);
  });

  it("applies an inbox-protected consumer effect once", async () => {
    const eventId = await withUnitOfWork(stack.pool, (client) =>
      enqueue(client, {
        type: "withdraw.updated",
        payload: { requestId: "request-2", status: "APPROVED" },
      }),
    );
    const effect = async (client: Parameters<typeof consumeOnce>[0]) => {
      await client.query('INSERT INTO "OutboxProbe" (id) VALUES ($1)', [
        eventId,
      ]);
    };
    expect(
      await withUnitOfWork(stack.pool, (client) =>
        consumeOnce(client, "ledger", eventId, effect),
      ),
    ).toBe(true);
    expect(
      await withUnitOfWork(stack.pool, (client) =>
        consumeOnce(client, "ledger", eventId, effect),
      ),
    ).toBe(false);
    expect(
      (await stack.pool.query('SELECT count(*) FROM "OutboxProbe"')).rows[0]
        ?.count,
    ).toBe("1");
  });

  it("retries a failed delivery with the same provider key and can then succeed", async () => {
    const eventId = await withUnitOfWork(stack.pool, (client) =>
      enqueue(client, {
        type: "order.paid",
        payload: {
          orderId: "order-1",
          providerReference: "payment-1",
          paidMinor: 1200n,
        },
      }),
    );
    const first = await withUnitOfWork(stack.pool, (client) =>
      claimDue(client, "worker-a"),
    );
    const key = providerIdempotencyKey("notify.payment", eventId);
    await recordFailure(
      stack.pool as never,
      eventId,
      "worker-a",
      new Error("provider unavailable"),
    );
    await stack.pool.query(
      'UPDATE "DomainEvent" SET "availableAt" = now() - interval \'1 second\' WHERE id = $1',
      [eventId],
    );
    const retry = await withUnitOfWork(stack.pool, (client) =>
      claimDue(client, "worker-b"),
    );
    expect(first[0]?.attempts).toBe(1);
    expect(retry[0]?.attempts).toBe(2);
    expect(providerIdempotencyKey("notify.payment", eventId)).toBe(key);
  });
});
