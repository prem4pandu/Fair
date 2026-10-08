import { describe, expect, it } from "vitest";
import {
  validateCheckout,
  type CheckoutInput,
} from "../../../src/orders/checkout.js";

const valid = (change: Partial<CheckoutInput> = {}): CheckoutInput => ({
  customer: {
    id: "c1",
    active: true,
    phone: "+60123456789",
    phoneVerified: true,
  },
  restaurant: {
    id: "r1",
    active: true,
    available: true,
    acceptsPickup: true,
    acceptsDelivery: true,
    currencyCode: "MYR",
  },
  expectedCurrencyCode: "MYR",
  requireVerifiedPhone: true,
  fulfillment: "DELIVERY",
  addressId: "a1",
  selections: [
    { foodId: "f1", variationId: "v1", optionIds: ["o1"], quantity: 2 },
  ],
  ...change,
});

describe("checkout validation", () => {
  it("returns normalized identities for a valid checkout", () => {
    expect(validateCheckout(valid())).toMatchObject({
      customerId: "c1",
      restaurantId: "r1",
      fulfillment: "DELIVERY",
    });
  });

  it("enforces the configurable verified-phone gate", () => {
    const customer = { ...valid().customer!, phoneVerified: false };
    expect(() => validateCheckout(valid({ customer }))).toThrow(/not verified/);
    expect(
      validateCheckout(valid({ customer, requireVerifiedPhone: false }))
        .customerId,
    ).toBe("c1");
  });

  it("requires a delivery address but permits pickup without one", () => {
    expect(() => validateCheckout(valid({ addressId: undefined }))).toThrow(
      /address is required/,
    );
    expect(
      validateCheckout(valid({ fulfillment: "PICKUP", addressId: undefined }))
        .fulfillment,
    ).toBe("PICKUP");
  });

  it("rejects unavailable restaurants, currency mismatch, and duplicate options", () => {
    expect(() =>
      validateCheckout(
        valid({ restaurant: { ...valid().restaurant!, available: false } }),
      ),
    ).toThrow(/not accepting/);
    expect(() =>
      validateCheckout(valid({ expectedCurrencyCode: "USD" })),
    ).toThrow(/currency/);
    expect(() =>
      validateCheckout(
        valid({
          selections: [
            {
              foodId: "f",
              variationId: "v",
              optionIds: ["x", "x"],
              quantity: 1,
            },
          ],
        }),
      ),
    ).toThrow(/duplicate/);
  });
});
