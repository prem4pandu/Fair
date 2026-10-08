import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatPrice,
  getItems,
  getOutlet,
  getOutlets,
  storePath,
  validCatalogId,
} from "./catalog";
vi.mock("server-only", () => ({}));
const id = "10000000-0000-0000-0000-000000000001";
const categoryId = "20000000-0000-0000-0000-000000000001";
const outlet = {
  id,
  name: "Lunch & Co",
  merchantName: "Merchant",
  currency: "MYR",
};
const response = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("FAIRBITE_API_URL", "http://localhost:4400/graphql");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("canonical catalog adapter", () => {
  it("uses server endpoint and cursor variables with no-store", async () => {
    fetchMock.mockResolvedValue(
      response({
        catalogOutlets: { nodes: [outlet], endCursor: id, hasNextPage: false },
      }),
    );
    expect((await getOutlets(id)).nodes).toEqual([outlet]);
    const [endpoint, options] = fetchMock.mock.calls[0];
    expect(String(endpoint)).toBe("http://localhost:4400/graphql");
    expect(options.cache).toBe("no-store");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body).variables).toEqual({ after: id });
  });
  it("does not call an upstream endpoint when configuration is absent or insecure", async () => {
    vi.stubEnv("FAIRBITE_API_URL", "http://upstream.invalid/graphql");
    await expect(getOutlets(null)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("FAIRBITE_API_URL", "");
    await expect(getOutlets(null)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("distinguishes a real missing outlet from invalid response", async () => {
    fetchMock.mockResolvedValueOnce(response({ catalogOutlet: null }));
    expect(await getOutlet(id)).toBeNull();
    fetchMock.mockResolvedValueOnce(response({}));
    await expect(getOutlet(id)).rejects.toThrow();
  });
  it.each([
    { nodes: [outlet], endCursor: null, hasNextPage: false },
    { nodes: [outlet, outlet], endCursor: id, hasNextPage: false },
    { nodes: [], endCursor: null, hasNextPage: true },
    {
      nodes: [{ ...outlet, currency: "usd" }],
      endCursor: id,
      hasNextPage: false,
    },
  ])("rejects malformed page metadata %#", async (bad) => {
    fetchMock.mockResolvedValue(response({ catalogOutlets: bad }));
    await expect(getOutlets(null)).rejects.toThrow();
  });
  it("rejects GraphQL errors even with apparent valid data", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ message: "failure" }],
          data: { catalogOutlet: outlet },
        }),
      ),
    );
    await expect(getOutlet(id)).rejects.toThrow();
  });
  it("rejects oversized streamed payloads", async () => {
    fetchMock.mockResolvedValue(new Response("x".repeat(196609)));
    await expect(getOutlets(null)).rejects.toThrow("too large");
  });
  it("rejects money decimals and cross-outlet items", async () => {
    const item = {
      id: categoryId,
      outletId: id,
      name: "Soup",
      description: "Warm",
      priceMinor: 1234,
      available: false,
      category: { id: categoryId, name: "Lunch" },
    };
    fetchMock.mockResolvedValueOnce(
      response({
        catalogItems: {
          nodes: [{ ...item, priceMinor: 12.34 }],
          endCursor: categoryId,
          hasNextPage: false,
        },
      }),
    );
    await expect(getItems(id, null)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(
      response({
        catalogItems: {
          nodes: [{ ...item, outletId: categoryId }],
          endCursor: categoryId,
          hasNextPage: false,
        },
      }),
    );
    await expect(getItems(id, null)).rejects.toThrow("ownership");
  });
  it("formats server minor-unit currency precision and canonical safe slug", () => {
    expect(formatPrice(1234, "USD")).toBe("$12.34");
    expect(formatPrice(1234, "JPY")).toBe("¥1,234");
    expect(storePath(outlet)).toBe(`/store/lunch-co/${id}`);
    expect(validCatalogId([id])).toBe(false);
    expect(validCatalogId("bad")).toBe(false);
  });
});
