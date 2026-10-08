import { appError } from "../kernel/errors.js";

export type CheckoutCustomer = Readonly<{
  id: string;
  active: boolean;
  phone: string | null;
  phoneVerified: boolean;
}>;

export type CheckoutRestaurant = Readonly<{
  id: string;
  active: boolean;
  available: boolean;
  acceptsPickup: boolean;
  acceptsDelivery: boolean;
  currencyCode: string;
}>;

export type CheckoutSelection = Readonly<{
  foodId: string;
  variationId: string;
  optionIds: readonly string[];
  quantity: number;
}>;

export type CheckoutInput = Readonly<{
  customer: CheckoutCustomer | null;
  restaurant: CheckoutRestaurant | null;
  expectedCurrencyCode: string;
  requireVerifiedPhone: boolean;
  fulfillment: "PICKUP" | "DELIVERY";
  addressId?: string;
  selections: readonly CheckoutSelection[];
}>;

export type CheckoutValidation = Readonly<{
  customerId: string;
  restaurantId: string;
  fulfillment: "PICKUP" | "DELIVERY";
  selections: readonly CheckoutSelection[];
}>;

/** Pure validation at the checkout boundary. Repositories resolve these snapshots first. */
export function validateCheckout(input: CheckoutInput): CheckoutValidation {
  const customer = input.customer;
  if (!customer) throw appError("NOT_FOUND", "Customer not found");
  if (!customer.active)
    throw appError("BAD_USER_INPUT", "Your account is deactivated");
  if (!customer.phone?.trim())
    throw appError("BAD_USER_INPUT", "Phone number is missing");
  if (input.requireVerifiedPhone && !customer.phoneVerified) {
    throw appError("BAD_USER_INPUT", "Phone number is not verified");
  }

  const restaurant = input.restaurant;
  if (!restaurant) throw appError("NOT_FOUND", "Restaurant not found");
  if (!restaurant.active || !restaurant.available) {
    throw appError("BAD_USER_INPUT", "Restaurant is not accepting orders");
  }
  if (restaurant.currencyCode !== input.expectedCurrencyCode) {
    throw appError(
      "BAD_USER_INPUT",
      "Restaurant currency does not match checkout currency",
    );
  }
  if (input.fulfillment === "PICKUP" && !restaurant.acceptsPickup) {
    throw appError(
      "BAD_USER_INPUT",
      "Pickup is not available for this restaurant",
    );
  }
  if (input.fulfillment === "DELIVERY") {
    if (!restaurant.acceptsDelivery) {
      throw appError(
        "BAD_USER_INPUT",
        "Delivery is not available for this restaurant",
      );
    }
    if (!input.addressId?.trim()) {
      throw appError("BAD_USER_INPUT", "A delivery address is required");
    }
  }
  if (input.selections.length === 0) {
    throw appError("BAD_USER_INPUT", "Order must contain at least one item");
  }
  for (const selection of input.selections) {
    if (!selection.foodId.trim() || !selection.variationId.trim()) {
      throw appError("BAD_USER_INPUT", "Order item selection is incomplete");
    }
    if (!Number.isSafeInteger(selection.quantity) || selection.quantity < 1) {
      throw appError(
        "BAD_USER_INPUT",
        "Line quantity must be a positive integer",
      );
    }
    if (new Set(selection.optionIds).size !== selection.optionIds.length) {
      throw appError("BAD_USER_INPUT", "Order item contains duplicate options");
    }
  }

  return {
    customerId: customer.id,
    restaurantId: restaurant.id,
    fulfillment: input.fulfillment,
    selections: input.selections,
  };
}

export interface CheckoutCatalogPort {
  restaurant(restaurantId: string): Promise<CheckoutRestaurant | null>;
  /** Returns server-owned prices and validates variation/add-on membership. */
  priceSelections(
    restaurantId: string,
    selections: readonly CheckoutSelection[],
  ): Promise<readonly { unitMinor: bigint; quantity: number }[]>;
}

export interface CheckoutCustomerPort {
  customer(customerId: string): Promise<CheckoutCustomer | null>;
}

export interface CheckoutConfigurationPort {
  currency(): Promise<Readonly<{ code: string; exponent: number }>>;
  requireVerifiedPhone(): Promise<boolean>;
}
