import { GraphQLError } from "graphql";
import type { Pool } from "pg";

const badInput = () =>
  new GraphQLError("Invalid catalog input", {
    extensions: { code: "BAD_USER_INPUT" },
  });
export function catalogId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw badInput();
  return value;
}
export function catalogPaging(limit: unknown = 20, after?: unknown) {
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw badInput();
  return { limit, after: after == null ? null : catalogId(after) };
}
export interface CatalogOutlet {
  id: string;
  name: string;
  merchantName: string;
  currency: string;
}
export interface CatalogItem {
  id: string;
  outletId: string;
  name: string;
  description: string;
  priceMinor: number;
  available: boolean;
  category: { id: string; name: string };
}
function page<T extends { id: string }>(rows: T[], limit: number) {
  const nodes = rows.slice(0, limit);
  return {
    nodes,
    endCursor: nodes.at(-1)?.id ?? null,
    hasNextPage: rows.length > limit,
  };
}
export class CatalogService {
  constructor(private readonly pool: Pick<Pool, "query">) {}
  private async read<T>(sql: string, values: unknown[]): Promise<T[]> {
    try {
      return (await this.pool.query(sql, values)).rows as T[];
    } catch {
      throw new GraphQLError("Catalog temporarily unavailable", {
        extensions: { code: "SERVICE_UNAVAILABLE" },
      });
    }
  }
  async outlets(limit?: unknown, after?: unknown) {
    const input = catalogPaging(limit, after);
    const rows = await this.read<CatalogOutlet>(
      `SELECT o.id, o.name, m.name AS "merchantName", o.currency FROM "CatalogOutlet" o JOIN "CatalogMerchant" m ON m.id = o."merchantId" WHERE o.published AND m.published AND ($1::uuid IS NULL OR o.id > $1::uuid) ORDER BY o.id ASC LIMIT $2`,
      [input.after, input.limit + 1],
    );
    return page(
      rows.map(({ id, name, merchantName, currency }) => ({
        id,
        name,
        merchantName,
        currency,
      })),
      input.limit,
    );
  }
  async outlet(id: unknown) {
    const rows = await this.read<CatalogOutlet>(
      `SELECT o.id, o.name, m.name AS "merchantName", o.currency FROM "CatalogOutlet" o JOIN "CatalogMerchant" m ON m.id = o."merchantId" WHERE o.id = $1::uuid AND o.published AND m.published`,
      [catalogId(id)],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          name: row.name,
          merchantName: row.merchantName,
          currency: row.currency,
        }
      : null;
  }
  async items(outletId: unknown, limit?: unknown, after?: unknown) {
    const id = catalogId(outletId);
    const input = catalogPaging(limit, after);
    const rows = await this.read<
      Omit<CatalogItem, "category"> & {
        categoryId: string;
        categoryName: string;
      }
    >(
      `SELECT i.id, i."outletId", i.name, i.description, i."priceMinor", i.available, c.id AS "categoryId", c.name AS "categoryName" FROM "CatalogItem" i JOIN "CatalogCategory" c ON c.id = i."categoryId" AND c."outletId" = i."outletId" JOIN "CatalogOutlet" o ON o.id = i."outletId" JOIN "CatalogMerchant" m ON m.id = o."merchantId" WHERE o.id = $1::uuid AND m.published AND o.published AND c.published AND i.published AND ($2::uuid IS NULL OR i.id > $2::uuid) ORDER BY i.id ASC LIMIT $3`,
      [id, input.after, input.limit + 1],
    );
    return page(
      rows.map(
        ({
          id,
          outletId,
          name,
          description,
          priceMinor,
          available,
          categoryId,
          categoryName,
        }) => ({
          id,
          outletId,
          name,
          description,
          priceMinor,
          available,
          category: { id: categoryId, name: categoryName },
        }),
      ),
      input.limit,
    );
  }
}
