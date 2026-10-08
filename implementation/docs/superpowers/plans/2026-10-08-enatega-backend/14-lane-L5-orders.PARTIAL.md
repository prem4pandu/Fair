# Lane L5 — Orders, pricing & lifecycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

**Goal:** Implement every L5 operation (24 roots: placement, pricing, customer/store/admin order reads, the order state machine and its three subscriptions) so the unchanged Enatega customer app, customer web, store app, rider app and admin place, price, track, accept, decline, hand over, cancel, review and administer orders against our backend with server-owned money, one central transition function and exactly-once accept timeouts.

**Architecture:** Two modules. `modules/pricing` is a pure, exhaustively unit-tested engine (integer minor units) plus a thin service that gathers its inputs through `RestaurantsPort`, `CouponsPort` and `ConfigPort`. `modules/orders` owns the `Order` aggregate, its snapshots and history; every status change in the system goes through the PostgreSQL function `l5_transition_order(...)` (allowed-transition table, actor classes, optimistic version, idempotency, timestamps, history row and `order.transitioned` outbox row in one statement), called by `TransitionService` (API, also behind `OrdersPort.transition`) and by the worker accept-timeout sweep; subscription messages are published to Redis after commit and each subscription authorises itself at subscribe time and re-reads the order per event.

**Tech stack:** NestJS 12 schema-first resolvers, `pg` 8 (raw SQL, as the existing modules), PostgreSQL 17 PL/pgSQL, Redis pub/sub (`kernel/pubsub.ts`), BullMQ 6 job scheduler in `services/worker`, zod 4, Vitest 4 + Testcontainers, Playwright 1.63 (specs handed to L10).

---

## 1. Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

L5 makes **no** edit inside `vendor/enatega-ui/`. The client defects listed in reference/02 §14 (NaN tip, `placeOrder.user.email` not selected, undeclared `offset`) are tolerated server-side (R14, R15, R16), never fixed in the UI.

---

## 2. Operations

Authority: `implementation/docs/OPERATION_LANES.json`, filter `lane == "L5"` → **24 operations** (12 queries, 9 mutations, 3 subscriptions). Every row below was checked against the JSON and every export name below was verified by reading the vendored file (`grep -n "export const"`). `app` paths are relative to `vendor/enatega-ui/<app>/`.

Legend for "Who may call": **C** = CUSTOMER (exact type; ADMIN does not pass customer-only checks), **R/V** = RESTAURANT/VENDOR user whose `RestaurantsPort.ownedBy(userId)` contains the restaurant, **Rd** = RIDER whose `AuthContext.riderId` equals `order.riderId`, **A** = ADMIN, **S(x)** = STAFF holding permission `x`.

| # | Type | Name | Apps (multivendor) | Who may call | Documents used in tests (`app`, `file`, `exportName`) | Reference |
|---|---|---|---|---|---|---|
| 1 | mutation | `coupon` | app, web | C | `enatega-multivendor-app`, `src/apollo/mutations.js`, `applyCoupon`; `enatega-multivendor-web`, `lib/api/graphql/mutations/coupon/index.ts`, `VERIFY_COUPON` | ref/02 §5.5 |
| 2 | mutation | `placeOrder` | app, web, rider (unused copy) | C (Rd, A → FORBIDDEN) | app `src/apollo/mutations.js` `placeOrder`; web `lib/api/graphql/mutations/orders/index.ts` `PLACE_ORDER`; `enatega-multivendor-rider`, `lib/apollo/mutations/order.mutation.ts`, `placeOrder` | ref/02 §5.2–§5.6, §11, §14; ref/03 §2.11 |
| 3 | query | `orders` | app, web, rider (copy) | C (own orders) | app `src/apollo/queries.js` `myOrders`; web `lib/api/graphql/queries/orders/index.ts` `ORDERS`; rider `lib/apollo/queries/order/order-1.query.ts` `myOrders` | ref/02 §6.1, §5.7 |
| 4 | query | `order` | app, rider | C (own), R/V (own restaurant), Rd (assigned), A, S(Orders\|Dispatch) | app `src/apollo/queries.js` `order`; rider `lib/apollo/queries/order/order-1.query.ts` `order` | ref/02 §6.1 |
| 5 | query | `orderDetails` | web | as `order` | web `lib/api/graphql/queries/order-tracking/index.ts` `ORDER_TRACKING` | ref/02 §6.1 |
| 6 | query | `getUsersActiveOrders` | app, web | C (own) | app `src/apollo/queries.js` `getUsersActiveOrders`; web `lib/api/graphql/queries/orders/index.ts` `GET_USERS_ACTIVE_ORDERS` | ref/02 §6.2 |
| 7 | query | `getUsersPastOrders` | app, web | C (own) | app `src/apollo/queries.js` `getUsersPastOrders`; web `lib/api/graphql/queries/orders/index.ts` `GET_USERS_PAST_ORDERS` | ref/02 §6.2 |
| 8 | mutation | `abortOrder` | app, web, rider (copy) | C (own, PENDING only) | app `src/apollo/mutations.js` `cancelOrder` (anonymous operation); web `lib/api/graphql/mutations/orders/index.ts` `ABORT_ORDER`; rider `lib/apollo/mutations/order.mutation.ts` `cancelOrder` | ref/02 §6.5; ref/03 §2.11 |
| 9 | mutation | `reviewOrder` | app, web, rider (copy) | C (own, DELIVERED only) | app `src/apollo/mutations.js` `reviewOrder`; web `lib/api/graphql/mutations/orders/index.ts` `ADD_REVIEW_ORDER`; rider `lib/apollo/mutations/order.mutation.ts` `reviewOrder` | ref/02 §6.6 |
| 10 | query | `restaurantOrders` | store | R/V (own restaurants); A gets `[]` | `enatega-multivendor-store`, `lib/apollo/queries/orders.ts`, `GET_ORDERS` | ref/03 §1.4 |
| 11 | mutation | `acceptOrder` | store | R/V (own), A | store `lib/apollo/mutations/order.mutation.ts` `ACCEPT_ORDER` | ref/03 §1.8, §B |
| 12 | mutation | `cancelOrder` | store | R/V (own, PENDING), A (any non-terminal) | store `lib/apollo/mutations/order.mutation.ts` `CANCEL_ORDER` | ref/03 §1.9, §B |
| 13 | mutation | `orderPickedUp` | store | R/V (own), A | store `lib/apollo/mutations/order.mutation.ts` `PICK_UP_ORDER` | ref/03 §1.10, §B |
| 14 | mutation | `muteRing` | store | R/V (own), A | store `lib/apollo/mutations/order.mutation.ts` `MUTATE_ORDER_RING` | ref/03 §1.7 |
| 15 | query | `allOrders` | admin | A, S(Orders) | `enatega-multivendor-admin`, `lib/api/graphql/queries/orders/index.ts`, `GET_ORDERS` | ref/04 §2.12, §B |
| 16 | query | `allOrdersPaginated` | admin | A, S(Orders) | admin `lib/api/graphql/queries/orders/index.ts` `GET_ALL_ORDERS_PAGINATED` | ref/04 §2.12, §2.1 (`dateKeyword`), §4 (P2) |
| 17 | query | `allOrdersWithoutPagination` | admin | A, S(Orders) | admin `lib/api/graphql/queries/orders/index.ts` `GET_ORDERS_WITHOUT_PAGINATION` | ref/04 §2.12 |
| 18 | query | `ordersByRestId` | admin | A, S(Orders\|Stores), R/V (own) | admin `lib/api/graphql/queries/orders/index.ts` `GET_ORDER_BY_RESTAURANT` | ref/04 §2.12, §B |
| 19 | query | `ordersByRestIdWithoutPagination` | admin | A, S(Orders\|Stores), R/V (own) | admin `lib/api/graphql/queries/orders/index.ts` `GET_ORDER_BY_RESTAURANT_WITHOUT_PAGINATION` | ref/04 §2.12, §B |
| 20 | query | `orderFilterOptions` | admin | A, S(Orders) | admin `lib/api/graphql/queries/orders/index.ts` `GET_ORDER_FILTER_OPTIONS` | ref/04 §2.12 |
| 21 | mutation | `updateStatus` | admin | A, S(Dispatch\|Orders) | admin `lib/api/graphql/mutations/dispatch/index.ts` `UPDATE_STATUS` | ref/04 §2.1 (Dispatch), §B; ref/03 §B |
| 22 | subscription | `subscribePlaceOrder` | store, admin (unused) | R/V (own), A, S(Orders\|Stores) | store `lib/apollo/subscriptions.ts` `SUBSCRIBE_PLACE_ORDER`; admin `lib/api/graphql/subscription/order-subscription/index.ts` `SUBSCRIPTION_PLACE_ORDER` | ref/03 §1.5 |
| 23 | subscription | `subscriptionOrder` | app, web, store, rider, admin | as `order` | app `src/apollo/subscriptions.js` `subscriptionOrder`; web `lib/api/graphql/subscription/orders/index.ts` `SUBSCRIPTION_ORDER`; store `lib/apollo/subscriptions.ts` `SUBSCRIPTION_ORDER_MULTI_VENDOR`; admin `lib/api/graphql/subscription/order-subscription/index.ts` `SUBSCRIPTION_ORDER`; rider `lib/apollo/subscriptions.ts` `SUBSCRIPTION_ORDERS` | ref/02 §6.4; ref/03 §1.6 |
| 24 | subscription | `orderStatusChanged` | app, web | C (`userId` must equal the socket user) | app `src/apollo/subscriptions.js` `orderStatusChanged`; web `lib/api/graphql/subscription/orders/index.ts` `orderStatusChanged` (untagged string export) | ref/02 §6.4, §10 |

**Count check:** 24 rows = 24 entries with `"lane": "L5"` in `OPERATION_LANES.json` (verified with `node -e "…filter(o=>o.lane==='L5').length"` → `24`).

Notes on the documents:

- Several app/rider documents are untagged template strings (`export const placeOrder = \``…`), and the app's `getUsersActiveOrders`/`getUsersPastOrders` interpolate the local const `ordersFieldsBody`; `tools/lib/documents.mjs` (W0-B Task B3) resolves both. The store's `GET_ORDERS` and `SUBSCRIPTION_ORDER_MULTI_VENDOR` have a `// @multi-vendor-only` comment between `=` and `gql` (ignored by the AST walk).
- The store `SUBSCRIPTION_ORDER` export (`lib/apollo/subscriptions.ts:115`) is the single-vendor variant; tests use `SUBSCRIPTION_ORDER_MULTI_VENDOR` (`:140`).
- The admin's `subscribePlaceOrder`/`subscriptionOrder` documents are UNUSED in multivendor-admin (ref/04 §2.1) but must still work; they are exercised in the subscription tests.

---

## 3. Contract notes (guides W1-L.1 for `contracts/enatega/L5-orders.graphql`)

Conventions applied to every L5 type:

- **Ids:** `_id: ID!` and `id: ID!` carry the same value on `Order`, `Item`, `ItemVariation`, `ItemAddon`, `ItemOption` (store and admin select both; ref/03 §1.4). `orderId` is the human id (`<orderPrefix>-<base-36 sequence>`), a `String`.
- **Money:** every money field is `Float` in major units, produced by `toMajor(minor, currencyExponent)` from the order's own snapshot exponent: `orderAmount paidAmount deliveryCharges tipping taxationAmount discountAmount`, `ItemVariation.price discounted`, `ItemOption.price`.
- **Timestamps:** all lifecycle timestamps are **ISO-8601 strings** (`isoString`), reference/02 §0.5: `createdAt updatedAt orderDate expectedTime acceptedAt assignedAt pickedAt deliveredAt cancelledAt completionTime preparationTime` and all `OrderEta` times. `preparationTime` is the absolute ready-at time (ref/03 §1.8). `selectedPrepTime` is `Int` minutes (web interface `order-tracking-detail.interface.ts:72`).
- **Type names:** order lines are type **`Item`** — the customer app has an `Item` type policy (`enatega-multivendor-app/src/apollo/index.js:124-134`). This overrides W1-0.2 rule 2 (`items[]` under an order → `OrderItem`): the database table is `OrderItem`, the GraphQL type is `Item`. Item variation/addon/option are L5-owned snapshot types (`ItemVariation`, `ItemAddon`, `ItemOption`), **not** catalog `Variation`/`Addon`/`Option`, because catalog `Addon.options` is `[String]` ids while order `addons.options` are objects.
- **Foreign types:** `Order.restaurant: Restaurant!` (L3), `Order.user: User!` (L1), `Order.rider: Rider` (L6), `Order.review: Review` (L3), `Order.zone: Zone` (L2), `CouponResult.coupon: Coupon` (L3). L5 resolves them as **plain objects with only these fields**: Restaurant `{_id id name image slug shopType address location}`, User `{_id name phone email}`, Rider `{_id name phone username available}`, Review `{_id rating description}`, Zone `{_id}`, Coupon `{_id title discount enabled}`. Cross-lane rule for W1-L.1 reviewers: those lanes must not add `@ResolveField` resolvers on these fields that expect their own database rows; any field resolver on those types must key on `_id` only.
- **Restricted fields:** none on `Order` beyond visibility of the whole order (R20). `user.email`/`user.phone` are visible to whoever may read the order (customer, owning store, assigned rider, admin) — that is the upstream behaviour the store and admin rely on.
- **Misspellings kept:** none in L5 roots. Argument names are exact: `acceptOrder(_id, time)`, `cancelOrder(_id, reason)`, `orderPickedUp(_id)`, `muteRing(orderId)`, `updateStatus(id, orderStatus)`, `ordersByRestId(restaurant, page, rows, …)`, `allOrdersPaginated(…, starting_date, ending_date, …)` (snake case), `coupon(coupon, restaurantId)`, `subscribePlaceOrder(restaurant)`.
- **Argument nullability:** least strict across documents (ref/02 §0.1): `getUsersActiveOrders`/`getUsersPastOrders` arguments are nullable `Int` (documents declare `Int!`, which is compatible); `restaurantOrders(offset: Int, limit: Int)` keeps the single-vendor arguments.
- **Inputs:** `AddressInput` belongs to L4 and must contain `_id label deliveryAddress details latitude longitude isDemoDefaultLocation demoZoneId` (`latitude`/`longitude` are `String`, ref/02 §2.1); L5 depends on it.

```graphql
# contracts/enatega/L5-orders.graphql
# Lane L5 — orders, pricing & lifecycle. Owner: L5. Timestamps: ISO-8601 strings unless noted.
# Money: Float major units converted from integer minor units with the order's currency exponent.

enum OrderStatus {
  PENDING
  ACCEPTED
  ASSIGNED
  PICKED
  DELIVERED
  CANCELLED
}

type Order {
  _id: ID!
  id: ID!
  "Human id: <orderPrefix>-<base-36 sequence>. Used in Stripe URLs, support tickets and muteRing."
  orderId: String!
  restaurant: Restaurant!
  deliveryAddress: OrderAddress!
  items: [Item!]!
  user: User!
  rider: Rider
  review: Review
  zone: Zone
  "COD | STRIPE | PAYPAL"
  paymentMethod: String!
  "PENDING | PAID | REFUNDED"
  paymentStatus: String!
  paidAmount: Float!
  orderAmount: Float!
  deliveryCharges: Float!
  tipping: Float!
  taxationAmount: Float!
  discountAmount: Float!
  orderStatus: OrderStatus!
  "Legacy flag: false only for CANCELLED orders."
  status: Boolean!
  isActive: Boolean!
  "Customer self-pickup (takeaway), not 'rider has collected'."
  isPickedUp: Boolean!
  isRinged: Boolean!
  isRiderRinged: Boolean!
  reason: String
  instructions: String
  orderDate: String!
  expectedTime: String
  createdAt: String!
  updatedAt: String!
  acceptedAt: String
  assignedAt: String
  pickedAt: String
  deliveredAt: String
  cancelledAt: String
  completionTime: String
  preparationTime: String
  "Minutes chosen by the store at acceptance."
  selectedPrepTime: Int
  eta: OrderEta
}

type OrderAddress {
  _id: ID
  id: ID
  label: String
  deliveryAddress: String!
  details: String
  location: Location
}

type Item {
  _id: ID!
  id: ID!
  title: String!
  "Catalog food id"
  food: String!
  description: String
  image: String
  quantity: Int!
  specialInstructions: String
  isActive: Boolean!
  createdAt: String!
  updatedAt: String!
  variation: ItemVariation!
  addons: [ItemAddon!]!
}

type ItemVariation {
  _id: ID!
  id: ID!
  title: String!
  "Selling price at order time"
  price: Float!
  "Discount amount shown as strikethrough (price + discounted)"
  discounted: Float!
}

type ItemAddon {
  _id: ID!
  id: ID!
  title: String!
  description: String
  quantityMinimum: Int!
  quantityMaximum: Int!
  options: [ItemOption!]!
}

type ItemOption {
  _id: ID!
  id: ID!
  title: String!
  description: String
  price: Float!
}

type EtaPoint {
  latitude: Float!
  longitude: Float!
}

type OrderEta {
  phase: String!
  source: String!
  readyAt: String
  baseArrivalAt: String
  estimatedArrivalAt: String
  windowStartAt: String
  windowEndAt: String
  durationSeconds: Int
  distanceMeters: Int
  encodedPolyline: String
  origin: EtaPoint
  destination: EtaPoint
  calculatedAt: String!
  lastLocationAt: String
  version: Int!
}

"P2 shape (reference/04 §4)."
type PaginatedOrders {
  orders: [Order!]!
  totalCount: Int!
  currentPage: Int!
  totalPages: Int!
  prevPage: Int
  nextPage: Int
}

type OrderFilterRestaurant {
  _id: ID!
  name: String!
}

type OrderFilterRider {
  _id: ID!
  name: String
  username: String
  phone: String
}

type OrderFilterOptions {
  restaurants: [OrderFilterRestaurant!]!
  riders: [OrderFilterRider!]!
}

type OrderStatusChangedPayload {
  userId: String!
  "'new' on placement, 'update' afterwards"
  origin: String!
  order: Order!
}

type PlaceOrderEvent {
  userId: String!
  "'new' when the order becomes visible to the store, 'update' afterwards"
  origin: String!
  order: Order!
}

type CouponResult {
  success: Boolean!
  message: String
  coupon: Coupon
}

input OrderAddonInput {
  _id: String!
  options: [String]
}

input OrderInput {
  food: String!
  quantity: Int!
  variation: String!
  addons: [OrderAddonInput]
  specialInstructions: String
}

input ReviewInput {
  order: String!
  rating: Int!
  description: String
  comments: String
}

extend type Query {
  # app (payment polling, no args), web ({page:1, limit:300}), rider (copy). Auth: CUSTOMER, own orders.
  orders(offset: Int, page: Int, limit: Int): [Order!]!
  # app review sheet, rider (copy). Auth: order readers (R20).
  order(id: String!): Order!
  # web tracking page. Auth: order readers (R20).
  orderDetails(id: String!): Order!
  # app, web. Auth: CUSTOMER. Statuses PENDING ACCEPTED ASSIGNED PICKED.
  getUsersActiveOrders(page: Int, limit: Int, offset: Int): [Order!]!
  # app, web. Auth: CUSTOMER. Statuses DELIVERED CANCELLED.
  getUsersPastOrders(page: Int, limit: Int, offset: Int): [Order!]!
  # store. Auth: RESTAURANT/VENDOR, own restaurants. No pagination in MULTI.
  restaurantOrders(offset: Int, limit: Int): [Order!]!
  # admin. Auth: ADMIN, STAFF(Orders).
  allOrders(page: Int): [Order!]!
  # admin /management/orders. Auth: ADMIN, STAFF(Orders). dateKeyword may be a translated label.
  allOrdersPaginated(
    page: Int
    rows: Int
    dateKeyword: String
    starting_date: String
    ending_date: String
    orderStatus: [String]
    search: String
    restaurantId: ID
    riderId: ID
  ): PaginatedOrders!
  # admin. Auth: ADMIN, STAFF(Orders).
  allOrdersWithoutPagination(dateKeyword: String, starting_date: String, ending_date: String): [Order!]!
  # admin store/vendor area. Auth: ADMIN, STAFF(Orders|Stores), RESTAURANT/VENDOR own.
  ordersByRestId(restaurant: String!, page: Int, rows: Int, search: String, orderStatus: [String]): PaginatedOrders!
  # admin store/vendor area. Auth: ADMIN, STAFF(Orders|Stores), RESTAURANT/VENDOR own.
  ordersByRestIdWithoutPagination(restaurant: String!, search: String): [Order!]!
  # admin /management/orders filters. Auth: ADMIN, STAFF(Orders).
  orderFilterOptions: OrderFilterOptions!
}

extend type Mutation {
  # app, web. Auth: CUSTOMER. Coupon is matched by title (clients send coupon.title).
  coupon(coupon: String!, restaurantId: ID!): CouponResult!
  # app, web, rider (copy). Auth: CUSTOMER only. Client money values are ignored except tipping.
  placeOrder(
    restaurant: String!
    orderInput: [OrderInput!]!
    paymentMethod: String!
    couponCode: String
    tipping: Float!
    taxationAmount: Float!
    address: AddressInput!
    orderDate: String!
    isPickedUp: Boolean!
    deliveryCharges: Float!
    instructions: String
  ): Order!
  # app (anonymous operation), web, rider (copy). Auth: CUSTOMER, own, PENDING only.
  abortOrder(id: String!): Order!
  # app, web, rider (copy). Auth: CUSTOMER, own, DELIVERED only.
  reviewOrder(reviewInput: ReviewInput!): Order!
  # store. Auth: RESTAURANT/VENDOR own, ADMIN. time = minutes as a string.
  acceptOrder(_id: String!, time: String): Order!
  # store ("not available"). Auth: RESTAURANT/VENDOR own (PENDING), ADMIN (non-terminal).
  cancelOrder(_id: String!, reason: String!): Order!
  # store takeaway hand-over. Auth: RESTAURANT/VENDOR own, ADMIN.
  orderPickedUp(_id: String!): Order!
  # store, called with the human orderId after accept. Auth: RESTAURANT/VENDOR own, ADMIN.
  muteRing(orderId: String): Boolean!
  # admin dispatch. Auth: ADMIN, STAFF(Dispatch|Orders). Idempotent for the current status.
  updateStatus(id: String!, orderStatus: String!): Order!
}

extend type Subscription {
  # store (and admin, unused). Auth at subscribe: RESTAURANT/VENDOR own, ADMIN, STAFF(Orders|Stores).
  subscribePlaceOrder(restaurant: String!): PlaceOrderEvent!
  # all apps. Auth at subscribe: order readers (R20).
  subscriptionOrder(id: String!): Order!
  # app, web. Auth at subscribe: CUSTOMER with userId == socket user.
  orderStatusChanged(userId: String!): OrderStatusChangedPayload!
}
```

---

## 4. Data model (guides W1-L.2 and W1-L.3)

### 4.1 Prisma models — `services/api/prisma/schema/L5-orders.prisma`

```prisma
// Lane L5 — orders, pricing & lifecycle. Cross-lane ids are scalar columns; foreign keys are
// added by the lead in 202610091900_cross_lane_fks (docs/CROSS_LANE_FKS.md).

enum OrderStatus {
  PENDING
  ACCEPTED
  ASSIGNED
  PICKED
  DELIVERED
  CANCELLED
}

enum OrderPaymentMethod {
  COD
  STRIPE
  PAYPAL
}

enum OrderPaymentStatus {
  PENDING
  PAID
  REFUNDED
}

model Order {
  id                  String             @id @db.Uuid
  /// Human id <orderPrefix>-<base-36 sequence>
  orderId             String             @unique @db.VarChar(40)
  orderNumber         BigInt             @unique
  userId              String             @db.Uuid
  restaurantId        String             @db.Uuid
  vendorId            String?            @db.Uuid
  zoneId              String?            @db.Uuid
  riderId             String?            @db.Uuid
  status              OrderStatus        @default(PENDING)
  isPickedUp          Boolean
  paymentMethod       OrderPaymentMethod
  paymentStatus       OrderPaymentStatus @default(PENDING)
  paymentReference    String?            @db.VarChar(255)
  currencyCode        String             @db.VarChar(3)
  currencySymbol      String             @db.VarChar(8)
  currencyExponent    Int                @db.SmallInt
  itemsMinor          BigInt
  discountMinor       BigInt
  deliveryMinor       BigInt
  taxMinor            BigInt
  tipMinor            BigInt
  totalMinor          BigInt
  paidMinor           BigInt             @default(0)
  taxPercent          Decimal            @db.Decimal(5, 2)
  couponId            String?            @db.Uuid
  couponTitle         String?            @db.VarChar(100)
  couponPercent       Decimal?           @db.Decimal(5, 2)
  distanceMeters      Int?
  instructions        String             @default("") @db.VarChar(500)
  reason              String?            @db.VarChar(200)
  isRinged            Boolean            @default(true)
  isRiderRinged       Boolean            @default(true)
  addressLabel        String             @db.VarChar(64)
  addressText         String             @db.VarChar(500)
  addressDetails      String             @default("") @db.VarChar(500)
  addressLongitude    Float?
  addressLatitude     Float?
  restaurantName      String             @db.VarChar(200)
  restaurantSlug      String?            @db.VarChar(200)
  restaurantImage     String?            @db.VarChar(2048)
  restaurantAddress   String?            @db.VarChar(500)
  restaurantShopType  String?            @db.VarChar(64)
  restaurantLongitude Float
  restaurantLatitude  Float
  customerName        String             @db.VarChar(200)
  customerEmail       String?            @db.VarChar(254)
  customerPhone       String?            @db.VarChar(32)
  riderName           String?            @db.VarChar(200)
  riderUsername       String?            @db.VarChar(100)
  riderPhone          String?            @db.VarChar(32)
  orderDate           DateTime           @db.Timestamptz(3)
  expectedTime        DateTime?          @db.Timestamptz(3)
  /// When the store may see the order: COD → placement; card → payment captured.
  visibleAt           DateTime?          @db.Timestamptz(3)
  /// PENDING orders still PENDING at this time are cancelled by the worker (D6).
  acceptDeadlineAt    DateTime?          @db.Timestamptz(3)
  acceptedAt          DateTime?          @db.Timestamptz(3)
  assignedAt          DateTime?          @db.Timestamptz(3)
  pickedAt            DateTime?          @db.Timestamptz(3)
  deliveredAt         DateTime?          @db.Timestamptz(3)
  cancelledAt         DateTime?          @db.Timestamptz(3)
  paidAt              DateTime?          @db.Timestamptz(3)
  preparationTime     DateTime?          @db.Timestamptz(3)
  selectedPrepTime    Int?               @db.SmallInt
  completionTime      DateTime?          @db.Timestamptz(3)
  version             Int                @default(1)
  createdAt           DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime           @default(now()) @db.Timestamptz(3)
  items               OrderItem[]
  history             OrderStatusHistory[]
  eta                 OrderEta?

  @@index([userId, createdAt(sort: Desc)])
  @@index([restaurantId, createdAt(sort: Desc)])
  @@index([riderId, status])
  @@index([status, acceptDeadlineAt])
  @@index([createdAt(sort: Desc)])
}

model OrderItem {
  id                       String           @id @db.Uuid
  orderId                  String           @db.Uuid
  position                 Int              @db.SmallInt
  foodId                   String           @db.Uuid
  title                    String           @db.VarChar(200)
  description              String?          @db.VarChar(1000)
  image                    String?          @db.VarChar(2048)
  quantity                 Int              @db.SmallInt
  specialInstructions      String           @default("") @db.VarChar(500)
  variationId              String           @db.Uuid
  variationTitle           String           @db.VarChar(200)
  variationPriceMinor      BigInt
  variationDiscountedMinor BigInt           @default(0)
  /// variation price + Σ selected option prices
  unitPriceMinor           BigInt
  lineTotalMinor           BigInt
  createdAt                DateTime         @default(now()) @db.Timestamptz(3)
  order                    Order            @relation(fields: [orderId], references: [id], onDelete: Restrict)
  addons                   OrderItemAddon[]

  @@unique([orderId, position])
  @@index([foodId])
}

model OrderItemAddon {
  id              String            @id @db.Uuid
  orderItemId     String            @db.Uuid
  position        Int               @db.SmallInt
  addonId         String            @db.Uuid
  title           String            @db.VarChar(200)
  description     String?           @db.VarChar(1000)
  quantityMinimum Int               @db.SmallInt
  quantityMaximum Int               @db.SmallInt
  item            OrderItem         @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  options         OrderItemOption[]

  @@unique([orderItemId, position])
}

model OrderItemOption {
  id               String         @id @db.Uuid
  orderItemAddonId String         @db.Uuid
  position         Int            @db.SmallInt
  optionId         String         @db.Uuid
  title            String         @db.VarChar(200)
  description      String?        @db.VarChar(1000)
  priceMinor       BigInt
  addon            OrderItemAddon @relation(fields: [orderItemAddonId], references: [id], onDelete: Restrict)

  @@unique([orderItemAddonId, position])
}

/// Append-only (trigger). One row per applied transition, including placement (fromStatus null).
model OrderStatusHistory {
  id         String       @id @db.Uuid
  orderId    String       @db.Uuid
  fromStatus OrderStatus?
  toStatus   OrderStatus
  actorType  String       @db.VarChar(16)
  actorId    String       @db.VarChar(64)
  reason     String?      @db.VarChar(200)
  riderId    String?      @db.Uuid
  version    Int
  createdAt  DateTime     @default(now()) @db.Timestamptz(3)
  order      Order        @relation(fields: [orderId], references: [id], onDelete: Restrict)

  @@unique([orderId, version])
  @@index([orderId, createdAt])
}

model OrderEta {
  orderId              String    @id @db.Uuid
  phase                String    @db.VarChar(32)
  source               String    @db.VarChar(32)
  readyAt              DateTime? @db.Timestamptz(3)
  baseArrivalAt        DateTime? @db.Timestamptz(3)
  estimatedArrivalAt   DateTime? @db.Timestamptz(3)
  windowStartAt        DateTime? @db.Timestamptz(3)
  windowEndAt          DateTime? @db.Timestamptz(3)
  durationSeconds      Int?
  distanceMeters       Int?
  encodedPolyline      String?
  originLatitude       Float?
  originLongitude      Float?
  destinationLatitude  Float?
  destinationLongitude Float?
  calculatedAt         DateTime  @db.Timestamptz(3)
  lastLocationAt       DateTime? @db.Timestamptz(3)
  version              Int       @default(1)
  order                Order     @relation(fields: [orderId], references: [id], onDelete: Restrict)
}
```

### 4.2 Raw SQL appended to `services/api/prisma/migrations/202610090150_L5_init/migration.sql`

After the `prisma migrate diff` output for the models above, append (review by hand; Prisma cannot express these):

```sql
-- Human order numbers (kernel convention: orderPrefix + base-36 sequence). Not owned by a table,
-- so TRUNCATE ... RESTART IDENTITY in the test harness does not reset it (ids stay unique).
CREATE SEQUENCE "OrderNumberSeq" AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

-- Money is integer minor units and must balance (AGENTS.md: integer minor units, server-owned prices).
ALTER TABLE "Order" ADD CONSTRAINT "Order_money_nonnegative" CHECK (
  "itemsMinor" >= 0 AND "discountMinor" >= 0 AND "deliveryMinor" >= 0 AND "taxMinor" >= 0
  AND "tipMinor" >= 0 AND "totalMinor" >= 0 AND "paidMinor" >= 0 AND "discountMinor" <= "itemsMinor");
ALTER TABLE "Order" ADD CONSTRAINT "Order_total_balanced" CHECK (
  "totalMinor" = "itemsMinor" - "discountMinor" + "deliveryMinor" + "taxMinor" + "tipMinor");
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickup_free" CHECK (
  NOT "isPickedUp" OR ("deliveryMinor" = 0 AND "tipMinor" = 0));
ALTER TABLE "Order" ADD CONSTRAINT "Order_currency_exponent" CHECK ("currencyExponent" BETWEEN 0 AND 3);
ALTER TABLE "Order" ADD CONSTRAINT "Order_version_positive" CHECK (version >= 1);
ALTER TABLE "Order" ADD CONSTRAINT "Order_tax_percent" CHECK ("taxPercent" BETWEEN 0 AND 100);
ALTER TABLE "Order" ADD CONSTRAINT "Order_status_timestamps" CHECK (
  (status <> 'ACCEPTED' OR "acceptedAt" IS NOT NULL)
  AND (status <> 'ASSIGNED' OR ("assignedAt" IS NOT NULL AND "riderId" IS NOT NULL))
  AND (status <> 'PICKED' OR "pickedAt" IS NOT NULL)
  AND (status <> 'DELIVERED' OR "deliveredAt" IS NOT NULL)
  AND (status <> 'CANCELLED' OR "cancelledAt" IS NOT NULL));
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity" CHECK (quantity BETWEEN 1 AND 99);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_money" CHECK (
  "variationPriceMinor" >= 0 AND "variationDiscountedMinor" >= 0
  AND "unitPriceMinor" >= "variationPriceMinor" AND "lineTotalMinor" = "unitPriceMinor" * quantity);
ALTER TABLE "OrderItemOption" ADD CONSTRAINT "OrderItemOption_price" CHECK ("priceMinor" >= 0);

-- History is append-only. TRUNCATE (test reset) does not fire row triggers.
CREATE FUNCTION l5_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OrderStatusHistory is append-only';
END
$$;
CREATE TRIGGER "OrderStatusHistory_append_only" BEFORE UPDATE OR DELETE ON "OrderStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION l5_history_immutable();

-- Read-only projection for other lanes (L4 ordersByUser, L9 analytics, L3 discovery aggregates).
-- Columns are a contract: add columns at the end only; never rename. Money in minor units plus the
-- wire-ready major-unit Float columns L4 returns unchanged.
CREATE VIEW "OrderSummaryView" AS
SELECT
  o.id,
  o."orderId",
  o."userId",
  o."restaurantId",
  o."vendorId",
  o."zoneId",
  o."riderId",
  o.status::text AS "orderStatus",
  o."isPickedUp",
  o."paymentMethod"::text AS "paymentMethod",
  o."paymentStatus"::text AS "paymentStatus",
  o."currencyCode",
  o."currencyExponent",
  o."itemsMinor",
  o."discountMinor",
  o."deliveryMinor",
  o."taxMinor",
  o."tipMinor",
  o."totalMinor",
  o."paidMinor",
  (o."totalMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8 AS "orderAmount",
  (o."paidMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8 AS "paidAmount",
  (o."deliveryMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8 AS "deliveryCharges",
  (o."taxMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8 AS "taxationAmount",
  (o."tipMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8 AS "tipping",
  (o."discountMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8 AS "discountAmount",
  jsonb_build_object('_id', o."restaurantId", 'name', o."restaurantName") AS restaurant,
  jsonb_build_object(
    'deliveryAddress', o."addressText", 'details', o."addressDetails", 'label', o."addressLabel",
    'location', jsonb_build_object('type', 'Point',
      'coordinates', jsonb_build_array(o."addressLongitude", o."addressLatitude"))) AS "deliveryAddress",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      '_id', i.id, 'id', i.id, 'title', i.title, 'description', i.description, 'quantity', i.quantity,
      'image', i.image, 'specialInstructions', i."specialInstructions",
      'variation', jsonb_build_object('_id', i."variationId", 'id', i."variationId", 'title', i."variationTitle",
        'price', (i."variationPriceMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8),
      'addons', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('_id', a."addonId", 'id', a."addonId", 'title', a.title,
          'options', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('_id', p."optionId", 'id', p."optionId", 'title', p.title,
              'price', (p."priceMinor"::numeric / power(10::numeric, o."currencyExponent"))::float8)
              ORDER BY p.position)
            FROM "OrderItemOption" p WHERE p."orderItemAddonId" = a.id), '[]'::jsonb))
          ORDER BY a.position)
        FROM "OrderItemAddon" a WHERE a."orderItemId" = i.id), '[]'::jsonb))
      ORDER BY i.position)
    FROM "OrderItem" i WHERE i."orderId" = o.id), '[]'::jsonb) AS items,
  (SELECT COALESCE(sum(i.quantity), 0)::int FROM "OrderItem" i WHERE i."orderId" = o.id) AS "itemCount",
  o."restaurantName",
  o."customerName",
  o."riderName",
  (o."visibleAt" IS NOT NULL) AS "isVisibleToStore",
  o."orderDate",
  o."createdAt",
  o."acceptedAt",
  o."assignedAt",
  o."pickedAt",
  o."deliveredAt",
  o."cancelledAt",
  o."paidAt",
  o.reason
FROM "Order" o;

-- Per-line projection for popularItems / mostOrdered* (L3) and item analytics (L9).
CREATE VIEW "OrderItemSummaryView" AS
SELECT i."orderId", o."restaurantId", o."userId", o.status::text AS "orderStatus", i."foodId",
       i."variationId", i.quantity, i."lineTotalMinor", o."currencyCode", o."createdAt"
FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId";
```

Consumers must filter `"orderStatus"` themselves (e.g. popularity counts only `DELIVERED`).

### 4.3 Cross-lane foreign keys (`docs/CROSS_LANE_FKS.md`, lead applies in W1-Z.1)

| Column | References | On delete |
|---|---|---|
| `Order.userId` | L1 customer user table (`IdentityUser.id` today; the table behind `UsersPort.customer`) | RESTRICT |
| `Order.restaurantId` | L3 `Restaurant.id` | RESTRICT |
| `Order.vendorId` | L3 `Vendor.id` | SET NULL |
| `Order.zoneId` | L2 `Zone.id` | SET NULL |
| `Order.riderId` | L6 `Rider.id` | RESTRICT |
| `OrderStatusHistory.riderId` | L6 `Rider.id` | RESTRICT |

Deliberately **no** FK: `Order.couponId` (snapshot; coupons may be deleted, title and percent are copied), `OrderItem.foodId`, `variationId`, `OrderItemAddon.addonId`, `OrderItemOption.optionId` (snapshots; catalog rows may be deleted after ordering).

### 4.4 Factory section (W1-L.3; append to `services/api/test/support/factories.ts` under `// L5`)

```ts
// L5 — orders. Inserts a priced, balanced COD order with one line. Parents (customer, restaurant)
// must exist because of the cross-lane foreign keys.
export type L5OrderSeed = {
  id: string;
  userId: string;
  restaurantId: string;
  zoneId: string | null;
  riderId: string | null;
  status: "PENDING" | "ACCEPTED" | "ASSIGNED" | "PICKED" | "DELIVERED" | "CANCELLED";
  isPickedUp: boolean;
  paymentMethod: "COD" | "STRIPE" | "PAYPAL";
  paymentStatus: "PENDING" | "PAID" | "REFUNDED";
  createdAt: Date;
  restaurantName: string;
  customerName: string;
  riderName: string | null;
};
export function l5OrderFactory(pool: Pick<Pool, "query">) {
  return async (overrides: Partial<L5OrderSeed> & Pick<L5OrderSeed, "userId" | "restaurantId">) => {
    const now = overrides.createdAt ?? new Date();
    const seed: L5OrderSeed = {
      id: randomUUID(),
      zoneId: null,
      riderId: null,
      status: "PENDING",
      isPickedUp: false,
      paymentMethod: "COD",
      paymentStatus: "PENDING",
      createdAt: now,
      restaurantName: "Seed Restaurant",
      customerName: "Seed Customer",
      riderName: null,
      ...overrides,
    };
    const { rows } = await pool.query<{ n: string }>(`SELECT nextval('"OrderNumberSeq"')::text AS n`);
    const orderId = `SEED-${BigInt(rows[0].n).toString(36).toUpperCase().padStart(6, "0")}`;
    const at = (status: string) => (seed.status === status ? now : null);
    await pool.query(
      `INSERT INTO "Order" (id, "orderId", "orderNumber", "userId", "restaurantId", "zoneId", "riderId", status,
         "isPickedUp", "paymentMethod", "paymentStatus", "currencyCode", "currencySymbol", "currencyExponent",
         "itemsMinor", "discountMinor", "deliveryMinor", "taxMinor", "tipMinor", "totalMinor", "paidMinor",
         "taxPercent", "addressLabel", "addressText", "addressLongitude", "addressLatitude", "restaurantName",
         "restaurantLongitude", "restaurantLatitude", "customerName", "riderName", "orderDate", "visibleAt",
         "acceptDeadlineAt", "acceptedAt", "assignedAt", "pickedAt", "deliveredAt", "cancelledAt", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'MYR','RM',2,1000,0,$12,80,0,$13,0,8,'Home','1 Seed Street',
         101.7,3.15,$14,101.6869,3.139,$15,$16,$17,$17,NULL,$18,$19,$20,$21,$22,$17,$17)`,
      [
        seed.id, orderId, rows[0].n, seed.userId, seed.restaurantId, seed.zoneId, seed.riderId, seed.status,
        seed.isPickedUp, seed.paymentMethod, seed.paymentStatus, seed.isPickedUp ? 0 : 200,
        seed.isPickedUp ? 1080 : 1280, seed.restaurantName, seed.customerName, seed.riderName, now,
        ["ACCEPTED", "ASSIGNED", "PICKED", "DELIVERED"].includes(seed.status) ? now : null,
        ["ASSIGNED", "PICKED", "DELIVERED"].includes(seed.status) ? now : null,
        ["PICKED", "DELIVERED"].includes(seed.status) ? now : null,
        at("DELIVERED"),
        at("CANCELLED"),
      ],
    );
    await pool.query(
      `INSERT INTO "OrderItem" (id, "orderId", position, "foodId", title, quantity, "variationId", "variationTitle",
         "variationPriceMinor", "unitPriceMinor", "lineTotalMinor", "createdAt")
       VALUES ($1,$2,0,$3,'Seed Food',1,$4,'Regular',1000,1000,1000,$5)`,
      [randomUUID(), seed.id, randomUUID(), randomUUID(), now],
    );
    return { id: seed.id, orderId, version: 1 };
  };
}
// Inside factories(pool): order: l5OrderFactory(pool),
```

(`randomUUID` from `node:crypto`, `Pool` from `pg`; the factories file already imports both or the lead adds them.) A row seeded as `ASSIGNED`/`PICKED`/`DELIVERED` must pass a `riderId`, otherwise `Order_status_timestamps` rejects it.

### 4.5 Wave 2 migration — `services/api/prisma/migrations/202610100150_L5_lifecycle/migration.sql`

Created in Task 6 (central transition function, rule table, snapshot function). Its full SQL is in Task 6.

---

## 5. Requests to the lead (shared files L5 does not own)

These are prerequisites. Each is small and exact; the tasks below assume them. Raise them in the Wave 2 kickoff; until merged, the affected task stays red and is reported as blocked.

**PCR-L5-1 `RestaurantForOrdering` additions** (`kernel/ports.ts`, implemented by L3): add `address: string | null; shopType: string | null;`. Needed for the `Order.restaurant.address/shopType` snapshot every order body selects.

**PCR-L5-2 `PricedLine` additions** (`kernel/ports.ts`, implemented by L3):

```ts
export type PricedLine = {
  foodId: string; foodTitle: string; foodDescription: string | null; foodImage: string | null;
  variationId: string; variationTitle: string; unitPriceMinor: number; variationDiscountedMinor: number;
  // every addon attached to the variation (selected or not), for min/max validation and snapshots
  variationAddons: { addonId: string; title: string; description: string | null; quantityMinimum: number; quantityMaximum: number }[];
  addons: { addonId: string; title: string; options: { optionId: string; title: string; description: string | null; priceMinor: number }[] }[];
  isOutOfStock: boolean;
};
```

Contract for `priceLines`: returns one `PricedLine` per requested line, in order; throws `BAD_USER_INPUT` `"Invalid menu selection"` when a food is not in the restaurant or inactive, the variation is not the food's, an addon is not in `variation.addons`, or an option is not in `addon.options`.

**PCR-L5-3 `UsersPort.customer` addition** (L1): `phoneIsVerified: boolean`. Needed for the checkout phone gate (R9).

**PCR-L5-4 `RidersPort.rider` addition** (L6): `username: string | null`. Store/admin select `rider.username`.

**PCR-L5-5 new `ReviewsPort`** (L3 implements; `reviewOrder` is an L5 root but reviews are L3 data):

```ts
export const REVIEWS_PORT = Symbol("REVIEWS_PORT");
export interface ReviewsPort {                       // L3
  forOrders(orderIds: string[]): Promise<{ orderId: string; id: string; rating: number; description: string | null }[]>;
  // Creates the review and updates restaurant aggregates; throws BAD_USER_INPUT
  // "This order has already been reviewed" when one exists for orderId.
  create(input: { orderId: string; restaurantId: string; userId: string; rating: number; description: string | null; comments: string | null }): Promise<{ id: string; rating: number; description: string | null }>;
}
```

**CFG-L5-1 configuration** (`services/api/src/config.ts`, `.env.example`): add `ORDER_ACCEPT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(3600).default(120)` (D6; `min(1)` so tests can use short windows).

**HR-L5-1 provider overrides in the harness** (`services/api/src/app.ts`, `services/api/test/support/app.ts`): `createApp(config, options?: { overrides?: { provide: unknown; useValue: unknown }[] })` registers each override in the global ports module **in place of** the lane implementation for that token (ports, `SESSION_VALIDATOR`, `PRINCIPAL_LOADER`), and `startApi(stack, env = {}, overrides = [])` forwards them. Wave 2 lanes use this to run integration tests against in-memory fakes of other lanes (master §7).

**APP-L5-1 wiring:** add `OrdersModule.register(config)` to the root module imports in `app.ts`; the ports module must resolve `ORDERS_PORT` from `OrdersModule` (remove the kernel `NOT_IMPLEMENTED` placeholder for that token) and expose `RESTAURANTS_PORT`, `COUPONS_PORT`, `CONFIG_PORT`, `ZONES_PORT`, `USERS_PORT`, `RIDERS_PORT`, `PAYMENTS_PORT`, `REVIEWS_PORT` globally.

**WRK-L5-1 worker wiring** (`services/worker/src/worker.ts`/`main.ts`): call `startL5Jobs({ connection, publisher, databaseUrl: config.DATABASE_URL })` (Task 16) and close it on shutdown; `publisher` is a second `ioredis` client on `REDIS_URL`.

**Open dependency (not blocking L5):** L6 needs `OrdersPort.updateEta(orderId, patch)` to refine ETAs from rider locations; L5 owns `OrderEta` and writes the initial estimate. Listed in §11.

---

## 6. Business rules

Numbers are referenced from tests (`R<n>` in test names). UNVERIFIED = not provable from the client source; the stated default is what we build.

### Placement and pricing

- **R1 Caller.** `placeOrder`, `coupon`, `orders`, `getUsersActiveOrders`, `getUsersPastOrders`, `abortOrder`, `reviewOrder`, `orderStatusChanged` require `AuthContext.type === "CUSTOMER"` exactly. Anonymous → `UNAUTHENTICATED`; any other type (RIDER via the rider app's copies, ADMIN, STAFF, RESTAURANT, VENDOR) → `FORBIDDEN` (ref/03 §2.11).
- **R2 Server-owned prices.** Line unit price = `variation.price` + Σ selected `option.price` from `RestaurantsPort.priceLines` (not `discounted`); line total = unit × quantity; items subtotal = Σ lines. Client `taxationAmount` and `deliveryCharges` are ignored (override, not reject; UNVERIFIED tolerance decision in ref/02 §5.4 — overriding is UI-safe because every order screen shows server values). All arithmetic is integer minor units (`Number.isSafeInteger` asserted).
- **R3 Coupon.** `couponCode` is the coupon **title** (both clients send `coupon.title`). Resolved with `CouponsPort.resolve(title, restaurantId, now)`; `null` → `BAD_USER_INPUT` `"Coupon is not valid"` (never silently dropped). Discount = `percentOf(itemsSubtotal, discountPercent)` (half-up), applies to items only, capped at the subtotal.
- **R4 Delivery fee.** From `ConfigPort.delivery()`: pickup → 0; `fixed` → `rateMinor`; `perKm` → `ceil(distanceKm) × rateMinor`, where `distanceKm` = `haversineKm(restaurant, address)` rounded to 6 decimals before `ceil` (so 2.0000000001 km bills 2 km); a non-positive result falls back to `rateMinor` (app `Checkout.js:304`). `distanceMeters = round(km × 1000)` is stored.
- **R5 Tax.** `taxMinor = percentOf(discountedItems + delivery, restaurant.taxPercent)` (half-up = the app's `round2`); tip excluded; zone tax and `taxes` are not used (ref/02 §5.4).
- **R6 Tip.** Non-finite → `"Invalid tip amount"`; negative → `"Tip must not be negative"`; pickup → stored 0 whatever was sent; otherwise `toMinor(tipping, exponent)`; more than `discountedItems + delivery` → `"Tip is too large"` (UNVERIFIED cap). The web "Other" tip sends `NaN`, which JSON-serialises to `null` and fails `$tipping: Float!` variable coercion before any resolver runs → `BAD_USER_INPUT`, no order (tolerated, never fixed in the UI; ref/02 §14.4).
- **R7 Minimum order.** `discountedItems + delivery >= restaurant.minimumOrderMinor`, else `"Minimum order not met"` (app `Checkout.js:505`).
- **R8 Total.** `orderAmount = discountedItems + delivery + tax + tip`; `discountAmount`, `taxationAmount`, `deliveryCharges`, `tipping` are the stored parts; `paidAmount = 0` until paid. DB check `Order_total_balanced` enforces it.
- **R9 Customer gate.** `UsersPort.customer(userId)`: missing → `NOT_FOUND` `"Customer not found"`; `!isActive` → `"Your account is deactivated"`; empty phone → `"Phone number is missing"`; `!phoneIsVerified && !ConfigPort.verification().skipMobile` → `"Phone number is not verified"` (both checkouts refuse the same; ref/02 §1.7; needs PCR-L5-3).
- **R10 Payment method.** Allow-list `COD | STRIPE | PAYPAL` (exact), else `"Unsupported payment method"`. `STRIPE`/`PAYPAL` while `PaymentsPort.available(method)` is false → `PROVIDER_UNAVAILABLE` `"Card payments are not available"` (D12; master §4.3). When available, the order is created with `paymentStatus PENDING`, `visibleAt = null`, `acceptDeadlineAt = null` and stays invisible to the store until `OrdersPort.markPaid` (R27).
- **R11 Restaurant gate.** `RestaurantsPort.forOrdering(id)`: missing → `NOT_FOUND` `"Restaurant not found"`; `!isActive` → `"Restaurant is not available"`; `!isAvailable` → `"Restaurant is not accepting orders right now"`; not open at `max(now, orderDate)` in `restaurant.timeZone` (`isOpenAt`) → `"Restaurant is closed"`.
- **R12 Delivery address and zone.** Delivery orders: `latitude`/`longitude` strings parsed with `parseCoordinate` (`"Invalid latitude"`/`"Invalid longitude"`; web may send `"undefined"`); `deliveryAddress` required (`"Delivery address is required"`); `ZonesPort.zoneAt(lng, lat)` null → **exactly** `"Delivery zone not found"`; zone ≠ `restaurant.zoneId` (when set) or point outside `restaurant.deliveryBounds` (when set) → **exactly** `"Sorry! we can't deliver to your address."` (the app opens its wrong-address modal only for these two strings, `Checkout.js:454-458`). Pickup orders skip zone checks; their coordinates are kept if valid, else null. `isDemoDefaultLocation`/`demoZoneId` are ignored (no server demo mode; ref/02 §5.2).
- **R13 Menu validation.** Out-of-stock line → `"<food title> is out of stock"`; selected addon not attached to the variation, duplicate addon or duplicate option → `"Invalid menu selection"`; for every variation addon, selected option count outside `[quantityMinimum, quantityMaximum]` → `"Select between <min> and <max> options for <addon title>"`; 0 lines → `"Your cart is empty"`; > 50 lines → `"Too many items in one order"`; quantity not an integer 1..99 → `"Invalid quantity"`; malformed ids → `"Invalid <field> id"` (`parseId`).
- **R14 Order date.** `orderDate` parsed by `parseClientDate` (ISO; the app sends a JS `Date` → ISO): unparsable → `"Invalid order date"`; earlier than now − 5 min → `"Order date is in the past"`; later than now + 7 days → `"Order date is too far in the future"` (UNVERIFIED bounds). `expectedTime = orderDate + restaurant.deliveryTimeMinutes`.
- **R15 Text.** `instructions` (web always sends `""`), `specialInstructions`, address fields: control characters stripped, trimmed, capped (`"<Label> must be at most <n> characters"`): instructions 500, special instructions 500, delivery address 500, address details 500, address label 64.
- **R16 Response quirks tolerated.** `placeOrder` returns the full `Order`; the app reads `placeOrder.user.email` without selecting it (undefined, harmless). Undeclared variables (`offset` from the web `fetchMore`, `ip`, extra address keys) are dropped by graphql-js.
- **R17 Placement writes** (one transaction): `nextval('"OrderNumberSeq"')` → `orderId = <prefix>-<base-36 upper, ≥6 chars>` (prefix = `restaurant.orderPrefix` upper-cased alphanumerics ≤ 10, default `ORD`); `Order` row with all snapshots (restaurant, customer, address, coupon, currency, tax percent), `status PENDING`, `isRinged true`, `version 1`; item/addon/option snapshots; history row `(null → PENDING, CUSTOMER)`; outbox `order.placed` with the `OrderSnapshot`. COD: `visibleAt = now`, `acceptDeadlineAt = max(now, orderDate − 5 min) + ORDER_ACCEPT_TIMEOUT_SECONDS` (scheduled orders count from the time the store may accept them; UNVERIFIED).
- **R18 Placement publishing** (after commit): `orderStatusChanged(userId)` origin `"new"`, `subscriptionOrder(id)`, and — only when visible — `subscribePlaceOrder(restaurant)` origin `"new"` with `isRinged: true`.
- **R19 `coupon` mutation.** C only (R1). Code trimmed, required (`"Coupon code is required"`), ≤ 100; `restaurantId` parsed. Found → `{success: true, message: "Coupon applied", coupon: {_id, title, discount: <percent>, enabled: true}}`; not found → `{success: false, message: "Invalid coupon code", coupon: null}` (the app shows `message` when `coupon` is absent; web requires `success && coupon.enabled`).

### Reading orders

- **R20 Order readers.** `order`, `orderDetails`, `subscriptionOrder`: the owning customer; R/V owning the restaurant (`RestaurantsPort.ownedBy`); a RIDER whose `riderId` is the order's rider; ADMIN; STAFF with `Orders` or `Dispatch`. Missing → `NOT_FOUND` `"Order not found"`; not a reader → `FORBIDDEN`.
- **R21 Customer lists.** Newest first (`createdAt DESC, id DESC`). `orders`: default limit 50, max 300, `skip = (page − 1) × limit + offset` (app polls with no args after Stripe; web sends `{page: 1, limit: 300}`). `getUsersActiveOrders`: statuses `PENDING ACCEPTED ASSIGNED PICKED`; `getUsersPastOrders`: `DELIVERED CANCELLED`; default limit 10, max 50, same skip formula (app pages with `offset: 0`). Negative/non-integer paging → `"Invalid pagination"`.
- **R22 Store list.** `restaurantOrders`: orders of every restaurant the caller owns with `visibleAt IS NOT NULL` and (`status` active, or `DELIVERED` within the last 24 h); `CANCELLED` omitted (the store shows them nowhere); newest first; limit default/max 200, `offset` honoured (UNVERIFIED window).
- **R23 Admin lists.** `allOrders(page)`: 50 per page (UNVERIFIED size). `allOrdersPaginated`/`ordersByRestId`: P2 via `paginate({page, limit: rows, maxLimit: 100})` + `p2` (`rows` capped at 100, the UI cap). Filters: `orderStatus` values outside the six statuses are dropped (a filter with only unknown values matches nothing); `search` (trimmed, ≤ 100, `%`/`_`/`\` escaped) matches `orderId`, customer name, restaurant name or rider name case-insensitively; `restaurantId`/`riderId` (`""` or null = all). `allOrdersWithoutPagination` capped at 1000 rows, `ordersByRestIdWithoutPagination` at 500 (UNVERIFIED caps). Admin lists include orders not yet visible to the store.
- **R24 `dateKeyword`.** The admin sends the **translated label** (`DateFilterCustomTab`, ref/04 §2.1). Every label of `All Today Week Month Year` in all 33 `enatega-multivendor-admin/locales/*.json` maps back to the canonical keyword; `"Custom"` is literal; unknown/empty → `All`. Ranges on `createdAt`, UTC (UNVERIFIED platform timezone): Today = since today 00:00; Week = since 00:00 six days ago; Month = since the 1st; Year = since 1 January; Custom = `starting_date` (00:00 if `YYYY-MM-DD`) to `ending_date` inclusive (`YYYY-MM-DD` → before next 00:00; ISO → that instant inclusive); either side may be absent; unparsable or reversed → `"Invalid date range"`.
- **R25 `orderFilterOptions`.** Distinct restaurants and riders that appear on orders (snapshot names; riders with username/phone), restaurants sorted by name, riders by name.

### State machine (D5) — one central transition function

- **R26 Transition table** (the only allowed moves; `fulfilment` PICKUP = `isPickedUp`):

  | From → To | Actor classes | Fulfilment |
  |---|---|---|
  | PENDING → ACCEPTED | RESTAURANT, ADMIN | any |
  | PENDING → CANCELLED | CUSTOMER, RESTAURANT, ADMIN, SYSTEM | any |
  | ACCEPTED → ASSIGNED | RIDER, ADMIN | DELIVERY |
  | ASSIGNED → ASSIGNED (re-assign) | ADMIN | DELIVERY |
  | ASSIGNED → PICKED | RIDER, ADMIN | DELIVERY |
  | PICKED → DELIVERED | RIDER, ADMIN | DELIVERY |
  | ACCEPTED → DELIVERED | RESTAURANT, ADMIN | PICKUP |
  | ACCEPTED/ASSIGNED/PICKED → CANCELLED | ADMIN | any |

  Actor class: CUSTOMER; RESTAURANT and VENDOR → RESTAURANT; RIDER; ADMIN and STAFF → ADMIN; SYSTEM (worker). The server never emits `COMPLETED`, `ON_ROUTE` or `CANCELLEDBYREST`; store rejection is `CANCELLED` + `reason`; never backwards (the app's status-rank merge drops regressions).
- **R27 Function semantics** (`l5_transition_order`, Task 6): row lock; **idempotent** per (order, target) — current status = target (and, for ASSIGNED, same or no rider given) returns `NOOP` with no writes; else `expectedVersion` mismatch → `L5_VERSION_CONFLICT`; rule missing → `L5_TRANSITION_NOT_ALLOWED`; ASSIGNED without any rider → `L5_RIDER_REQUIRED`; ACCEPTED without 1..180 prep minutes → `L5_PREP_TIME_REQUIRED`. On apply: `version + 1`, `updatedAt`, timestamps (`acceptedAt`+`preparationTime = now + prep`+`selectedPrepTime`; `assignedAt`+rider snapshot+`isRiderRinged false`; `pickedAt`; `deliveredAt`+`completionTime`; `cancelledAt`+`reason`), `isRinged false` on ACCEPTED/CANCELLED, `acceptDeadlineAt null` once not PENDING, COD `DELIVERED` → `paymentStatus PAID`, `paidMinor = totalMinor`, `paidAt` (cash collected; UNVERIFIED for pickup), history row, outbox `order.transitioned {from, to, actor, reason, order: OrderSnapshot}` — all in the caller's transaction. `riderId` is kept on cancellation (L6/L7 need it).
- **R28 TransitionService** maps function errors: NOT_FOUND → `NOT_FOUND` `"Order not found"`; RIDER_REQUIRED → `"Assign a rider before marking the order as assigned"`; PREP_TIME → `"Preparation time must be between 1 and 180 minutes"`; NOT_ALLOWED or VERSION_CONFLICT → re-read; if the move is not allowed from the fresh status → `BAD_USER_INPUT` `"Order status cannot move from <fresh> to <to>"`, else `CONFLICT` `"The order changed, refresh and try again"`. After commit, when applied: publish `subscriptionOrder`, `orderStatusChanged` origin `"update"`, and (when visible) `subscribePlaceOrder` origin `"update"`. ETA: ACCEPTED writes the initial estimate (R36) and sets `completionTime` = estimated arrival; later transitions advance phase/version of an existing ETA.
- **R29 `abortOrder`.** C own; only `PENDING` (`"Order can only be cancelled while it is pending"`); reason `"Cancelled by customer"`. A paid card order's refund is L7's reaction to `order.transitioned` (provider blocker).
- **R30 `acceptOrder`.** R/V own or A; order must be visible (else `NOT_FOUND`); only `PENDING` (`"Only pending orders can be accepted"`); scheduled orders only from `orderDate − 5 min` (`"This scheduled order cannot be accepted yet"`, mirrors `getIsAcceptButtonVisible`); `time` = minutes string `1..180` (`"Preparation time must be between 1 and 180 minutes"`), absent → 10 (the UI default). Returns `preparationTime` ISO = `acceptedAt + time` and the initial `eta`. Clears `isRinged`.
- **R31 `cancelOrder`.** R/V own: only `PENDING` (`"Only pending orders can be declined"`); A: any non-terminal (rules). `reason` required (`"Cancellation reason is required"`, ≤ 200); the store sends `"not available"`. Clears `isRinged`.
- **R32 `orderPickedUp`.** R/V own or A; delivery orders → `"Only pickup orders can be handed over by the store"`; not `ACCEPTED` → `"Only accepted orders can be handed over"`; result `DELIVERED` (COD → PAID).
- **R33 `muteRing`.** R/V own or A; `orderId` required (`"Order id is required"`); matched as the human `orderId` within the caller's restaurants, or as `_id` when UUID-shaped; not found → `NOT_FOUND`; sets `isRinged false` (no version bump), publishes `subscribePlaceOrder` `"update"`; returns `true`.
- **R34 `updateStatus`.** A or S(Dispatch|Orders). `orderStatus` must be one of the six (`"Invalid order status"`). Same status as current → returns the order unchanged, no history (idempotent: the admin calls it with `ASSIGNED` right after `assignRider`, ref/04 §2.1). `ASSIGNED` without a rider → `"Assign a rider before marking the order as assigned"`. `ACCEPTED` uses `restaurant.deliveryTimeMinutes` (1..180, default 20) as prep minutes. `CANCELLED` reason `"Cancelled by admin"`. Anything else not in R26 → `"Order status cannot move from <from> to <to>"`.
- **R35 `reviewOrder`.** C own; only `DELIVERED` (`"Only delivered orders can be reviewed"`); rating integer 1..5 (`"Rating must be between 1 and 5"`); description/comments ≤ 500; one review per order (`"This order has already been reviewed"`); written through `ReviewsPort.create` (L3 updates restaurant aggregates). Returns the order with `review`.
- **R36 Initial ETA** (UNVERIFIED engine; L6 refines later): `readyAt = acceptedAt + prep`; delivery: `estimatedArrivalAt = baseArrivalAt = readyAt + max(1, restaurant.deliveryTimeMinutes)`, window `[arrival − 5 min, arrival + 10 min]`; pickup: arrival = `readyAt`, window `[readyAt, readyAt + 10 min]`; `phase` by status (`PREPARING RIDER_ASSIGNED IN_TRANSIT DELIVERED CANCELLED`), `source "STORE_ESTIMATE"`, `version` monotonic, `origin` = restaurant point, `destination` = delivery point (restaurant for pickup), `encodedPolyline null`. `eta` is `null` until accepted (the store tolerates `eta: null`).

### Visibility, payments, timeouts

- **R37 Store visibility (D12).** A card order is invisible to the store (`restaurantOrders`, `subscribePlaceOrder`, store actions) until `OrdersPort.markPaid(id, ref, paidMinor)`: COD → `"Cash orders are not paid online"`; already paid with the same reference → idempotent; another reference → `CONFLICT` `"Order is already paid"`; status not PENDING → `"Order is no longer awaiting payment"`; `paidMinor ≠ totalMinor` → `"Paid amount does not match the order total"`; on success `paymentStatus PAID`, `paidMinor`, `paidAt`, `visibleAt = now`, accept deadline from now, `version + 1`, publish `subscribePlaceOrder` origin `"new"` and customer `"update"`.
- **R38 Accept timeout (D6).** The worker sweeps every 5 s: `PENDING` orders with `acceptDeadlineAt <= now` (`FOR UPDATE SKIP LOCKED`, ≤ 50 per sweep) are cancelled through `l5_transition_order` with actor `SYSTEM`, reason **`"Not accepted in time"`**, expected version = the locked row's version; failures roll back to a savepoint and are skipped. Exactly once: the row lock, the status predicate and the version check make a concurrent `acceptOrder` and the sweep mutually exclusive — exactly one terminal history row. After commit the worker publishes the three topics (same names and payload as the API).

### Subscriptions

- **R39 Topics and payloads.** Redis topics `orders.order.<id>`, `orders.user.<userId>`, `orders.restaurant.<restaurantId>`; message `{id, origin}`. Each subscription re-reads the order per message and returns the current full shape, so a slow subscriber never sees a stale order. Publishing happens after commit and is best-effort (failures logged as `order_publish_failed`; clients refetch on foreground/reconnect — store `restaurant.tsx:204-255`).
- **R40 `subscriptionOrder(id)`** authorised at subscribe time with R20; yields `Order`.
- **R41 `orderStatusChanged(userId)`** C only and `userId === socket user` (else `FORBIDDEN`); yields `{userId, origin, order}`; never delivers another user's order.
- **R42 `subscribePlaceOrder(restaurant)`** R/V owning the restaurant, A, S(Orders|Stores) (the store comment calls it `ensureRestaurantAccess`); yields `{userId: <customer id>, origin, order}` only for visible orders of that restaurant; `"new"` on placement (COD) or payment (card), `"update"` on every later change including `muteRing`, rider assignment and timeouts.
- **R43 Error wording.** No L5 message contains `unauthorized`, `unauthenticated`, `jwt expired`, `invalid token` or `forbidden` (enforced by `appError` and `pnpm check:errors`).

---
## 7. Tasks

Paths are relative to `implementation/`. Branch: `wave2/L5-orders` from `enatega-ui-backend`. Unit tests: `pnpm --filter @fairbite/api exec vitest run <file>`. Integration tests: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts <file>` (Docker required; master §10).

| # | Task | Rules |
|---|---|---|
| 1 | Pricing engine (pure) | R2–R8 |
| 2 | Menu-selection validation (pure) | R13 |
| 3 | Transition rules mirror, human ids, deadlines (pure) | R17, R26, R38 |
| 4 | ETA estimate (pure) | R36 |
| 5 | Admin filters and translated date keywords (pure) | R23–R24 |
| 6 | Central transition SQL function + parity and view tests | R26–R27, R38, §4.2 views |
| 7 | Inputs (zod) and mappers (pure) | R12–R16, R21, R30, R34–R35 |
| 8 | Integration harness and fakes (lane-local) | — |
| 9 | Repository, publisher, transition service, read model, `OrdersPort`, module wiring | R27–R28, R37, R39 |
| 10 | `placeOrder` and `coupon` | R1–R19 |
| 11 | Customer reads: `orders`, `order`, `orderDetails`, `getUsersActiveOrders`, `getUsersPastOrders` | R20–R21 |
| 12 | Customer actions: `abortOrder`, `reviewOrder` | R29, R35 |
| 13 | Store: `restaurantOrders`, `acceptOrder`, `cancelOrder`, `orderPickedUp`, `muteRing` | R22, R30–R33, R37 |
| 14 | Admin reads: `allOrders`, `allOrdersPaginated`, `allOrdersWithoutPagination`, `ordersByRestId`, `ordersByRestIdWithoutPagination`, `orderFilterOptions` | R23–R25 |
| 15 | Admin `updateStatus` | R34 |
| 16 | Subscriptions: `subscriptionOrder`, `orderStatusChanged`, `subscribePlaceOrder` | R39–R42 |
| 17 | Worker accept-timeout job (exactly once, race-safe) | R38 |
| 18 | Lane gate G2 | — |

---

### Task 1: Pricing engine (pure)

**Files:**
- Create: `services/api/src/modules/pricing/engine.ts`
- Test: `services/api/test/unit/pricing/engine.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/pricing/engine.spec.ts
import { describe, expect, it } from "vitest";
import {
  deliveryFeeMinor,
  priceOrder,
  roundedDistanceKm,
  tipMinor,
  type PricingInput,
} from "../../../src/modules/pricing/engine.js";

const base = (overrides: Partial<PricingInput> = {}): PricingInput => ({
  exponent: 2,
  lines: [
    { quantity: 2, variationPriceMinor: 1000, optionPricesMinor: [150, 50] },
    { quantity: 1, variationPriceMinor: 500, optionPricesMinor: [] },
  ],
  couponPercent: 10,
  delivery: { costType: "perKm", rateMinor: 200 },
  isPickedUp: false,
  distanceKm: 2.3,
  taxPercent: 8,
  tip: 2.5,
  minimumOrderMinor: 1000,
  ...overrides,
});

describe("priceOrder — the worked example (R2–R8)", () => {
  it("prices lines, coupon, per-km delivery, tax and tip in minor units", () => {
    expect(priceOrder(base())).toEqual({
      lines: [
        { unitPriceMinor: 1200, lineTotalMinor: 2400 },
        { unitPriceMinor: 500, lineTotalMinor: 500 },
      ],
      itemsMinor: 2900,
      discountMinor: 290,
      deliveryMinor: 600,
      taxMinor: 257,
      tipMinor: 250,
      totalMinor: 3717,
    });
  });
  it("balances: total = items - discount + delivery + tax + tip", () => {
    const r = priceOrder(base());
    expect(r.totalMinor).toBe(r.itemsMinor - r.discountMinor + r.deliveryMinor + r.taxMinor + r.tipMinor);
  });
});

describe("coupon (R3)", () => {
  it("applies no discount without a coupon", () => {
    expect(priceOrder(base({ couponPercent: null })).discountMinor).toBe(0);
  });
  it("takes a half-up percentage of the items subtotal only", () => {
    const r = priceOrder(
      base({ lines: [{ quantity: 1, variationPriceMinor: 999, optionPricesMinor: [] }], couponPercent: 12.5, minimumOrderMinor: 0 }),
    );
    expect(r.discountMinor).toBe(125);
  });
  it("caps a 100 % coupon at the subtotal and still charges delivery and tax", () => {
    const r = priceOrder(base({ couponPercent: 100, minimumOrderMinor: 0, tip: 0 }));
    expect(r.discountMinor).toBe(2900);
    expect(r.deliveryMinor).toBe(600);
    expect(r.taxMinor).toBe(48);
    expect(r.totalMinor).toBe(648);
  });
  it("rejects an out-of-range coupon percent coming from the coupons port", () => {
    expect(() => priceOrder(base({ couponPercent: 101 }))).toThrow(/Invalid coupon percent/);
  });
});

describe("delivery fee (R4)", () => {
  it("charges the fixed rate regardless of distance", () => {
    expect(deliveryFeeMinor({ costType: "fixed", rateMinor: 300 }, false, null)).toBe(300);
  });
  it("charges ceil(km) × rate for perKm", () => {
    expect(deliveryFeeMinor({ costType: "perKm", rateMinor: 200 }, false, 2.3)).toBe(600);
    expect(deliveryFeeMinor({ costType: "perKm", rateMinor: 200 }, false, 3)).toBe(600);
  });
  it("ignores float noise below six decimals but bills a real excess", () => {
    expect(roundedDistanceKm(2.0000000001)).toBe(2);
    expect(roundedDistanceKm(2.000001)).toBe(3);
  });
  it("falls back to one rate when the distance is zero (app Checkout.js:304)", () => {
    expect(deliveryFeeMinor({ costType: "perKm", rateMinor: 200 }, false, 0)).toBe(200);
  });
  it("is free for pickup", () => {
    expect(deliveryFeeMinor({ costType: "fixed", rateMinor: 300 }, true, null)).toBe(0);
  });
  it("refuses a perKm quote without a distance", () => {
    expect(() => deliveryFeeMinor({ costType: "perKm", rateMinor: 200 }, false, null)).toThrow(/Invalid delivery distance/);
  });
  it("refuses a negative rate", () => {
    expect(() => deliveryFeeMinor({ costType: "fixed", rateMinor: -1 }, false, null)).toThrow(/Invalid delivery rate/);
  });
});

describe("tax (R5)", () => {
  const taxAt = (subtotal: number) =>
    priceOrder(
      base({
        lines: [{ quantity: 1, variationPriceMinor: subtotal, optionPricesMinor: [] }],
        couponPercent: null,
        delivery: { costType: "fixed", rateMinor: 0 },
        taxPercent: 5,
        tip: 9,
        minimumOrderMinor: 0,
      }),
    ).taxMinor;
  it("rounds half-up on (discounted items + delivery), tip excluded", () => {
    expect(taxAt(1005)).toBe(50);
    expect(taxAt(1010)).toBe(51);
  });
  it("supports a zero tax rate and rejects > 100 %", () => {
    expect(priceOrder(base({ taxPercent: 0 })).taxMinor).toBe(0);
    expect(() => priceOrder(base({ taxPercent: 101 }))).toThrow(/Invalid tax percent/);
  });
});

describe("tip (R6)", () => {
  it("converts the client's major amount to minor units", () => {
    expect(tipMinor(3, 2, false, 10_000)).toBe(300);
    expect(tipMinor(0.005, 2, false, 10_000)).toBe(1);
    expect(tipMinor(100, 0, false, 10_000)).toBe(100);
  });
  it("rejects NaN and infinity (web 'Other' sends NaN)", () => {
    expect(() => tipMinor(Number.NaN, 2, false, 10_000)).toThrow("Invalid tip amount");
    expect(() => tipMinor(Number.POSITIVE_INFINITY, 2, false, 10_000)).toThrow("Invalid tip amount");
  });
  it("rejects negative tips even for pickup", () => {
    expect(() => tipMinor(-1, 2, true, 10_000)).toThrow("Tip must not be negative");
  });
  it("stores zero for pickup whatever the client sent", () => {
    expect(tipMinor(5, 2, true, 10_000)).toBe(0);
    expect(priceOrder(base({ isPickedUp: true, tip: 5 })).tipMinor).toBe(0);
  });
  it("caps the tip at discounted items + delivery", () => {
    expect(() => priceOrder(base({ tip: 32.11 }))).toThrow("Tip is too large");
    expect(priceOrder(base({ tip: 32.1 })).tipMinor).toBe(3210);
  });
});

describe("minimum order (R7) and line validation (R13)", () => {
  it("rejects below the minimum and accepts exactly the minimum", () => {
    expect(() => priceOrder(base({ minimumOrderMinor: 3211 }))).toThrow("Minimum order not met");
    expect(priceOrder(base({ minimumOrderMinor: 3210 })).totalMinor).toBe(3717);
  });
  it("counts delivery towards the minimum and ignores it for pickup", () => {
    expect(() => priceOrder(base({ isPickedUp: true, tip: 0, minimumOrderMinor: 2611 }))).toThrow("Minimum order not met");
  });
  it("rejects empty carts and more than 50 lines", () => {
    expect(() => priceOrder(base({ lines: [] }))).toThrow("Your cart is empty");
    const line = { quantity: 1, variationPriceMinor: 100, optionPricesMinor: [] };
    expect(() => priceOrder(base({ lines: Array.from({ length: 51 }, () => line) }))).toThrow("Too many items in one order");
  });
  it.each([0, -1, 1.5, 100])("rejects quantity %s", (quantity) => {
    expect(() => priceOrder(base({ lines: [{ quantity, variationPriceMinor: 100, optionPricesMinor: [] }] }))).toThrow(
      "Invalid quantity",
    );
  });
  it("treats negative catalogue prices as an internal error, not a user error", () => {
    expect(() => priceOrder(base({ lines: [{ quantity: 1, variationPriceMinor: -5, optionPricesMinor: [] }] }))).toThrow(
      /Invalid variation price/,
    );
    expect(() => priceOrder(base({ lines: [{ quantity: 1, variationPriceMinor: 5, optionPricesMinor: [-1] }] }))).toThrow(
      /Invalid option price/,
    );
  });
});

describe("invariants over generated carts", () => {
  it("always returns non-negative safe integers that balance", () => {
    let seed = 42;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let run = 0; run < 500; run++) {
      const lines = Array.from({ length: 1 + next(5) }, () => ({
        quantity: 1 + next(9),
        variationPriceMinor: next(5000),
        optionPricesMinor: Array.from({ length: next(4) }, () => next(400)),
      }));
      const r = priceOrder(
        base({
          lines,
          couponPercent: next(3) === 0 ? null : next(101),
          delivery: { costType: next(2) === 0 ? "fixed" : "perKm", rateMinor: next(500) },
          isPickedUp: next(4) === 0,
          distanceKm: next(20000) / 1000,
          taxPercent: next(2500) / 100,
          tip: 0,
          minimumOrderMinor: 0,
        }),
      );
      for (const value of [r.itemsMinor, r.discountMinor, r.deliveryMinor, r.taxMinor, r.tipMinor, r.totalMinor])
        expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
      expect(r.totalMinor).toBe(r.itemsMinor - r.discountMinor + r.deliveryMinor + r.taxMinor + r.tipMinor);
      expect(r.discountMinor).toBeLessThanOrEqual(r.itemsMinor);
    }
  });
});
```

Arithmetic of the worked example: unit 1000 + 150 + 50 = 1200, × 2 = 2400; + 500 = 2900; 10 % → 290; discounted 2610; ceil(2.3) = 3 km × 200 = 600; 8 % of 3210 = 256.8 → 257; tip 250; total 2610 + 600 + 257 + 250 = 3717. Tip cap = 3210. Pickup minimum case: 2610 < 2611.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/pricing/engine.spec.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/pricing/engine.js'`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/pricing/engine.ts
import { appError } from "../../kernel/errors.js";
import { percentOf, toMinor } from "../../kernel/money.js";

// Pure pricing in integer minor units (master D3). Reproduces the customer clients'
// arithmetic (reference/02 §5.4) authoritatively; client totals are never read.
export const MAX_LINES = 50;
export const MAX_QUANTITY = 99;

export type DeliveryPricing = { costType: "fixed" | "perKm"; rateMinor: number };
export type PricingLine = {
  quantity: number;
  variationPriceMinor: number;
  optionPricesMinor: number[];
};
export type PricingInput = {
  exponent: number;
  lines: PricingLine[];
  couponPercent: number | null;
  delivery: DeliveryPricing;
  isPickedUp: boolean;
  distanceKm: number | null;
  taxPercent: number;
  tip: number;
  minimumOrderMinor: number;
};
export type PricedTotals = {
  lines: { unitPriceMinor: number; lineTotalMinor: number }[];
  itemsMinor: number;
  discountMinor: number;
  deliveryMinor: number;
  taxMinor: number;
  tipMinor: number;
  totalMinor: number;
};

// Catalogue/config values come from other lanes; a bad one is a server defect (masked as
// INTERNAL_SERVER_ERROR by formatError), never a user error.
function assertMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}
function assertPercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Invalid ${label}`);
  return value;
}

// Six decimals remove float noise so 2.0000000001 km bills 2 km, while 2.000001 km bills 3.
export function roundedDistanceKm(distanceKm: number): number {
  return Math.ceil(Math.round(distanceKm * 1e6) / 1e6);
}

export function deliveryFeeMinor(
  delivery: DeliveryPricing,
  isPickedUp: boolean,
  distanceKm: number | null,
): number {
  if (isPickedUp) return 0;
  const rate = assertMinor(delivery.rateMinor, "delivery rate");
  if (delivery.costType === "fixed") return rate;
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0)
    throw new Error("Invalid delivery distance");
  const fee = roundedDistanceKm(distanceKm) * rate;
  // Same fallback as the customer app (Checkout.js:304).
  return fee > 0 ? fee : rate;
}

export function tipMinor(tip: number, exponent: number, isPickedUp: boolean, capMinor: number): number {
  if (typeof tip !== "number" || !Number.isFinite(tip)) throw appError("BAD_USER_INPUT", "Invalid tip amount");
  if (tip < 0) throw appError("BAD_USER_INPUT", "Tip must not be negative");
  if (isPickedUp) return 0;
  const minor = toMinor(tip, exponent);
  // UNVERIFIED policy (R6): a tip may not exceed the discounted items plus delivery.
  if (minor > capMinor) throw appError("BAD_USER_INPUT", "Tip is too large");
  return minor;
}

export function priceOrder(input: PricingInput): PricedTotals {
  if (input.lines.length === 0) throw appError("BAD_USER_INPUT", "Your cart is empty");
  if (input.lines.length > MAX_LINES) throw appError("BAD_USER_INPUT", "Too many items in one order");
  const lines = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY)
      throw appError("BAD_USER_INPUT", "Invalid quantity");
    const unitPriceMinor = line.optionPricesMinor.reduce(
      (sum, price) => sum + assertMinor(price, "option price"),
      assertMinor(line.variationPriceMinor, "variation price"),
    );
    return { unitPriceMinor, lineTotalMinor: assertMinor(unitPriceMinor * line.quantity, "line total") };
  });
  const itemsMinor = assertMinor(
    lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    "items subtotal",
  );
  const discountMinor =
    input.couponPercent === null
      ? 0
      : Math.min(itemsMinor, percentOf(itemsMinor, assertPercent(input.couponPercent, "coupon percent")));
  const discountedMinor = itemsMinor - discountMinor;
  const deliveryMinor = deliveryFeeMinor(input.delivery, input.isPickedUp, input.distanceKm);
  const taxMinor = percentOf(discountedMinor + deliveryMinor, assertPercent(input.taxPercent, "tax percent"));
  const tip = tipMinor(input.tip, input.exponent, input.isPickedUp, discountedMinor + deliveryMinor);
  if (discountedMinor + deliveryMinor < assertMinor(input.minimumOrderMinor, "minimum order"))
    throw appError("BAD_USER_INPUT", "Minimum order not met");
  return {
    lines,
    itemsMinor,
    discountMinor,
    deliveryMinor,
    taxMinor,
    tipMinor: tip,
    totalMinor: assertMinor(discountedMinor + deliveryMinor + taxMinor + tip, "total"),
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/pricing/engine.spec.ts`
Expected: PASS (all tests, including the 4 `it.each` cases and the 500-cart invariant).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/pricing/engine.ts services/api/test/unit/pricing/engine.spec.ts
git commit -m "feat(L5): add pure server-side pricing engine in minor units"
```

---

### Task 2: Menu-selection validation (pure)

**Files:**
- Create: `services/api/src/modules/pricing/selection.ts`
- Test: `services/api/test/unit/pricing/selection.spec.ts`

Depends on PCR-L5-2 (`PricedLine` fields).

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/pricing/selection.spec.ts
import { describe, expect, it } from "vitest";
import type { PricedLine } from "../../../src/kernel/ports.js";
import { optionPricesFor, validateSelection } from "../../../src/modules/pricing/selection.js";

const line = (overrides: Partial<PricedLine> = {}): PricedLine => ({
  foodId: "f1",
  foodTitle: "Margherita",
  foodDescription: null,
  foodImage: null,
  variationId: "v1",
  variationTitle: "Large",
  unitPriceMinor: 1000,
  variationDiscountedMinor: 200,
  variationAddons: [
    { addonId: "a1", title: "Toppings", description: null, quantityMinimum: 0, quantityMaximum: 2 },
    { addonId: "a2", title: "Crust", description: null, quantityMinimum: 1, quantityMaximum: 1 },
  ],
  addons: [
    { addonId: "a1", title: "Toppings", options: [{ optionId: "o1", title: "Olives", description: null, priceMinor: 150 }] },
    { addonId: "a2", title: "Crust", options: [{ optionId: "o4", title: "Thick", description: null, priceMinor: 100 }] },
  ],
  isOutOfStock: false,
  ...overrides,
});
const requested = [
  { addonId: "a1", optionIds: ["o1"] },
  { addonId: "a2", optionIds: ["o4"] },
];

describe("validateSelection (R13)", () => {
  it("accepts a selection within every addon's bounds", () => {
    expect(() => validateSelection(line(), requested)).not.toThrow();
  });
  it("rejects out-of-stock food with its title", () => {
    expect(() => validateSelection(line({ isOutOfStock: true }), requested)).toThrow("Margherita is out of stock");
  });
  it("rejects a missing required addon", () => {
    expect(() => validateSelection(line(), [{ addonId: "a1", optionIds: ["o1"] }])).toThrow(
      "Select between 1 and 1 options for Crust",
    );
  });
  it("rejects too many options", () => {
    expect(() =>
      validateSelection(line(), [
        { addonId: "a1", optionIds: ["o1", "o2", "o3"] },
        { addonId: "a2", optionIds: ["o4"] },
      ]),
    ).toThrow("Select between 0 and 2 options for Toppings");
  });
  it("rejects an addon not attached to the variation and duplicate addons", () => {
    expect(() => validateSelection(line(), [...requested, { addonId: "zz", optionIds: [] }])).toThrow("Invalid menu selection");
    expect(() => validateSelection(line(), [...requested, { addonId: "a1", optionIds: [] }])).toThrow("Invalid menu selection");
  });
});

describe("optionPricesFor", () => {
  it("returns the server price of every selected option in request order", () => {
    expect(optionPricesFor(line(), requested)).toEqual([150, 100]);
  });
  it("fails when the port did not price a requested option", () => {
    expect(() => optionPricesFor(line(), [{ addonId: "a1", optionIds: ["o9"] }])).toThrow("Invalid menu selection");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/pricing/selection.spec.ts`
Expected: FAIL — module `selection.js` not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/pricing/selection.ts
import { appError } from "../../kernel/errors.js";
import type { PricedLine } from "../../kernel/ports.js";

export type RequestedAddon = { addonId: string; optionIds: string[] };

const invalid = () => appError("BAD_USER_INPUT", "Invalid menu selection");

// Server-side mirror of the item-detail rules (reference/02 §4.2). L3's priceLines has
// already proved every id belongs to the restaurant/food/variation/addon (PCR-L5-2 contract).
export function validateSelection(line: PricedLine, requested: RequestedAddon[]): void {
  if (line.isOutOfStock) throw appError("BAD_USER_INPUT", `${line.foodTitle} is out of stock`);
  const seen = new Set<string>();
  for (const addon of requested) {
    if (seen.has(addon.addonId)) throw invalid();
    seen.add(addon.addonId);
    if (!line.variationAddons.some((candidate) => candidate.addonId === addon.addonId)) throw invalid();
  }
  for (const addon of line.variationAddons) {
    const count = requested.find((entry) => entry.addonId === addon.addonId)?.optionIds.length ?? 0;
    if (count < addon.quantityMinimum || count > addon.quantityMaximum)
      throw appError(
        "BAD_USER_INPUT",
        `Select between ${addon.quantityMinimum} and ${addon.quantityMaximum} options for ${addon.title}`,
      );
  }
}

export function optionPricesFor(line: PricedLine, requested: RequestedAddon[]): number[] {
  return requested.flatMap((addon) =>
    addon.optionIds.map((optionId) => {
      const option = line.addons
        .find((priced) => priced.addonId === addon.addonId)
        ?.options.find((candidate) => candidate.optionId === optionId);
      if (!option) throw invalid();
      return option.priceMinor;
    }),
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/pricing/selection.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/pricing/selection.ts services/api/test/unit/pricing/selection.spec.ts
git commit -m "feat(L5): validate addon selections against variation bounds"
```

---

### Task 3: Transition rules mirror, human order ids, accept deadlines (pure)

**Files:**
- Create: `services/api/src/modules/orders/tokens.ts`
- Create: `services/api/src/modules/orders/rules.ts`
- Test: `services/api/test/unit/orders/rules.spec.ts`

`rules.ts` is the TypeScript mirror of the SQL rule set in Task 6. An integration test there proves the two are identical, so the database stays the single enforcement point and TypeScript only uses the mirror for friendly pre-check messages.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/orders/rules.spec.ts
import { describe, expect, it } from "vitest";
import {
  acceptDeadline,
  actorClass,
  humanOrderId,
  isAllowed,
  isNoop,
  ORDER_STATUSES,
  TRANSITION_RULES,
} from "../../../src/modules/orders/rules.js";

describe("actor classes (R26)", () => {
  it("folds user types into transition actor classes", () => {
    expect(actorClass("CUSTOMER")).toBe("CUSTOMER");
    expect(actorClass("RESTAURANT")).toBe("RESTAURANT");
    expect(actorClass("VENDOR")).toBe("RESTAURANT");
    expect(actorClass("RIDER")).toBe("RIDER");
    expect(actorClass("ADMIN")).toBe("ADMIN");
    expect(actorClass("STAFF")).toBe("ADMIN");
    expect(actorClass("SYSTEM")).toBe("SYSTEM");
    expect(() => actorClass("ROBOT")).toThrow(/Unknown actor type/);
  });
});

describe("transition table (R26)", () => {
  it("never emits COMPLETED, ON_ROUTE or CANCELLEDBYREST", () => {
    expect(ORDER_STATUSES).toEqual(["PENDING", "ACCEPTED", "ASSIGNED", "PICKED", "DELIVERED", "CANCELLED"]);
    for (const rule of TRANSITION_RULES) expect(ORDER_STATUSES).toContain(rule.to);
  });
  it.each([
    ["PENDING", "ACCEPTED", "RESTAURANT", false, true],
    ["PENDING", "ACCEPTED", "CUSTOMER", false, false],
    ["PENDING", "CANCELLED", "CUSTOMER", false, true],
    ["PENDING", "CANCELLED", "SYSTEM", false, true],
    ["ACCEPTED", "CANCELLED", "CUSTOMER", false, false],
    ["ACCEPTED", "CANCELLED", "RESTAURANT", false, false],
    ["ACCEPTED", "CANCELLED", "ADMIN", false, true],
    ["ACCEPTED", "ASSIGNED", "RIDER", false, true],
    ["ACCEPTED", "ASSIGNED", "RIDER", true, false],
    ["ACCEPTED", "DELIVERED", "RESTAURANT", true, true],
    ["ACCEPTED", "DELIVERED", "RESTAURANT", false, false],
    ["ASSIGNED", "PICKED", "RIDER", false, true],
    ["PICKED", "DELIVERED", "RIDER", false, true],
    ["ASSIGNED", "ASSIGNED", "ADMIN", false, true],
    ["ASSIGNED", "ASSIGNED", "RIDER", false, false],
    ["DELIVERED", "PENDING", "ADMIN", false, false],
    ["CANCELLED", "ACCEPTED", "ADMIN", false, false],
    ["PICKED", "ASSIGNED", "ADMIN", false, false],
  ] as const)("%s → %s by %s (pickup %s) allowed = %s", (from, to, actor, pickup, allowed) => {
    expect(isAllowed(from, to, actor, pickup)).toBe(allowed);
  });
  it("has no move out of a terminal status", () => {
    expect(TRANSITION_RULES.filter((rule) => rule.from === "DELIVERED" || rule.from === "CANCELLED")).toEqual([]);
  });
});

describe("idempotency (R27)", () => {
  it("treats the current status as a no-op, except a different rider for ASSIGNED", () => {
    expect(isNoop({ status: "ACCEPTED", riderId: null }, "ACCEPTED", null)).toBe(true);
    expect(isNoop({ status: "ASSIGNED", riderId: "r1" }, "ASSIGNED", null)).toBe(true);
    expect(isNoop({ status: "ASSIGNED", riderId: "r1" }, "ASSIGNED", "r1")).toBe(true);
    expect(isNoop({ status: "ASSIGNED", riderId: "r1" }, "ASSIGNED", "r2")).toBe(false);
    expect(isNoop({ status: "PENDING", riderId: null }, "ACCEPTED", null)).toBe(false);
  });
});

describe("human order ids (R17)", () => {
  it("uses the upper-cased restaurant prefix and a base-36 sequence of at least six characters", () => {
    expect(humanOrderId("pst", 1n)).toBe("PST-000001");
    expect(humanOrderId("PST", "46655")).toBe("PST-000ZZZ");
    expect(humanOrderId("pa-st 9!", 2176782336n)).toBe("PAST9-1000000");
    expect(humanOrderId("", 5n)).toBe("ORD-000005");
    expect(humanOrderId("ABCDEFGHIJKLMNOP", 5n)).toBe("ABCDEFGHIJ-000005");
  });
});

describe("accept deadline (R17, R38)", () => {
  const visible = new Date("2026-10-08T12:00:00.000Z");
  it("is visibleAt + timeout for an immediate order", () => {
    expect(acceptDeadline(visible, visible, 120).toISOString()).toBe("2026-10-08T12:02:00.000Z");
  });
  it("starts 5 minutes before a scheduled orderDate", () => {
    expect(acceptDeadline(visible, new Date("2026-10-08T14:00:00.000Z"), 120).toISOString()).toBe(
      "2026-10-08T13:57:00.000Z",
    );
  });
});
```

(`46655` = `ZZZ` in base 36; `2176782336` = 36⁶ = `1000000`.)

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/orders/rules.spec.ts`
Expected: FAIL — module `rules.js` not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/orders/tokens.ts
export const ORDERS_POOL = Symbol("ORDERS_POOL");
export const ORDERS_CLOCK = Symbol("ORDERS_CLOCK");
export const ORDERS_SETTINGS = Symbol("ORDERS_SETTINGS");
export type OrdersSettings = { acceptTimeoutSeconds: number };

export const DEFAULT_PREP_MINUTES = 10;
export const SCHEDULE_LEAD_MS = 5 * 60_000;
// Exact strings the customer app matches to open its wrong-address modal (Checkout.js:454-458).
export const DELIVERY_REFUSED = "Sorry! we can't deliver to your address.";
export const ZONE_NOT_FOUND = "Delivery zone not found";
export const PREP_TIME_MESSAGE = "Preparation time must be between 1 and 180 minutes";
export const ACCEPT_TIMEOUT_REASON = "Not accepted in time";
```

```ts
// services/api/src/modules/orders/rules.ts
import type { OrderStatus } from "../../kernel/ports.js";
import { SCHEDULE_LEAD_MS } from "./tokens.js";

export const ORDER_STATUSES = ["PENDING", "ACCEPTED", "ASSIGNED", "PICKED", "DELIVERED", "CANCELLED"] as const;
export const ACTIVE_STATUSES: readonly OrderStatus[] = ["PENDING", "ACCEPTED", "ASSIGNED", "PICKED"];
export const PAST_STATUSES: readonly OrderStatus[] = ["DELIVERED", "CANCELLED"];

export type ActorClass = "CUSTOMER" | "RESTAURANT" | "RIDER" | "ADMIN" | "SYSTEM";
export type Fulfilment = "ANY" | "PICKUP" | "DELIVERY";
export type TransitionRule = { from: OrderStatus; to: OrderStatus; actor: ActorClass; fulfilment: Fulfilment };

// Mirror of l5_order_transition_rules() (Task 6). Equality is proved by
// test/integration/orders/transition-fn.integration.spec.ts.
export const TRANSITION_RULES: readonly TransitionRule[] = [
  { from: "PENDING", to: "ACCEPTED", actor: "RESTAURANT", fulfilment: "ANY" },
  { from: "PENDING", to: "ACCEPTED", actor: "ADMIN", fulfilment: "ANY" },
  { from: "PENDING", to: "CANCELLED", actor: "CUSTOMER", fulfilment: "ANY" },
  { from: "PENDING", to: "CANCELLED", actor: "RESTAURANT", fulfilment: "ANY" },
  { from: "PENDING", to: "CANCELLED", actor: "ADMIN", fulfilment: "ANY" },
  { from: "PENDING", to: "CANCELLED", actor: "SYSTEM", fulfilment: "ANY" },
  { from: "ACCEPTED", to: "ASSIGNED", actor: "RIDER", fulfilment: "DELIVERY" },
  { from: "ACCEPTED", to: "ASSIGNED", actor: "ADMIN", fulfilment: "DELIVERY" },
  { from: "ASSIGNED", to: "ASSIGNED", actor: "ADMIN", fulfilment: "DELIVERY" },
  { from: "ASSIGNED", to: "PICKED", actor: "RIDER", fulfilment: "DELIVERY" },
  { from: "ASSIGNED", to: "PICKED", actor: "ADMIN", fulfilment: "DELIVERY" },
  { from: "PICKED", to: "DELIVERED", actor: "RIDER", fulfilment: "DELIVERY" },
  { from: "PICKED", to: "DELIVERED", actor: "ADMIN", fulfilment: "DELIVERY" },
  { from: "ACCEPTED", to: "DELIVERED", actor: "RESTAURANT", fulfilment: "PICKUP" },
  { from: "ACCEPTED", to: "DELIVERED", actor: "ADMIN", fulfilment: "PICKUP" },
  { from: "ACCEPTED", to: "CANCELLED", actor: "ADMIN", fulfilment: "ANY" },
  { from: "ASSIGNED", to: "CANCELLED", actor: "ADMIN", fulfilment: "ANY" },
  { from: "PICKED", to: "CANCELLED", actor: "ADMIN", fulfilment: "ANY" },
];

export function actorClass(type: string): ActorClass {
  switch (type) {
    case "CUSTOMER":
      return "CUSTOMER";
    case "RESTAURANT":
    case "VENDOR":
      return "RESTAURANT";
    case "RIDER":
      return "RIDER";
    case "ADMIN":
    case "STAFF":
      return "ADMIN";
    case "SYSTEM":
      return "SYSTEM";
    default:
      throw new Error(`Unknown actor type ${type}`);
  }
}

export function isAllowed(from: OrderStatus, to: OrderStatus, actor: ActorClass, isPickedUp: boolean): boolean {
  const fulfilment: Fulfilment = isPickedUp ? "PICKUP" : "DELIVERY";
  return TRANSITION_RULES.some(
    (rule) =>
      rule.from === from &&
      rule.to === to &&
      rule.actor === actor &&
      (rule.fulfilment === "ANY" || rule.fulfilment === fulfilment),
  );
}

export function isNoop(
  current: { status: OrderStatus; riderId: string | null },
  to: OrderStatus,
  riderId: string | null,
): boolean {
  return current.status === to && (to !== "ASSIGNED" || riderId === null || current.riderId === riderId);
}

export function humanOrderId(prefix: string, sequence: bigint | string | number): string {
  const clean = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "ORD";
  return `${clean}-${BigInt(sequence).toString(36).toUpperCase().padStart(6, "0")}`;
}

// The store may accept from orderDate - 5 min (store getIsAcceptButtonVisible), so the window
// for scheduled orders starts there (UNVERIFIED, R17).
export function acceptDeadline(visibleAt: Date, orderDate: Date, timeoutSeconds: number): Date {
  return new Date(Math.max(visibleAt.getTime(), orderDate.getTime() - SCHEDULE_LEAD_MS) + timeoutSeconds * 1000);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/orders/rules.spec.ts`
Expected: PASS (18 table cases + 7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/orders/rules.ts services/api/src/modules/orders/tokens.ts services/api/test/unit/orders/rules.spec.ts
git commit -m "feat(L5): add order transition rules mirror, human ids and accept deadlines"
```

---

### Task 4: ETA estimate (pure)

**Files:**
- Create: `services/api/src/modules/orders/eta.ts`
- Test: `services/api/test/unit/orders/eta.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/orders/eta.spec.ts
import { describe, expect, it } from "vitest";
import { advanceEta, initialEta } from "../../../src/modules/orders/eta.js";

const now = new Date("2026-10-08T12:00:00.000Z");
const common = {
  orderId: "o1",
  now,
  prepMinutes: 20,
  deliveryTimeMinutes: 30,
  distanceMeters: 1900,
  origin: { latitude: 3.139, longitude: 101.6869 },
  destination: { latitude: 3.15, longitude: 101.7 },
};

describe("initialEta (R36)", () => {
  it("estimates delivery arrival from prep time plus the restaurant delivery time", () => {
    const eta = initialEta({ ...common, isPickedUp: false });
    expect(eta.phase).toBe("PREPARING");
    expect(eta.source).toBe("STORE_ESTIMATE");
    expect(eta.readyAt?.toISOString()).toBe("2026-10-08T12:20:00.000Z");
    expect(eta.estimatedArrivalAt?.toISOString()).toBe("2026-10-08T12:50:00.000Z");
    expect(eta.baseArrivalAt?.toISOString()).toBe("2026-10-08T12:50:00.000Z");
    expect(eta.windowStartAt?.toISOString()).toBe("2026-10-08T12:45:00.000Z");
    expect(eta.windowEndAt?.toISOString()).toBe("2026-10-08T13:00:00.000Z");
    expect(eta.durationSeconds).toBe(3000);
    expect(eta.distanceMeters).toBe(1900);
    expect(eta.destinationLatitude).toBe(3.15);
    expect(eta.encodedPolyline).toBeNull();
    expect(eta.version).toBe(1);
  });
  it("uses ready time as arrival for pickup and the restaurant as destination", () => {
    const eta = initialEta({ ...common, isPickedUp: true, destination: null });
    expect(eta.estimatedArrivalAt?.toISOString()).toBe("2026-10-08T12:20:00.000Z");
    expect(eta.windowStartAt?.toISOString()).toBe("2026-10-08T12:20:00.000Z");
    expect(eta.windowEndAt?.toISOString()).toBe("2026-10-08T12:30:00.000Z");
    expect(eta.distanceMeters).toBe(0);
    expect(eta.destinationLongitude).toBe(101.6869);
  });
});

describe("advanceEta (R28, R36)", () => {
  const later = new Date("2026-10-08T12:30:00.000Z");
  const start = initialEta({ ...common, isPickedUp: false });
  it("moves the phase and version and recomputes the remaining duration", () => {
    const eta = advanceEta(start, "PICKED", later);
    expect(eta.phase).toBe("IN_TRANSIT");
    expect(eta.version).toBe(2);
    expect(eta.calculatedAt).toBe(later);
    expect(eta.durationSeconds).toBe(1200);
  });
  it("collapses the window on delivery and clears the duration on cancellation", () => {
    const delivered = advanceEta(start, "DELIVERED", later);
    expect(delivered.estimatedArrivalAt).toBe(later);
    expect(delivered.windowEndAt).toBe(later);
    expect(delivered.durationSeconds).toBe(0);
    expect(advanceEta(start, "CANCELLED", later).durationSeconds).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/orders/eta.spec.ts`
Expected: FAIL — module `eta.js` not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/orders/eta.ts
import type { OrderStatus } from "../../kernel/ports.js";

// Initial server estimate written at acceptance (R36). L6 refines it from rider locations
// through the requested OrdersPort.updateEta (open question in §11).
export type EtaRecord = {
  orderId: string;
  phase: string;
  source: string;
  readyAt: Date | null;
  baseArrivalAt: Date | null;
  estimatedArrivalAt: Date | null;
  windowStartAt: Date | null;
  windowEndAt: Date | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  encodedPolyline: string | null;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  calculatedAt: Date;
  lastLocationAt: Date | null;
  version: number;
};
type LatLng = { latitude: number; longitude: number };

const MINUTE = 60_000;
export const ETA_SOURCE = "STORE_ESTIMATE";
export const ETA_PHASES: Record<OrderStatus, string> = {
  PENDING: "AWAITING_ACCEPTANCE",
  ACCEPTED: "PREPARING",
  ASSIGNED: "RIDER_ASSIGNED",
  PICKED: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};
const secondsUntil = (target: Date, now: Date) => Math.max(0, Math.round((target.getTime() - now.getTime()) / 1000));

export function initialEta(input: {
  orderId: string;
  now: Date;
  prepMinutes: number;
  isPickedUp: boolean;
  deliveryTimeMinutes: number;
  distanceMeters: number | null;
  origin: LatLng;
  destination: LatLng | null;
}): EtaRecord {
  const readyAt = new Date(input.now.getTime() + input.prepMinutes * MINUTE);
  const travel = input.isPickedUp ? 0 : Math.max(1, Math.round(input.deliveryTimeMinutes)) * MINUTE;
  const arrival = new Date(readyAt.getTime() + travel);
  const destination = input.destination ?? input.origin;
  return {
    orderId: input.orderId,
    phase: ETA_PHASES.ACCEPTED,
    source: ETA_SOURCE,
    readyAt,
    baseArrivalAt: arrival,
    estimatedArrivalAt: arrival,
    windowStartAt: input.isPickedUp ? readyAt : new Date(arrival.getTime() - 5 * MINUTE),
    windowEndAt: new Date(arrival.getTime() + 10 * MINUTE),
    durationSeconds: secondsUntil(arrival, input.now),
    distanceMeters: input.isPickedUp ? 0 : input.distanceMeters,
    encodedPolyline: null,
    originLatitude: input.origin.latitude,
    originLongitude: input.origin.longitude,
    destinationLatitude: destination.latitude,
    destinationLongitude: destination.longitude,
    calculatedAt: input.now,
    lastLocationAt: null,
    version: 1,
  };
}

export function advanceEta(eta: EtaRecord, to: OrderStatus, now: Date): EtaRecord {
  const next: EtaRecord = { ...eta, phase: ETA_PHASES[to], calculatedAt: now, version: eta.version + 1 };
  if (to === "DELIVERED")
    return { ...next, estimatedArrivalAt: now, windowStartAt: now, windowEndAt: now, durationSeconds: 0 };
  if (to === "CANCELLED") return { ...next, durationSeconds: null };
  return { ...next, durationSeconds: next.estimatedArrivalAt ? secondsUntil(next.estimatedArrivalAt, now) : null };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/orders/eta.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/orders/eta.ts services/api/test/unit/orders/eta.spec.ts
git commit -m "feat(L5): add initial order ETA estimate"
```

---

### Task 5: Admin filters and translated date keywords (pure)

**Files:**
- Create: `services/api/src/modules/orders/date-keywords.ts`
- Create: `services/api/src/modules/orders/filters.ts`
- Test: `services/api/test/unit/orders/filters.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/orders/filters.spec.ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canonicalDateKeyword,
  dateRange,
  optionalId,
  searchPattern,
  statusFilter,
} from "../../../src/modules/orders/filters.js";

const locales = fileURLToPath(
  new URL("../../../../../vendor/enatega-ui/enatega-multivendor-admin/locales/", import.meta.url),
);
const now = new Date("2026-10-08T15:30:00.000Z"); // a Thursday

describe("canonicalDateKeyword (R24)", () => {
  it("maps every translated label in every admin locale back to its canonical keyword", () => {
    const files = readdirSync(locales).filter((file) => file.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(33);
    for (const file of files) {
      const strings = JSON.parse(readFileSync(`${locales}${file}`, "utf8")) as Record<string, string>;
      for (const key of ["All", "Today", "Week", "Month", "Year"] as const)
        expect([file, key, canonicalDateKeyword(strings[key])]).toEqual([file, key, key]);
    }
  });
  it("keeps Custom literal and treats unknown or empty values as All", () => {
    expect(canonicalDateKeyword("Custom")).toBe("Custom");
    expect(canonicalDateKeyword("Whenever")).toBe("All");
    expect(canonicalDateKeyword("")).toBe("All");
    expect(canonicalDateKeyword(undefined)).toBe("All");
    expect(canonicalDateKeyword("  الكل ")).toBe("All");
  });
});

describe("dateRange (R24)", () => {
  it("computes calendar ranges in UTC", () => {
    expect(dateRange("All", null, null, now)).toEqual({ from: null, to: null });
    expect(dateRange("Today", null, null, now).from?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(dateRange("Week", null, null, now).from?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(dateRange("Month", null, null, now).from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(dateRange("Year", null, null, now).from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it("makes YYYY-MM-DD custom ends inclusive and ISO ends inclusive to the millisecond", () => {
    const day = dateRange("Custom", "2026-10-01", "2026-10-07", now);
    expect(day.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(day.to?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    const iso = dateRange("Custom", "2026-10-07T18:30:00.000Z", "2026-10-08T18:29:59.999Z", now);
    expect(iso.from?.toISOString()).toBe("2026-10-07T18:30:00.000Z");
    expect(iso.to?.toISOString()).toBe("2026-10-08T18:30:00.000Z");
  });
  it("allows open-ended custom ranges and ignores dates for other keywords", () => {
    expect(dateRange("Custom", "2026-10-01", undefined, now)).toEqual({
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: null,
    });
    expect(dateRange("All", "2026-10-01", "2026-10-02", now)).toEqual({ from: null, to: null });
  });
  it("rejects unparsable and reversed custom ranges", () => {
    expect(() => dateRange("Custom", "nonsense", null, now)).toThrow("Invalid date range");
    expect(() => dateRange("Custom", "2026-10-07", "2026-10-01", now)).toThrow("Invalid date range");
  });
});

describe("statusFilter, searchPattern, optionalId (R23)", () => {
  it("drops unknown statuses and treats an empty list as no filter", () => {
    expect(statusFilter(undefined)).toBeNull();
    expect(statusFilter([])).toBeNull();
    expect(statusFilter(["PENDING", "COMPLETED", "DELIVERED"])).toEqual(["PENDING", "DELIVERED"]);
    expect(statusFilter(["COMPLETED"])).toEqual([]);
    expect(() => statusFilter("PENDING")).toThrow("Invalid status filter");
  });
  it("escapes LIKE wildcards and caps the search", () => {
    expect(searchPattern(undefined)).toBeNull();
    expect(searchPattern("   ")).toBeNull();
    expect(searchPattern(" 50%_off\\ ")).toBe("%50\\%\\_off\\\\%");
    expect(searchPattern("x".repeat(150))).toBe(`%${"x".repeat(100)}%`);
  });
  it("treats empty ids as 'all' and validates others", () => {
    expect(optionalId("", "restaurant")).toBeNull();
    expect(optionalId(null, "restaurant")).toBeNull();
    expect(() => optionalId("abc", "restaurant")).toThrow("Invalid restaurant id");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/orders/filters.spec.ts`
Expected: FAIL — module `filters.js` not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/orders/date-keywords.ts
// Labels of All/Today/Week/Month/Year from vendor/enatega-ui/enatega-multivendor-admin/locales/*.json
// (33 locales). The admin sends the translated label as dateKeyword (reference/04 §2.1).
// test/unit/orders/filters.spec.ts fails if a locale gains a label that is missing here.
export type DateKeyword = "All" | "Today" | "Week" | "Month" | "Year";
const labels: Record<DateKeyword, string[]> = {
  All: ["All", "الكل", "Hamısı", "সব", "Alle", "Todos", "همه", "બધા", "הכל", "सभी", "Semua", "Tutti", "すべて", "Барлығы", "ទាំងអស់", "모두", "Hemû", "सर्व", "Alles", "Wszystko", "ټول", "Toate", "Все", "అన్నీ", "ทั้งหมด", "Tümü", "سب", "Hammasi", "Tất cả", "所有"],
  Today: ["Today", "اليوم", "Bu gün", "আজ", "Heute", "Hoy", "امروز", "આજે", "היום", "आज", "Hari Ini", "Oggi", "今日", "Бүгін", "ថ្ងៃនេះ", "오늘", "Îro", "Vandaag", "Dzisiaj", "نن", "Hoje", "Astăzi", "Сегодня", "ఈరోజు", "วันนี้", "Bugün", "آج", "Bugun", "Hôm nay", "今天"],
  Week: ["Week", "الأسبوع", "Həftə", "সপ্তাহ", "Woche", "Semana", "هفته", "અઠવાડિયું", "שבוע", "सप्ताह", "Minggu", "Settimana", "週", "Апта", "សប្តាហ៍", "주", "Hefte", "आठवडा", "Tydzień", "اونۍ", "Săptămână", "Неделя", "వారం", "สัปดาห์", "Hafta", "ہفتہ", "Tuần", "周"],
  Month: ["Month", "الشهر", "Ay", "মাস", "Monat", "Mes", "ماه", "મહિનો", "חודש", "महीना", "Bulan", "Mese", "月", "Ай", "ខែ", "월", "Meh", "महिना", "Maand", "Miesiąc", "میاشت", "Mês", "Lună", "Месяц", "నెల", "เดือน", "مہینہ", "Oy", "Tháng"],
  Year: ["Year", "السنة", "İl", "বছর", "Jahr", "Año", "سال", "વર્ષ", "שנה", "वर्ष", "Tahun", "Anno", "年", "Жыл", "ឆ្នាំ", "년", "Sal", "Jaar", "Rok", "کال", "Ano", "An", "Год", "సంవత్సరం", "ปี", "Yıl", "Yil", "Năm"],
};
export const DATE_KEYWORD_LABELS: ReadonlyMap<string, DateKeyword> = new Map(
  (Object.entries(labels) as [DateKeyword, string[]][]).flatMap(([keyword, values]) =>
    values.map((value) => [value, keyword] as const),
  ),
);
```

(The lists were extracted on 2026-10-08 with `node -e` over the 33 locale files; no label maps to two keywords — `Ay` is Month in both `az` and `tr`, `سال` is Year in both `fa` and `ur`, `月`/`年` are shared by `jp` and `zh`.)

```ts
// services/api/src/modules/orders/filters.ts
import { appError } from "../../kernel/errors.js";
import { parseId } from "../../kernel/ids.js";
import type { OrderStatus } from "../../kernel/ports.js";
import { parseClientDate } from "../../kernel/time.js";
import { DATE_KEYWORD_LABELS, type DateKeyword } from "./date-keywords.js";
import { ORDER_STATUSES } from "./rules.js";

export type DateRange = { from: Date | null; to: Date | null };
const DAY = 86_400_000;
const dayOnly = /^\d{4}-\d{2}-\d{2}$/;

export function canonicalDateKeyword(value: unknown): DateKeyword | "Custom" {
  if (typeof value !== "string") return "All";
  const text = value.trim();
  if (text === "Custom") return "Custom";
  return DATE_KEYWORD_LABELS.get(text) ?? "All";
}

const invalidRange = () => appError("BAD_USER_INPUT", "Invalid date range");
function bound(value: unknown, end: boolean): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = parseClientDate(value);
  if (!date) throw invalidRange();
  if (!end) return date;
  // Inclusive end: next midnight for a day, one millisecond later for an instant.
  return new Date(date.getTime() + (typeof value === "string" && dayOnly.test(value) ? DAY : 1));
}

export function dateRange(keyword: DateKeyword | "Custom", starting: unknown, ending: unknown, now: Date): DateRange {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  switch (keyword) {
    case "All":
      return { from: null, to: null };
    case "Today":
      return { from: new Date(midnight), to: null };
    case "Week":
      return { from: new Date(midnight - 6 * DAY), to: null };
    case "Month":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: null };
    case "Year":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: null };
    case "Custom": {
      const from = bound(starting, false);
      const to = bound(ending, true);
      if (from && to && from.getTime() >= to.getTime()) throw invalidRange();
      return { from, to };
    }
  }
}

export function statusFilter(values: unknown): OrderStatus[] | null {
  if (values === null || values === undefined) return null;
  if (!Array.isArray(values)) throw appError("BAD_USER_INPUT", "Invalid status filter");
  if (values.length === 0) return null;
  return values.filter((value): value is OrderStatus => (ORDER_STATUSES as readonly unknown[]).includes(value));
}

export function searchPattern(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 100);
  if (!text) return null;
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function optionalId(value: unknown, field: string): string | null {
  return value === null || value === undefined || value === "" ? null : parseId(value, field);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/orders/filters.spec.ts`
Expected: PASS (every locale mapped; 9 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/orders/date-keywords.ts services/api/src/modules/orders/filters.ts services/api/test/unit/orders/filters.spec.ts
git commit -m "feat(L5): map translated admin date keywords and order filters"
```

---
