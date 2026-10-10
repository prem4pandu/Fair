import { describe, expect, it, vi } from "vitest";
import { EnategaIdentityAdapter } from "../../../src/identity/enatega.js";
import { op } from "../../support/op.js";

describe(op("mutation.Deactivate"), () => {
  it("forwards the ownership claim and the requested state to the identity service", async () => {
    const deactivate = vi.fn().mockResolvedValue({
      _id: "018f0000-0000-7000-8000-0000000000a1",
      email: "owner@example.test",
      name: "Synthetic Principal",
      isActive: false,
    });
    const adapter = new EnategaIdentityAdapter({
      deactivate,
    } as unknown as never);
    const context = { ip: "127.0.0.1" };
    const input = { email: "owner@example.test", isActive: false };
    await expect(adapter.deactivate(input, context)).resolves.toMatchObject({
      isActive: false,
    });
    expect(deactivate).toHaveBeenCalledWith(input, context);
  });

  it("propagates a rejection without inventing a result", async () => {
    const adapter = new EnategaIdentityAdapter({
      deactivate: vi.fn().mockRejectedValue(new Error("forbidden")),
    } as unknown as never);
    await expect(
      adapter.deactivate(
        { email: "other@example.test", isActive: false },
        { ip: "x" },
      ),
    ).rejects.toThrowError(/forbidden/);
  });
});
