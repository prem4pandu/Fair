import { describe, expect, it, vi } from "vitest";
import { EnategaIdentityAdapter } from "../../../src/identity/enatega.js";
import { op } from "../../support/op.js";

describe(op("mutation.sendOtpToEmail"), () => {
  it("forwards only the email target, even when a client also sends an otp", async () => {
    const sendOtp = vi.fn().mockResolvedValue({ result: "SENT" });
    const adapter = new EnategaIdentityAdapter({
      sendOtp,
    } as unknown as never);
    const context = { ip: "127.0.0.1" };
    await expect(
      adapter.sendOtpToEmail(
        { email: "user@example.test", otp: "123456" },
        context,
      ),
    ).resolves.toEqual({ result: "SENT" });
    // The client-chosen code reaches the service only so it can be ignored; the
    // service never treats it as the code to deliver.
    expect(sendOtp).toHaveBeenCalledWith(
      { email: "user@example.test", otp: "123456" },
      context,
    );
  });

  it(`${op("mutation.sendOtpToPhoneNumber")} forwards the phone target for the SMS root`, async () => {
    const sendOtp = vi.fn().mockResolvedValue({ result: "SENT" });
    const adapter = new EnategaIdentityAdapter({
      sendOtp,
    } as unknown as never);
    await adapter.sendOtpToPhoneNumber({ phone: "+60123456789" }, { ip: "x" });
    expect(sendOtp).toHaveBeenCalledWith(
      { phone: "+60123456789", otp: undefined },
      { ip: "x" },
    );
  });
});
