import { randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";
import type { Pool, PoolClient } from "pg";
import type { IdentityContext } from "../identity/service.js";

export interface AddressAuthority {
  authorize(context: IdentityContext): Promise<{ id: string }>;
}
export interface CustomerAddress {
  id: string;
  label: string;
  deliveryAddress: string;
  details: string;
  longitude: number;
  latitude: number;
  selected: boolean;
}
export interface EnategaAddress {
  _id: string;
  id: string;
  label: string;
  deliveryAddress: string;
  details: string;
  location: { coordinates: [number, number] };
  selected: boolean;
}
const fields =
  'id, label, "deliveryAddress", details, longitude, latitude, selected';
function error(code: string, message: string): never {
  throw new GraphQLError(message, { extensions: { code } });
}
export function addressId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    return error("BAD_USER_INPUT", "Invalid address input");
  return value;
}
export function addressInput(
  value: unknown,
): Omit<CustomerAddress, "id" | "selected"> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return error("BAD_USER_INPUT", "Invalid address input");
  const input = value as Record<string, unknown>;
  const keys = ["label", "deliveryAddress", "details", "longitude", "latitude"];
  if (
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    return error("BAD_USER_INPUT", "Invalid address input");
  const text = (key: string, min: number, max: number) => {
    const raw = input[key];
    if (typeof raw !== "string" || raw.includes("\0"))
      return error("BAD_USER_INPUT", "Invalid address input");
    const trimmed = raw.trim();
    if (trimmed.length < min || trimmed.length > max)
      return error("BAD_USER_INPUT", "Invalid address input");
    return trimmed;
  };
  const coordinate = (key: string, max: number) => {
    const v = input[key];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > max)
      return error("BAD_USER_INPUT", "Invalid address input");
    return v;
  };
  return {
    label: text("label", 1, 100),
    deliveryAddress: text("deliveryAddress", 1, 500),
    details: text("details", 0, 1000),
    longitude: coordinate("longitude", 180),
    latitude: coordinate("latitude", 90),
  };
}
export function enategaAddressInput(value: unknown): {
  id?: string;
  input: Omit<CustomerAddress, "id" | "selected">;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return error("BAD_USER_INPUT", "Invalid address input");
  const source = value as Record<string, unknown>;
  const allowed = new Set([
    "_id",
    "label",
    "deliveryAddress",
    "details",
    "longitude",
    "latitude",
  ]);
  if (Object.keys(source).some((key) => !allowed.has(key)))
    return error("BAD_USER_INPUT", "Invalid address input");
  const coordinate = (key: "longitude" | "latitude") => {
    const raw = source[key];
    if (typeof raw === "number") return raw;
    if (typeof raw !== "string" || raw.trim() === "") return raw;
    return Number(raw);
  };
  const id = source._id === undefined ? undefined : addressId(source._id);
  return {
    ...(id ? { id } : {}),
    input: addressInput({
      label: source.label,
      deliveryAddress: source.deliveryAddress,
      details: source.details,
      longitude: coordinate("longitude"),
      latitude: coordinate("latitude"),
    }),
  };
}
function publicAddress(row: CustomerAddress): CustomerAddress {
  return {
    id: row.id,
    label: row.label,
    deliveryAddress: row.deliveryAddress,
    details: row.details,
    longitude: row.longitude,
    latitude: row.latitude,
    selected: row.selected,
  };
}
export function enategaAddress(row: CustomerAddress): EnategaAddress {
  return {
    _id: row.id,
    id: row.id,
    label: row.label,
    deliveryAddress: row.deliveryAddress,
    details: row.details,
    location: { coordinates: [row.longitude, row.latitude] },
    selected: row.selected,
  };
}
export class AddressesService {
  constructor(
    private readonly pool: Pick<Pool, "query" | "connect">,
    private readonly authority: AddressAuthority,
  ) {}
  private async transaction<T>(
    owner: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    let client: PoolClient | undefined;
    let discard = false;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`customer-address:${owner}`],
      );
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
      }
      if (cause instanceof GraphQLError) throw cause;
      return error("SERVICE_UNAVAILABLE", "Addresses temporarily unavailable");
    } finally {
      client?.release(discard);
    }
  }
  async list(context: IdentityContext) {
    const { id: owner } = await this.authority.authorize(context);
    try {
      const result = await this.pool.query(
        `SELECT ${fields} FROM "CustomerAddress" WHERE "userId"=$1::uuid ORDER BY id LIMIT 50`,
        [owner],
      );
      return (result.rows as CustomerAddress[]).map(publicAddress);
    } catch {
      return error("SERVICE_UNAVAILABLE", "Addresses temporarily unavailable");
    }
  }
  async create(value: unknown, context: IdentityContext) {
    const { id: owner } = await this.authority.authorize(context);
    const input = addressInput(value);
    return this.transaction(owner, async (client) => {
      const count = await client.query(
        'SELECT count(*)::int AS count FROM "CustomerAddress" WHERE "userId"=$1::uuid',
        [owner],
      );
      if (count.rows[0].count >= 50)
        return error("ADDRESS_LIMIT_REACHED", "Address limit reached");
      const result = await client.query(
        `INSERT INTO "CustomerAddress" (id,"userId",label,"deliveryAddress",details,longitude,latitude) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) RETURNING ${fields}`,
        [
          randomUUID(),
          owner,
          input.label,
          input.deliveryAddress,
          input.details,
          input.longitude,
          input.latitude,
        ],
      );
      return publicAddress(result.rows[0]);
    });
  }
  async update(id: unknown, value: unknown, context: IdentityContext) {
    const { id: owner } = await this.authority.authorize(context);
    const target = addressId(id),
      input = addressInput(value);
    return this.transaction(owner, async (client) => {
      const result = await client.query(
        `UPDATE "CustomerAddress" SET label=$3,"deliveryAddress"=$4,details=$5,longitude=$6,latitude=$7 WHERE id=$1::uuid AND "userId"=$2::uuid RETURNING ${fields}`,
        [
          target,
          owner,
          input.label,
          input.deliveryAddress,
          input.details,
          input.longitude,
          input.latitude,
        ],
      );
      if (!result.rows[0]) return error("NOT_FOUND", "Address not found");
      return publicAddress(result.rows[0]);
    });
  }
  async delete(id: unknown, context: IdentityContext) {
    const { id: owner } = await this.authority.authorize(context);
    const target = addressId(id);
    return this.transaction(owner, async (client) => {
      await client.query(
        'DELETE FROM "CustomerAddress" WHERE id=$1::uuid AND "userId"=$2::uuid',
        [target, owner],
      );
      return { accepted: true };
    });
  }
  async select(id: unknown, context: IdentityContext) {
    const { id: owner } = await this.authority.authorize(context);
    const target = addressId(id);
    return this.transaction(owner, async (client) => {
      const existing = await client.query(
        'SELECT id FROM "CustomerAddress" WHERE id=$1::uuid AND "userId"=$2::uuid',
        [target, owner],
      );
      if (!existing.rows[0]) return error("NOT_FOUND", "Address not found");
      await client.query(
        'UPDATE "CustomerAddress" SET selected=FALSE WHERE "userId"=$1::uuid AND selected',
        [owner],
      );
      const result = await client.query(
        `UPDATE "CustomerAddress" SET selected=TRUE WHERE id=$1::uuid AND "userId"=$2::uuid RETURNING ${fields}`,
        [target, owner],
      );
      return publicAddress(result.rows[0]);
    });
  }

  async deleteBulk(ids: unknown, context: IdentityContext) {
    const { id: owner } = await this.authority.authorize(context);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50)
      return error("BAD_USER_INPUT", "Invalid address input");
    const targets = [...new Set(ids.map(addressId))];
    return this.transaction(owner, async (client) => {
      await client.query(
        'DELETE FROM "CustomerAddress" WHERE "userId"=$1::uuid AND id = ANY($2::uuid[])',
        [owner, targets],
      );
      const result = await client.query(
        `SELECT ${fields} FROM "CustomerAddress" WHERE "userId"=$1::uuid ORDER BY id LIMIT 50`,
        [owner],
      );
      return {
        _id: owner,
        addresses: (result.rows as CustomerAddress[]).map(enategaAddress),
      };
    });
  }

  async enategaProfile(context: IdentityContext) {
    const user = await this.authority.authorize(context);
    const addresses = await this.list(context);
    return { _id: user.id, addresses: addresses.map(enategaAddress) };
  }

  async createEnatega(value: unknown, context: IdentityContext) {
    const parsed = enategaAddressInput(value);
    if (parsed.id)
      return error("BAD_USER_INPUT", "New addresses cannot include an id");
    await this.create(parsed.input, context);
    return this.enategaProfile(context);
  }

  async editEnatega(value: unknown, context: IdentityContext) {
    const parsed = enategaAddressInput(value);
    if (!parsed.id) return error("BAD_USER_INPUT", "Address id is required");
    await this.update(parsed.id, parsed.input, context);
    return this.enategaProfile(context);
  }

  async deleteEnatega(id: unknown, context: IdentityContext) {
    await this.delete(id, context);
    return this.enategaProfile(context);
  }

  async selectEnatega(id: unknown, context: IdentityContext) {
    await this.select(id, context);
    return this.enategaProfile(context);
  }
}
