import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  OrderPersistenceService,
  type CreateOrderRecord,
} from "../../../src/orders/persistence.js";

type Client = Pick<Pool | PoolClient, "connect" | "query">;

export function orderRecord(
  overrides: Partial<CreateOrderRecord> = {},
): CreateOrderRecord {
  const unitPriceMinor = 1_000n;
  return {
    tenantId: randomUUID(),
    userId: randomUUID(),
    restaurantId: randomUUID(),
    isPickedUp: false,
    paymentMethod: "COD",
    currency: { code: "MYR", symbol: "RM", exponent: 2 },
    price: {
      itemsMinor: unitPriceMinor,
      discountMinor: 0n,
      deliveryMinor: 200n,
      taxMinor: 80n,
      tipMinor: 0n,
      totalMinor: 1_280n,
    },
    taxBasisPoints: 800,
    address: {
      label: "Home",
      text: "1 Seed Street",
      longitude: 101.7,
      latitude: 3.15,
    },
    restaurant: {
      name: "Seed Restaurant",
      longitude: 101.6869,
      latitude: 3.139,
      orderPrefix: "seed",
    },
    customer: {
      name: "Seed Customer",
      email: "customer@example.test",
      phone: "+60111111111",
    },
    orderDate: new Date(),
    visibleAt: new Date(),
    acceptDeadlineAt: new Date(Date.now() + 300_000),
    lines: [
      {
        foodId: randomUUID(),
        title: "Seed Food",
        quantity: 1,
        variationId: randomUUID(),
        variationTitle: "Regular",
        variationPriceMinor: unitPriceMinor,
        variationDiscountedMinor: 0n,
        unitPriceMinor,
        addons: [],
      },
    ],
    ...overrides,
  };
}

export function orderFactory(pool: Client) {
  return (overrides: Partial<CreateOrderRecord> = {}) =>
    new OrderPersistenceService(pool as Pick<Pool, "connect" | "query">).create(
      orderRecord(overrides),
    );
}
