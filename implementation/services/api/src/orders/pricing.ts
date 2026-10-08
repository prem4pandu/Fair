import { appError } from "../kernel/errors.js";

export type Minor = bigint;

export type OrderLinePrice = Readonly<{
  unitMinor: Minor;
  quantity: number;
}>;

export type DeliveryFeePolicy =
  | Readonly<{ mode: "PICKUP" }>
  | Readonly<{ mode: "FIXED"; rateMinor: Minor }>
  | Readonly<{ mode: "PER_KM"; rateMinor: Minor; distanceMeters: number }>;

export type EconomicRules = Readonly<{
  taxBasisPoints: bigint;
  commissionBasisPoints: bigint;
  corePlan: boolean;
  delivery: DeliveryFeePolicy;
}>;

export type PriceOrderInput = Readonly<{
  lines: readonly OrderLinePrice[];
  discountMinor: Minor;
  tipMinor: Minor;
  rules: EconomicRules;
}>;

export type OrderPrice = Readonly<{
  itemsMinor: Minor;
  discountMinor: Minor;
  discountedItemsMinor: Minor;
  deliveryMinor: Minor;
  taxMinor: Minor;
  tipMinor: Minor;
  commissionMinor: Minor;
  totalMinor: Minor;
}>;

function requireNonNegative(value: bigint, name: string): void {
  if (value < 0n)
    throw appError("BAD_USER_INPUT", `${name} must not be negative`);
}

function requireBasisPoints(value: bigint, name: string): void {
  if (value < 0n || value > 10_000n) {
    throw appError(
      "BAD_USER_INPUT",
      `${name} must be between 0 and 100 percent`,
    );
  }
}

function percentage(amount: bigint, basisPoints: bigint): bigint {
  const numerator = amount * basisPoints;
  return (numerator + 5_000n) / 10_000n;
}

function deliveryFee(policy: DeliveryFeePolicy): bigint {
  if (policy.mode === "PICKUP") return 0n;
  requireNonNegative(policy.rateMinor, "Delivery rate");
  if (policy.mode === "FIXED") return policy.rateMinor;
  if (
    !Number.isSafeInteger(policy.distanceMeters) ||
    policy.distanceMeters < 0
  ) {
    throw appError("BAD_USER_INPUT", "Delivery distance is invalid");
  }
  const kilometres = BigInt(
    Math.max(1, Math.ceil(policy.distanceMeters / 1_000)),
  );
  return policy.rateMinor * kilometres;
}

export function priceOrder(input: PriceOrderInput): OrderPrice {
  requireNonNegative(input.discountMinor, "Discount");
  requireNonNegative(input.tipMinor, "Tip");
  requireBasisPoints(input.rules.taxBasisPoints, "Tax rate");
  requireBasisPoints(input.rules.commissionBasisPoints, "Commission rate");
  if (input.rules.corePlan && input.rules.commissionBasisPoints !== 0n) {
    throw appError(
      "BAD_USER_INPUT",
      "Commission is fixed at 0% on the core plan",
    );
  }

  const itemsMinor = input.lines.reduce((total, line) => {
    requireNonNegative(line.unitMinor, "Line price");
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw appError(
        "BAD_USER_INPUT",
        "Line quantity must be a positive integer",
      );
    }
    return total + line.unitMinor * BigInt(line.quantity);
  }, 0n);
  const discountMinor =
    input.discountMinor > itemsMinor ? itemsMinor : input.discountMinor;
  const discountedItemsMinor = itemsMinor - discountMinor;
  const deliveryMinor = deliveryFee(input.rules.delivery);
  const taxMinor = percentage(
    discountedItemsMinor + deliveryMinor,
    input.rules.taxBasisPoints,
  );
  const commissionMinor = percentage(
    discountedItemsMinor,
    input.rules.commissionBasisPoints,
  );
  const totalMinor =
    discountedItemsMinor + deliveryMinor + taxMinor + input.tipMinor;

  return {
    itemsMinor,
    discountMinor,
    discountedItemsMinor,
    deliveryMinor,
    taxMinor,
    tipMinor: input.tipMinor,
    commissionMinor,
    totalMinor,
  };
}
