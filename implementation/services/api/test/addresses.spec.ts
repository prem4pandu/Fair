import { describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";
import type { Pool } from "pg";
import {
  addressId,
  addressInput,
  AddressesService,
} from "../src/addresses/service.js";
const owner = "00000000-0000-0000-0000-000000000001";
const id = "00000000-0000-0000-0000-000000000002";
const input = {
  label: " Home ",
  deliveryAddress: " Street ",
  details: " ",
  longitude: 180,
  latitude: -90,
};
const row = {
  id,
  label: "Home",
  deliveryAddress: "Street",
  details: "",
  longitude: 180,
  latitude: -90,
  selected: false,
  userId: owner,
};
function setup() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const authorize = vi.fn().mockResolvedValue({ id: owner });
  const service = new AddressesService(
    { query, connect } as unknown as Pick<Pool, "query" | "connect">,
    { authorize },
  );
  return { query, release, connect, authorize, service };
}
describe("owned saved addresses", () => {
  it("normalizes strict input at finite boundaries", () => {
    expect(addressInput(input)).toEqual({
      ...input,
      label: "Home",
      deliveryAddress: "Street",
      details: "",
    });
    for (const value of [
      null,
      [],
      {},
      { ...input, userId: owner },
      { ...input, selected: true },
      { ...input, label: " " },
      { ...input, label: "x".repeat(101) },
      { ...input, deliveryAddress: "x".repeat(501) },
      { ...input, details: "x".repeat(1001) },
      { ...input, details: "a\0b" },
      { ...input, latitude: 90.1 },
      { ...input, longitude: Infinity },
      { ...input, longitude: NaN },
      { ...input, latitude: "1" },
    ])
      expect(() => addressInput(value)).toThrow();
    expect(
      addressInput({
        ...input,
        label: "x".repeat(100),
        deliveryAddress: "x".repeat(500),
        details: "x".repeat(1000),
      }).label,
    ).toHaveLength(100);
  });
  it("requires canonical UUID ids", () => {
    expect(addressId(id)).toBe(id);
    for (const value of [
      null,
      1,
      id + " ",
      "ABCDEFAB-0000-0000-0000-000000000001",
      "bad",
    ])
      expect(() => addressId(value)).toThrow();
  });
  it("authenticates before any address database or validation", async () => {
    const { service, authorize, query, connect } = setup();
    const denied = new GraphQLError("denied", {
      extensions: { code: "UNAUTHENTICATED" },
    });
    authorize.mockRejectedValue(denied);
    for (const action of [
      () => service.list({ ip: "127.0.0.1" }),
      () => service.create({}, { ip: "127.0.0.1" }),
      () => service.update("bad", {}, { ip: "127.0.0.1" }),
      () => service.delete("bad", { ip: "127.0.0.1" }),
      () => service.select("bad", { ip: "127.0.0.1" }),
    ])
      await expect(action()).rejects.toBe(denied);
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
  it("lists only explicit public fields, scoped to principal", async () => {
    const { service, query } = setup();
    query.mockResolvedValue({ rows: [row] });
    const result = await service.list({ ip: "127.0.0.1" });
    expect(result[0]).not.toHaveProperty("userId");
    expect(query.mock.calls[0]?.[1]).toEqual([owner]);
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY id LIMIT 50");
  });
  it("creates within owner lock and preserves unselected default", async () => {
    const { service, query, release } = setup();
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("count(*)")
        ? [{ count: 49 }]
        : sql.includes("INSERT")
          ? [row]
          : [],
    }));
    expect(await service.create(input, { ip: "127.0.0.1" })).toEqual({
      ...row,
      userId: undefined,
    });
    const insert = query.mock.calls.find((call) => call[0].includes("INSERT"));
    expect(insert?.[1].slice(1)).toEqual([
      owner,
      "Home",
      "Street",
      "",
      180,
      -90,
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([`customer-address:${owner}`]);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledWith(false);
  });
  it("rolls back cap and missing updates without leaking existence", async () => {
    const { service, query, release } = setup();
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("count(*)") ? [{ count: 50 }] : [],
    }));
    await expect(
      service.create(input, { ip: "127.0.0.1" }),
    ).rejects.toMatchObject({
      extensions: { code: "ADDRESS_LIMIT_REACHED" },
    });
    await expect(
      service.update(id, input, { ip: "127.0.0.1" }),
    ).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" },
    });
    expect(query.mock.calls.some((call) => call[0].includes("INSERT"))).toBe(
      false,
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("foreign select never clears current choice; delete remains generic", async () => {
    const { service, query } = setup();
    await expect(service.select(id, { ip: "127.0.0.1" })).rejects.toMatchObject(
      {
        extensions: { code: "NOT_FOUND" },
      },
    );
    expect(
      query.mock.calls.some((call) => call[0].includes("SET selected")),
    ).toBe(false);
    expect(await service.delete(id, { ip: "127.0.0.1" })).toEqual({
      accepted: true,
    });
    const removal = query.mock.calls.find((call) =>
      call[0].startsWith("DELETE"),
    );
    expect(removal?.[1]).toEqual([id, owner]);
  });
  it("select verifies ownership before clearing and selects under same lock", async () => {
    const { service, query } = setup();
    query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT id")
        ? [{ id }]
        : sql.includes("RETURNING")
          ? [{ ...row, selected: true }]
          : [],
    }));
    expect((await service.select(id, { ip: "127.0.0.1" })).selected).toBe(true);
    const updates = query.mock.calls.filter((call) =>
      call[0].startsWith("UPDATE"),
    );
    expect(updates[0]?.[1]).toEqual([owner]);
    expect(updates[1]?.[1]).toEqual([id, owner]);
  });
  it("redacts outages and discards clients when rollback fails", async () => {
    const { service, query, release, connect } = setup();
    query.mockRejectedValue(new Error("secret connection/address"));
    await expect(service.list({ ip: "127.0.0.1" })).rejects.toMatchObject({
      message: "Addresses temporarily unavailable",
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
    await expect(service.delete(id, { ip: "127.0.0.1" })).rejects.toMatchObject(
      {
        extensions: { code: "SERVICE_UNAVAILABLE" },
      },
    );
    expect(release).toHaveBeenCalledWith(true);
    connect.mockRejectedValue(new Error("credential"));
    await expect(
      service.create(input, { ip: "127.0.0.1" }),
    ).rejects.toMatchObject({
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  });
});
