import { describe, expect, it, vi } from "vitest";
import { EnategaIdentityAdapter } from "../../../src/identity/enatega.js";
import { op } from "../../support/op.js";

describe(op("mutation.updateUser"), () => {
  it("forwards the profile input and context to the identity service", async () => {
    const updateUser = vi.fn().mockResolvedValue({
      _id: "018f0000-0000-7000-8000-0000000000a1",
      name: "Updated Name",
      phone: "+60123456789",
      phoneIsVerified: false,
      emailIsVerified: false,
    });
    const adapter = new EnategaIdentityAdapter({
      updateUser,
    } as unknown as never);
    const context = { ip: "127.0.0.1" };
    const input = { name: "Updated Name", phone: "+60123456789" };
    await expect(adapter.updateUser(input, context)).resolves.toMatchObject({
      name: "Updated Name",
    });
    expect(updateUser).toHaveBeenCalledWith(input, context);
  });

  it("degrades a missing input object rather than passing undefined through", async () => {
    const updateUser = vi.fn().mockResolvedValue(null);
    const adapter = new EnategaIdentityAdapter({
      updateUser,
    } as unknown as never);
    await adapter.updateUser(undefined as unknown as Record<string, unknown>, {
      ip: "x",
    });
    expect(updateUser).toHaveBeenCalledWith({}, { ip: "x" });
  });
});
