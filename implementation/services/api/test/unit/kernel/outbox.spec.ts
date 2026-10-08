import { describe, expect, it, vi } from "vitest";
import { enqueue, providerIdempotencyKey } from "../../../src/kernel/outbox.js";

describe("transactional outbox", () => {
  it("inserts a serialized event through the supplied transaction client", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const id = await enqueue({ query } as never, {
      type: "order.paid",
      payload: {
        orderId: "order-1",
        providerReference: "pay-1",
        paidMinor: 9007199254740993n,
      },
    });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO "DomainEvent"');
    expect(query.mock.calls[0]?.[1]).toEqual([
      id,
      "order.paid",
      '{"orderId":"order-1","providerReference":"pay-1","paidMinor":"9007199254740993"}',
    ]);
  });

  it("derives the same provider idempotency key on every retry", () => {
    const first = providerIdempotencyKey(
      "payments.capture",
      "018f0000-0000-7000-8000-000000000001",
    );
    expect(
      providerIdempotencyKey(
        "payments.capture",
        "018f0000-0000-7000-8000-000000000001",
      ),
    ).toBe(first);
    expect(
      providerIdempotencyKey(
        "payments.refund",
        "018f0000-0000-7000-8000-000000000001",
      ),
    ).not.toBe(first);
  });
});
