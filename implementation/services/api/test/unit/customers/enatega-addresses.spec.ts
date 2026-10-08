import { GraphQLError } from "graphql";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  AddressesService,
  enategaAddress,
  enategaAddressInput,
} from "../../../src/addresses/service.js";

const owner = "00000000-0000-0000-0000-000000000001";
const first = "00000000-0000-0000-0000-000000000002";
const second = "00000000-0000-0000-0000-000000000003";
const row = {
  id: first,
  label: "Home",
  deliveryAddress: "1 Jalan Test",
  details: "Lobby",
  longitude: 101.6869,
  latitude: 3.139,
  selected: true,
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
  return { service, query, connect, authorize };
}

describe("Enatega address compatibility", () => {
  it("accepts the clients' coordinate strings and maps stored coordinates", () => {
    expect(
      enategaAddressInput({
        _id: first,
        label: " Home ",
        deliveryAddress: " 1 Jalan Test ",
        details: " Lobby ",
        longitude: "101.6869",
        latitude: "3.139",
      }),
    ).toEqual({
      id: first,
      input: {
        label: "Home",
        deliveryAddress: "1 Jalan Test",
        details: "Lobby",
        longitude: 101.6869,
        latitude: 3.139,
      },
    });
    expect(enategaAddress(row)).toEqual({
      _id: first,
      id: first,
      label: "Home",
      deliveryAddress: "1 Jalan Test",
      details: "Lobby",
      location: { coordinates: [101.6869, 3.139] },
      selected: true,
    });
  });

  it("rejects coercion surprises, unknown fields and invalid edit ids", () => {
    const base = {
      label: "Home",
      deliveryAddress: "1 Jalan Test",
      details: "Lobby",
      longitude: "101.6",
      latitude: "3.1",
    };
    for (const invalid of [
      { ...base, longitude: "" },
      { ...base, longitude: "NaN" },
      { ...base, latitude: "91" },
      { ...base, userId: owner },
      { ...base, _id: "not-an-id" },
    ])
      expect(() => enategaAddressInput(invalid)).toThrow(GraphQLError);
  });

  it("bulk deletes only owned ids and returns the persisted remainder", async () => {
    const { service, query } = setup();
    query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT") ? [row] : [],
    }));
    await expect(
      service.deleteBulk([first, second, first], { ip: "127.0.0.1" }),
    ).resolves.toEqual({
      _id: owner,
      addresses: [enategaAddress(row)],
    });
    const removal = query.mock.calls.find((call) =>
      String(call[0]).startsWith("DELETE"),
    );
    expect(removal?.[1]).toEqual([owner, [first, second]]);
    expect(String(removal?.[0])).toContain('"userId"=$1::uuid');
  });

  it("authenticates before validating or opening a bulk transaction", async () => {
    const { service, authorize, connect } = setup();
    const denied = new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
    authorize.mockRejectedValue(denied);
    await expect(
      service.deleteBulk(["invalid"], { ip: "127.0.0.1" }),
    ).rejects.toBe(denied);
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires one to fifty canonical ids for bulk deletion", async () => {
    const { service, connect } = setup();
    for (const ids of [[], ["invalid"], Array(51).fill(first), "bad"])
      await expect(
        service.deleteBulk(ids, { ip: "127.0.0.1" }),
      ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(connect).not.toHaveBeenCalled();
  });
});
