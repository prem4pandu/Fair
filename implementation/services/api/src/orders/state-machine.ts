import { appError } from "../kernel/errors.js";

export const ORDER_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "ASSIGNED",
  "PICKED",
  "DELIVERED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type OrderActor =
  | "CUSTOMER"
  | "RESTAURANT"
  | "RIDER"
  | "ADMIN"
  | "SYSTEM";

export type TransitionRequest = Readonly<{
  from: OrderStatus;
  to: OrderStatus;
  actor: OrderActor;
  pickup: boolean;
  riderId?: string;
  currentRiderId?: string;
  preparationMinutes?: number;
}>;

export type TransitionDecision = Readonly<{
  kind: "APPLY" | "NOOP";
  from: OrderStatus;
  to: OrderStatus;
}>;

type TransitionRule = Readonly<{
  from: OrderStatus;
  to: OrderStatus;
  actors: ReadonlySet<OrderActor>;
  fulfillment: "ANY" | "PICKUP" | "DELIVERY";
}>;

export const ORDER_TRANSITION_RULES: readonly TransitionRule[] = [
  {
    from: "PENDING",
    to: "ACCEPTED",
    actors: new Set(["RESTAURANT", "ADMIN"]),
    fulfillment: "ANY",
  },
  {
    from: "PENDING",
    to: "CANCELLED",
    actors: new Set(["CUSTOMER", "RESTAURANT", "ADMIN", "SYSTEM"]),
    fulfillment: "ANY",
  },
  {
    from: "ACCEPTED",
    to: "ASSIGNED",
    actors: new Set(["RIDER", "ADMIN"]),
    fulfillment: "DELIVERY",
  },
  {
    from: "ASSIGNED",
    to: "ASSIGNED",
    actors: new Set(["ADMIN"]),
    fulfillment: "DELIVERY",
  },
  {
    from: "ASSIGNED",
    to: "PICKED",
    actors: new Set(["RIDER", "ADMIN"]),
    fulfillment: "DELIVERY",
  },
  {
    from: "PICKED",
    to: "DELIVERED",
    actors: new Set(["RIDER", "ADMIN"]),
    fulfillment: "DELIVERY",
  },
  {
    from: "ACCEPTED",
    to: "DELIVERED",
    actors: new Set(["RESTAURANT", "ADMIN"]),
    fulfillment: "PICKUP",
  },
  {
    from: "ACCEPTED",
    to: "CANCELLED",
    actors: new Set(["ADMIN"]),
    fulfillment: "ANY",
  },
  {
    from: "ASSIGNED",
    to: "CANCELLED",
    actors: new Set(["ADMIN"]),
    fulfillment: "ANY",
  },
  {
    from: "PICKED",
    to: "CANCELLED",
    actors: new Set(["ADMIN"]),
    fulfillment: "ANY",
  },
];

function matchingRule(request: TransitionRequest): TransitionRule | undefined {
  const fulfillment = request.pickup ? "PICKUP" : "DELIVERY";
  return ORDER_TRANSITION_RULES.find(
    (rule) =>
      rule.from === request.from &&
      rule.to === request.to &&
      (rule.fulfillment === "ANY" || rule.fulfillment === fulfillment),
  );
}

export function decideOrderTransition(
  request: TransitionRequest,
): TransitionDecision {
  if (
    request.from === request.to &&
    (request.to !== "ASSIGNED" ||
      !request.riderId ||
      request.riderId === request.currentRiderId)
  ) {
    return { kind: "NOOP", from: request.from, to: request.to };
  }

  const rule = matchingRule(request);
  if (!rule) {
    throw appError(
      "BAD_USER_INPUT",
      `Order status cannot move from ${request.from} to ${request.to}`,
    );
  }
  if (!rule.actors.has(request.actor)) {
    throw appError(
      "FORBIDDEN",
      "This account cannot perform the order transition",
    );
  }
  if (request.to === "ACCEPTED") {
    if (
      !Number.isInteger(request.preparationMinutes) ||
      request.preparationMinutes === undefined ||
      request.preparationMinutes < 1 ||
      request.preparationMinutes > 180
    ) {
      throw appError(
        "BAD_USER_INPUT",
        "Preparation time must be between 1 and 180 minutes",
      );
    }
  }
  if (request.to === "ASSIGNED" && !request.riderId?.trim()) {
    throw appError(
      "BAD_USER_INPUT",
      "Assign a rider before marking the order as assigned",
    );
  }

  return { kind: "APPLY", from: request.from, to: request.to };
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  pickup: boolean,
): boolean {
  return (
    from === to ||
    ORDER_TRANSITION_RULES.some(
      (rule) =>
        rule.from === from &&
        rule.to === to &&
        (rule.fulfillment === "ANY" ||
          rule.fulfillment === (pickup ? "PICKUP" : "DELIVERY")),
    )
  );
}
