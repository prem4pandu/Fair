import { describe, expect, it, vi } from "vitest";
import { EnategaIdentityAdapter } from "../../../src/identity/enatega.js";
import { op } from "../../support/op.js";

describe(op("mutation.changePassword"), () => {
  it("forwards both password fields and the context to the identity service", async () => {
    const changePassword = vi.fn().mockResolvedValue("ok");
    const adapter = new EnategaIdentityAdapter({
      changePassword,
    } as unknown as never);
    const context = { ip: "127.0.0.1" };
    const input = {
      oldPassword: "synthetic-old-password-12",
      newPassword: "synthetic-new-password-34",
    };
    await expect(adapter.changePassword(input, context)).resolves.toBe("ok");
    expect(changePassword).toHaveBeenCalledWith(input, context);
  });

  it("propagates the null result the pinned client reads as an invalid password", async () => {
    const adapter = new EnategaIdentityAdapter({
      changePassword: vi.fn().mockResolvedValue(null),
    } as unknown as never);
    await expect(
      adapter.changePassword(
        {
          oldPassword: "wrong-password-123",
          newPassword: "synthetic-new-password-34",
        },
        { ip: "x" },
      ),
    ).resolves.toBeNull();
  });
});
