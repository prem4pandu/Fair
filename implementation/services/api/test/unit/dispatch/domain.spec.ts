import { describe, expect, it, vi } from "vitest";

import {
  acceptOffer,
  adminAssignmentDecision,
  createDispatchOffer,
  flagTimedOutOffer,
  rejectOffer,
  riderStatusDecision,
} from "../../../src/dispatch/assignment.js";
import { validateLocationUpdate } from "../../../src/dispatch/location.js";
import {
  ConfigurableDeliveryRouter,
  ProviderUnavailableCourier,
} from "../../../src/dispatch/routing.js";

const now = new Date("2026-10-08T10:00:00.000Z");
const rider = {
  id: "rider-1",
  active: true,
  available: true,
  zoneId: "zone-1",
} as const;
const order = {
  id: "order-1",
  status: "ACCEPTED",
  riderId: null,
  zoneId: "zone-1",
  restaurantId: "restaurant-1",
  customerId: "customer-1",
  pickup: false,
  version: 3,
} as const;

describe("dispatch offers and assignment", () => {
  it("opens an own-fleet offer and emits a zone event", () => {
    const result = createDispatchOffer(order, "own_fleet", now, 2);
    expect(result.offer).toMatchObject({ status: "OPEN", flagReason: null });
    expect(result.events).toEqual([
      { type: "dispatch.offer_opened", orderId: order.id, zoneId: "zone-1" },
    ]);
  });

  it("flags missing zones and riders without pretending dispatch succeeded", () => {
    expect(
      createDispatchOffer({ ...order, zoneId: null }, "own_fleet", now, 3)
        .offer!.flagReason,
    ).toBe("NO_ZONE");
    expect(
      createDispatchOffer(order, "own_fleet", now, 0).offer!.flagReason,
    ).toBe("NO_RIDERS");
  });

  it("does not create offers for pickup orders", () => {
    expect(
      createDispatchOffer({ ...order, pickup: true }, "own_fleet", now, 2),
    ).toEqual({ offer: null, events: [] });
  });

  it("accepts only eligible riders and supports an idempotent re-accept", () => {
    const opened = createDispatchOffer(order, "own_fleet", now, 2).offer!;
    const accepted = acceptOffer({ offer: opened, order, rider, now });
    expect(accepted.offer).toMatchObject({
      status: "CLAIMED",
      claimedBy: rider.id,
    });
    expect(accepted.assignment).toMatchObject({
      status: "ACTIVE",
      phase: "ASSIGNED",
    });
    expect(
      acceptOffer({
        offer: accepted.offer,
        order: { ...order, status: "ASSIGNED", riderId: rider.id },
        rider,
        now,
      }),
    ).toMatchObject({
      offer: accepted.offer,
      assignment: accepted.assignment,
      events: [],
    });
  });

  it("rejects inactive, unavailable, cross-zone, and already claimed riders", () => {
    const offer = createDispatchOffer(order, "own_fleet", now, 2).offer!;
    expect(() =>
      acceptOffer({ offer, order, rider: { ...rider, active: false }, now }),
    ).toThrow(/Rider not found/);
    expect(() =>
      acceptOffer({ offer, order, rider: { ...rider, available: false }, now }),
    ).toThrow(/must be available/);
    expect(() =>
      acceptOffer({ offer, order, rider: { ...rider, zoneId: "zone-2" }, now }),
    ).toThrow(/outside your zone/);
    expect(() =>
      acceptOffer({
        offer: { ...offer, status: "CLAIMED", claimedBy: "other" },
        order,
        rider,
        now,
      }),
    ).toThrow(/already assigned/);
  });

  it("records a rider rejection without closing the zone-wide offer", () => {
    const offer = createDispatchOffer(order, "own_fleet", now, 2).offer!;
    const result = rejectOffer(offer, rider.id, now, "too_far");
    expect(result.offer).toBe(offer);
    expect(result.event).toMatchObject({
      type: "dispatch.offer_rejected",
      riderId: rider.id,
    });
  });

  it("flags a timeout once and never cancels the order", () => {
    const offer = createDispatchOffer(order, "own_fleet", now, 2).offer!;
    expect(
      flagTimedOutOffer(offer, new Date(now.getTime() + 119_000), 120),
    ).toBe(offer);
    const flagged = flagTimedOutOffer(
      offer,
      new Date(now.getTime() + 120_000),
      120,
    );
    expect(flagged).toMatchObject({
      status: "OPEN",
      flagReason: "CLAIM_TIMEOUT",
    });
    expect(
      flagTimedOutOffer(flagged, new Date(now.getTime() + 240_000), 120),
    ).toBe(flagged);
  });
});

describe("dispatch state guards", () => {
  it("allows admin reassignment but guards pickup and order phases", () => {
    expect(
      adminAssignmentDecision(
        { ...order, status: "ASSIGNED", riderId: "old" },
        rider,
      ),
    ).toEqual({ kind: "ASSIGN", riderId: rider.id });
    expect(
      adminAssignmentDecision(
        { ...order, status: "ASSIGNED", riderId: rider.id },
        rider,
      ),
    ).toEqual({ kind: "NOOP", riderId: rider.id });
    expect(() =>
      adminAssignmentDecision({ ...order, pickup: true }, rider),
    ).toThrow(/Pickup orders/);
    expect(() =>
      adminAssignmentDecision({ ...order, status: "PENDING" }, rider),
    ).toThrow(/accepted by the store/);
  });

  it("only lets the assigned rider progress ASSIGNED to PICKED to DELIVERED", () => {
    const assigned = {
      ...order,
      status: "ASSIGNED" as const,
      riderId: rider.id,
    };
    expect(riderStatusDecision(assigned, rider.id, "PICKED")).toEqual({
      kind: "TRANSITION",
      to: "PICKED",
    });
    expect(
      riderStatusDecision(
        { ...assigned, status: "PICKED" },
        rider.id,
        "DELIVERED",
      ),
    ).toEqual({ kind: "TRANSITION", to: "DELIVERED" });
    expect(
      riderStatusDecision(
        { ...assigned, status: "PICKED" },
        rider.id,
        "PICKED",
      ),
    ).toEqual({ kind: "NOOP", to: "PICKED" });
    expect(() => riderStatusDecision(assigned, "other", "PICKED")).toThrow(
      /Forbidden/,
    );
    expect(() => riderStatusDecision(assigned, rider.id, "DELIVERED")).toThrow(
      /PICKED before/,
    );
  });
});

describe("delivery routing", () => {
  it("routes own-fleet orders and delegates configured external fleets", async () => {
    const external = {
      route: vi
        .fn()
        .mockResolvedValue({ kind: "EXTERNAL_REQUESTED", reference: "ext-1" }),
    };
    await expect(
      new ConfigurableDeliveryRouter("own_fleet", external).route(order),
    ).resolves.toEqual({ kind: "OWN_FLEET", zoneId: "zone-1" });
    await expect(
      new ConfigurableDeliveryRouter("third_party_courier", external).route(
        order,
      ),
    ).resolves.toEqual({ kind: "EXTERNAL_REQUESTED", reference: "ext-1" });
  });

  it("fails closed when an external provider is not configured", async () => {
    await expect(
      new ConfigurableDeliveryRouter(
        "third_party_courier",
        new ProviderUnavailableCourier(),
      ).route(order),
    ).rejects.toThrow(/Courier delivery is not available/);
  });
});

describe("location validation", () => {
  it("normalizes a valid device sample", () => {
    expect(
      validateLocationUpdate(
        {
          latitude: "3.139",
          longitude: "101.6869",
          accuracy: 8,
          heading: -1,
          speed: -1,
          deviceTimestamp: "2026-10-08T09:59:58.000Z",
        },
        now,
        null,
        { maxFutureSkewSeconds: 30, maxAgeSeconds: 300, minIntervalMs: 5000 },
      ),
    ).toMatchObject({
      latitude: 3.139,
      longitude: 101.6869,
      heading: null,
      speed: null,
    });
  });

  it("rejects invalid, stale, future, rapid, and non-monotonic samples", () => {
    const policy = {
      maxFutureSkewSeconds: 30,
      maxAgeSeconds: 300,
      minIntervalMs: 5000,
    };
    expect(() =>
      validateLocationUpdate({ latitude: 91, longitude: 1 }, now, null, policy),
    ).toThrow(/Invalid latitude/);
    expect(() =>
      validateLocationUpdate(
        { latitude: 1, longitude: 1, deviceTimestamp: "2026-10-08T09:00:00Z" },
        now,
        null,
        policy,
      ),
    ).toThrow(/too old/);
    expect(() =>
      validateLocationUpdate(
        { latitude: 1, longitude: 1, deviceTimestamp: "2026-10-08T10:01:00Z" },
        now,
        null,
        policy,
      ),
    ).toThrow(/future/);
    const previous = {
      recordedAt: new Date("2026-10-08T09:59:59Z"),
      receivedAt: new Date("2026-10-08T09:59:58Z"),
    };
    expect(() =>
      validateLocationUpdate(
        { latitude: 1, longitude: 1 },
        now,
        previous,
        policy,
      ),
    ).toThrow(/too frequent/);
    expect(() =>
      validateLocationUpdate(
        { latitude: 1, longitude: 1, deviceTimestamp: "2026-10-08T09:59:00Z" },
        new Date("2026-10-08T10:00:10Z"),
        previous,
        policy,
      ),
    ).toThrow(/older than/);
  });
});
