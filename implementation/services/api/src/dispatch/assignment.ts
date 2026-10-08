import { appError } from "../kernel/errors.js";
import type { OrderStatus } from "../orders/state-machine.js";
import type { DispatchDomainEvent } from "./events.js";
import type {
  DeliveryRoutingStrategy,
  DispatchAssignment,
  DispatchOffer,
  DispatchOrder,
  DispatchRider,
} from "./types.js";

export function createDispatchOffer(
  order: DispatchOrder,
  strategy: DeliveryRoutingStrategy,
  offeredAt: Date,
  availableRiders: number,
): { offer: DispatchOffer | null; events: DispatchDomainEvent[] } {
  if (order.pickup || order.status !== "ACCEPTED") {
    return { offer: null, events: [] };
  }
  const flagReason = !order.zoneId
    ? "NO_ZONE"
    : availableRiders < 1
      ? "NO_RIDERS"
      : strategy === "third_party_courier"
        ? "PROVIDER_UNAVAILABLE"
        : null;
  const offer: DispatchOffer = {
    orderId: order.id,
    zoneId: order.zoneId,
    restaurantId: order.restaurantId,
    status: "OPEN",
    strategy,
    offeredAt,
    claimedBy: null,
    claimedAt: null,
    closedAt: null,
    flaggedAt: flagReason ? offeredAt : null,
    flagReason,
    orderVersion: order.version,
  };
  const events: DispatchDomainEvent[] = flagReason
    ? [
        {
          type: "dispatch.offer_flagged",
          orderId: order.id,
          reason: flagReason,
        },
      ]
    : [
        {
          type: "dispatch.offer_opened",
          orderId: order.id,
          zoneId: order.zoneId!,
        },
      ];
  return { offer, events };
}

export function assertRiderEligible(
  rider: DispatchRider,
  order: DispatchOrder,
): void {
  if (!rider.active) throw appError("NOT_FOUND", "Rider not found");
  if (!rider.available) {
    throw appError("BAD_USER_INPUT", "You must be available to accept orders");
  }
  if (!order.zoneId || rider.zoneId !== order.zoneId) {
    throw appError("BAD_USER_INPUT", "This order is outside your zone");
  }
}

export function acceptOffer(input: {
  offer: DispatchOffer;
  order: DispatchOrder;
  rider: DispatchRider;
  now: Date;
}): {
  offer: DispatchOffer;
  assignment: DispatchAssignment;
  events: DispatchDomainEvent[];
} {
  const { offer, order, rider, now } = input;
  if (order.status === "ASSIGNED" && order.riderId === rider.id) {
    return {
      offer,
      assignment: assignmentFor(order, rider.id, now),
      events: [],
    };
  }
  if (order.riderId || offer.status !== "OPEN") {
    throw appError("CONFLICT", "Order already assigned");
  }
  if (order.status !== "ACCEPTED" || order.pickup) {
    throw appError("BAD_USER_INPUT", "Order is not available for assignment");
  }
  assertRiderEligible(rider, order);
  const claimed: DispatchOffer = {
    ...offer,
    status: "CLAIMED",
    claimedBy: rider.id,
    claimedAt: now,
    flagReason: null,
    flaggedAt: null,
  };
  return {
    offer: claimed,
    assignment: assignmentFor(order, rider.id, now),
    events: [
      {
        type: "dispatch.offer_claimed",
        orderId: order.id,
        riderId: rider.id,
        zoneId: order.zoneId!,
      },
    ],
  };
}

function assignmentFor(
  order: DispatchOrder,
  riderId: string,
  now: Date,
): DispatchAssignment {
  return {
    orderId: order.id,
    riderId,
    customerId: order.customerId,
    status: "ACTIVE",
    phase: "ASSIGNED",
    assignedAt: now,
    updatedAt: now,
    orderVersion: order.version,
  };
}

export function rejectOffer(
  offer: DispatchOffer,
  riderId: string,
  rejectedAt: Date,
  reason?: string,
): { offer: DispatchOffer; event: DispatchDomainEvent } {
  if (offer.status !== "OPEN") {
    throw appError("CONFLICT", "Order already assigned");
  }
  return {
    offer,
    event: {
      type: "dispatch.offer_rejected",
      orderId: offer.orderId,
      riderId,
      rejectedAt: rejectedAt.toISOString(),
      reason: reason?.trim() || null,
    },
  };
}

export function flagTimedOutOffer(
  offer: DispatchOffer,
  now: Date,
  timeoutSeconds: number,
): DispatchOffer {
  if (
    offer.status !== "OPEN" ||
    offer.flagReason === "CLAIM_TIMEOUT" ||
    now.getTime() - offer.offeredAt.getTime() < timeoutSeconds * 1000
  ) {
    return offer;
  }
  return {
    ...offer,
    flaggedAt: now,
    flagReason: "CLAIM_TIMEOUT",
  };
}

export function adminAssignmentDecision(
  order: DispatchOrder,
  rider: DispatchRider,
): { kind: "NOOP" | "ASSIGN"; riderId: string } {
  if (!rider.active) throw appError("NOT_FOUND", "Rider not found");
  if (order.pickup) {
    throw appError("BAD_USER_INPUT", "Pickup orders do not need a rider");
  }
  const messages: Partial<Record<OrderStatus, string>> = {
    PENDING: "Order must be accepted by the store before a rider is assigned",
    PICKED: "Order has already been picked up",
    DELIVERED: "Order has already been delivered",
    CANCELLED: "Order has been cancelled",
  };
  const message = messages[order.status];
  if (message) throw appError("BAD_USER_INPUT", message);
  return {
    kind:
      order.status === "ASSIGNED" && order.riderId === rider.id
        ? "NOOP"
        : "ASSIGN",
    riderId: rider.id,
  };
}

export function riderStatusDecision(
  order: DispatchOrder,
  riderId: string,
  to: OrderStatus,
): { kind: "NOOP" | "TRANSITION"; to: "PICKED" | "DELIVERED" } {
  if (to !== "PICKED" && to !== "DELIVERED") {
    throw appError("BAD_USER_INPUT", "Riders can only set PICKED or DELIVERED");
  }
  if (order.riderId !== riderId) throw appError("FORBIDDEN");
  if (order.status === to) return { kind: "NOOP", to };
  if (to === "PICKED" && order.status !== "ASSIGNED") {
    throw appError(
      "BAD_USER_INPUT",
      "Order must be ASSIGNED before it can be PICKED",
    );
  }
  if (to === "DELIVERED" && order.status !== "PICKED") {
    throw appError(
      "BAD_USER_INPUT",
      "Order must be PICKED before it can be DELIVERED",
    );
  }
  return { kind: "TRANSITION", to };
}
