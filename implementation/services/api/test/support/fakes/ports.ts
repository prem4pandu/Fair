import type {
  AddressesPort,
  AuditPort,
  ConfigPort,
  CouponsPort,
  LedgerPort,
  MediaPort,
  NotifyPort,
  OrdersPort,
  OrderSnapshot,
  PaymentsPort,
  PricedLine,
  RestaurantForOrdering,
  RestaurantsPort,
  RidersPort,
  UsersPort,
  ZonesPort,
} from "../../../src/kernel/ports.js";

export class FakeConfigPort implements ConfigPort {
  async currency() {
    return { code: "MYR", symbol: "RM", exponent: 2 };
  }
  async delivery() {
    return { costType: "fixed" as const, rateMinor: 0n };
  }
  async tipOptions() {
    return { enabled: false, percentages: [] };
  }
  async verification() {
    return { skipEmail: false, skipMobile: false };
  }
}

export class FakeZonesPort implements ZonesPort {
  zones = new Map<string, Awaited<ReturnType<ZonesPort["get"]>>>();
  async zoneAt() {
    return null;
  }
  async get(id: string) {
    return this.zones.get(id) ?? null;
  }
}

export class FakeUsersPort implements UsersPort {
  customers = new Map<string, Awaited<ReturnType<UsersPort["customer"]>>>();
  tokens = new Map<string, string[]>();
  async customer(id: string) {
    return this.customers.get(id) ?? null;
  }
  async pushTokens(userId: string) {
    return this.tokens.get(userId) ?? [];
  }
}

export class FakeRestaurantsPort implements RestaurantsPort {
  restaurants = new Map<string, RestaurantForOrdering>();
  pricedLines: PricedLine[] = [];
  owners = new Map<string, string[]>();
  async forOrdering(id: string) {
    return this.restaurants.get(id) ?? null;
  }
  async priceLines() {
    return this.pricedLines;
  }
  async ownedBy(userId: string) {
    return this.owners.get(userId) ?? [];
  }
}

export class FakeCouponsPort implements CouponsPort {
  result: Awaited<ReturnType<CouponsPort["resolve"]>> = null;
  async resolve() {
    return this.result;
  }
}

export class FakeAddressesPort implements AddressesPort {
  result: Awaited<ReturnType<AddressesPort["owned"]>> = null;
  async owned() {
    return this.result;
  }
}

export class FakeOrdersPort implements OrdersPort {
  orders = new Map<string, OrderSnapshot>();
  async get(id: string) {
    return this.orders.get(id) ?? null;
  }
  async transition(input: Parameters<OrdersPort["transition"]>[0]) {
    const order = this.orders.get(input.id);
    if (!order) throw new Error("Unknown fake order");
    const changed = { ...order, status: input.to, version: order.version + 1 };
    this.orders.set(input.id, changed);
    return changed;
  }
  async markPaid(id: string) {
    const order = this.orders.get(id);
    if (!order) throw new Error("Unknown fake order");
    const changed = { ...order, paymentStatus: "PAID" as const };
    this.orders.set(id, changed);
    return changed;
  }
}

export class FakeRidersPort implements RidersPort {
  riders = new Map<string, Awaited<ReturnType<RidersPort["rider"]>>>();
  available = new Map<string, string[]>();
  async rider(id: string) {
    return this.riders.get(id) ?? null;
  }
  async availableInZone(zoneId: string) {
    return this.available.get(zoneId) ?? [];
  }
}

export class FakeLedgerPort implements LedgerPort {
  result = {
    totalMinor: 0n,
    withdrawnMinor: 0n,
    currentMinor: 0n,
    pendingMinor: 0n,
  };
  async balances() {
    return this.result;
  }
}

export class FakePaymentsPort implements PaymentsPort {
  enabled = new Set<"STRIPE" | "PAYPAL">();
  async available(method: "STRIPE" | "PAYPAL") {
    return this.enabled.has(method);
  }
}

export class FakeNotifyPort implements NotifyPort {
  pushes: Parameters<NotifyPort["push"]>[] = [];
  emails: Parameters<NotifyPort["email"]>[] = [];
  messages: Parameters<NotifyPort["sms"]>[] = [];
  async push(...args: Parameters<NotifyPort["push"]>) {
    this.pushes.push(args);
  }
  async email(...args: Parameters<NotifyPort["email"]>) {
    this.emails.push(args);
  }
  async sms(...args: Parameters<NotifyPort["sms"]>) {
    this.messages.push(args);
  }
}

export class FakeMediaPort implements MediaPort {
  stored: { dataUrl: string; ownerId: string }[] = [];
  async storeDataUrl(dataUrl: string, ownerId: string) {
    this.stored.push({ dataUrl, ownerId });
    return {
      key: `fake/${ownerId}`,
      url: `https://invalid.example/${ownerId}`,
    };
  }
}

export class FakeAuditPort implements AuditPort {
  entries: Parameters<AuditPort["record"]>[0][] = [];
  async record(entry: Parameters<AuditPort["record"]>[0]) {
    this.entries.push(entry);
  }
}
