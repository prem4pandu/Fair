import type { Pool } from "pg";
import { appError } from "../kernel/errors.js";
import { newId } from "../kernel/ids.js";
import { enqueue } from "../kernel/outbox.js";
import type { OrderSnapshot } from "../kernel/ports.js";
import {
  withUnitOfWork,
  type TransactionClient,
} from "../kernel/unit-of-work.js";
import type { OrderActor, OrderStatus } from "./state-machine.js";

export type OrderOptionSnapshot = Readonly<{
  optionId: string;
  title: string;
  description?: string | null;
  priceMinor: bigint;
}>;
export type OrderAddonSnapshot = Readonly<{
  addonId: string;
  title: string;
  description?: string | null;
  quantityMinimum: number;
  quantityMaximum: number;
  options: readonly OrderOptionSnapshot[];
}>;
export type OrderLineSnapshot = Readonly<{
  foodId: string;
  title: string;
  description?: string | null;
  image?: string | null;
  quantity: number;
  specialInstructions?: string;
  variationId: string;
  variationTitle: string;
  variationPriceMinor: bigint;
  variationDiscountedMinor: bigint;
  unitPriceMinor: bigint;
  addons: readonly OrderAddonSnapshot[];
}>;

export type CreateOrderRecord = Readonly<{
  tenantId: string;
  userId: string;
  restaurantId: string;
  vendorId?: string | null;
  zoneId?: string | null;
  isPickedUp: boolean;
  paymentMethod: "COD" | "STRIPE" | "PAYPAL";
  currency: { code: string; symbol: string; exponent: number };
  price: {
    itemsMinor: bigint;
    discountMinor: bigint;
    deliveryMinor: bigint;
    taxMinor: bigint;
    tipMinor: bigint;
    totalMinor: bigint;
  };
  taxBasisPoints: number;
  coupon?: { id: string; title: string; basisPoints: number } | null;
  instructions?: string;
  address: {
    id?: string | null;
    label: string;
    text: string;
    details?: string;
    longitude?: number | null;
    latitude?: number | null;
  };
  restaurant: {
    name: string;
    slug?: string | null;
    image?: string | null;
    address?: string | null;
    shopType?: string | null;
    longitude: number;
    latitude: number;
    orderPrefix?: string | null;
  };
  customer: { name: string; email?: string | null; phone?: string | null };
  orderDate: Date;
  visibleAt: Date | null;
  acceptDeadlineAt: Date | null;
  lines: readonly OrderLineSnapshot[];
}>;

type OrderRow = {
  id: string;
  orderId: string;
  status: OrderStatus;
  restaurantId: string;
  userId: string;
  riderId: string | null;
  zoneId: string | null;
  isPickedUp: boolean;
  paymentMethod: OrderSnapshot["paymentMethod"];
  paymentStatus: OrderSnapshot["paymentStatus"];
  currencyCode: string;
  currencySymbol: string;
  currencyExponent: number;
  itemsMinor: string;
  discountMinor: string;
  deliveryMinor: string;
  taxMinor: string;
  tipMinor: string;
  totalMinor: string;
  version: number;
  createdAt: Date;
  acceptedAt: Date | null;
};

const selectSnapshot = `SELECT id, "orderId", status, "restaurantId", "userId", "riderId", "zoneId", "isPickedUp",
  "paymentMethod", "paymentStatus", "currencyCode", "currencySymbol", "currencyExponent", "itemsMinor"::text,
  "discountMinor"::text, "deliveryMinor"::text, "taxMinor"::text, "tipMinor"::text, "totalMinor"::text,
  version, "createdAt", "acceptedAt" FROM "Order"`;

function snapshot(row: OrderRow): OrderSnapshot {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    restaurantId: row.restaurantId,
    userId: row.userId,
    riderId: row.riderId,
    zoneId: row.zoneId,
    isPickedUp: row.isPickedUp,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    currency: {
      code: row.currencyCode,
      symbol: row.currencySymbol,
      exponent: row.currencyExponent,
    },
    itemsMinor: BigInt(row.itemsMinor),
    discountMinor: BigInt(row.discountMinor),
    deliveryMinor: BigInt(row.deliveryMinor),
    taxMinor: BigInt(row.taxMinor),
    tipMinor: BigInt(row.tipMinor),
    totalMinor: BigInt(row.totalMinor),
    version: row.version,
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
  };
}

export function normalizeOrderPrefix(value?: string | null): string {
  const clean = value
    ?.toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return clean || "ORD";
}

export function validateOrderRecord(input: CreateOrderRecord): void {
  if (input.lines.length === 0)
    throw appError("BAD_USER_INPUT", "Order must contain at least one item");
  const lineTotal = input.lines.reduce(
    (sum, line) => sum + line.unitPriceMinor * BigInt(line.quantity),
    0n,
  );
  if (lineTotal !== input.price.itemsMinor)
    throw appError(
      "BAD_USER_INPUT",
      "Order item snapshot does not match priced items",
    );
  const balanced =
    input.price.itemsMinor -
    input.price.discountMinor +
    input.price.deliveryMinor +
    input.price.taxMinor +
    input.price.tipMinor;
  if (balanced !== input.price.totalMinor)
    throw appError("BAD_USER_INPUT", "Order total is not balanced");
  if (
    input.isPickedUp &&
    (input.price.deliveryMinor !== 0n || input.price.tipMinor !== 0n)
  )
    throw appError(
      "BAD_USER_INPUT",
      "Pickup orders cannot contain delivery fees or tips",
    );
}

export class OrderPersistenceService {
  constructor(private readonly pool: Pick<Pool, "connect" | "query">) {}

  async get(tenantId: string, id: string): Promise<OrderSnapshot | null> {
    const result = await this.pool.query<OrderRow>(
      `${selectSnapshot} WHERE "tenantId"=$1 AND id=$2`,
      [tenantId, id],
    );
    return result.rows[0] ? snapshot(result.rows[0]) : null;
  }

  async create(input: CreateOrderRecord): Promise<OrderSnapshot> {
    validateOrderRecord(input);
    return withUnitOfWork(this.pool, async (client) => {
      const sequence = await client.query<{ n: string }>(
        `SELECT nextval('"OrderNumberSeq"')::text AS n`,
      );
      const n = sequence.rows[0]?.n;
      if (!n) throw new Error("Order sequence did not return a value");
      const id = newId();
      const humanId = `${normalizeOrderPrefix(input.restaurant.orderPrefix)}-${BigInt(n).toString(36).toUpperCase().padStart(6, "0")}`;
      await client.query(
        `INSERT INTO "Order" (id,"orderId","orderNumber","tenantId","userId","restaurantId","vendorId","zoneId","isPickedUp","paymentMethod","currencyCode","currencySymbol","currencyExponent","itemsMinor","discountMinor","deliveryMinor","taxMinor","tipMinor","totalMinor","taxBasisPoints","couponId","couponTitle","couponBasisPoints",instructions,"addressId","addressLabel","addressText","addressDetails","addressLongitude","addressLatitude","restaurantName","restaurantSlug","restaurantImage","restaurantAddress","restaurantShopType","restaurantLongitude","restaurantLatitude","customerName","customerEmail","customerPhone","orderDate","visibleAt","acceptDeadlineAt")
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43)`,
        [
          id,
          humanId,
          n,
          input.tenantId,
          input.userId,
          input.restaurantId,
          input.vendorId ?? null,
          input.zoneId ?? null,
          input.isPickedUp,
          input.paymentMethod,
          input.currency.code,
          input.currency.symbol,
          input.currency.exponent,
          input.price.itemsMinor.toString(),
          input.price.discountMinor.toString(),
          input.price.deliveryMinor.toString(),
          input.price.taxMinor.toString(),
          input.price.tipMinor.toString(),
          input.price.totalMinor.toString(),
          input.taxBasisPoints,
          input.coupon?.id ?? null,
          input.coupon?.title ?? null,
          input.coupon?.basisPoints ?? null,
          input.instructions ?? "",
          input.address.id ?? null,
          input.address.label,
          input.address.text,
          input.address.details ?? "",
          input.address.longitude ?? null,
          input.address.latitude ?? null,
          input.restaurant.name,
          input.restaurant.slug ?? null,
          input.restaurant.image ?? null,
          input.restaurant.address ?? null,
          input.restaurant.shopType ?? null,
          input.restaurant.longitude,
          input.restaurant.latitude,
          input.customer.name,
          input.customer.email ?? null,
          input.customer.phone ?? null,
          input.orderDate,
          input.visibleAt,
          input.acceptDeadlineAt,
        ],
      );
      await this.insertLines(client, id, input.lines);
      await client.query(
        `INSERT INTO "OrderStatusHistory"(id,"orderId","toStatus","actorType","actorId",version) VALUES($1,$2,'PENDING','CUSTOMER',$3,1)`,
        [newId(), id, input.userId],
      );
      const created = await client.query<OrderRow>(
        `${selectSnapshot} WHERE id=$1`,
        [id],
      );
      const order = snapshot(created.rows[0]!);
      await enqueue(client, { type: "order.placed", payload: order });
      return order;
    });
  }

  private async insertLines(
    client: TransactionClient,
    orderId: string,
    lines: readonly OrderLineSnapshot[],
  ): Promise<void> {
    for (const [position, line] of lines.entries()) {
      const itemId = newId();
      await client.query(
        `INSERT INTO "OrderItem"(id,"orderId",position,"foodId",title,description,image,quantity,"specialInstructions","variationId","variationTitle","variationPriceMinor","variationDiscountedMinor","unitPriceMinor","lineTotalMinor") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          itemId,
          orderId,
          position,
          line.foodId,
          line.title,
          line.description ?? null,
          line.image ?? null,
          line.quantity,
          line.specialInstructions ?? "",
          line.variationId,
          line.variationTitle,
          line.variationPriceMinor.toString(),
          line.variationDiscountedMinor.toString(),
          line.unitPriceMinor.toString(),
          (line.unitPriceMinor * BigInt(line.quantity)).toString(),
        ],
      );
      for (const [addonPosition, addon] of line.addons.entries()) {
        const addonId = newId();
        await client.query(
          `INSERT INTO "OrderItemAddon"(id,"orderItemId",position,"addonId",title,description,"quantityMinimum","quantityMaximum") VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            addonId,
            itemId,
            addonPosition,
            addon.addonId,
            addon.title,
            addon.description ?? null,
            addon.quantityMinimum,
            addon.quantityMaximum,
          ],
        );
        for (const [optionPosition, option] of addon.options.entries())
          await client.query(
            `INSERT INTO "OrderItemOption"(id,"orderItemAddonId",position,"optionId",title,description,"priceMinor") VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              newId(),
              addonId,
              optionPosition,
              option.optionId,
              option.title,
              option.description ?? null,
              option.priceMinor.toString(),
            ],
          );
      }
    }
  }

  async transition(input: {
    tenantId: string;
    id: string;
    to: OrderStatus;
    actor: { type: OrderActor; id: string };
    expectedVersion: number;
    reason?: string;
    riderId?: string | null;
    preparationMinutes?: number;
  }): Promise<OrderSnapshot> {
    return withUnitOfWork(this.pool, async (client) => {
      await client.query(
        `SELECT * FROM l5_transition_order($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          input.tenantId,
          input.id,
          input.to,
          input.actor.type,
          input.actor.id,
          input.expectedVersion,
          input.reason ?? null,
          input.riderId ?? null,
          input.preparationMinutes ?? null,
        ],
      );
      const result = await client.query<OrderRow>(
        `${selectSnapshot} WHERE "tenantId"=$1 AND id=$2`,
        [input.tenantId, input.id],
      );
      if (!result.rows[0]) throw appError("NOT_FOUND", "Order not found");
      return snapshot(result.rows[0]);
    });
  }
}
