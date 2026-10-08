import { appError } from "../kernel/errors.js";
import type { DeliveryRoutingStrategy, DispatchOrder } from "./types.js";

export type DeliveryRouteResult =
  | Readonly<{ kind: "OWN_FLEET"; zoneId: string }>
  | Readonly<{ kind: "EXTERNAL_REQUESTED"; reference: string }>;

export interface ExternalCourier {
  route(order: DispatchOrder): Promise<DeliveryRouteResult>;
}

export interface DeliveryRouter {
  route(order: DispatchOrder): Promise<DeliveryRouteResult>;
}

export class ProviderUnavailableCourier implements ExternalCourier {
  // No order data is needed: an unconfigured courier provider must fail closed
  // rather than pretend a quote or booking succeeded.
  async route(): Promise<DeliveryRouteResult> {
    throw appError("PROVIDER_UNAVAILABLE", "Courier delivery is not available");
  }
}

export class ConfigurableDeliveryRouter implements DeliveryRouter {
  constructor(
    private readonly strategy: DeliveryRoutingStrategy,
    private readonly externalCourier: ExternalCourier,
  ) {}

  async route(order: DispatchOrder): Promise<DeliveryRouteResult> {
    if (order.pickup) {
      throw appError("BAD_USER_INPUT", "Pickup orders do not need a rider");
    }
    if (this.strategy === "third_party_courier") {
      return this.externalCourier.route(order);
    }
    if (!order.zoneId) {
      throw appError("BAD_USER_INPUT", "Delivery order has no dispatch zone");
    }
    return { kind: "OWN_FLEET", zoneId: order.zoneId };
  }
}
