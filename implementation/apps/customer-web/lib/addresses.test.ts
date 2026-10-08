import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { addressesGet, addressesPost } from "./addresses";
import { names } from "./auth";
vi.mock("server-only", () => ({}));
const id = "10000000-0000-0000-0000-000000000001";
const input = {
  label: "Home",
  deliveryAddress: "12 Main Street",
  details: "Unit 3",
  longitude: 101.7,
  latitude: 3.1,
};
const address = { id, ...input, selected: false };
const backend = vi.fn();
function request(body?: unknown, extra: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3100/api/customer/addresses", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      host: "localhost:3100",
      origin: "http://localhost:3100",
      "content-type": "application/json",
      cookie: `${names().access}=abc.def.ghi`,
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const response = (data: unknown) => new Response(JSON.stringify({ data }));
beforeEach(() => {
  vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4100/graphql");
  vi.stubEnv("FAIRBITE_WEB_ORIGIN", "http://localhost:3100");
  vi.stubGlobal("fetch", backend);
  backend.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("address BFF security boundary", () => {
  it("returns only own allowlisted fields without tokens or backend metadata", async () => {
    backend.mockResolvedValue(
      response({
        customerAddresses: [
          { ...address, userId: "private", accessToken: "secret" },
        ],
      }),
    );
    const result = await addressesGet(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ addresses: [address] });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    const options = backend.mock.calls[0][1];
    expect(options.cache).toBe("no-store");
    expect(options.headers.authorization).toBe("Bearer abc.def.ghi");
  });
  it("supports a valid 50-record list larger than identity response cap", async () => {
    const records = Array.from({ length: 50 }, (_, n) => ({
      ...address,
      id: `10000000-0000-0000-0000-${String(n + 1).padStart(12, "0")}`,
      details: "é".repeat(1000),
    }));
    backend.mockResolvedValue(response({ customerAddresses: records }));
    expect((await addressesGet(request())).status).toBe(200);
  });
  it.each([
    { nodes: "wrong" },
    Array.from({ length: 51 }, () => address),
    [address, address],
    [{ ...address, longitude: 181 }],
    [{ ...address, selected: "true" }],
  ])("rejects malformed backend list %#", async (value) => {
    backend.mockResolvedValue(response({ customerAddresses: value }));
    expect((await addressesGet(request())).status).toBe(503);
  });
  it("rejects missing token before calling backend", async () => {
    expect(
      (await addressesGet(request(undefined, { cookie: "" }))).status,
    ).toBe(401);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each(["https://foreign.example", ""])(
    "rejects mutation origin %s before backend",
    async (origin) => {
      expect(
        (await addressesPost(request({ action: "delete", id }, { origin })))
          .status,
      ).toBe(403);
      expect(backend).not.toHaveBeenCalled();
    },
  );
  it.each([
    { action: "create", input: { ...input, userId: id } },
    { action: "create", input: { ...input, selected: true } },
    { action: "create", input, userId: id },
    { action: "create", input: { ...input, longitude: "101.7" } },
    { action: "create", input: { ...input, latitude: 91 } },
    { action: "create", input: { ...input, label: " " } },
    { action: "select", id, input },
    { action: "delete", id: "invalid" },
  ])("rejects injected or malformed command %#", async (command) => {
    expect((await addressesPost(request(command))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it("forwards only canonical create and returns accepted without payload secrets", async () => {
    backend.mockResolvedValue(
      response({
        createCustomerAddress: {
          ...address,
          userId: id,
          accessToken: "secret",
        },
      }),
    );
    const result = await addressesPost(request({ action: "create", input }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ accepted: true });
    expect(JSON.parse(backend.mock.calls[0][1].body).variables).toEqual({
      input,
    });
  });
  it("rejects update/select response pointing to another address", async () => {
    backend.mockResolvedValue(
      response({
        updateCustomerAddress: {
          ...address,
          id: "20000000-0000-0000-0000-000000000001",
        },
      }),
    );
    expect(
      (await addressesPost(request({ action: "update", id, input }))).status,
    ).toBe(503);
  });
  it.each([
    ["NOT_FOUND", 404],
    ["ADDRESS_LIMIT_REACHED", 409],
    ["AUTHENTICATION_FAILED", 401],
    ["FORBIDDEN", 403],
    ["BAD_USER_INPUT", 400],
    ["SECRET_SQL_ERROR", 503],
  ])("maps backend %s to bounded status %s", async (code, status) => {
    backend.mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ message: "private SQL query", extensions: { code } }],
        }),
      ),
    );
    const result = await addressesPost(request({ action: "delete", id }));
    expect(result.status).toBe(status);
    expect(await result.text()).not.toContain("private SQL");
  });
  it("rejects malformed JSON and oversized backend without leaking errors", async () => {
    backend.mockResolvedValueOnce(new Response("not json"));
    expect((await addressesGet(request())).status).toBe(503);
    backend.mockResolvedValueOnce(new Response("x".repeat(524289)));
    expect((await addressesGet(request())).status).toBe(503);
  });
  it("does not claim delete success for false acknowledgement", async () => {
    backend.mockResolvedValue(
      response({ deleteCustomerAddress: { accepted: false } }),
    );
    expect(
      (await addressesPost(request({ action: "delete", id }))).status,
    ).toBe(503);
  });
});
