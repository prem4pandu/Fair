import { GraphQLError } from "graphql";
import type { Pool } from "pg";
import { toMajor } from "../kernel/money.js";

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
interface EnategaCatalogRow {
  id: string;
  name: string;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  itemId: string | null;
  itemName: string | null;
  description: string | null;
  priceMinor: number | null;
  available: boolean | null;
}

interface EnategaFood {
  _id: string;
  title: string;
  description: string;
  isActive: boolean;
  isOutOfStock: boolean;
  variations: Array<{
    _id: string;
    id: string;
    title: string;
    price: number;
    isOutOfStock: boolean;
    addons: string[];
  }>;
}

interface EnategaCategory {
  _id: string;
  title: string;
  foods: EnategaFood[];
}

export interface EnategaRestaurant {
  _id: string;
  name: string;
  isActive: boolean;
  isAvailable: boolean;
  categories: EnategaCategory[];
  options: never[];
  addons: never[];
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

  private async enategaRows(id?: string): Promise<EnategaCatalogRow[]> {
    return this.read<EnategaCatalogRow>(
      `SELECT o.id, o.name, o.currency,
        c.id AS "categoryId", c.name AS "categoryName",
        i.id AS "itemId", i.name AS "itemName", i.description,
        i."priceMinor", i.available
       FROM "CatalogOutlet" o
       JOIN "CatalogMerchant" m ON m.id = o."merchantId" AND m.published
       LEFT JOIN "CatalogCategory" c
         ON c."outletId" = o.id AND c.published
       LEFT JOIN "CatalogItem" i
         ON i."outletId" = o.id AND i."categoryId" = c.id AND i.published
       WHERE o.published AND ($1::uuid IS NULL OR o.id = $1::uuid)
       ORDER BY o.id, c.id, i.id`,
      [id ?? null],
    );
  }

  private mapEnategaRestaurants(rows: EnategaCatalogRow[]) {
    const restaurants = new Map<string, EnategaRestaurant>();
    const categories = new Map<string, EnategaCategory>();
    for (const row of rows) {
      let restaurant = restaurants.get(row.id);
      if (!restaurant) {
        restaurant = {
          _id: row.id,
          name: row.name,
          isActive: true,
          isAvailable: true,
          categories: [],
          options: [],
          addons: [],
        };
        restaurants.set(row.id, restaurant);
      }
      if (!row.categoryId || !row.categoryName) continue;
      const categoryKey = `${row.id}:${row.categoryId}`;
      let category = categories.get(categoryKey);
      if (!category) {
        category = {
          _id: row.categoryId,
          title: row.categoryName,
          foods: [],
        };
        categories.set(categoryKey, category);
        restaurant.categories.push(category);
      }
      if (
        !row.itemId ||
        !row.itemName ||
        row.priceMinor === null ||
        row.available === null
      )
        continue;
      const isOutOfStock = !row.available;
      category.foods.push({
        _id: row.itemId,
        title: row.itemName,
        description: row.description ?? "",
        isActive: true,
        isOutOfStock,
        variations: [
          {
            _id: row.itemId,
            id: row.itemId,
            title: row.itemName,
            price: Number(toMajor(BigInt(row.priceMinor), 2)),
            isOutOfStock,
            addons: [],
          },
        ],
      });
    }
    return [...restaurants.values()];
  }

  async enategaRestaurants() {
    return this.mapEnategaRestaurants(await this.enategaRows());
  }

  async enategaRestaurant(id: unknown) {
    const restaurants = this.mapEnategaRestaurants(
      await this.enategaRows(catalogId(id)),
    );
    return restaurants[0] ?? null;
  }
}
