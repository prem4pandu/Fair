# Wave 1 — Contract and data model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Wave 0 (gate G0) must be merged.

**Goal:** By the end of Wave 1, every one of the 334 root operations exists in the served schema with the argument and response shapes the apps use; every multivendor app document validates (`pnpm check:enatega` PASS); every root without a resolver returns `NOT_IMPLEMENTED`; the full database schema, the cross-lane ports, the domain-event outbox and the test factories exist. This is what makes Wave 2 fully parallel.

**Architecture:** One agent (W1-0) derives type requirements from every app document, generates a first SDL, splits it into per-lane files and gets the contract gate to PASS. Then nine lane agents (W1-L1 … W1-L9) refine their own SDL file and write their Prisma schema file, migration, mappers and factories, in parallel. Cross-lane database references are plain id columns; their foreign keys are added by one lead migration at the end.

**Tech stack:** as master plan; Prisma multi-file schema (`prisma/schema/`).

---

## W1-0 — contract derivation (one agent)

Owns: `tools/derive-type-requirements.mjs`, `tools/generate-sdl.mjs`, `tools/type-map.json`, `contracts/enatega/*.graphql` (initial generation only; each lane owns its file afterwards), `services/api/src/kernel/ports.ts`, `services/api/src/kernel/events.ts`, `services/api/prisma/schema/base.prisma`, `services/api/prisma.config.ts`, `services/api/test/support/factories.ts`.

### Task W1-0.1: Derive type requirements from every app document

**Files:**
- Create: `tools/derive-type-requirements.mjs`
- Test: `tools/derive-type-requirements.test.mjs`
- Output: `docs/ENATEGA_TYPE_REQUIREMENTS.json`

The tool uses `tools/lib/documents.mjs` (`listDocuments`) for all six apps and builds, for each root field:

- `arguments`: every argument name with every variable type used for it across documents (from `VariableDefinition`s, e.g. `String!`, `[OrderInput!]!`) and every literal kind passed inline (`IntValue`, `StringValue`, `EnumValue`, `ObjectValue` with its keys);
- `selection`: the merged selection tree — for each field path, the set of child fields, the fragment type conditions seen at that path (`on RestaurantPreview`), and whether the path is ever a leaf;
- `apps`: which apps use it;
- `inputs`: for every input-object variable type, the set of keys passed in literals and the declared name.

- [ ] **Step 1: Write the failing test**

```js
// tools/derive-type-requirements.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFromDocuments } from "./derive-type-requirements.mjs";

test("merges selections, argument types and fragment type conditions per root", () => {
  const result = deriveFromDocuments([
    { app: "web", text: "query A($id: String!) { restaurant(id: $id) { _id name ...P } } fragment P on RestaurantPreview { slug }" },
    { app: "app", text: "query B($id: String) { restaurant(id: $id) { _id location { coordinates } } }" },
  ]);
  const root = result.query.restaurant;
  assert.deepEqual(root.arguments.id.variableTypes.sort(), ["String", "String!"]);
  assert.deepEqual(Object.keys(root.selection.fields).sort(), ["_id", "location", "name", "slug"]);
  assert.deepEqual(root.selection.typeConditions, ["RestaurantPreview"]);
  assert.equal(root.selection.fields.location.fields.coordinates.leaf, true);
  assert.deepEqual(root.apps.sort(), ["app", "web"]);
});
test("records inline literal argument kinds and input object keys", () => {
  const result = deriveFromDocuments([
    { app: "admin", text: 'query { earnings(userType: STORE, pagination: { pageSize: 10, pageNo: 1 }) { data { _id } } }' },
  ]);
  assert.deepEqual(result.query.earnings.arguments.userType.literalKinds, ["EnumValue"]);
  assert.deepEqual(result.query.earnings.arguments.pagination.objectKeys.sort(), ["pageNo", "pageSize"]);
});
```

- [ ] **Step 2: Run it**, expect FAIL (module not found).
- [ ] **Step 3: Implement** `deriveFromDocuments(documents)` (pure) and a CLI that loads all documents with `listDocuments` and writes `docs/ENATEGA_TYPE_REQUIREMENTS.json` (sorted keys, stable output). Unresolved documents (dynamic interpolations) are listed under `unresolved` with file and line; there must be none for multivendor apps after W0-B Task B3, otherwise each is resolved by hand and recorded in `docs/ENATEGA_UNRESOLVED_DOCUMENTS.md` with the manual reading.
- [ ] **Step 4: Run** `node --test tools/derive-type-requirements.test.mjs && node tools/derive-type-requirements.mjs`; expect PASS and a JSON with 334 roots.
- [ ] **Step 5: Commit** `feat(tools): derive GraphQL type requirements from every app document`.

### Task W1-0.2: Type map — name every object position

**Files:**
- Create: `tools/type-map.json`

Every object-valued selection path must map to a named GraphQL type. Rules, applied in order by `generate-sdl.mjs`:

1. Fragment type conditions and Apollo type-policy names are fixed: `RestaurantPreview`, `RestaurantCarouselPreview`, `RestaurantDetail` (alias of `Restaurant`), `Food`, `Category`, `Item` (reference/02 §0.5).
2. Field-name rules (path suffix → type): `restaurant`, `restaurants[]` → `Restaurant`; `rider` → `Rider`; `user`, `customer` → `User`; `owner` → `Owner`; `zone` → `Zone`; `food`, `foods[]` → `Food`; `variation(s)` → `Variation`; `addon(s)` → `Addon`; `option(s)` → `Option`; `category`, `categories[]` → `Category`; `subCategory` → `SubCategory`; `location`, `deliveryAddress.location` → `Location` (GeoJSON point: `type: String`, `coordinates: [Float]`); `deliveryBounds`, `zone.location` → `Polygon` (`type: String`, `coordinates: [[[Float]]]`); `openingTimes[]` → `OpeningTimes`; `times[]` → `Timings` (`startTime: [String]`, `endTime: [String]`); `items[]` under an order → `OrderItem`; `review(s)` → `Review`; `reviewData` → `ReviewData`; `coupon` → `Coupon`; `address(es)[]` → `Address`; `bussinessDetails` → `BussinessDetails`; `vendor` → `Vendor`; `staff` → `Staff`; `cuisine(s)` → `Cuisine`; `banner(s)` → `Banner`; `shopType` → `ShopType`; `eta` → `OrderEta`; `pagination` → `PaginationTotal`.
3. Root-specific overrides in `tools/type-map.json` for paginated wrappers and dashboard shapes, e.g. `query.restaurantsPaginated` → `PaginatedRestaurants`, `query.earnings` → `EarningsResponse`, `query.earnings.data` → `EarningsData`, `query.getDashboardUsers` → `DashboardUsers`, `query.metricsGeneral` handled by kernel.
4. Anything left: `PascalCase(root) + PascalCase(path)` (e.g. `query.getLiveMonitorData` → `LiveMonitorData`). The generator prints these so the owning lane can rename them in W1-L*.

- [ ] Write `tools/type-map.json` with sections `fixed`, `byFieldName`, `byPath` (path syntax `query.root.field.sub`) and `ownership` (type → lane), using the tables in reference/02 §9, reference/03 §A and reference/04 §A. Ownership defaults: `User`, `Owner`, `Staff`, `AuthData`-style login payloads → L1; `Configuration`, `Zone`, `Polygon`, `Cuisine`, `ShopType`, `Banner`, `Tipping`, `Taxation`, `Version*`, `Country`, `City`, `AuditLog*`, upload payloads → L2; `Restaurant*`, `Vendor`, `Food`, `Variation`, `Addon`, `Option`, `Category`, `SubCategory`, `Coupon`, `Review*`, `OpeningTimes`, `Timings`, `BussinessDetails` → L3; `Address`, `SupportTicket*`, `TicketMessage*` → L4; `Order`, `OrderItem`, `OrderEta`, order wrappers → L5; `Rider*`, `ChatMessage*`, `Tracking*`, `LiveMonitor*` → L6; `Earnings*`, `Transaction*`, `WithdrawRequest*`, `CommissionRate*`, `EarningsGraph*` → L7; `Notification*`, `WebNotification*` → L8; `Dashboard*` → L9; `Location`, `PaginationTotal`, generic page wrappers → core.
- [ ] Commit `feat(tools): add type naming and ownership map`.

### Task W1-0.3: Generate SDL and split it by lane

**Files:**
- Create: `tools/generate-sdl.mjs`
- Test: `tools/generate-sdl.test.mjs`
- Output: `contracts/enatega/core.graphql`, `contracts/enatega/L1-identity.graphql`, `L2-platform.graphql`, `L3-vendors-catalog.graphql`, `L4-customers-support.graphql`, `L5-orders.graphql`, `L6-dispatch.graphql`, `L7-finance.graphql`, `L8-notifications.graphql`, `L9-analytics.graphql`, `L12-single-vendor.graphql`

Generation rules:

- Root fields go to the file of their lane (`OPERATION_LANES.json`) as `extend type Query|Mutation|Subscription`. Object types go to the file of their owning lane; fields on another lane's type that only appear under this lane's roots are still emitted on the owner's type (one definition per type).
- Argument type: if every document declares the same variable type, use it; if they differ only in nullability, use the nullable form (least strict, reference/02 §0.1); otherwise the lane resolves it in W1-L*. Inline literals: `IntValue` → `Int`, `FloatValue` → `Float`, `StringValue` → `String`, `BooleanValue` → `Boolean`, `EnumValue` → an enum named `<Root><Arg>` with the literal values seen, `ObjectValue` → an input named `<Root><Arg>Input` with the keys seen.
- Input object types named in variables (`OrderInput`, `AddressInput`, …) are generated from the keys seen in literals and from reference docs §12-style signature lists (reference/02 §12, reference/03, reference/04 §2.20); missing keys are added by the lane.
- Leaf types: from the leaf-type table below; anything not matched is `String` and listed in `docs/SDL_TYPE_REVIEW.md` for the owning lane.

| Leaf name pattern | Type |
|---|---|
| `_id`, `id`, `*Id` (not `orderId`) | `ID` |
| `orderId`, `*Url`, `*Image`, `image`, `name`, `title`, `description`, `email`, `phone`, `*Status` (unless enum), `reason`, `slug`, `*At`, `*Date`, `*Time` when ISO, `createdAt`, `updatedAt` | `String` |
| `price`, `*Price`, `*Amount`, `amount*`, `deliveryCharges`, `tipping`, `taxationAmount`, `tax`, `minimumOrder`, `rating`, `reviewAverage`, `commissionRate`, `deliveryRate`, `*Wallet*`, `discount*`, `latitude`, `longitude`, `accuracy`, `heading`, `speed` | `Float` |
| `count`, `*Count`, `total*` (counts), `quantity`, `page`, `limit`, `*Pages`, `currentPage`, `nextPage`, `prevPage`, `deliveryTime`, `version`, `docsCount`, `distanceMeters`, `durationSeconds` | `Int` |
| `is*`, `has*`, `available`, `enabled`, `*Enabled`, `isActive`, `selected`, `success` | `Boolean` |
| `coordinates` under `Location` | `[Float]` |
| `coordinates` under `Polygon` | `[[[Float]]]` |
| `startTime`, `endTime` under `Timings` | `[String]` |
| `permissions`, `cuisines`, `tags`, `*Ids` | `[String]` |

- [ ] **Step 1: Write the failing test** with a two-document fixture (one query with a fragment on `RestaurantPreview`, one mutation with an input variable) asserting the generated SDL text contains `type RestaurantPreview`, `extend type Query { restaurant(id: String): Restaurant }`, the input type, and that the output passes `buildSchema` together with `core.graphql`.
- [ ] **Step 2: Run it**, expect FAIL.
- [ ] **Step 3: Implement** `generate-sdl.mjs` (pure `generate(requirements, typeMap, lanes)` returning `{ files: { [name]: text }, review: [...] }` plus CLI writing the files, `docs/SDL_TYPE_REVIEW.md`, and formatting with Prettier).
- [ ] **Step 4: Run** `node --test tools/generate-sdl.test.mjs && node tools/generate-sdl.mjs`.
- [ ] **Step 5: Commit** `feat(contract): generate initial Enatega SDL split by lane`.

### Task W1-0.4: Make the contract gate pass

- [ ] Delete `contracts/foundation.graphql`, `identity.graphql`, `catalog.graphql`, `addresses.graphql`, `configuration.graphql` from the served schema (D15): move them to `contracts/legacy/` (not loaded), and remove their entries from `kernel/schema.ts`. Delete or rewrite resolvers that reference removed roots: `FoundationResolver.serviceInfo` (remove), `IdentityResolver` (remove the class; its service stays for L1), `CatalogResolver`, `AddressesResolver` (remove classes; services stay for L3/L4), `ConfigurationResolver` (keep — `configuration`/`publicConfiguration` are Enatega roots; re-point to the new types in L2). Move their HTTP tests that call removed roots to `test/legacy/` excluded from runs, and list them in the lane plans for rewrite.
- [ ] Update `codegen.ts` to read `contracts/enatega/*.graphql` and generate `packages/api-contracts/src/generated.ts` (rename the package directory `packages/identity-contracts` → `packages/api-contracts`, package name `@fairbite/api-contracts`; update imports). Run `pnpm codegen`.
- [ ] Run `pnpm check:enatega`. For each failing document, read the validation error, fix the generated SDL in the right lane file (missing field, wrong list-ness, nullability of arguments, enum value), and re-run. Typical fixes are listed in `docs/SDL_TYPE_REVIEW.md` for the lane to confirm. Repeat until `staticCompatibility: PASS` with `--scope multivendor` and every single-vendor document fails only on `L12` roots — then go further and make the single-vendor documents validate too, so L12 only adds resolvers later.
- [ ] Run `pnpm check:operations --require-schema`; expect all 334 roots `inSchema: true`.
- [ ] Write `services/api/test/integration/contract/all-operations.integration.spec.ts`: for every multivendor document from `listDocuments` (one `it` per document, named `<app> <file>:<line>`), send it through `GqlClient` with variables generated from its variable definitions (`String` → `"x"`, `ID` → a valid UUID, `Int` → 1, `Float` → 1.5, `Boolean` → true, enums → first value, inputs → empty object or required keys with the same rule) and assert there is no `GRAPHQL_VALIDATION_FAILED` and no `INTERNAL_SERVER_ERROR` — only data, `NOT_IMPLEMENTED`, `UNAUTHENTICATED`, `BAD_USER_INPUT`, `NOT_FOUND` or `FORBIDDEN`. This test stays in the suite forever: it proves the server accepts every real document.
- [ ] Commit `feat(contract): serve the complete Enatega schema with NOT_IMPLEMENTED roots`.

### Task W1-0.5: Ports, domain events and the outbox

**Files:**
- Create: `services/api/src/kernel/ports.ts`
- Create: `services/api/src/kernel/events.ts`
- Create: `services/api/src/kernel/outbox.ts`
- Create: `services/api/test/support/fakes/*.ts` (one in-memory fake per port)
- Test: `services/api/test/unit/kernel/outbox.spec.ts`, `services/api/test/integration/kernel/outbox.integration.spec.ts`

Ports (each with a Nest DI token exported next to the interface; implementations registered by the owning lane's module in Wave 2; until then the kernel registers a provider that throws `NOT_IMPLEMENTED`):

```ts
// services/api/src/kernel/ports.ts
import type { OpeningTimes, Point, Polygon } from "./geo.js";

export type Currency = { code: string; symbol: string; exponent: number };
export const CONFIG_PORT = Symbol("CONFIG_PORT");
export interface ConfigPort {                        // L2
  currency(): Promise<Currency>;
  delivery(): Promise<{ costType: "fixed" | "perKm"; rateMinor: number }>;
  tipOptions(): Promise<{ enabled: boolean; percentages: number[] }>;
  verification(): Promise<{ skipEmail: boolean; skipMobile: boolean }>;
}
export const ZONES_PORT = Symbol("ZONES_PORT");
export interface ZonesPort {                         // L2
  zoneAt(longitude: number, latitude: number): Promise<{ id: string; title: string } | null>;
  get(id: string): Promise<{ id: string; title: string; area: Polygon; isActive: boolean } | null>;
}
export const USERS_PORT = Symbol("USERS_PORT");
export interface UsersPort {                         // L1
  customer(id: string): Promise<{ id: string; name: string; email: string | null; phone: string | null; isActive: boolean } | null>;
  pushTokens(userId: string): Promise<string[]>;
}
export type RestaurantForOrdering = {
  id: string; name: string; slug: string; image: string | null; vendorId: string | null;
  ownerUserIds: string[]; zoneId: string | null; location: Point; deliveryBounds: Polygon | null;
  timeZone: string; openingTimes: OpeningTimes; isActive: boolean; isAvailable: boolean;
  minimumOrderMinor: number; taxPercent: number; deliveryTimeMinutes: number;
  plan: "CORE"; commissionPercent: 0; orderPrefix: string; phone: string | null;
};
export type PricedLine = {
  foodId: string; foodTitle: string; variationId: string; variationTitle: string; unitPriceMinor: number;
  addons: { addonId: string; title: string; options: { optionId: string; title: string; priceMinor: number }[] }[];
  isOutOfStock: boolean;
};
export const RESTAURANTS_PORT = Symbol("RESTAURANTS_PORT");
export interface RestaurantsPort {                   // L3
  forOrdering(id: string): Promise<RestaurantForOrdering | null>;
  priceLines(restaurantId: string, lines: { foodId: string; variationId: string; addons: { addonId: string; optionIds: string[] }[] }[]): Promise<PricedLine[]>;
  ownedBy(userId: string): Promise<string[]>;
}
export const COUPONS_PORT = Symbol("COUPONS_PORT");
export interface CouponsPort {                       // L3
  resolve(titleOrCode: string, restaurantId: string, at: Date): Promise<{ id: string; title: string; discountPercent: number } | null>;
}
export const ADDRESSES_PORT = Symbol("ADDRESSES_PORT");
export interface AddressesPort {                     // L4
  owned(userId: string, addressId: string): Promise<{ id: string; label: string; deliveryAddress: string; details: string; location: Point } | null>;
}
export type OrderStatus = "PENDING" | "ACCEPTED" | "ASSIGNED" | "PICKED" | "DELIVERED" | "CANCELLED";
export type OrderSnapshot = {
  id: string; orderId: string; status: OrderStatus; restaurantId: string; userId: string; riderId: string | null;
  zoneId: string | null; isPickedUp: boolean; paymentMethod: "COD" | "STRIPE" | "PAYPAL"; paymentStatus: "PENDING" | "PAID" | "REFUNDED";
  currency: Currency; itemsMinor: number; discountMinor: number; deliveryMinor: number; taxMinor: number; tipMinor: number; totalMinor: number;
  version: number; createdAt: Date; acceptedAt: Date | null;
};
export const ORDERS_PORT = Symbol("ORDERS_PORT");
export interface OrdersPort {                        // L5
  get(id: string): Promise<OrderSnapshot | null>;
  // The only way any lane changes an order's status (AGENTS.md: centrally validated transitions).
  transition(input: { id: string; to: OrderStatus; actor: { type: string; id: string }; expectedVersion?: number; reason?: string; riderId?: string | null }): Promise<OrderSnapshot>;
  markPaid(id: string, providerReference: string, paidMinor: number): Promise<OrderSnapshot>;
}
export const RIDERS_PORT = Symbol("RIDERS_PORT");
export interface RidersPort {                        // L6
  rider(id: string): Promise<{ id: string; userId: string; name: string; phone: string | null; zoneId: string | null; available: boolean; isActive: boolean } | null>;
  availableInZone(zoneId: string): Promise<string[]>;
}
export const LEDGER_PORT = Symbol("LEDGER_PORT");
export interface LedgerPort {                        // L7
  balances(account: { type: "RESTAURANT" | "RIDER"; id: string }): Promise<{ totalMinor: number; withdrawnMinor: number; currentMinor: number; pendingMinor: number }>;
}
export const PAYMENTS_PORT = Symbol("PAYMENTS_PORT");
export interface PaymentsPort {                      // L7
  available(method: "STRIPE" | "PAYPAL"): Promise<boolean>;
}
export type Message = { template: string; data: Record<string, string | number> };
export const NOTIFY_PORT = Symbol("NOTIFY_PORT");
export interface NotifyPort {                        // L8
  push(userIds: string[], title: string, body: string, data?: Record<string, string>): Promise<void>;
  email(to: string, message: Message): Promise<void>;
  sms(to: string, text: string): Promise<void>;
}
export const MEDIA_PORT = Symbol("MEDIA_PORT");
export interface MediaPort {                         // L2
  storeDataUrl(dataUrl: string, ownerId: string): Promise<{ key: string; url: string }>;
}
export const AUDIT_PORT = Symbol("AUDIT_PORT");
export interface AuditPort {                         // L2
  record(entry: { actorId: string; actorType: string; action: string; entity: string; entityId: string; changes?: Record<string, unknown> }): Promise<void>;
}
```

Domain events (`kernel/events.ts`) are written to the `DomainEvent` outbox table **in the same transaction** as the state change, then delivered by the worker to handlers and to `PubSub`. Event types and payloads:

| Event | Producer | Payload | Consumers |
|---|---|---|---|
| `order.placed` | L5 | `OrderSnapshot` | L6 (none until accepted), L8 (push to restaurant), L9 (counters) |
| `order.transitioned` | L5 | `{ from, to, order: OrderSnapshot, actor, reason }` | L6 (broadcast on ACCEPTED, release on CANCELLED), L7 (ledger on DELIVERED/CANCELLED), L8 (push), L5 (subscription publish) |
| `order.paid` | L7 | `{ orderId, providerReference, paidMinor }` | L5 (status visibility), L8 |
| `rider.location` | L6 | `{ riderId, location, recordedAt }` | L6 (tracking subscription) |
| `withdraw.updated` | L7 | `{ requestId, status }` | L8 |
| `user.otp` | L1 | `{ channel, to, code, purpose }` | L8 |
| `ticket.message` | L4 | `{ ticketId, senderType }` | L8 |

```ts
// services/api/src/kernel/events.ts
export type DomainEvent =
  | { type: "order.placed"; payload: import("./ports.js").OrderSnapshot }
  | { type: "order.transitioned"; payload: { from: string; to: string; order: import("./ports.js").OrderSnapshot; actor: { type: string; id: string }; reason?: string } }
  | { type: "order.paid"; payload: { orderId: string; providerReference: string; paidMinor: number } }
  | { type: "rider.location"; payload: { riderId: string; longitude: number; latitude: number; recordedAt: string } }
  | { type: "withdraw.updated"; payload: { requestId: string; status: string } }
  | { type: "user.otp"; payload: { channel: "email" | "sms"; to: string; code: string; purpose: "signup" | "reset" | "login" } }
  | { type: "ticket.message"; payload: { ticketId: string; senderType: "USER" | "ADMIN" } };
export type EventHandler<T extends DomainEvent["type"]> = (event: Extract<DomainEvent, { type: T }>) => Promise<void>;
```

```ts
// services/api/src/kernel/outbox.ts
import type { PoolClient } from "pg";
import { newId } from "./ids.js";
import type { DomainEvent } from "./events.js";

// Call inside the same transaction as the state change.
export async function enqueue(client: Pick<PoolClient, "query">, event: DomainEvent): Promise<string> {
  const id = newId();
  await client.query('INSERT INTO "DomainEvent"(id, type, payload) VALUES ($1, $2, $3)', [id, event.type, JSON.stringify(event.payload)]);
  return id;
}
```

`base.prisma` adds:

```prisma
model DomainEvent {
  id          String    @id @db.Uuid
  type        String    @db.VarChar(64)
  payload     Json      @db.JsonB
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  processedAt DateTime? @db.Timestamptz(3)
  attempts    Int       @default(0)
  lastError   String?   @db.VarChar(500)
  @@index([processedAt, createdAt])
}
model DevOutbox {
  id        String   @id @db.Uuid
  channel   String   @db.VarChar(16)
  recipient String   @db.VarChar(254)
  subject   String?  @db.VarChar(200)
  body      String
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@index([recipient, createdAt])
}
```

Worker: `services/worker/src/jobs/outbox.ts` polls `DomainEvent` with `SELECT … FOR UPDATE SKIP LOCKED LIMIT 100`, dispatches to handlers registered by lanes in `services/worker/src/jobs/<lane>/index.ts`, marks `processedAt`, retries with exponential backoff (attempts ≤ 10, then logs `outbox_dead_letter`). Handlers must be idempotent (keyed by event id).

- [ ] **Tests:** unit test that `enqueue` issues one INSERT with the serialised payload; integration test that an event enqueued inside a committed transaction is delivered exactly once to a registered handler and an event in a rolled-back transaction is never delivered; a handler that throws is retried and then succeeds.
- [ ] Commit `feat(kernel): add cross-lane ports, domain events and transactional outbox`.

### Task W1-0.6: Prisma multi-file schema and base models

- [ ] Move `services/api/prisma/schema.prisma` to `services/api/prisma/schema/base.prisma` (generator and datasource stay there). Split the existing models into the owning lane files so lanes start from them: identity models → `L1-identity.prisma`; `CatalogMerchant`, `CatalogOutlet`, `CatalogCategory`, `CatalogItem` → `L3-vendors-catalog.prisma` (L3 replaces them); `CustomerAddress` → `L4-customers.prisma`; `RuntimeConfiguration*` → `L2-platform.prisma`. Keep `FoundationMigration`, `DomainEvent`, `DevOutbox` in `base.prisma`.
- [ ] Set `schema: "prisma/schema"` in `prisma.config.ts`. Run `pnpm --filter @fairbite/api exec prisma validate` and `prisma generate`; expect success with identical generated client models.
- [ ] Add migration `202610090000_base_outbox` (DomainEvent, DevOutbox) with `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script` restricted to the two new tables.
- [ ] Commit `refactor(db): split Prisma schema by lane and add outbox tables`.

### Task W1-0.7: Factories

**Files:**
- Create: `services/api/test/support/factories.ts`

`factories.ts` exports `factories(pool)` returning one async builder per table that inserts a valid row with overridable fields and returns it, e.g. `await f.restaurant({ name: "Pasta Place" })`. W1-0 writes builders for the base tables; each W1-L* lane appends builders for its own tables in a section marked `// L3` etc. (the only shared file lanes may append to in Wave 1; the lead resolves append conflicts). Builders insert with SQL, not through services, so any lane can seed any other lane's data.

- [ ] Commit `test(harness): add table factories`.

### Task W1-0.8: Handoff to lanes

- [ ] Run `pnpm verify --integration`.
- [ ] Open nine lane branches `wave1/L<n>-schema` from the integration branch and dispatch W1-L1 … W1-L9 with the handoff template (master §9) and the section below.

---

## W1-L* — lane schema refinement (nine agents in parallel)

Each lane agent owns `contracts/enatega/L<n>-*.graphql`, `services/api/prisma/schema/L<n>-*.prisma`, its migrations, `services/api/src/modules/<module>/mappers.ts`, its factory section, and its port implementation skeleton. Use the lane's Wave 2 plan (`1x-lane-…md`) "Data model" and "Contract" sections as the specification.

### Task W1-L.1: Review and correct the lane SDL

- [ ] For every entry for your lane in `docs/SDL_TYPE_REVIEW.md`, decide the type from the reference docs (cite the section in a `#` comment above the field) and fix it.
- [ ] For every type you own: nullability — fields the apps always read without a null check are non-null only if the server can always produce them; everything else nullable. Enums: define enums only where the apps send or compare a fixed set (order status, payment method, user type); otherwise `String` with server-side validation.
- [ ] Each root field has a `#` comment: apps that call it, auth rule (from master §4.4 / reference/04 §B), and timestamp convention for any time field (ISO or epoch-ms, reference/02 §0.5).
- [ ] Run `pnpm check:enatega` (must stay PASS) and `pnpm --filter @fairbite/api test:integration -- contract/all-operations` (must stay green).

### Task W1-L.2: Lane data model and migration

- [ ] Write the lane's Prisma models exactly as specified in the lane plan's "Data model" section: UUID `@db.Uuid` ids, money as `BigInt` `*Minor`, `timestamptz(3)`, `version Int @default(1)` on mutable aggregates (optimistic concurrency), soft-delete `deletedAt` where the apps "delete" things that history still references (restaurants, foods, riders, users, zones), and indexes for every query in the lane plan.
- [ ] References to another lane's tables are scalar id columns **without** Prisma relation fields (avoids cross-file edits). List each such column in `docs/CROSS_LANE_FKS.md` (`table.column → table.id, on delete`); the lead adds the foreign keys in Task W1-Z.1.
- [ ] Generate the lane migration named `2026100901<lane number>0_<lane>_init` with `prisma migrate diff`, review the SQL by hand, and add PostGIS columns/indexes in SQL where Prisma cannot express them (e.g. `ALTER TABLE "Restaurant" ADD COLUMN "locationGeo" geography(Point, 4326)`; `CREATE INDEX … USING GIST`).
- [ ] Run `prisma migrate deploy` on an empty database (`pnpm stack:up`), then `pnpm --filter @fairbite/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code` must report no drift for your lane's tables.

### Task W1-L.3: Mappers, factories and port skeleton

- [ ] `src/modules/<module>/mappers.ts`: one pure function per owned GraphQL type converting a database row to the GraphQL shape (money via `toMajor` with the configured exponent, ISO/epoch via `kernel/time.ts`, GeoJSON via `kernel/geo.ts`, `_id` from `id`). Unit tests for each mapper in `test/unit/<module>/mappers.spec.ts` with at least: all fields mapped, nulls preserved, money rounding, timestamp convention.
- [ ] Append the lane's builders to `test/support/factories.ts`.
- [ ] Register the lane's port implementation class(es) with methods that throw `appError("NOT_IMPLEMENTED")`; Wave 2 fills them.
- [ ] Commit per task; open a PR to the integration branch; request L11 review.

---

## W1-Z — lead closes Wave 1

### Task W1-Z.1: Cross-lane foreign keys

- [ ] Write migration `202610091900_cross_lane_fks` adding every foreign key from `docs/CROSS_LANE_FKS.md` with the stated `ON DELETE` (default `RESTRICT`; soft-deleted rows keep references valid).
- [ ] Run `prisma migrate deploy` on an empty database and the drift check.

### Task W1-Z.2: Gate G1

- [ ] `pnpm verify --integration --coverage --record G1` — must include `check:enatega` PASS (multivendor and single-vendor documents validate), `check:operations --require-schema`, `contract/all-operations` green, migrations clean, `codegen:check`.
- [ ] L11 review of SDL and data model for consistency (type names, nullability, money/time conventions) across lanes; L13 review of field-level restrictions on secret and personal fields.
- [ ] Commit `docs/GATES.json`.
