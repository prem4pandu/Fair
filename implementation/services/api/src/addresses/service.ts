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
}
