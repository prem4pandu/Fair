import { describe, expect, it } from "vitest";
import { priceOrder } from "../../../src/orders/pricing.js";

describe("order pricing", () => {
  it("computes configurable fees, tax, tip, and commission in minor units", () => {
    expect(
      priceOrder({
        lines: [
          { unitMinor: 1_000n, quantity: 2 },
          { unitMinor: 250n, quantity: 1 },
        ],
        discountMinor: 250n,
        tipMinor: 100n,
        rules: {
          taxBasisPoints: 800n,
          commissionBasisPoints: 500n,
          corePlan: false,
          delivery: { mode: "PER_KM", rateMinor: 200n, distanceMeters: 2_001 },
        },
      }),
    ).toEqual({
      itemsMinor: 2_250n,
      discountMinor: 250n,
      discountedItemsMinor: 2_000n,
      deliveryMinor: 600n,
      taxMinor: 208n,
      tipMinor: 100n,
      commissionMinor: 100n,
      totalMinor: 2_908n,
    });
  });

  it("caps discounts and balances the total", () => {
    const result = priceOrder({
      lines: [{ unitMinor: 999n, quantity: 1 }],
      discountMinor: 5_000n,
      tipMinor: 0n,
      rules: {
        taxBasisPoints: 600n,
        commissionBasisPoints: 0n,
        corePlan: true,
        delivery: { mode: "FIXED", rateMinor: 300n },
      },
    });
    expect(result.discountMinor).toBe(999n);
    expect(result.totalMinor).toBe(
      result.itemsMinor -
        result.discountMinor +
        result.deliveryMinor +
        result.taxMinor +
        result.tipMinor,
    );
  });

  it("keeps pickup delivery at zero", () => {
    expect(
      priceOrder({
        lines: [{ unitMinor: 100n, quantity: 1 }],
        discountMinor: 0n,
        tipMinor: 0n,
        rules: {
          taxBasisPoints: 0n,
          commissionBasisPoints: 0n,
          corePlan: true,
          delivery: { mode: "PICKUP" },
        },
      }).deliveryMinor,
    ).toBe(0n);
  });

  it("rejects nonzero core-plan commission", () => {
    expect(() =>
      priceOrder({
        lines: [],
        discountMinor: 0n,
        tipMinor: 0n,
        rules: {
          taxBasisPoints: 0n,
          commissionBasisPoints: 1n,
          corePlan: true,
          delivery: { mode: "PICKUP" },
        },
      }),
    ).toThrow(/fixed at 0%/);
  });

  it("rejects invalid monetary and percentage inputs", () => {
    expect(() =>
      priceOrder({
        lines: [{ unitMinor: -1n, quantity: 1 }],
        discountMinor: 0n,
        tipMinor: 0n,
        rules: {
          taxBasisPoints: 0n,
          commissionBasisPoints: 0n,
          corePlan: true,
          delivery: { mode: "PICKUP" },
        },
      }),
    ).toThrow(/must not be negative/);
    expect(() =>
      priceOrder({
        lines: [],
        discountMinor: 0n,
        tipMinor: 0n,
        rules: {
          taxBasisPoints: 10_001n,
          commissionBasisPoints: 0n,
          corePlan: true,
          delivery: { mode: "PICKUP" },
        },
      }),
    ).toThrow(/between 0 and 100/);
  });
});
