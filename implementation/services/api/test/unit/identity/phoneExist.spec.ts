import { describe, expect, it, vi } from "vitest";
import { EnategaIdentityAdapter } from "../../../src/identity/enatega.js";
import { normalizePhone } from "../../../src/identity/service.js";
import { op } from "../../support/op.js";

describe(op("mutation.phoneExist"), () => {
  it("delegates the raw number and context to the identity service", async () => {
    const phoneExists = vi.fn().mockResolvedValue(true);
    const adapter = new EnategaIdentityAdapter({
      phoneExists,
    } as unknown as never);
    const context = { ip: "127.0.0.1" };
    await expect(adapter.phoneExist("+60123456789", context)).resolves.toBe(
      true,
    );
    expect(phoneExists).toHaveBeenCalledWith("+60123456789", context);
  });

  it("propagates a false lookup without altering it", async () => {
    const adapter = new EnategaIdentityAdapter({
      phoneExists: vi.fn().mockResolvedValue(false),
    } as unknown as never);
    await expect(adapter.phoneExist("+60199999999", { ip: "x" })).resolves.toBe(
      false,
    );
  });

  it("normalizes client separators to the stored E.164 form", () => {
    expect(normalizePhone("+60 12-345 6789")).toBe("+60123456789");
    expect(normalizePhone(" +60 (12) 345.6789 ")).toBe("+60123456789");
  });

  it("rejects numbers that are not E.164-shaped", () => {
    for (const value of [
      "0123456789",
      "+123",
      "+6012345678901234",
      "not-a-phone",
      "",
      undefined,
    ])
      expect(() => normalizePhone(value)).toThrowError(/Invalid request/);
  });
});
