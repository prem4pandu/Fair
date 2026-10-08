import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OrderPersistenceService } from "../src/orders/persistence.js";
import { orderRecord } from "./support/factories/orders.js";
import { startStack, type Stack } from "./support/stack.js";

describe("L5 order persistence", () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  beforeEach(async () => stack.reset());
  afterAll(async () => stack.release());

  it("atomically stores immutable snapshots, initial history and placed outbox event", async () => {
    const service = new OrderPersistenceService(stack.pool);
    const input = orderRecord();
    const order = await service.create(input);
    expect(order.orderId).toMatch(/^SEED-[0-9A-Z]{6,}$/);
    expect(order.totalMinor).toBe(1280n);
    const counts = await stack.pool.query(`SELECT
      (SELECT count(*) FROM "Order") orders,
      (SELECT count(*) FROM "OrderItem") items,
      (SELECT count(*) FROM "OrderStatusHistory") history,
      (SELECT count(*) FROM "DomainEvent" WHERE type='order.placed') events`);
    expect(counts.rows[0]).toEqual({
      orders: "1",
      items: "1",
      history: "1",
      events: "1",
    });
    await expect(
      stack.pool.query(`UPDATE "OrderStatusHistory" SET reason='tamper'`),
    ).rejects.toThrow("append-only");
  });

  it("enforces tenant isolation and applies a transition with history and outbox in one transaction", async () => {
    const service = new OrderPersistenceService(stack.pool);
    const input = orderRecord();
    const placed = await service.create(input);
    expect(await service.get(orderRecord().tenantId, placed.id)).toBeNull();
    const accepted = await service.transition({
      tenantId: input.tenantId,
      id: placed.id,
      to: "ACCEPTED",
      actor: { type: "RESTAURANT", id: input.restaurantId },
      expectedVersion: 1,
      preparationMinutes: 20,
    });
    expect(accepted.version).toBe(2);
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    const rows = await stack.pool.query(
      `SELECT
      (SELECT count(*) FROM "OrderStatusHistory" WHERE "orderId"=$1) history,
      (SELECT count(*) FROM "DomainEvent" WHERE type='order.transitioned') events`,
      [placed.id],
    );
    expect(rows.rows[0]).toEqual({ history: "2", events: "1" });
  });

  it("rejects stale versions without partially writing lifecycle state", async () => {
    const service = new OrderPersistenceService(stack.pool);
    const input = orderRecord();
    const placed = await service.create(input);
    await expect(
      service.transition({
        tenantId: input.tenantId,
        id: placed.id,
        to: "ACCEPTED",
        actor: { type: "RESTAURANT", id: input.restaurantId },
        expectedVersion: 9,
        preparationMinutes: 10,
      }),
    ).rejects.toThrow("L5_VERSION_CONFLICT");
    expect((await service.get(input.tenantId, placed.id))?.status).toBe(
      "PENDING",
    );
    expect(
      (
        await stack.pool.query(
          `SELECT count(*) FROM "OrderStatusHistory" WHERE "orderId"=$1`,
          [placed.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
});
