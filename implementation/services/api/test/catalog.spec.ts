import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  CatalogService,
  catalogId,
  catalogPaging,
} from "../src/catalog/service.js";
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
function setup(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return {
    query,
    service: new CatalogService({ query } as unknown as Pick<Pool, "query">),
  };
}
describe("public catalog bounded reads", () => {
  it("accepts only canonical UUID text", () => {
    expect(catalogId(a)).toBe(a);
    for (const input of [
      null,
      1,
      "",
      a + " ",
      "ABCDEFAB-0000-0000-0000-000000000001",
      "' OR true--",
    ])
      expect(() => catalogId(input)).toThrow(/Invalid catalog input/);
  });
  it("defaults pagination but rejects explicit null and invalid limits", () => {
    expect(catalogPaging()).toEqual({ limit: 20, after: null });
    expect(catalogPaging(50, b)).toEqual({ limit: 50, after: b });
    for (const input of [null, 0, 51, 1.5, "20", NaN])
      expect(() => catalogPaging(input)).toThrow();
  });
  it("rejects inputs before reaching SQL", async () => {
    const { service, query } = setup();
    await expect(service.items("bad", 1)).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
    await expect(service.outlets(1, "bad")).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  it("fetches one extra row and returns an allowlisted stable page", async () => {
    const { service, query } = setup([
      {
        id: a,
        name: "Outlet",
        merchantName: "Merchant",
        currency: "MYR",
        published: true,
        merchantId: b,
      },
      { id: b },
    ]);
    expect(await service.outlets(1, a)).toEqual({
      nodes: [
        { id: a, name: "Outlet", merchantName: "Merchant", currency: "MYR" },
      ],
      endCursor: a,
      hasNextPage: true,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([a, 2]);
  });
  it("returns indistinguishable empty catalog responses", async () => {
    const { service } = setup();
    expect(await service.outlet(a)).toBeNull();
    expect(await service.items(a)).toEqual({
      nodes: [],
      endCursor: null,
      hasNextPage: false,
    });
  });
  it("preserves minor-unit extremes and unavailable item visibility", async () => {
    const { service, query } = setup([
      {
        id: a,
        outletId: b,
        name: "Item",
        description: "",
        priceMinor: 2147483647,
        available: false,
        categoryId: a,
        categoryName: "Category",
        published: true,
      },
    ]);
    expect(await service.items(b, 1)).toEqual({
      nodes: [
        {
          id: a,
          outletId: b,
          name: "Item",
          description: "",
          priceMinor: 2147483647,
          available: false,
          category: { id: a, name: "Category" },
        },
      ],
      endCursor: a,
      hasNextPage: false,
    });
    expect(query.mock.calls[0]?.[1]).toEqual([b, null, 2]);
  });
  it("fails closed without leaking database details and recovers on next call", async () => {
    const { service, query } = setup();
    query.mockRejectedValueOnce(new Error("database credentials private"));
    await expect(service.outlets()).rejects.toMatchObject({
      message: "Catalog temporarily unavailable",
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
    expect(await service.outlets()).toEqual({
      nodes: [],
      endCursor: null,
      hasNextPage: false,
    });
  });
});
