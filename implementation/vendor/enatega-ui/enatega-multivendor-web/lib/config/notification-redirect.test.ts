import { describe, expect, it } from "vitest";
import { normalizeNotificationRedirect } from "./notification-redirect";

const origin = "https://orders.fairbite.example";

describe("normalizeNotificationRedirect", () => {
  it.each([
    ["external absolute URL", "https://attacker.example/order/1"],
    ["same-origin protocol-relative URL", "//orders.fairbite.example/order/1"],
    ["javascript URL", "javascript:alert(1)"],
    ["malformed URL", "http://[::1"],
  ])("rejects %s", (_label, candidate) => {
    expect(normalizeNotificationRedirect(candidate, origin)).toBeNull();
  });

  it("keeps a valid same-origin path with query and fragment", () => {
    expect(
      normalizeNotificationRedirect(
        "https://orders.fairbite.example/order/1/tracking?from=push#status",
        origin,
      ),
    ).toBe("/order/1/tracking?from=push#status");
  });

  it("accepts an application-relative path", () => {
    expect(
      normalizeNotificationRedirect("/profile/order-history", origin),
    ).toBe("/profile/order-history");
  });
});
