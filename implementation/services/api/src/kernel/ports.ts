import type { OpeningTimes, Point, Polygon } from "./geo.js";

export type Currency = { code: string; symbol: string; exponent: number };

export const CONFIG_PORT = Symbol("CONFIG_PORT");
export interface ConfigPort {
  currency(): Promise<Currency>;
  delivery(): Promise<{ costType: "fixed" | "perKm"; rateMinor: bigint }>;
  tipOptions(): Promise<{ enabled: boolean; percentages: number[] }>;
  verification(): Promise<{ skipEmail: boolean; skipMobile: boolean }>;
}

export const ZONES_PORT = Symbol("ZONES_PORT");
export interface ZonesPort {
  zoneAt(
    longitude: number,
    latitude: number,
  ): Promise<{ id: string; title: string } | null>;
  get(id: string): Promise<{
    id: string;
    title: string;
    area: Polygon;
    isActive: boolean;
  } | null>;
}

export const USERS_PORT = Symbol("USERS_PORT");
export interface UsersPort {
  customer(id: string): Promise<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
  } | null>;
  pushTokens(userId: string): Promise<string[]>;
}

export type RestaurantForOrdering = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  vendorId: string | null;
  ownerUserIds: string[];
  zoneId: string | null;
  location: Point;
  deliveryBounds: Polygon | null;
  timeZone: string;
  openingTimes: OpeningTimes;
  isActive: boolean;
  isAvailable: boolean;
  minimumOrderMinor: bigint;
  taxPercent: number;
  deliveryTimeMinutes: number;
  plan: "CORE";
  commissionPercent: 0;
  orderPrefix: string;
  phone: string | null;
};

export type PricedLine = {
  foodId: string;
  foodTitle: string;
  variationId: string;
  variationTitle: string;
  unitPriceMinor: bigint;
  addons: {
    addonId: string;
    title: string;
    options: { optionId: string; title: string; priceMinor: bigint }[];
  }[];
  isOutOfStock: boolean;
};

export const RESTAURANTS_PORT = Symbol("RESTAURANTS_PORT");
export interface RestaurantsPort {
  forOrdering(id: string): Promise<RestaurantForOrdering | null>;
  priceLines(
    restaurantId: string,
    lines: {
      foodId: string;
      variationId: string;
      addons: { addonId: string; optionIds: string[] }[];
    }[],
  ): Promise<PricedLine[]>;
  ownedBy(userId: string): Promise<string[]>;
}

export const COUPONS_PORT = Symbol("COUPONS_PORT");
export interface CouponsPort {
  resolve(
    titleOrCode: string,
    restaurantId: string,
    at: Date,
  ): Promise<{ id: string; title: string; discountPercent: number } | null>;
}

export const ADDRESSES_PORT = Symbol("ADDRESSES_PORT");
export interface AddressesPort {
  owned(
    userId: string,
    addressId: string,
  ): Promise<{
    id: string;
    label: string;
    deliveryAddress: string;
    details: string;
    location: Point;
  } | null>;
}

export type OrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "ASSIGNED"
  | "PICKED"
  | "DELIVERED"
  | "CANCELLED";
export type OrderSnapshot = {
  id: string;
  orderId: string;
  status: OrderStatus;
  restaurantId: string;
  userId: string;
  riderId: string | null;
  zoneId: string | null;
  isPickedUp: boolean;
  paymentMethod: "COD" | "STRIPE" | "PAYPAL";
  paymentStatus: "PENDING" | "PAID" | "REFUNDED";
  currency: Currency;
  itemsMinor: bigint;
  discountMinor: bigint;
  deliveryMinor: bigint;
  taxMinor: bigint;
  tipMinor: bigint;
  totalMinor: bigint;
  version: number;
  createdAt: Date;
  acceptedAt: Date | null;
};

export const ORDERS_PORT = Symbol("ORDERS_PORT");
export interface OrdersPort {
  get(id: string): Promise<OrderSnapshot | null>;
  transition(input: {
    id: string;
    to: OrderStatus;
    actor: { type: string; id: string };
    expectedVersion?: number;
    reason?: string;
    riderId?: string | null;
  }): Promise<OrderSnapshot>;
  markPaid(
    id: string,
    providerReference: string,
    paidMinor: bigint,
  ): Promise<OrderSnapshot>;
}

export const RIDERS_PORT = Symbol("RIDERS_PORT");
export interface RidersPort {
  rider(id: string): Promise<{
    id: string;
    userId: string;
    name: string;
    phone: string | null;
    zoneId: string | null;
    available: boolean;
    isActive: boolean;
  } | null>;
  availableInZone(zoneId: string): Promise<string[]>;
}

export const LEDGER_PORT = Symbol("LEDGER_PORT");
export interface LedgerPort {
  balances(account: { type: "RESTAURANT" | "RIDER"; id: string }): Promise<{
    totalMinor: bigint;
    withdrawnMinor: bigint;
    currentMinor: bigint;
    pendingMinor: bigint;
  }>;
}

export const PAYMENTS_PORT = Symbol("PAYMENTS_PORT");
export interface PaymentsPort {
  available(method: "STRIPE" | "PAYPAL"): Promise<boolean>;
}

export type Message = {
  template: string;
  data: Record<string, string | number>;
};
export const NOTIFY_PORT = Symbol("NOTIFY_PORT");
export interface NotifyPort {
  push(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void>;
  email(to: string, message: Message): Promise<void>;
  sms(to: string, text: string): Promise<void>;
}

export const MEDIA_PORT = Symbol("MEDIA_PORT");
export interface MediaPort {
  storeDataUrl(
    dataUrl: string,
    ownerId: string,
  ): Promise<{ key: string; url: string }>;
}

export const AUDIT_PORT = Symbol("AUDIT_PORT");
export interface AuditPort {
  record(entry: {
    actorId: string;
    actorType: string;
    action: string;
    entity: string;
    entityId: string;
    changes?: Record<string, unknown>;
  }): Promise<void>;
}
