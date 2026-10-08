import type { OrderStatus } from "../orders/state-machine.js";

export type DeliveryRoutingStrategy = "own_fleet" | "third_party_courier";
export type OfferStatus = "OPEN" | "CLAIMED" | "CLOSED";
export type OfferFlag =
  | "CLAIM_TIMEOUT"
  | "NO_ZONE"
  | "NO_RIDERS"
  | "PROVIDER_UNAVAILABLE";

export type DispatchOrder = Readonly<{
  id: string;
  status: OrderStatus;
  riderId: string | null;
  zoneId: string | null;
  restaurantId: string;
  customerId: string;
  pickup: boolean;
  version: number;
}>;

export type DispatchRider = Readonly<{
  id: string;
  active: boolean;
  available: boolean;
  zoneId: string | null;
}>;

export type DispatchOffer = Readonly<{
  orderId: string;
  zoneId: string | null;
  restaurantId: string;
  status: OfferStatus;
  strategy: DeliveryRoutingStrategy;
  offeredAt: Date;
  claimedBy: string | null;
  claimedAt: Date | null;
  closedAt: Date | null;
  flaggedAt: Date | null;
  flagReason: OfferFlag | null;
  orderVersion: number;
}>;

export type DispatchAssignment = Readonly<{
  orderId: string;
  riderId: string;
  customerId: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  phase: "ASSIGNED" | "PICKED" | "DELIVERED" | "CANCELLED";
  assignedAt: Date;
  updatedAt: Date;
  orderVersion: number;
}>;
