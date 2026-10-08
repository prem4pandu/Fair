import { describe, expect, it } from "vitest";
import { decideOrderTransition } from "../../../src/orders/state-machine.js";

describe("order state machine", () => {
  it("allows the complete delivery lifecycle", () => {
    expect(
      decideOrderTransition({
        from: "PENDING",
        to: "ACCEPTED",
        actor: "RESTAURANT",
        pickup: false,
        preparationMinutes: 20,
      }).kind,
    ).toBe("APPLY");
    expect(
      decideOrderTransition({
        from: "ACCEPTED",
        to: "ASSIGNED",
        actor: "ADMIN",
        pickup: false,
        riderId: "r1",
      }).kind,
    ).toBe("APPLY");
    expect(
      decideOrderTransition({
        from: "ASSIGNED",
        to: "PICKED",
        actor: "RIDER",
        pickup: false,
      }).kind,
    ).toBe("APPLY");
    expect(
      decideOrderTransition({
        from: "PICKED",
        to: "DELIVERED",
        actor: "RIDER",
        pickup: false,
      }).kind,
    ).toBe("APPLY");
  });

  it("uses ACCEPTED to DELIVERED for pickup", () => {
    expect(
      decideOrderTransition({
        from: "ACCEPTED",
        to: "DELIVERED",
        actor: "RESTAURANT",
        pickup: true,
      }).kind,
    ).toBe("APPLY");
    expect(() =>
      decideOrderTransition({
        from: "ACCEPTED",
        to: "ASSIGNED",
        actor: "ADMIN",
        pickup: true,
        riderId: "r1",
      }),
    ).toThrow(/cannot move/);
  });

  it("is idempotent for an already reached state", () => {
    expect(
      decideOrderTransition({
        from: "ACCEPTED",
        to: "ACCEPTED",
        actor: "RESTAURANT",
        pickup: false,
      }),
    ).toMatchObject({ kind: "NOOP" });
  });

  it("permits only an admin to reassign an assigned delivery", () => {
    expect(
      decideOrderTransition({
        from: "ASSIGNED",
        to: "ASSIGNED",
        actor: "ADMIN",
        pickup: false,
        currentRiderId: "r1",
        riderId: "r2",
      }).kind,
    ).toBe("APPLY");
    expect(() =>
      decideOrderTransition({
        from: "ASSIGNED",
        to: "ASSIGNED",
        actor: "RIDER",
        pickup: false,
        currentRiderId: "r1",
        riderId: "r2",
      }),
    ).toThrow(/cannot perform/);
  });

  it("limits cancellation after acceptance to admins", () => {
    expect(() =>
      decideOrderTransition({
        from: "ACCEPTED",
        to: "CANCELLED",
        actor: "CUSTOMER",
        pickup: false,
      }),
    ).toThrow(/cannot perform/);
  });

  it("requires preparation time and a rider at their transitions", () => {
    expect(() =>
      decideOrderTransition({
        from: "PENDING",
        to: "ACCEPTED",
        actor: "RESTAURANT",
        pickup: false,
        preparationMinutes: 0,
      }),
    ).toThrow(/between 1 and 180/);
    expect(() =>
      decideOrderTransition({
        from: "ACCEPTED",
        to: "ASSIGNED",
        actor: "ADMIN",
        pickup: false,
      }),
    ).toThrow(/Assign a rider/);
  });

  it("enforces actor classes", () => {
    expect(() =>
      decideOrderTransition({
        from: "PENDING",
        to: "ACCEPTED",
        actor: "CUSTOMER",
        pickup: false,
        preparationMinutes: 10,
      }),
    ).toThrow(/cannot perform/);
  });
});
