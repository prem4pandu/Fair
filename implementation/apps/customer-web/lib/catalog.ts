import "server-only";

/** Canonical server-side catalog adapter. No upstream provider fallback. */
export interface Outlet {
  id: string;
  name: string;
  merchantName: string;
  currency: string;
}
export interface Item {
  id: string;
  outletId: string;
  name: string;
  description: string;
  priceMinor: number;
  available: boolean;
  category: { id: string; name: string };
}
export interface CatalogPage<T> {
  nodes: T[];
  endCursor: string | null;
  hasNextPage: boolean;
}
export const validCatalogId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid catalog");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 200): string => {
  if (typeof value !== "string" || value.length > max)
    throw new Error("Invalid catalog");
  return value;
};
function outlet(value: unknown): Outlet {
  const row = object(value);
  if (!validCatalogId(row.id) || !/^[A-Z]{3}$/.test(text(row.currency, 3)))
    throw new Error("Invalid catalog");
  return {
    id: row.id,
    name: text(row.name),
    merchantName: text(row.merchantName),
    currency: text(row.currency, 3),
  };
}
function item(value: unknown): Item {
  const row = object(value);
  const category = object(row.category);
  if (
    !validCatalogId(row.id) ||
    !validCatalogId(row.outletId) ||
    !validCatalogId(category.id) ||
    !Number.isSafeInteger(row.priceMinor) ||
    (row.priceMinor as number) < 0 ||
    (row.priceMinor as number) > 2147483647 ||
    typeof row.available !== "boolean"
  )
    throw new Error("Invalid catalog");
  return {
    id: row.id,
    outletId: row.outletId,
    name: text(row.name),
    description: text(row.description, 5000),
    priceMinor: row.priceMinor as number,
    available: row.available,
    category: { id: category.id, name: text(category.name) },
  };
}
function page<T extends { id: string }>(
  value: unknown,
  parse: (v: unknown) => T,
): CatalogPage<T> {
  const row = object(value);
  if (
    !Array.isArray(row.nodes) ||
    row.nodes.length > 20 ||
    typeof row.hasNextPage !== "boolean" ||
    (row.endCursor !== null && !validCatalogId(row.endCursor))
  )
    throw new Error("Invalid catalog");
  const nodes = row.nodes.map(parse);
  if (
    new Set(nodes.map((n) => n.id)).size !== nodes.length ||
    row.endCursor !== (nodes.at(-1)?.id ?? null) ||
    (row.hasNextPage && !nodes.length)
  )
    throw new Error("Invalid catalog");
  return {
    nodes,
    endCursor: row.endCursor as string | null,
    hasNextPage: row.hasNextPage,
  };
}
async function query(
  document: string,
  variables: Record<string, string | number | null>,
): Promise<Record<string, unknown>> {
  const endpoint = new URL(process.env.FAIRBITE_API_URL ?? "");
  if (
    endpoint.pathname !== "/graphql" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !["https:", "http:"].includes(endpoint.protocol) ||
    (endpoint.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))
  )
    throw new Error("Invalid endpoint");
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body) throw new Error("Catalog unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 196608) {
      await reader.cancel();
      throw new Error("Catalog too large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result = object(JSON.parse(new TextDecoder().decode(bytes)));
  if ("errors" in result) throw new Error("Catalog unavailable");
  return object(result.data);
}
const OUTLET_FIELDS = "id name merchantName currency";
export async function getOutlets(after: string | null) {
  return page(
    (
      await query(
        `query CatalogBrowse($after: ID) { catalogOutlets(limit:20,after:$after) { nodes { ${OUTLET_FIELDS} } endCursor hasNextPage } }`,
        { after },
      )
    ).catalogOutlets,
    outlet,
  );
}
export async function getOutlet(id: string) {
  const result = (
    await query(
      `query CatalogStore($id: ID!) { catalogOutlet(id:$id) { ${OUTLET_FIELDS} } }`,
      { id },
    )
  ).catalogOutlet;
  if (result === null) return null;
  const parsed = outlet(result);
  if (parsed.id !== id) throw new Error("Invalid catalog ownership");
  return parsed;
}
export async function getItems(id: string, after: string | null) {
  const result = page(
    (
      await query(
        "query CatalogMenu($id: ID!, $after: ID) { catalogItems(outletId:$id,limit:20,after:$after) { nodes { id outletId name description priceMinor available category { id name } } endCursor hasNextPage } }",
        { id, after },
      )
    ).catalogItems,
    item,
  );
  if (result.nodes.some((n) => n.outletId !== id))
    throw new Error("Invalid catalog ownership");
  return result;
}
export function storePath(row: Outlet) {
  const slug =
    row.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "menu";
  return `/store/${slug}/${row.id}`;
}
export function formatPrice(priceMinor: number, currency: string) {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    priceMinor / 10 ** digits,
  );
}
