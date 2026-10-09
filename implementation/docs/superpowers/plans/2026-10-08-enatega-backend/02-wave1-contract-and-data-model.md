# Wave 1 — Contract and data model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Wave 0 (gate G0) must be merged.

> **Precedence notice (2026-10-09).** `implementation/docs/ROADMAP.md` is the single roadmap and outranks this
> file for scope, scheduling, ownership and gates; this file remains authoritative for its own task detail.
> `L10`, `L11` and `L13` are **retired identifiers** — they were never lanes in `OPERATION_LANES.json`. Read
> `L10` as **W15** for journey suites (`test/journeys/**`), **W16** for Playwright (`e2e/**`), and the matching
> frontend workstream **W12/W13/W14a/W14b** for edits inside a `vendor/enatega-ui/` package; `L11` as **W23**
> (independent QA) and `L13` as **W24** (independent security). Operation counts come from
> `docs/OPERATION_LANES.json`, not from prose. See `ROADMAP.md` §4.0.

**Goal:** By the end of Wave 1, every one of the 334 root operations exists in the served schema with the argument and response shapes the apps use; every multivendor and single-vendor app document validates (`pnpm check:enatega` PASS); every root without a resolver returns `NOT_IMPLEMENTED`; the full database schema, the cross-lane ports, the at-least-once domain-event outbox and the test factories exist. L12 is present for schema compatibility but remains runtime `NOT_IMPLEMENTED` until Wave 5. This is what makes Wave 2 lane work possible.

**Architecture:** One agent (W1-0) derives type requirements from every app document, generates a first SDL, splits it into per-lane files and gets the contract gate to PASS. Lane agents W1-L1 … W1-L9 refine only their own SDL, Prisma schema, mapper and lane factory files with no more than four total agents active. The lead alone integrates shared configuration, composes the schema and applies lane migrations sequentially in dependency order. Cross-lane database references are plain id columns; their foreign keys are added by one lead migration at the end.

**Tech stack:** as master plan; Prisma multi-file schema (`prisma/schema/`).

---

## Mandatory prerequisites — do not start W1-0 or W1-L work without these

### P1: Inventory and preserve the existing database

The database is an upgrade from migrations 001–005, not a disposable empty schema. Before generating a new migration:

- [ ] Record every table, column, index, constraint, enum, extension and ownership boundary created by migrations 001–005 in `docs/WAVE1_MIGRATION_INVENTORY.md`. Map each existing model (`Identity*`, `Catalog*`, `CustomerAddress`, `RuntimeConfiguration*` and `FoundationMigration`) to its Wave 1 owner.
- [ ] For every affected table, document one explicit action: **preserve in place**, **additive extension**, **backfill then cut over**, or **retire after verified cutover**. Include column-level source-to-target mappings, null/default transitions, validation queries and rollback steps. Renames use `ALTER ... RENAME`; replacement tables require a reversible copy/backfill and row-count plus semantic checks. No migration may drop or truncate an existing table or column in Wave 1.
- [ ] Create a deterministic populated migration-005 fixture containing active and inactive users, sessions, catalog data, addresses and at least two runtime-configuration versions. Keep stable UUIDv4 identifiers and representative relationships.
- [ ] Add an upgrade integration test that restores that fixture, applies every Wave 1 migration, verifies preserved identifiers and data, verifies each backfill and constraint, starts the API, and exercises the affected reads. Add a rollback rehearsal for every cutover step that changes names or storage shape. An empty-database deploy remains a secondary check only.
- [ ] Establish the identifier transition: existing UUIDv4 rows and foreign keys remain valid indefinitely; `newId()` creates UUIDv7 for new rows after the cutover; all parsers, GraphQL variables and database columns accept both valid UUIDv4 and UUIDv7. Record how existing sessions are handled at deployment. If the token contract changes, either support both versions for a bounded, documented window or deliberately revoke all sessions with an owner-visible release note and test.

### P2: Resolve the complete frontend contract

The 334-root inventory does not close the contract while 132 dynamic/imported/interpolated request sites remain unresolved.

- [ ] Resolve all 132 baseline unresolved sites by reading the original source, following imports/fragments and expanding safe static interpolations. Record each baseline site, final operation/document, lane, app, file and line in `docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json`.
- [ ] Make `listDocuments` consume the checked-in resolution artifact deterministically and fail on any unresolved site, stale file hash, duplicate conflicting resolution or newly discovered dynamic site.
- [ ] Require zero unresolved documents across all six apps before SDL generation. The generated type requirements, operation inventory and contract tests must include those resolved documents.

### P3: Finish the executable lane specifications

W1-L and Wave 2 are blocked until final lane plans exist for L1–L8 and the journey/E2E wave. L1–L4 and the journey plan are absent; L5–L8 are `*.PARTIAL.md`. Complete them from `_lane-plan-brief.md`, resolve every continuation marker/TODO and obtain lead review before dispatching lane agents. L9 may proceed only after its cross-lane inputs are frozen. Wave 5 remains gated, but its L12 SDL contract is still required by G1.

---

## W1-0 — contract derivation (one agent)

Owns: `tools/derive-type-requirements.mjs`, `tools/generate-sdl.mjs`, `tools/type-map.json`, `contracts/enatega/*.graphql` (initial generation only; each lane owns its file afterwards), `services/api/src/kernel/ports.ts`, `services/api/src/kernel/events.ts`, `services/api/prisma/schema/base.prisma`, `services/api/prisma.config.ts`, `services/api/test/support/factories/base.ts` and `services/api/test/support/factories/index.ts`.

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
    {
      app: "web",
      text: "query A($id: String!) { restaurant(id: $id) { _id name ...P } } fragment P on RestaurantPreview { slug }",
    },
    {
      app: "app",
      text: "query B($id: String) { restaurant(id: $id) { _id location { coordinates } } }",
    },
  ]);
  const root = result.query.restaurant;
  assert.deepEqual(root.arguments.id.variableTypes.sort(), [
    "String",
    "String!",
  ]);
  assert.deepEqual(Object.keys(root.selection.fields).sort(), [
    "_id",
    "location",
    "name",
    "slug",
  ]);
  assert.deepEqual(root.selection.typeConditions, ["RestaurantPreview"]);
  assert.equal(root.selection.fields.location.fields.coordinates.leaf, true);
  assert.deepEqual(root.apps.sort(), ["app", "web"]);
});
test("records inline literal argument kinds and input object keys", () => {
  const result = deriveFromDocuments([
    {
      app: "admin",
      text: "query { earnings(userType: STORE, pagination: { pageSize: 10, pageNo: 1 }) { data { _id } } }",
    },
  ]);
  assert.deepEqual(result.query.earnings.arguments.userType.literalKinds, [
    "EnumValue",
  ]);
  assert.deepEqual(
    result.query.earnings.arguments.pagination.objectKeys.sort(),
    ["pageNo", "pageSize"],
  );
});
```

- [ ] **Step 2: Run it**, expect FAIL (module not found).
- [ ] **Step 3: Implement** `deriveFromDocuments(documents)` (pure) and a CLI that loads all documents with `listDocuments` and writes `docs/ENATEGA_TYPE_REQUIREMENTS.json` (sorted keys, stable output). It consumes `docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json` from P2. Any unresolved document in any app is a hard failure; do not omit it from generation or defer it by application scope.
- [ ] **Step 4: Run** `node --test tools/derive-type-requirements.test.mjs && node tools/derive-type-requirements.mjs`; expect PASS and a JSON with 334 roots.
- [ ] **Step 5: Commit** `feat(tools): derive GraphQL type requirements from every app document`.

### Task W1-0.2: Type map — name every object position

**Files:**

- Create: `tools/type-map.json`

Every object-valued selection path must map to a named GraphQL type. Rules, applied in order by `generate-sdl.mjs`:

1. Fragment type conditions and Apollo type-policy names are fixed: `RestaurantPreview`, `RestaurantCarouselPreview`, `RestaurantDetail` (alias of `Restaurant`), `Food`, `Category`, `Item` (reference/02 §0.5).
2. Field-name rules (path suffix → type): `restaurant`, `restaurants[]` → `Restaurant`; `rider` → `Rider`; `user`, `customer` → `User`; `owner` → `Owner`; `zone` → `Zone`; `food`, `foods[]` → `Food`; `variation(s)` → `Variation`; `addon(s)` → `Addon`; `option(s)` → `Option`; `category`, `categories[]` → `Category`; `subCategory` → `SubCategory`; `location`, `deliveryAddress.location` → `Location` (GeoJSON point: `type: String`, `coordinates: [Float]`); `deliveryBounds`, `zone.location` → `Polygon` (`type: String`, `coordinates: [[[Float]]]`); `openingTimes[]` → `OpeningTimes`; `times[]` → `Timings` (`startTime: [String]`, `endTime: [String]`); `items[]` under an order → `OrderItem`; `review(s)` → `Review`; `reviewData` → `ReviewData`; `coupon` → `Coupon`; `address(es)[]` → `Address`; `bussinessDetails` → `BussinessDetails`; `vendor` → `Vendor`; `staff` → `Staff`; `cuisine(s)` → `Cuisine`; `banner(s)` → `Banner`; `shopType` → `ShopType`; `eta` → `OrderEta`; `pagination` → `PaginationTotal`.
3. Root-specific overrides in `tools/type-map.json` for paginated wrappers and dashboard shapes, e.g. `query.restaurantsPaginated` → `PaginatedRestaurants`, `query.earnings` → `EarningsResponse`, `query.earnings.data` → `EarningsData`, `query.getDashboardUsers` → `DashboardUsers`, `query.metricsGeneral` handled by kernel.
4. Anything left: `PascalCase(root) + PascalCase(path)` (e.g. `query.getLiveMonitorData` → `LiveMonitorData`). The generator prints these so the owning lane can rename them in W1-L\*.

- [ ] Write `tools/type-map.json` with sections `fixed`, `byFieldName`, `byPath` (path syntax `query.root.field.sub`) and `ownership` (type → lane), using the tables in reference/02 §9, reference/03 §A and reference/04 §A. Ownership defaults: `User`, `Owner`, `Staff`, `AuthData`-style login payloads → L1; `Configuration`, `Zone`, `Polygon`, `Cuisine`, `ShopType`, `Banner`, `Tipping`, `Taxation`, `Version*`, `Country`, `City`, `AuditLog*`, upload payloads → L2; `Restaurant*`, `Vendor`, `Food`, `Variation`, `Addon`, `Option`, `Category`, `SubCategory`, `Coupon`, `Review*`, `OpeningTimes`, `Timings`, `BussinessDetails` → L3; `Address`, `SupportTicket*`, `TicketMessage*` → L4; `Order`, `OrderItem`, `OrderEta`, order wrappers → L5; `Rider*`, `ChatMessage*`, `Tracking*`, `LiveMonitor*` → L6; `Earnings*`, `Transaction*`, `WithdrawRequest*`, `CommissionRate*`, `EarningsGraph*` → L7; `Notification*`, `WebNotification*` → L8; `Dashboard*` → L9; `Location`, `PaginationTotal`, generic page wrappers → core.
- [ ] Commit `feat(tools): add type naming and ownership map`.

### Task W1-0.3: Generate SDL and split it by lane

**Files:**

- Create: `tools/generate-sdl.mjs`
- Test: `tools/generate-sdl.test.mjs`
- Output: `contracts/enatega/core.graphql`, `contracts/enatega/L1-identity.graphql`, `L2-platform.graphql`, `L3-vendors-catalog.graphql`, `L4-customers-support.graphql`, `L5-orders.graphql`, `L6-dispatch.graphql`, `L7-finance.graphql`, `L8-notifications.graphql`, `L9-analytics.graphql`, `L12-single-vendor.graphql`

Generation rules:

- Root fields go to the file of their lane (`OPERATION_LANES.json`) as `extend type Query|Mutation|Subscription`. Object types go to the file of their owning lane; fields on another lane's type that only appear under this lane's roots are still emitted on the owner's type (one definition per type).
- Argument type: if every document declares the same variable type, use it; if they differ only in nullability, use the nullable form (least strict, reference/02 §0.1); otherwise the lane resolves it in W1-L\*. Inline literals: `IntValue` → `Int`, `FloatValue` → `Float`, `StringValue` → `String`, `BooleanValue` → `Boolean`, `EnumValue` → an enum named `<Root><Arg>` with the literal values seen, `ObjectValue` → an input named `<Root><Arg>Input` with the keys seen.
- Input object types named in variables (`OrderInput`, `AddressInput`, …) are generated from the keys seen in literals and from reference docs §12-style signature lists (reference/02 §12, reference/03, reference/04 §2.20); missing keys are added by the lane.
- Leaf types: from the leaf-type table below; anything not matched is `String` and listed in `docs/SDL_TYPE_REVIEW.md` for the owning lane.

| Leaf name pattern                                                                                                                                                                                                                                             | Type          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `_id`, `id`, `*Id` (not `orderId`)                                                                                                                                                                                                                            | `ID`          |
| `orderId`, `*Url`, `*Image`, `image`, `name`, `title`, `description`, `email`, `phone`, `*Status` (unless enum), `reason`, `slug`, `*At`, `*Date`, `*Time` when ISO, `createdAt`, `updatedAt`                                                                 | `String`      |
| `price`, `*Price`, `*Amount`, `amount*`, `deliveryCharges`, `tipping`, `taxationAmount`, `tax`, `minimumOrder`, `rating`, `reviewAverage`, `commissionRate`, `deliveryRate`, `*Wallet*`, `discount*`, `latitude`, `longitude`, `accuracy`, `heading`, `speed` | `Float`       |
| `count`, `*Count`, `total*` (counts), `quantity`, `page`, `limit`, `*Pages`, `currentPage`, `nextPage`, `prevPage`, `deliveryTime`, `version`, `docsCount`, `distanceMeters`, `durationSeconds`                                                               | `Int`         |
| `is*`, `has*`, `available`, `enabled`, `*Enabled`, `isActive`, `selected`, `success`                                                                                                                                                                          | `Boolean`     |
| `coordinates` under `Location`                                                                                                                                                                                                                                | `[Float]`     |
| `coordinates` under `Polygon`                                                                                                                                                                                                                                 | `[[[Float]]]` |
| `startTime`, `endTime` under `Timings`                                                                                                                                                                                                                        | `[String]`    |
| `permissions`, `cuisines`, `tags`, `*Ids`                                                                                                                                                                                                                     | `[String]`    |

- [ ] **Step 1: Write the failing test** with a two-document fixture (one query with a fragment on `RestaurantPreview`, one mutation with an input variable) asserting the generated SDL text contains `type RestaurantPreview`, `extend type Query { restaurant(id: String): Restaurant }`, the input type, and that the output passes `buildSchema` together with `core.graphql`.
- [ ] **Step 2: Run it**, expect FAIL.
- [ ] **Step 3: Implement** `generate-sdl.mjs` (pure `generate(requirements, typeMap, lanes)` returning `{ files: { [name]: text }, review: [...] }` plus CLI writing the files, `docs/SDL_TYPE_REVIEW.md`, and formatting with Prettier).
- [ ] **Step 4: Run** `node --test tools/generate-sdl.test.mjs && node tools/generate-sdl.mjs`.
- [ ] **Step 5: Commit** `feat(contract): generate initial Enatega SDL split by lane`.

### Task W1-0.4: Make the contract gate pass

- [ ] Delete `contracts/foundation.graphql`, `identity.graphql`, `catalog.graphql`, `addresses.graphql`, `configuration.graphql` from the served schema (D15): move them to `contracts/legacy/` (not loaded), and remove their entries from `kernel/schema.ts`. Delete or rewrite resolvers that reference removed roots: `FoundationResolver.serviceInfo` (remove), `IdentityResolver` (remove the class; its service stays for L1), `CatalogResolver`, `AddressesResolver` (remove classes; services stay for L3/L4), `ConfigurationResolver` (keep — `configuration`/`publicConfiguration` are Enatega roots; re-point to the new types in L2). Move their HTTP tests that call removed roots to `test/legacy/` excluded from runs, and list them in the lane plans for rewrite.
- [ ] Update `codegen.ts` to read `contracts/enatega/*.graphql` and generate `packages/api-contracts/src/generated.ts` (rename the package directory `packages/identity-contracts` → `packages/api-contracts`, package name `@fairbite/api-contracts`; update imports). Run `pnpm codegen`.
- [ ] Run `pnpm check:enatega`. For each failing document, read the validation error, fix the generated SDL in the right lane file (missing field, wrong list-ness, nullability of arguments, enum value), and re-run. Typical fixes are listed in `docs/SDL_TYPE_REVIEW.md` for the lane to confirm. Repeat until every document in all six apps schema-validates. Scope is determined by `OPERATION_LANES.json`, never inferred from the app name: L1–L9 roots proceed to implementation; L12 roots are served by explicit `NOT_IMPLEMENTED` resolvers until Wave 5.
- [ ] Run `pnpm check:operations --require-schema`; expect all 334 roots `inSchema: true`.
- [ ] Write `services/api/test/integration/contract/all-operations.integration.spec.ts`: for every resolved document from all six apps (one `it` per document, named `<app> <file>:<line>`), first validate the exact document against the served schema independently of authorization and execution. Then execute it through `GqlClient` with deterministic variables generated recursively from the schema: satisfy every non-null wrapper, list minimum, nested required input field and custom scalar; use a known enum value, bounded valid strings, a valid existing UUIDv4 fixture id where the field refers to data, and a valid UUIDv7 for create-style ids. Do not use `{}` for an input with required fields or assert that `BAD_USER_INPUT` proves compatibility. Assert no `GRAPHQL_VALIDATION_FAILED` or `INTERNAL_SERVER_ERROR`; L1–L9 may return data or an explicitly allowed auth/domain error, while every L12 root must return `NOT_IMPLEMENTED`. Store per-document generated variables in failure output so a failure is reproducible. This test stays in the suite forever and distinguishes schema acceptance from resolver behavior.
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
export interface ConfigPort {
  // L2
  currency(): Promise<Currency>;
  delivery(): Promise<{ costType: "fixed" | "perKm"; rateMinor: number }>;
  tipOptions(): Promise<{ enabled: boolean; percentages: number[] }>;
  verification(): Promise<{ skipEmail: boolean; skipMobile: boolean }>;
}
export const ZONES_PORT = Symbol("ZONES_PORT");
export interface ZonesPort {
  // L2
  zoneAt(
    longitude: number,
    latitude: number,
  ): Promise<{ id: string; title: string } | null>;
  get(id: string): Promise<{
    id: string;
    title: string;
    area: Polygon;
    isActive: boolean;
  } | null>;
}
export const USERS_PORT = Symbol("USERS_PORT");
export interface UsersPort {
  // L1
  customer(id: string): Promise<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
  } | null>;
  pushTokens(userId: string): Promise<string[]>;
}
export type RestaurantForOrdering = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  vendorId: string | null;
  ownerUserIds: string[];
  zoneId: string | null;
  location: Point;
  deliveryBounds: Polygon | null;
  timeZone: string;
  openingTimes: OpeningTimes;
  isActive: boolean;
  isAvailable: boolean;
  minimumOrderMinor: number;
  taxPercent: number;
  deliveryTimeMinutes: number;
  plan: "CORE";
  commissionPercent: 0;
  orderPrefix: string;
  phone: string | null;
};
export type PricedLine = {
  foodId: string;
  foodTitle: string;
  variationId: string;
  variationTitle: string;
  unitPriceMinor: number;
  addons: {
    addonId: string;
    title: string;
    options: { optionId: string; title: string; priceMinor: number }[];
  }[];
  isOutOfStock: boolean;
};
export const RESTAURANTS_PORT = Symbol("RESTAURANTS_PORT");
export interface RestaurantsPort {
  // L3
  forOrdering(id: string): Promise<RestaurantForOrdering | null>;
  priceLines(
    restaurantId: string,
    lines: {
      foodId: string;
      variationId: string;
      addons: { addonId: string; optionIds: string[] }[];
    }[],
  ): Promise<PricedLine[]>;
  ownedBy(userId: string): Promise<string[]>;
}
export const COUPONS_PORT = Symbol("COUPONS_PORT");
export interface CouponsPort {
  // L3
  resolve(
    titleOrCode: string,
    restaurantId: string,
    at: Date,
  ): Promise<{ id: string; title: string; discountPercent: number } | null>;
}
export const ADDRESSES_PORT = Symbol("ADDRESSES_PORT");
export interface AddressesPort {
  // L4
  owned(
    userId: string,
    addressId: string,
  ): Promise<{
    id: string;
    label: string;
    deliveryAddress: string;
    details: string;
    location: Point;
  } | null>;
}
export type OrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "ASSIGNED"
  | "PICKED"
  | "DELIVERED"
  | "CANCELLED";
export type OrderSnapshot = {
  id: string;
  orderId: string;
  status: OrderStatus;
  restaurantId: string;
  userId: string;
  riderId: string | null;
  zoneId: string | null;
  isPickedUp: boolean;
  paymentMethod: "COD" | "STRIPE" | "PAYPAL";
  paymentStatus: "PENDING" | "PAID" | "REFUNDED";
  currency: Currency;
  itemsMinor: number;
  discountMinor: number;
  deliveryMinor: number;
  taxMinor: number;
  tipMinor: number;
  totalMinor: number;
  version: number;
  createdAt: Date;
  acceptedAt: Date | null;
};
export const ORDERS_PORT = Symbol("ORDERS_PORT");
export interface OrdersPort {
  // L5
  get(id: string): Promise<OrderSnapshot | null>;
  // The only way any lane changes an order's status (AGENTS.md: centrally validated transitions).
  transition(input: {
    id: string;
    to: OrderStatus;
    actor: { type: string; id: string };
    expectedVersion?: number;
    reason?: string;
    riderId?: string | null;
  }): Promise<OrderSnapshot>;
  markPaid(
    id: string,
    providerReference: string,
    paidMinor: number,
  ): Promise<OrderSnapshot>;
}
export const RIDERS_PORT = Symbol("RIDERS_PORT");
export interface RidersPort {
  // L6
  rider(id: string): Promise<{
    id: string;
    userId: string;
    name: string;
    phone: string | null;
    zoneId: string | null;
    available: boolean;
    isActive: boolean;
  } | null>;
  availableInZone(zoneId: string): Promise<string[]>;
}
export const LEDGER_PORT = Symbol("LEDGER_PORT");
export interface LedgerPort {
  // L7
  balances(account: { type: "RESTAURANT" | "RIDER"; id: string }): Promise<{
    totalMinor: number;
    withdrawnMinor: number;
    currentMinor: number;
    pendingMinor: number;
  }>;
}
export const PAYMENTS_PORT = Symbol("PAYMENTS_PORT");
export interface PaymentsPort {
  // L7
  available(method: "STRIPE" | "PAYPAL"): Promise<boolean>;
}
export type Message = {
  template: string;
  data: Record<string, string | number>;
};
export const NOTIFY_PORT = Symbol("NOTIFY_PORT");
export interface NotifyPort {
  // L8
  push(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void>;
  email(to: string, message: Message): Promise<void>;
  sms(to: string, text: string): Promise<void>;
}
export const MEDIA_PORT = Symbol("MEDIA_PORT");
export interface MediaPort {
  // L2
  storeDataUrl(
    dataUrl: string,
    ownerId: string,
  ): Promise<{ key: string; url: string }>;
}
export const AUDIT_PORT = Symbol("AUDIT_PORT");
export interface AuditPort {
  // L2
  record(entry: {
    actorId: string;
    actorType: string;
    action: string;
    entity: string;
    entityId: string;
    changes?: Record<string, unknown>;
  }): Promise<void>;
}
```

Domain events (`kernel/events.ts`) are written to the `DomainEvent` outbox table **through the same unit-of-work transaction and database client** as the state change, then delivered at least once by the worker to handlers and to `PubSub`. A module may not update state through Prisma and enqueue through an unrelated `pg` connection. Add `kernel/unit-of-work.ts` with an explicit transaction context passed to repositories and `enqueue`; integration tests must prove both writes commit or roll back together. Event types and payloads:

| Event                | Producer | Payload                                             | Consumers                                                                                                                  |
| -------------------- | -------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `order.placed`       | L5       | `OrderSnapshot`                                     | L6 (none until accepted), L8 (push to restaurant), L9 (counters)                                                           |
| `order.transitioned` | L5       | `{ from, to, order: OrderSnapshot, actor, reason }` | L6 (broadcast on ACCEPTED, release on CANCELLED), L7 (ledger on DELIVERED/CANCELLED), L8 (push), L5 (subscription publish) |
| `order.paid`         | L7       | `{ orderId, providerReference, paidMinor }`         | L5 (status visibility), L8                                                                                                 |
| `rider.location`     | L6       | `{ riderId, location, recordedAt }`                 | L6 (tracking subscription)                                                                                                 |
| `withdraw.updated`   | L7       | `{ requestId, status }`                             | L8                                                                                                                         |
| `user.otp`           | L1       | `{ channel, to, code, purpose }`                    | L8                                                                                                                         |
| `ticket.message`     | L4       | `{ ticketId, senderType }`                          | L8                                                                                                                         |

```ts
// services/api/src/kernel/events.ts
export type DomainEvent =
  | { type: "order.placed"; payload: import("./ports.js").OrderSnapshot }
  | {
      type: "order.transitioned";
      payload: {
        from: string;
        to: string;
        order: import("./ports.js").OrderSnapshot;
        actor: { type: string; id: string };
        reason?: string;
      };
    }
  | {
      type: "order.paid";
      payload: {
        orderId: string;
        providerReference: string;
        paidMinor: number;
      };
    }
  | {
      type: "rider.location";
      payload: {
        riderId: string;
        longitude: number;
        latitude: number;
        recordedAt: string;
      };
    }
  | { type: "withdraw.updated"; payload: { requestId: string; status: string } }
  | {
      type: "user.otp";
      payload: {
        channel: "email" | "sms";
        to: string;
        code: string;
        purpose: "signup" | "reset" | "login";
      };
    }
  | {
      type: "ticket.message";
      payload: { ticketId: string; senderType: "USER" | "ADMIN" };
    };
export type EventHandler<T extends DomainEvent["type"]> = (
  event: Extract<DomainEvent, { type: T }>,
) => Promise<void>;
```

```ts
// services/api/src/kernel/outbox.ts
import type { PoolClient } from "pg";
import { newId } from "./ids.js";
import type { DomainEvent } from "./events.js";

// Call inside the same transaction as the state change.
export async function enqueue(
  client: Pick<PoolClient, "query">,
  event: DomainEvent,
): Promise<string> {
  const id = newId();
  await client.query(
    'INSERT INTO "DomainEvent"(id, type, payload) VALUES ($1, $2, $3)',
    [id, event.type, JSON.stringify(event.payload)],
  );
  return id;
}
```

`base.prisma` adds:

```prisma
model DomainEvent {
  id             String    @id @db.Uuid
  type           String    @db.VarChar(64)
  payload        Json      @db.JsonB
  createdAt      DateTime  @default(now()) @db.Timestamptz(3)
  availableAt    DateTime  @default(now()) @db.Timestamptz(3)
  claimedBy      String?   @db.VarChar(100)
  claimExpiresAt DateTime? @db.Timestamptz(3)
  processedAt    DateTime? @db.Timestamptz(3)
  attempts       Int       @default(0)
  lastError      String?   @db.VarChar(500)
  deadLetteredAt DateTime? @db.Timestamptz(3)
  @@index([processedAt, availableAt, claimExpiresAt, createdAt])
}
model EventInbox {
  consumer   String   @db.VarChar(100)
  eventId    String   @db.Uuid
  processedAt DateTime @default(now()) @db.Timestamptz(3)
  @@id([consumer, eventId])
  @@index([eventId])
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

Worker: `services/worker/src/jobs/outbox.ts` claims due rows in a short transaction with `SELECT … FOR UPDATE SKIP LOCKED LIMIT 100`, assigns `claimedBy` and a bounded `claimExpiresAt` lease, commits, then dispatches outside that transaction. A crashed worker leaves a lease that another worker can reclaim. Each named consumer inserts `(consumer, eventId)` into `EventInbox` in the same transaction as its database side effects; a uniqueness conflict means the consumer already completed and is acknowledged. External providers receive a stable idempotency key derived from consumer and event id; where a provider cannot enforce idempotency, the handler must reconcile provider state before retry and document the residual duplicate risk. After all required consumers acknowledge, mark `processedAt`. Failures clear or expire the claim and set `availableAt` with bounded exponential backoff; after 10 attempts mark a queryable dead-letter state and alert. The guarantee is **at-least-once delivery with idempotent consumption**, never exactly-once external side effects.

- [ ] **Tests:** unit test that `enqueue` issues one INSERT with the serialised payload through the supplied unit of work; integration tests that state plus event commit together, state plus event roll back together, an expired lease is reclaimed, concurrent workers cannot hold the same live claim, duplicate delivery invokes an idempotent consumer effect once through `EventInbox`, and a handler that throws is retried and then succeeds. Provider-fake tests assert the same stable idempotency key on every attempt. Do not assert exactly-once delivery.
- [ ] Commit `feat(kernel): add cross-lane ports, domain events and transactional outbox`.

### Task W1-0.6: Prisma multi-file schema and base models

- [ ] Move `services/api/prisma/schema.prisma` to `services/api/prisma/schema/base.prisma` (generator and datasource stay there). Split the existing models into the owning lane files without changing their database mappings: identity models → `L1-identity.prisma`; `CatalogMerchant`, `CatalogOutlet`, `CatalogCategory`, `CatalogItem` → `L3-vendors-catalog.prisma`; `CustomerAddress` → `L4-customers.prisma`; `RuntimeConfiguration*` → `L2-platform.prisma`. Later model changes follow the preserve/backfill/cutover mapping from P1. Keep `FoundationMigration`, `DomainEvent`, `EventInbox` and `DevOutbox` in `base.prisma`.
- [ ] Set `schema: "prisma/schema"` in `prisma.config.ts`. Run `pnpm --filter @fairbite/api exec prisma validate` and `prisma generate`; expect success with identical generated client models.
- [ ] Add migration `202610090000_base_outbox` (`DomainEvent`, `EventInbox`, `DevOutbox`) with `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script` restricted to the three new tables. Apply it first to the populated migration-005 fixture and run P1 preservation assertions; then verify a fresh deploy.
- [ ] Commit `refactor(db): split Prisma schema by lane and add outbox tables`.

### Task W1-0.7: Factories

**Files:**

- Create: `services/api/test/support/factories/base.ts`
- Create per lane: `services/api/test/support/factories/L<n>.ts`
- Create: `services/api/test/support/factories/index.ts`

`factories/index.ts` composes `factories(pool)` from one file per lane, returning one async builder per table that inserts a valid row with overridable fields, e.g. `await f.restaurant({ name: "Pasta Place" })`. W1-0 owns `base.ts` and the index. Each lane owns only its `L<n>.ts`; the lead updates the index after merging the lane. Builders insert with SQL, not through services, so any lane can seed another lane's data without concurrent edits to a shared file.

- [ ] Commit `test(harness): add table factories`.

### Task W1-0.8: Handoff to lanes

- [ ] Run `pnpm verify --integration`.
- [ ] After P3 is complete, open lane branches `wave1/L<n>-schema` from the integration branch and dispatch W1-L1 … W1-L9 in dependency-aware batches with at most three lane agents plus the lead active (four total). Agents do not edit root package files, lockfiles, Prisma configuration, factory index or migration history. The lead serializes those shared changes.

---

## W1-L\* — lane schema refinement (batched, maximum four total agents)

Each lane agent owns `contracts/enatega/L<n>-*.graphql`, `services/api/prisma/schema/L<n>-*.prisma`, `services/api/src/modules/<module>/mappers.ts`, `services/api/test/support/factories/L<n>.ts` and its port implementation skeleton. Lane agents produce a reviewed migration proposal in their branch but do not add it to the shared migration history. The lead rebases each accepted schema in dependency order, generates/reviews one migration, applies it to the populated upgrade fixture, runs preservation checks, then merges the next lane. Use the completed lane's Wave 2 plan (`1x-lane-…md`) "Data model" and "Contract" sections as the specification; a missing or partial plan blocks that lane.

### Task W1-L.1: Review and correct the lane SDL

- [ ] For every entry for your lane in `docs/SDL_TYPE_REVIEW.md`, decide the type from the reference docs (cite the section in a `#` comment above the field) and fix it.
- [ ] For every type you own: nullability — fields the apps always read without a null check are non-null only if the server can always produce them; everything else nullable. Enums: define enums only where the apps send or compare a fixed set (order status, payment method, user type); otherwise `String` with server-side validation.
- [ ] Each root field has a `#` comment: apps that call it, auth rule (from master §4.4 / reference/04 §B), and timestamp convention for any time field (ISO or epoch-ms, reference/02 §0.5).
- [ ] Run `pnpm check:enatega` (must stay PASS) and `pnpm --filter @fairbite/api test:integration -- contract/all-operations` (must stay green).

### Task W1-L.2: Lane data model and migration

- [ ] Write the lane's Prisma models exactly as specified in the lane plan's "Data model" section: UUID `@db.Uuid` ids, money as `BigInt` `*Minor`, `timestamptz(3)`, `version Int @default(1)` on mutable aggregates (optimistic concurrency), soft-delete `deletedAt` where the apps "delete" things that history still references (restaurants, foods, riders, users, zones), and indexes for every query in the lane plan.
- [ ] References to another lane's tables are scalar id columns **without** Prisma relation fields (avoids cross-file edits). List each such column in `docs/CROSS_LANE_FKS.md` (`table.column → table.id, on delete`); the lead adds the foreign keys in Task W1-Z.1.
- [ ] Produce a lane migration proposal and review it against P1. The lead generates the final sequential migration named `2026100901<lane number>0_<lane>_upgrade`, adds PostGIS columns/indexes where Prisma cannot express them, and records preserve/backfill/cutover/rollback steps. Destructive SQL is prohibited.
- [ ] The lead restores the populated migration-005 fixture, applies the migration, runs lane preservation/backfill assertions and the API read checks, then runs the drift check. After that passes, deploy the complete history to a fresh database as a secondary check.

### Task W1-L.3: Mappers, factories and port skeleton

- [ ] `src/modules/<module>/mappers.ts`: one pure function per owned GraphQL type converting a database row to the GraphQL shape (money via `toMajor` with the configured exponent, ISO/epoch via `kernel/time.ts`, GeoJSON via `kernel/geo.ts`, `_id` from `id`). Unit tests for each mapper in `test/unit/<module>/mappers.spec.ts` with at least: all fields mapped, nulls preserved, money rounding, timestamp convention.
- [ ] Add the lane's builders only to `test/support/factories/L<n>.ts`; the lead composes them in `factories/index.ts`.
- [ ] Register the lane's port implementation class(es) with methods that throw `appError("NOT_IMPLEMENTED")`; Wave 2 fills them.
- [ ] Commit per task; open a PR to the integration branch; request L11 review.

---

## W1-Z — lead closes Wave 1

### Task W1-Z.1: Cross-lane foreign keys

- [ ] Write migration `202610091900_cross_lane_fks` adding every foreign key from `docs/CROSS_LANE_FKS.md` with the stated `ON DELETE` (default `RESTRICT`; soft-deleted rows keep references valid).
- [ ] Restore the populated migration-005 fixture, apply the full ordered history including the foreign keys, run all preservation/backfill/API checks and the drift check. Then run a fresh-database deploy as a secondary verification.

### Task W1-Z.2: Gate G1

- [ ] `pnpm verify --integration --coverage --record G1` — must include zero unresolved dynamic documents, `check:enatega` PASS for all multivendor and single-vendor documents, `check:operations --require-schema`, `contract/all-operations` green with L12 runtime `NOT_IMPLEMENTED`, populated migration-005 upgrade and preservation tests, fresh migration deploy, clean drift, outbox lease/inbox/idempotency tests and `codegen:check`.
- [ ] L11 review of SDL and data model for consistency (type names, nullability, money/time conventions) across lanes; L13 review of field-level restrictions on secret and personal fields.
- [ ] Commit `docs/GATES.json`.
