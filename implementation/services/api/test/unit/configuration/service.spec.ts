import { describe, expect, it, vi } from "vitest";
import {
  ConfigurationService,
  runtimeConfigurationDocument,
} from "../../../src/configuration/service.js";

const base = {
  countryCode: "MY",
  currency: "MYR",
  currencySymbol: "RM",
  currencyMinorUnits: 2,
  skipEmailVerification: false,
  skipMobileVerification: false,
};

function serviceWith(document: unknown) {
  return new ConfigurationService({
    query: vi.fn().mockResolvedValue({
      rows: [
        { id: "018f6b77-0f2c-7e34-8c68-733a48e2641b", version: 1, document },
      ],
    }),
  });
}

describe("versioned runtime configuration", () => {
  it("supports configurable MYR, own fleet, payment and economic policies", async () => {
    const document = {
      ...base,
      deliveryFleets: [
        {
          id: "own-fleet-my",
          kind: "OWN_FLEET",
          enabled: true,
          provider: null,
          capability: "LIVE_VERIFIED",
        },
      ],
      paymentMethods: [
        {
          id: "cash",
          kind: "CASH",
          enabled: true,
          provider: null,
          capability: "LIVE_VERIFIED",
        },
      ],
      rules: {
        deliveryFeeMinor: 500,
        serviceFeeMinor: 0,
        taxBasisPoints: 600,
        coreFoodCommissionBasisPoints: 0,
        refundsEnabled: true,
        refundWindowMinutes: 60,
      },
    };

    expect(runtimeConfigurationDocument.parse(document)).toEqual(document);
    await expect(serviceWith(document).read()).resolves.toMatchObject({
      countryCode: "MY",
      currency: "MYR",
      deliveryRate: 5,
      costType: "fixed",
      checkoutAvailable: true,
    });
  });

  it("does not advertise an enabled provider before verification", async () => {
    const document = {
      ...base,
      paymentMethods: [
        {
          id: "card",
          kind: "CARD",
          enabled: true,
          provider: "stripe",
          capability: "CONFIGURED",
        },
      ],
    };

    await expect(serviceWith(document).read()).resolves.toMatchObject({
      checkoutAvailable: false,
    });
  });

  it("enforces zero core-plan food commission and rejects embedded secrets", () => {
    expect(
      runtimeConfigurationDocument.safeParse({
        ...base,
        rules: {
          deliveryFeeMinor: 0,
          serviceFeeMinor: 0,
          taxBasisPoints: 0,
          coreFoodCommissionBasisPoints: 100,
          refundsEnabled: false,
          refundWindowMinutes: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      runtimeConfigurationDocument.safeParse({
        ...base,
        paymentMethods: [],
        stripeSecretKey: "secret",
      }).success,
    ).toBe(false);
  });

  it("requires provider identities only for external capabilities", () => {
    for (const invalid of [
      {
        deliveryFleets: [
          {
            id: "external",
            kind: "EXTERNAL",
            enabled: true,
            provider: null,
            capability: "CONFIGURED",
          },
        ],
      },
      {
        paymentMethods: [
          {
            id: "card",
            kind: "CARD",
            enabled: true,
            provider: null,
            capability: "CONFIGURED",
          },
        ],
      },
      {
        paymentMethods: [
          {
            id: "cash",
            kind: "CASH",
            enabled: true,
            provider: "external-cash",
            capability: "LIVE_VERIFIED",
          },
        ],
      },
    ]) {
      expect(
        runtimeConfigurationDocument.safeParse({ ...base, ...invalid }).success,
      ).toBe(false);
    }
  });

  it("retains the legacy safe defaults when policy sections are absent", async () => {
    await expect(serviceWith(base).read()).resolves.toMatchObject({
      deliveryRate: null,
      costType: null,
      checkoutAvailable: false,
      twilioEnabled: false,
    });
  });
});
