import { describe, expect, it } from "vitest";
import {
  normalizeOrderPrefix,
  validateOrderRecord,
} from "../../../src/orders/persistence.js";
import { orderRecord } from "../../support/factories/orders.js";

describe("order persistence invariants", () => {
  it("normalizes bounded human order prefixes", () => {
    expect(normalizeOrderPrefix(" My-store! 123 ")).toBe("MYSTORE123");
    expect(normalizeOrderPrefix("---")).toBe("ORD");
    expect(normalizeOrderPrefix("abcdefghijklmnop")).toBe("ABCDEFGHIJ");
  });

  it("rejects totals that do not match immutable line snapshots", () => {
    expect(() =>
      validateOrderRecord(
        orderRecord({
          price: {
            itemsMinor: 999n,
            discountMinor: 0n,
            deliveryMinor: 200n,
            taxMinor: 80n,
            tipMinor: 0n,
            totalMinor: 1_279n,
          },
        }),
      ),
    ).toThrow("snapshot");
  });

  it("rejects delivery charges on pickup orders", () => {
    expect(() =>
      validateOrderRecord(orderRecord({ isPickedUp: true })),
    ).toThrow("Pickup orders");
  });
});
