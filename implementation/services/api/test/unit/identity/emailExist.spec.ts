import { describe, expect, it, vi } from "vitest";
import { EnategaIdentityAdapter } from "../../../src/identity/enatega.js";
import { normalizeEmail } from "../../../src/identity/service.js";
import { op } from "../../support/op.js";

describe(op("mutation.emailExist"), () => {
  it("delegates the raw address and context to the identity service", async () => {
    const emailExists = vi.fn().mockResolvedValue(true);
    const adapter = new EnategaIdentityAdapter({
      emailExists,
    } as unknown as never);
    const context = { ip: "127.0.0.1" };
    await expect(
      adapter.emailExist("owner@example.test", context),
    ).resolves.toBe(true);
    expect(emailExists).toHaveBeenCalledWith("owner@example.test", context);
  });

  it("propagates a false lookup without altering it", async () => {
    const adapter = new EnategaIdentityAdapter({
      emailExists: vi.fn().mockResolvedValue(false),
    } as unknown as never);
    await expect(
      adapter.emailExist("nobody@example.test", { ip: "x" }),
    ).resolves.toBe(false);
  });

  it("normalizes case and whitespace, and rejects a malformed address", () => {
    expect(normalizeEmail("  Owner@Example.TEST ")).toBe("owner@example.test");
    expect(() => normalizeEmail("not-an-email")).toThrowError(
      /Invalid request/,
    );
    expect(() => normalizeEmail(undefined)).toThrowError(/Invalid request/);
  });
});
