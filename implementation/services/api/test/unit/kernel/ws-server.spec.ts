import { describe, expect, it } from "vitest";
import {
  subscriptionServerOptions,
  WS_MAX_PAYLOAD_BYTES,
} from "../../../src/kernel/ws/server.js";

describe("subscription server", () => {
  it("applies the payload limit to both protocol servers", () => {
    for (const protocol of ["graphql-ws", "graphql-transport-ws"] as const) {
      const options = subscriptionServerOptions(protocol);
      expect(options.maxPayload).toBe(WS_MAX_PAYLOAD_BYTES);
      expect(options.handleProtocols()).toBe(protocol);
    }
  });
});
