import { describe, expect, it, vi } from "vitest";
import { apiUrl, checkConnection, parseServiceInfo } from "./connection";
import type { ConnectionRequest } from "./connection";
describe("mobile backend connection", () => {
  it("rejects redirect destinations and nonstreaming bodies without buffering", async () => {
    const redirected = new Response("{}");
    Object.defineProperty(redirected, "url", {
      value: "http://untrusted.example/graphql",
    });
    const noBody = new Response(null);
    for (const response of [redirected, noBody])
      await expect(
        checkConnection(
          "https://example.com/graphql",
          new AbortController().signal,
          vi.fn<ConnectionRequest>().mockResolvedValue(response),
        ),
      ).rejects.toThrow("Backend returned an invalid response");
  });
  it("preserves dependency unavailability instead of reporting ready", () => {
    expect(
      parseServiceInfo({
        data: { serviceInfo: { name: "service", status: "unavailable" } },
      }),
    ).toEqual({ name: "service", status: "unavailable" });
  });
  it("fails closed for absent, malformed, unsafe or credential-bearing config", () => {
    for (const value of [
      undefined,
      "",
      "garbage",
      "http://api.example/graphql",
      "https://user:pass@example.com/graphql",
      "https://example.com/graphql?token=x",
      "https://example.com/graphql#x",
      "https://example.com/wrong",
      "ftp://example.com/graphql",
    ])
      expect(() => apiUrl(value)).toThrow();
    expect(apiUrl("https://example.com/graphql")).toBe(
      "https://example.com/graphql",
    );
    expect(apiUrl("http://localhost:4100/graphql")).toBe(
      "http://localhost:4100/graphql",
    );
  });
  it("rejects GraphQL errors and malformed service statuses", () => {
    for (const value of [
      null,
      [],
      {},
      {
        errors: [],
        data: { serviceInfo: { name: "service", status: "ready" } },
      },
      { data: { serviceInfo: { name: "", status: "ready" } } },
      { data: { serviceInfo: { name: "service", status: "unexpected" } } },
    ])
      expect(() => parseServiceInfo(value)).toThrow();
    expect(
      parseServiceInfo({
        data: { serviceInfo: { name: "service", status: "ready" } },
      }),
    ).toEqual({ name: "service", status: "ready" });
  });
  it("makes only the public service request and parses its response", async () => {
    const request = vi.fn<ConnectionRequest>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { serviceInfo: { name: "service", status: "ready" } },
        }),
      ),
    );
    expect(
      await checkConnection(
        "https://example.com/graphql",
        new AbortController().signal,
        request,
      ),
    ).toEqual({ name: "service", status: "ready" });
    expect(request).toHaveBeenCalledWith(
      "https://example.com/graphql",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "query MobileServiceInfo { serviceInfo { name status } }",
        }),
      }),
    );
  });
  it("handles HTTP outage, invalid JSON, oversized response and network failure safely", async () => {
    for (const response of [
      new Response("private details", { status: 503 }),
      new Response("not JSON"),
      new Response("x".repeat(16385)),
    ]) {
      await expect(
        checkConnection(
          "https://example.com/graphql",
          new AbortController().signal,
          vi.fn<ConnectionRequest>().mockResolvedValue(response),
        ),
      ).rejects.toThrow(/Backend/);
    }
    await expect(
      checkConnection(
        "https://example.com/graphql",
        new AbortController().signal,
        vi
          .fn<ConnectionRequest>()
          .mockRejectedValue(new Error("sensitive detail")),
      ),
    ).rejects.toThrow("Could not reach the backend");
  });
  it("propagates unmount cancellation to the network request", async () => {
    const parent = new AbortController();
    const request = vi.fn<ConnectionRequest>().mockImplementation(
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const pending = checkConnection(
      "https://example.com/graphql",
      parent.signal,
      request,
    );
    parent.abort();
    await expect(pending).rejects.toThrow("cancelled or timed out");
  });
  it("bounds requests to eight seconds", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<ConnectionRequest>().mockImplementation(
        async (_url, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );
      const pending = checkConnection(
        "https://example.com/graphql",
        new AbortController().signal,
        request,
      );
      const assertion = expect(pending).rejects.toThrow(
        "cancelled or timed out",
      );
      await vi.advanceTimersByTimeAsync(8000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
