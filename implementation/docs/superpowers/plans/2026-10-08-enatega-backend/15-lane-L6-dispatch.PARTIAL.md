# Lane L6 — Dispatch, riders, tracking & chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

**Goal:** Implement the 32 L6 root operations (rider administration and self-service, zone-broadcast dispatch with atomic self-assignment, admin dispatch, live tracking with ETA and encoded polylines, rider–customer chat, live-activity sessions) exactly as the unchanged Enatega admin, rider, customer app and customer web documents call them, plus the two L6 worker jobs (rider-claim timeout flagging, stale-location cleanup).

**Architecture:** Three Nest modules — `tracking` (locations, ETA engine, polyline, tracking subscriptions, live-activity sessions), `dispatch` (riders, delivery routing, offers, assignments, the announcer that turns order transitions into rider/zone/dispatcher events) and `chat` — share one L6 database pool and talk to other lanes only through `kernel/ports.ts`. Every order status change goes through `OrdersPort.transition`; L6 keeps its own dispatch state (offers, assignments, ETA rows, announcements) and publishes thin `{ orderId, origin }` events on Redis pub/sub that each subscription resolves per subscriber after an authorisation check.

**Tech stack:** NestJS 12 schema-first resolvers, `pg` (raw SQL, row-level `UPDATE … WHERE` compare-and-set), Prisma 7 multi-file schema for migrations only, zod 4 input parsing, kernel `PubSub` (Redis), Vitest 4 unit and Testcontainers integration tests, legacy `subscriptions-transport-ws` client from `test/support/ws.ts`, Playwright 1.63 specs handed to L10.

---

## 1. Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

L6 makes **no** edits under `vendor/enatega-ui/`. Every test loads the exact app documents.

---

## 2. Operations

Authority: `docs/OPERATION_LANES.json`, filter `lane == "L6"` → **32 operations** (10 queries, 15 mutations, 7 subscriptions). Checked on 2026-10-08 with `node -e "…filter(o=>o.lane==='L6').length"` → `32`. Every row below has at least one tagged integration test in §7.

App keys: `A` = `enatega-multivendor-admin`, `R` = `enatega-multivendor-rider`, `C` = `enatega-multivendor-app`, `W` = `enatega-multivendor-web`. "Doc" = `doc(app, file, exportName)` arguments (every export name verified by reading the file). Roles: `A`=ADMIN, `S(x)`=STAFF with permission `x`, `RID(self)`=rider acting on itself, `CUS(own)`=customer owning the order, `RID(assigned)`=the order's rider, `V/R(own)`=vendor/restaurant owning the order's restaurant.

| #   | Type         | Name                                             | Apps       | Who may call                                                                                                                                                    | Vendored document(s) used in tests                                                                                                                                                                                                                  | Ref                              |
| --- | ------------ | ------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | query        | `riders`                                         | A          | A, S(Riders), S(Dispatch)                                                                                                                                       | `A`, `lib/api/graphql/queries/riders/index.ts`, `GET_RIDERS`; `A`, `lib/api/graphql/queries/concurrent/index.tsx`, `GET_STORE_RIDER`                                                                                                                | 04 §2.10, §2.1 dispatch, §B      |
| 2   | query        | `ridersPaginated`                                | A          | A, S(Riders)                                                                                                                                                    | `A`, `lib/api/graphql/queries/riders/index.ts`, `GET_RIDERS_PAGINATED`                                                                                                                                                                              | 04 §2.10, §4 P1                  |
| 3   | query        | `rider`                                          | A, R, C, W | RID(self) (other id → `FORBIDDEN`, forces rider logout); A, S(Riders), S(Dispatch); CUS whose active order is assigned to that rider (public fields + location) | `R`, `lib/apollo/queries/rider.query.ts`, `RIDER_PROFILE` and `RIDER_BY_ID`; `A`, `lib/api/graphql/queries/riders/index.ts`, `GET_RIDER`; `W`, `lib/api/graphql/queries/rider/index.ts`, `RIDER`; `C`, `src/apollo/queries.js`, `rider`             | 03 §2.3, §0.4; 04 §2.10; 02 §6.1 |
| 4   | query        | `ridersByZone`                                   | A          | A, S(Riders), S(Dispatch)                                                                                                                                       | `A`, `lib/api/graphql/queries/riders/index.ts`, `GET_RIDERS_BY_ZONE`                                                                                                                                                                                | 04 §2.10                         |
| 5   | query        | `availableRiders`                                | A          | A, S(Riders), S(Dispatch)                                                                                                                                       | `A`, `lib/api/graphql/queries/riders/index.ts`, `GET_AVAILABLE_RIDERS`                                                                                                                                                                              | 04 §2.10                         |
| 6   | mutation     | `createRider`                                    | A          | A, S(Riders)                                                                                                                                                    | `A`, `lib/api/graphql/mutations/riders/index.tsx`, `CREATE_RIDER`                                                                                                                                                                                   | 04 §2.10, §2.20 `RiderInput`     |
| 7   | mutation     | `editRider`                                      | A, R       | A, S(Riders) (all fields); RID(self) (only `vehicleType`)                                                                                                       | `A`, `lib/api/graphql/mutations/riders/index.tsx`, `EDIT_RIDER`; `R`, `lib/apollo/mutations/rider.mutation.ts`, `EDIT_RIDER`                                                                                                                        | 03 §2.14; 04 §2.20               |
| 8   | mutation     | `deleteRider`                                    | A          | A, S(Riders)                                                                                                                                                    | `A`, `lib/api/graphql/mutations/riders/index.tsx`, `DELETE_RIDER`                                                                                                                                                                                   | 04 §2.10                         |
| 9   | mutation     | `toggleAvailablity` (misspelling kept)           | A, R       | RID(self); A, S(Riders)                                                                                                                                         | `A`, `lib/api/graphql/mutations/riders/index.tsx`, `TOGGLE_RIDER`; `R`, `lib/apollo/mutations/rider.mutation.ts`, `UPDATE_AVAILABILITY`                                                                                                             | 03 §2.4; 04 §2.10                |
| 10  | mutation     | `updateRiderLocation`                            | R          | RID(self) only (no id argument)                                                                                                                                 | `R`, `lib/apollo/mutations/rider.mutation.ts`, `UPDATE_LOCATION_MULTI_VENDOR` and `UPDATE_LOCATION`; background raw `fetch` document `mutation BackgroundRiderLocation(...)` extracted verbatim from `R/lib/services/background-location.ts:69`     | 03 §2.5                          |
| 11  | mutation     | `updateRiderBussinessDetails` (misspelling kept) | R          | RID(self); A, S(Riders)                                                                                                                                         | `R`, `lib/apollo/mutations/rider.mutation.ts`, `UPDATE_BUSINESS_DETAILS`                                                                                                                                                                            | 03 §2.14                         |
| 12  | mutation     | `updateRiderLicenseDetails`                      | R          | RID(self); A, S(Riders)                                                                                                                                         | `R`, `lib/apollo/mutations/rider.mutation.ts`, `UPDATE_LICENSE`                                                                                                                                                                                     | 03 §2.14                         |
| 13  | mutation     | `updateRiderVehicleDetails`                      | R          | RID(self); A, S(Riders)                                                                                                                                         | `R`, `lib/apollo/mutations/rider.mutation.ts`, `UPDATE_VEHICLE`                                                                                                                                                                                     | 03 §2.14                         |
| 14  | mutation     | `updateWorkSchedule`                             | R          | RID(self); A, S(Riders)                                                                                                                                         | `R`, `lib/apollo/mutations/rider.mutation.ts`, `UPDATE_WORK_SCHEDULE`                                                                                                                                                                               | 03 §2.14                         |
| 15  | query        | `riderOrders`                                    | R          | RID(self)                                                                                                                                                       | `R`, `lib/apollo/queries/rider.query.ts`, `RIDER_ORDERS`                                                                                                                                                                                            | 03 §2.6                          |
| 16  | mutation     | `assignOrder`                                    | R          | RID(self), available, active, same zone as the order                                                                                                            | `R`, `lib/apollo/mutations/order.mutation.ts`, `ASSIGN_ORDER`                                                                                                                                                                                       | 03 §2.8, §C                      |
| 17  | mutation     | `assignRider`                                    | A          | A, S(Dispatch)                                                                                                                                                  | `A`, `lib/api/graphql/mutations/dispatch/index.ts`, `ASSIGN_RIDER`                                                                                                                                                                                  | 04 §2.1 dispatch, §B             |
| 18  | mutation     | `updateOrderStatusRider`                         | R          | RID(assigned)                                                                                                                                                   | `R`, `lib/apollo/mutations/order.mutation.ts`, `UPDATE_ORDER_STATUS_RIDER`                                                                                                                                                                          | 03 §2.10                         |
| 19  | query        | `orderTracking`                                  | A, C, W    | CUS(own), RID(assigned), A, S(Dispatch), S(Orders), V/R(own)                                                                                                    | `A`, `lib/api/graphql/subscription/order-subscription/index.ts`, `ORDER_TRACKING`; `C`, `src/apollo/queries.js`, `orderTracking`; `W`, `lib/api/graphql/queries/order-tracking/index.ts`, `ORDER_LIVE_TRACKING`                                     | 02 §6.1; 04 §2.1                 |
| 20  | query        | `getActiveOrders`                                | A          | A, S(Dispatch)                                                                                                                                                  | `A`, `lib/api/graphql/queries/orders/index.ts`, `GET_ACTIVE_ORDERS`                                                                                                                                                                                 | 04 §2.1 dispatch, §4 P3          |
| 21  | query        | `getLiveMonitorData`                             | A          | A, S(Vendors), VENDOR(id = own vendor id)                                                                                                                       | `A`, `lib/api/graphql/queries/dashboard/index.ts`, `GET_VENDOR_LIVE_MONITOR`                                                                                                                                                                        | 04 §2.1 vendor dashboard, §B     |
| 22  | subscription | `subscriptionZoneOrders`                         | R          | RID(self) whose zone = `zoneId` and `available`                                                                                                                 | `R`, `lib/apollo/subscriptions.ts`, `SUBSCRIPTION_ZONE_ORDERS`                                                                                                                                                                                      | 03 §2.7                          |
| 23  | subscription | `subscriptionAssignRider`                        | R          | RID(self) (`riderId` = caller)                                                                                                                                  | `R`, `lib/apollo/subscriptions.ts`, `SUBSCRIPTION_ASSIGNED_RIDER`                                                                                                                                                                                   | 03 §2.9                          |
| 24  | subscription | `subscriptionDispatcher`                         | A          | A, S(Dispatch)                                                                                                                                                  | `A`, `lib/api/graphql/subscription/order-subscription/index.ts`, `SUBSCRIPTION_DISPATCH_ORDER`                                                                                                                                                      | 04 §2.1 dispatch                 |
| 25  | subscription | `subscriptionOrderTracking`                      | A, C, W    | same as `orderTracking`                                                                                                                                         | `A`, `lib/api/graphql/subscription/order-subscription/index.ts`, `SUBSCRIPTION_ORDER_TRACKING`; `C`, `src/apollo/subscriptions.js`, `subscriptionOrderTracking`; `W`, `lib/api/graphql/subscription/orders/index.ts`, `SUBSCRIPTION_ORDER_TRACKING` | 02 §6.4                          |
| 26  | subscription | `subscriptionRiderLocation`                      | C, W       | RID(self); A, S(Dispatch), S(Riders); CUS whose active order is assigned to that rider                                                                          | `C`, `src/apollo/subscriptions.js`, `subscriptionRiderLocation`; `W`, `lib/api/graphql/subscription/riderLocation/index.ts`, `SUBSCRIPTION_RIDER_LOCATION`                                                                                          | 02 §6.4; 03 §2.5                 |
| 27  | subscription | `riderUpdated`                                   | A          | A, any STAFF                                                                                                                                                    | `A`, `lib/api/graphql/subscription/rider-subscription/index.ts`, `RIDER_UPDATED_SUBSCRIPTION`                                                                                                                                                       | 04 §2.1, §B                      |
| 28  | query        | `chat`                                           | C, R, W    | CUS(own), RID(assigned)                                                                                                                                         | `R`, `lib/apollo/queries/chat.query.ts`, `CHAT`; `C`, `src/apollo/queries.js`, `chat`; `W`, `lib/api/graphql/queries/chatWithRider/index.tsx`, `CHAT_QUERY`                                                                                         | 02 §6.7; 03 §2.12                |
| 29  | mutation     | `sendChatMessage`                                | C, R, W    | CUS(own), RID(assigned), order `ASSIGNED`/`PICKED`                                                                                                              | `R`, `lib/apollo/mutations/chat.mutation.ts`, `SEND_CHAT_MESSAGE`; `C`, `src/apollo/mutations.js`, `sendChatMessage`; `W`, `lib/api/graphql/mutations/chatWithRider/index.ts`, `SEND_CHAT_MESSAGE`                                                  | 02 §6.7; 03 §2.12                |
| 30  | subscription | `subscriptionNewMessage`                         | C, R, W    | CUS(own), RID(assigned)                                                                                                                                         | `R`, `lib/apollo/subscriptions.ts`, `SUBSCRIPTION_NEW_MESSAGE`; `C`, `src/apollo/subscriptions.js`, `subscriptionNewMessage`; `W`, `lib/api/graphql/subscription/ChatWithRider/index.tsx`, `SUBSCRIPTION_NEW_MESSAGE`                               | 02 §6.4, §6.7                    |
| 31  | mutation     | `registerLiveActivitySession`                    | C          | CUS(own), order active                                                                                                                                          | `C`, `src/utils/liveActivityService.js`, module-level `const REGISTER_SESSION` (not exported; extracted verbatim by `extractDocument`, Task 2)                                                                                                      | 02 §8                            |
| 32  | mutation     | `removeLiveActivitySession`                      | C          | CUS(own)                                                                                                                                                        | `C`, `src/utils/liveActivityService.js`, module-level `const REMOVE_SESSION` (extracted verbatim)                                                                                                                                                   | 02 §8                            |

Total: **32**, equal to the JSON count. Single-vendor variants of the same roots (`SINGLE_VENDOR_*` in `R`) are L12's concern; the SDL below declares their extra arguments (`riderOrders(limit, offset)`) as nullable so those documents validate, and L6 ignores them in MULTI mode.

---

## 3. Contract notes (guides W1-L.1 for `contracts/enatega/L6-dispatch.graphql`)

### 3.1 Conventions for every L6 type

- `_id: ID!` on every object with an id; `ChatMessage` and `ChatUser` expose `id: ID!` (the apps select `id`, not `_id`).
- Timestamps: ISO-8601 strings via `isoString()` for every L6 field (`createdAt`, `updatedAt`, `licenseDetails.expiryDate`, chat `createdAt`, all ETA times, `riderLocation.recordedAt`). No L6 field uses epoch-ms (reference/02 §0.5).
- Money: only the rider wallet fields (`currentWalletAmount`, `totalWalletAmount`, `withdrawnWalletAmount`) — `Float` major units from `LedgerPort.balances` minor units via `toMajor(minor, currency.exponent)`. Self and A/S(Riders) only; `null` for everyone else.
- Points: `Location { type: String, coordinates: [Float] }` GeoJSON `[lng, lat]` (core type). Tracking uses `{ latitude: Float!, longitude: Float! }` objects because that is what the documents select.
- Misspellings kept: `toggleAvailablity`, `updateRiderBussinessDetails`, `bussinessDetails`, `BussinessDetailsInput`.
- Field-level restriction (master §4.4): for a customer viewer `Rider` resolves only `_id`, `name`, `phone`, `image`, `vehicleType`, `location`, `createdAt`, `updatedAt`; every other field is `null` (`riderToGraph(row, "PUBLIC", …)`).

### 3.2 SDL (complete; enums are deliberately `String` with server validation, master W1-L.1)

```graphql
# contracts/enatega/L6-dispatch.graphql
# Lane L6 — riders, dispatch, tracking, chat, live activities.

# Rider profile. A rider reads itself (R RIDER_PROFILE), admins read anyone (A GET_RIDER),
# customers read only the rider of their active order (W RIDER / C rider: _id location).
type Rider {
  _id: ID!
  name: String
  username: String
  email: String
  phone: String
  image: String
  available: Boolean
  # true while the rider holds at least one ACTIVE assignment (reference/03 §2.3 UNVERIFIED: Boolean chosen).
  assigned: Boolean
  isActive: Boolean
  # bicycle | motorbike | car | pickup_truck
  vehicleType: String
  # Same digits as bussinessDetails.accountNumber; self and admins only.
  accountNumber: String
  zone: Zone
  location: Location
  bussinessDetails: BussinessDetails
  licenseDetails: LicenseDetails
  vehicleDetails: VehicleDetails
  workSchedule: [DaySchedule!]
  timeZone: String
  currentWalletAmount: Float
  totalWalletAmount: Float
  withdrawnWalletAmount: Float
  # ISO-8601
  createdAt: String
  # ISO-8601
  updatedAt: String
}
type LicenseDetails {
  number: String
  # ISO-8601
  expiryDate: String
  image: String
}
type VehicleDetails {
  number: String
  image: String
}
type DaySchedule {
  # MON..SUN
  day: String!
  enabled: Boolean!
  slots: [TimeSlot!]!
}
type TimeSlot {
  # "HH:MM" (rider format; differs from restaurant [HH, MM] pairs)
  startTime: String!
  endTime: String!
}
type PaginatedRiders {
  data: [Rider!]!
  totalCount: Int!
  currentPage: Int!
  totalPages: Int!
  nextPage: Int
  prevPage: Int
}
input RiderInput {
  # "" on create (reference/04 §2.20)
  _id: String
  name: String
  username: String
  password: String
  phone: String
  # zone _id
  zone: String
  vehicleType: String
  available: Boolean
}
input LicenseDetailsInput {
  number: String
  # ISO-8601 or YYYY-MM-DD
  expiryDate: String
  image: String
}
input VehicleDetailsInput {
  number: String
  image: String
}
input DayScheduleInput {
  day: String!
  enabled: Boolean!
  slots: [TimeSlotInput!]!
}
input TimeSlotInput {
  startTime: String!
  endTime: String!
}
# BussinessDetails / BussinessDetailsInput are L3-owned (shared with updateRestaurantBussinessDetails).
# L6 requires: BussinessDetails { bankName accountName accountCode accountNumber bussinessRegNo companyRegNo taxRate }
# and BussinessDetailsInput accepting { bankName accountName accountCode accountNumber: Float }.

type ZoneOrderEvent {
  zoneId: String!
  # "new" | "update" | "remove"
  origin: String!
  order: Order
}
type RiderOrderEvent {
  order: Order
  # "new" | "update" | "remove"
  origin: String!
}
type ActiveOrdersPage {
  totalCount: Int!
  orders: [Order!]!
}
type LiveMonitorData {
  online_stores: Int!
  cancelled_orders: Int!
  delayed_orders: Int!
  ratings: Float!
}
type OrderTracking {
  # human order id (orderPrefix + sequence)
  orderId: String
  # PENDING | ACCEPTED | ASSIGNED | PICKED | DELIVERED | CANCELLED
  status: String
  riderLocation: TrackingLocation
  eta: OrderEta
}
type TrackingLocation {
  latitude: Float!
  longitude: Float!
  accuracy: Float
  heading: Float
  speed: Float
  # ISO-8601 (device time when plausible, otherwise server receive time)
  recordedAt: String!
}
# OrderEta is computed by L6 (tracking) and returned by L5's Order.eta through TRACKING_PORT.
# Ownership request: move OrderEta and EtaPoint from L5 to L6 in tools/type-map.json (see §3.4 C-6).
type OrderEta {
  # PREPARING | TO_RESTAURANT | TO_CUSTOMER | DELIVERED | CANCELLED (not interpreted by the apps)
  phase: String
  # ESTIMATE (haversine) | MAPS (directions API)
  source: String
  # ISO-8601 for every time field below
  readyAt: String
  baseArrivalAt: String
  estimatedArrivalAt: String
  windowStartAt: String
  windowEndAt: String
  durationSeconds: Int
  distanceMeters: Int
  # Google encoded polyline, precision 1e5
  encodedPolyline: String
  origin: EtaPoint
  destination: EtaPoint
  calculatedAt: String
  lastLocationAt: String
  # strictly increasing per order
  version: Int
}
type EtaPoint {
  latitude: Float!
  longitude: Float!
}
type ChatUser {
  # rider _id when the rider sent it, customer user _id when the customer sent it
  id: ID!
  name: String
}
type ChatMessage {
  id: ID!
  message: String
  image: String
  user: ChatUser!
  # ISO-8601
  createdAt: String!
}
type ChatMessageResult {
  success: Boolean!
  message: String
  data: ChatMessage
}
input ChatUserInput {
  id: String
  name: String
}
input ChatMessageInput {
  message: String
  image: String
  # ignored: the server stamps the authenticated sender (reference/02 §6.7)
  user: ChatUserInput
}
type LiveActivityResult {
  success: Boolean!
  message: String
}

extend type Query {
  # A, S(Riders|Dispatch)
  riders: [Rider!]!
  # A, S(Riders); P1 pagination
  ridersPaginated(
    page: Int
    limit: Int
    search: String
    zone: String
    available: Boolean
    isActive: Boolean
  ): PaginatedRiders!
  # rider self | A, S(Riders|Dispatch) | customer of an active order with this rider. id nullable (C sends String).
  rider(id: String): Rider
  # A, S(Riders|Dispatch)
  ridersByZone(id: String!): [Rider!]!
  # A, S(Riders|Dispatch)
  availableRiders: [Rider!]!
  # rider self. limit/offset only sent by single-vendor documents; ignored in MULTI.
  riderOrders(limit: Int, offset: Int): [Order!]!
  # CUS(own), RID(assigned), A, S(Dispatch|Orders), V/R(own)
  orderTracking(id: ID!): OrderTracking
  # A, S(Dispatch); P3 pagination; restaurantId "" means all
  getActiveOrders(
    restaurantId: ID
    page: Int
    rowsPerPage: Int
    actions: [String]
    search: String
  ): ActiveOrdersPage!
  # A, S(Vendors), VENDOR(own)
  getLiveMonitorData(
    id: String!
    dateKeyword: String
    starting_date: String
    ending_date: String
  ): LiveMonitorData!
  # CUS(own), RID(assigned); newest first
  chat(order: ID!): [ChatMessage!]!
}
extend type Mutation {
  createRider(riderInput: RiderInput!): Rider!
  editRider(riderInput: RiderInput!): Rider!
  deleteRider(id: String!): Rider!
  toggleAvailablity(id: String!): Rider!
  updateRiderLocation(
    latitude: String!
    longitude: String!
    accuracy: Float
    heading: Float
    speed: Float
    deviceTimestamp: String
  ): Rider!
  updateRiderBussinessDetails(
    bussinessDetails: BussinessDetailsInput
    id: String!
  ): Rider!
  updateRiderLicenseDetails(
    id: String!
    licenseDetails: LicenseDetailsInput
  ): Rider!
  updateRiderVehicleDetails(
    id: String!
    vehicleDetails: VehicleDetailsInput
  ): Rider!
  updateWorkSchedule(
    riderId: String!
    workSchedule: [DayScheduleInput!]!
    timeZone: String!
  ): Rider!
  assignOrder(id: String!): Order!
  assignRider(id: String!, riderId: String!): Order!
  # status: PICKED | DELIVERED only
  updateOrderStatusRider(id: String!, status: String!): Order!
  sendChatMessage(message: ChatMessageInput!, orderId: ID!): ChatMessageResult!
  registerLiveActivitySession(
    orderId: ID!
    activityId: String!
    platform: String!
    pushToken: String!
    schemaVersion: Int
    language: String
  ): LiveActivityResult!
  removeLiveActivitySession(
    orderId: ID!
    activityId: String!
  ): LiveActivityResult!
}
extend type Subscription {
  subscriptionZoneOrders(zoneId: String!): ZoneOrderEvent!
  subscriptionAssignRider(riderId: String!): RiderOrderEvent!
  subscriptionDispatcher: Order!
  subscriptionOrderTracking(id: String!): OrderTracking!
  # payload is a Rider with _id and location only
  subscriptionRiderLocation(riderId: String!): Rider!
  riderUpdated: Rider!
  subscriptionNewMessage(order: ID!): ChatMessage!
}
```

### 3.3 Field notes the generator cannot infer

- `Rider.assigned` → `Boolean` (generator default would be `String`).
- `Rider.workSchedule` → `[DaySchedule!]` with `TimeSlot.startTime: String!` — **not** the restaurant `Timings` `[String]` pair.
- `OrderEta.version`, `durationSeconds`, `distanceMeters` → `Int`; `encodedPolyline` → `String`.
- `LiveMonitorData` keeps snake_case field names.
- `getActiveOrders.restaurantId: ID` — the admin sends `""`; the resolver treats `""`/`null` as "all".
- `orderTracking(id: ID!)` vs `subscriptionOrderTracking(id: String!)` — both exactly as documents declare.

### 3.4 Cross-lane contracts L6 depends on (requests to the lead and owning lanes)

These are shared files (`kernel/ports.ts`, `config.ts`, `test/support/**`, worker loop) owned by the lead. L6 code in §7 is written against exactly these signatures; until a request is merged the matching integration tests cannot pass (dependency table in §10).

**C-1 `kernel/ports.ts` additions (lead):**

```ts
// Queryable: a pg client inside the caller's transaction (same database, different module).
export type Queryable = Pick<import("pg").PoolClient, "query">;

// OrderSnapshot gains two fields (L5 fills them):
//   deliveryLocation: Point | null   // delivery address point; null for pickup
//   readyAt: Date | null             // preparationTime (acceptedAt + store prep minutes)
export type OrderSearch = {
  statuses?: OrderStatus[];
  restaurantIds?: string[];
  riderId?: string;
  zoneId?: string;
  unassigned?: boolean;
  isPickedUp?: boolean;
  text?: string; // matches human orderId, customer name/phone, restaurant name
  createdFrom?: Date;
};
export interface OrdersPort {
  // existing: get, transition, markPaid
  getMany(ids: string[]): Promise<OrderSnapshot[]>;
  // newest first
  search(
    filter: OrderSearch,
    window: { skip: number; limit: number },
  ): Promise<{ ids: string[]; total: number }>;
  // The parent objects L5's Order resolvers expect, in the order of `ids`; missing ids omitted.
  graph(ids: string[]): Promise<Record<string, unknown>[]>;
  // delayed = DELIVERED after expectedTime, or not terminal and expectedTime < now
  liveStats(input: {
    restaurantIds: string[];
    from: Date | null;
    to: Date | null;
    now: Date;
  }): Promise<{ cancelled: number; delayed: number }>;
}
export interface RestaurantsPort {
  // existing: forOrdering, priceLines, ownedBy
  byVendor(vendorId: string): Promise<
    {
      id: string;
      isActive: boolean;
      isAvailable: boolean;
      reviewAverage: number;
    }[]
  >;
}
export interface RidersPort {
  // existing: rider, availableInZone — implemented by L6 (Task 13)
  recordLogin(riderId: string, input: { timeZone: string }): Promise<void>; // L1 riderLogin persists timeZone
}
export const ACCOUNTS_PORT = Symbol("ACCOUNTS_PORT");
export interface AccountsPort {
  // L1 — identity owns credentials
  // Creates IdentityUser + credential with role RIDER inside the caller's transaction; returns the new user id.
  // Duplicate username → CONFLICT "Username is already taken"; weak password → BAD_USER_INPUT (L1 message).
  create(
    tx: Queryable,
    input: {
      type: "RIDER";
      username: string;
      password: string;
      name: string;
      phone: string | null;
    },
  ): Promise<{ userId: string }>;
  update(
    tx: Queryable,
    userId: string,
    input: {
      username?: string;
      password?: string;
      name?: string;
      phone?: string | null;
    },
  ): Promise<void>;
  // Disables login and revokes every session family of the user.
  deactivate(tx: Queryable, userId: string): Promise<void>;
}
export const MAPS_PORT = Symbol("MAPS_PORT");
export interface MapsPort {
  // L2 — Google Directions behind the D11 key; returns null when no key is configured
  directions(input: {
    origin: LatLng;
    destination: LatLng;
    waypoints?: LatLng[];
  }): Promise<{
    distanceMeters: number;
    durationSeconds: number;
    encodedPolyline: string;
  } | null>;
}
export type LatLng = { latitude: number; longitude: number };
export type LiveActivityContent = {
  schemaVersion: number;
  status: string;
  estimatedArrivalEpoch: number | null;
  etaUpdatedAtEpoch: number | null;
  riderName: string | null;
  riderPhone: string | null;
  language: string;
};
export const LIVE_ACTIVITY_PORT = Symbol("LIVE_ACTIVITY_PORT");
export interface LiveActivityPort {
  // L8 — APNs liveactivity / FCM; throws PROVIDER_UNAVAILABLE when credentials are absent
  send(
    session: {
      platform: "IOS" | "ANDROID";
      pushToken: string;
      activityId: string;
    },
    content: LiveActivityContent,
    event: "update" | "end",
  ): Promise<void>;
}
export type OrderEtaView = {
  phase: string;
  source: string;
  readyAt: string | null;
  baseArrivalAt: string | null;
  estimatedArrivalAt: string | null;
  windowStartAt: string | null;
  windowEndAt: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  encodedPolyline: string | null;
  origin: LatLng | null;
  destination: LatLng | null;
  calculatedAt: string;
  lastLocationAt: string | null;
  version: number;
};
export const TRACKING_PORT = Symbol("TRACKING_PORT");
export interface TrackingPort {
  // L6 — L5's Order.eta field resolver calls this
  eta(orderIds: string[]): Promise<Map<string, OrderEtaView>>;
}
```

**C-2 L5 transition semantics L6 relies on:** `transition({ to: "ASSIGNED", riderId, expectedVersion })` is a compare-and-set on `version` (mismatch → `CONFLICT`); `ASSIGNED → ASSIGNED` with a different `riderId` is a valid reassignment; `CANCELLED` keeps `riderId`; `updateStatus(id, "ASSIGNED")` on an already-assigned order is an idempotent success (reference/04 §2.1); every transition enqueues `order.transitioned` with the new snapshot.

**C-3 Outbox → pub/sub (lead, `services/worker/src/jobs/outbox.ts`):** after an event's handlers succeed, publish `{ id, type, payload }` (JSON) on topic `domain:<type>` through Redis, the same wire format `RedisPubSub` uses. L6's API-side `DomainEventConsumer` listens on `domain:order.placed` and `domain:order.transitioned`.

**C-4 Config keys (lead, `services/api/src/config.ts` zod schema; worker `config.ts` gets the first one):**

```ts
RIDER_CLAIM_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(3600).default(120),
LOCATION_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(60000).default(5000),
LOCATION_MAX_AGE_SECONDS: z.coerce.number().int().min(10).max(3600).default(600),
LOCATION_MAX_FUTURE_SKEW_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
ETA_DEFAULT_SPEED_KMH: z.coerce.number().min(5).max(120).default(25),
ETA_ROAD_FACTOR: z.coerce.number().min(1).max(3).default(1.3),
ETA_WINDOW_MINUTES: z.coerce.number().int().min(0).max(60).default(5),
ETA_MAPS_REFRESH_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
CHAT_MAX_LENGTH: z.coerce.number().int().min(1).max(5000).default(1000),
DELIVERY_ROUTING_STRATEGY: z.enum(["own_fleet", "third_party_courier"]).default("own_fleet"),
DISPATCH_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(0).max(3600000).default(60000),
LOCATION_HISTORY_DAYS: z.coerce.number().int().min(1).max(90).default(7),
LOCATION_HISTORY_MAX_POINTS: z.coerce.number().int().min(10).max(100000).default(1000),
LOCATION_LATEST_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
// PUBLIC_BASE_URL is L2's (D10); L6 accepts chat/licence/vehicle images only under `${PUBLIC_BASE_URL}/media/`.
```

**C-5 Worker job registry (lead, `services/worker/src/worker.ts`):** register every entry of `l6Jobs` (Task 31/32) as a BullMQ repeatable job with `every: job.everyMs`, calling `job.run({ db, publish, config, now: new Date() })` where `db` is the worker `pg.Pool`, `publish(topic, payload)` does `redis.publish(topic, JSON.stringify(payload))` and `config` is the parsed worker config.

**C-6 Type ownership:** `tools/type-map.json` `ownership`: `OrderEta`, `EtaPoint` → L6 (L6 computes every field; L5's `Order.eta` resolver delegates to `TRACKING_PORT`).

**C-7 Harness:** no change needed. Non-exported documents (`REGISTER_SESSION`, `REMOVE_SESSION`, `BackgroundRiderLocation`) are extracted verbatim from the vendored files by L6's `extractDocument` (Task 2), which fails if the text is not found.

**C-8 `app.ts` wiring (lead, done in W1-L.3):** `imports` contains `L6DatabaseModule.register(config)`, `TrackingModule`, `DispatchModule`, `ChatModule` after `KernelModule.register(config)`.

---

## 4. Data model (guides W1-L.2)

### 4.1 Prisma (`services/api/prisma/schema/L6-dispatch.prisma`)

```prisma
// Lane L6 — dispatch, tracking, chat, live activities.
// Cross-lane references are plain uuid columns; foreign keys are listed in docs/CROSS_LANE_FKS.md.

// Rider profile. Rider.id equals the IdentityUser id of the rider's login (1:1 extension row),
// so AuthContext.userId of a RIDER token is the rider _id the rider app stores (reference/03 §2.1).
model Rider {
  id                String                @id @db.Uuid
  userId            String                @unique @db.Uuid
  name              String                @db.VarChar(100)
  // display copy; the login credential lives in L1 and is changed through AccountsPort in the same transaction
  username          String                @db.VarChar(64)
  email             String?               @db.VarChar(254)
  phone             String?               @db.VarChar(32)
  image             String?               @db.VarChar(1000)
  zoneId            String?               @db.Uuid
  vehicleType       String                @db.VarChar(32)
  available         Boolean               @default(true)
  isActive          Boolean               @default(true)
  timeZone          String                @default("UTC") @db.VarChar(64)
  bankName          String?               @db.VarChar(100)
  accountName       String?               @db.VarChar(100)
  accountCode       String?               @db.VarChar(64)
  accountNumber     String?               @db.VarChar(64)
  licenseNumber     String?               @db.VarChar(64)
  licenseExpiryDate DateTime?             @db.Timestamptz(3)
  licenseImage      String?               @db.VarChar(1000)
  vehicleNumber     String?               @db.VarChar(32)
  vehicleImage      String?               @db.VarChar(1000)
  workSchedule      Json                  @default("[]") @db.JsonB
  createdAt         DateTime              @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime              @default(now()) @db.Timestamptz(3)
  deletedAt         DateTime?             @db.Timestamptz(3)
  version           Int                   @default(1)
  location          RiderLocation?
  samples           RiderLocationSample[]
  assignments       DispatchAssignment[]

  @@index([zoneId, available, isActive])
  @@index([createdAt])
}

// Latest position per rider (one row). receivedAt drives rate limiting; recordedAt is shown to clients.
model RiderLocation {
  riderId          String    @id @db.Uuid
  longitude        Float
  latitude         Float
  accuracy         Float?
  heading          Float?
  speed            Float?
  deviceRecordedAt DateTime? @db.Timestamptz(3)
  recordedAt       DateTime  @db.Timestamptz(3)
  receivedAt       DateTime  @db.Timestamptz(3)
  sequence         Int       @default(1)
  rider            Rider     @relation(fields: [riderId], references: [id], onDelete: Restrict)

  @@index([receivedAt])
}

// Bounded history (Task 32 trims to LOCATION_HISTORY_DAYS and LOCATION_HISTORY_MAX_POINTS per rider).
model RiderLocationSample {
  id         String   @id @db.Uuid
  riderId    String   @db.Uuid
  longitude  Float
  latitude   Float
  accuracy   Float?
  heading    Float?
  speed      Float?
  recordedAt DateTime @db.Timestamptz(3)
  receivedAt DateTime @db.Timestamptz(3)
  rider      Rider    @relation(fields: [riderId], references: [id], onDelete: Restrict)

  @@index([riderId, receivedAt])
  @@index([receivedAt])
}

// One offer per delivery order once it is ACCEPTED (own-fleet zone broadcast strategy).
model DispatchOffer {
  orderId      String    @id @db.Uuid
  zoneId       String?   @db.Uuid
  restaurantId String    @db.Uuid
  // OPEN | CLAIMED | CLOSED
  status       String    @db.VarChar(16)
  // own_fleet | third_party_courier
  strategy     String    @db.VarChar(40)
  offeredAt    DateTime  @db.Timestamptz(3)
  claimedBy    String?   @db.Uuid
  claimedAt    DateTime? @db.Timestamptz(3)
  closedAt     DateTime? @db.Timestamptz(3)
  // CLAIM_TIMEOUT | NO_ZONE | NO_RIDERS | PROVIDER_UNAVAILABLE
  flaggedAt    DateTime? @db.Timestamptz(3)
  flagReason   String?   @db.VarChar(32)
  orderVersion Int

  @@index([zoneId, status])
  @@index([status, offeredAt])
}

// Current rider of an order (one row per order; reassignment updates riderId).
model DispatchAssignment {
  orderId      String   @id @db.Uuid
  riderId      String   @db.Uuid
  customerId   String   @db.Uuid
  // ACTIVE | COMPLETED | CANCELLED
  status       String   @db.VarChar(16)
  // ASSIGNED | PICKED | DELIVERED | CANCELLED
  phase        String   @db.VarChar(16)
  assignedAt   DateTime @db.Timestamptz(3)
  updatedAt    DateTime @db.Timestamptz(3)
  orderVersion Int
  rider        Rider    @relation(fields: [riderId], references: [id], onDelete: Restrict)

  @@index([riderId, status])
  @@index([riderId, updatedAt])
}

model DispatchAssignmentLog {
  id        String   @id @db.Uuid
  orderId   String   @db.Uuid
  riderId   String   @db.Uuid
  // ASSIGN | REASSIGN | COMPLETE | CANCEL
  action    String   @db.VarChar(16)
  actorType String   @db.VarChar(16)
  actorId   String   @db.VarChar(64)
  at        DateTime @default(now()) @db.Timestamptz(3)

  @@index([orderId, at])
}

// Exactly-once side effects per order version, whichever of the mutation path, the domain-event
// consumer or the reconciler gets there first.
model DispatchAnnouncement {
  orderId      String   @db.Uuid
  orderVersion Int
  announcedAt  DateTime @default(now()) @db.Timestamptz(3)

  @@id([orderId, orderVersion])
}

model TrackingEta {
  orderId              String    @id @db.Uuid
  humanOrderId         String    @db.VarChar(40)
  orderStatus          String    @db.VarChar(16)
  orderVersion         Int
  customerId           String    @db.Uuid
  riderId              String?   @db.Uuid
  phase                String    @db.VarChar(16)
  source               String    @db.VarChar(16)
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
  mapsCalculatedAt     DateTime? @db.Timestamptz(3)
  version              Int       @default(1)

  @@index([riderId, orderStatus])
  @@index([customerId, riderId])
}

model ChatMessage {
  id         String   @id @db.Uuid
  orderId    String   @db.Uuid
  // RIDER | CUSTOMER
  senderType String   @db.VarChar(16)
  senderId   String   @db.Uuid
  senderName String   @db.VarChar(100)
  message    String   @default("") @db.VarChar(5000)
  image      String?  @db.VarChar(1000)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  @@index([orderId, createdAt])
}

model LiveActivitySession {
  id            String    @id @db.Uuid
  orderId       String    @db.Uuid
  userId        String    @db.Uuid
  activityId    String    @db.VarChar(200)
  // IOS | ANDROID
  platform      String    @db.VarChar(8)
  // write-only; never returned by any resolver
  pushToken     String    @db.VarChar(4096)
  schemaVersion Int       @default(2)
  language      String    @default("en") @db.VarChar(8)
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime  @default(now()) @db.Timestamptz(3)
  lastPushedAt  DateTime? @db.Timestamptz(3)
  lastError     String?   @db.VarChar(64)

  @@unique([orderId, activityId])
  @@index([orderId])
}
```

### 4.2 Migration `services/api/prisma/migrations/202610090160_L6_init/migration.sql`

Generate the DDL with `pnpm --filter @fairbite/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script > prisma/migrations/202610090160_L6_init/migration.sql`, keep only the L6 tables, then append exactly this block (Prisma does not model check constraints, so they cause no drift):

```sql
-- L6 raw constraints (not expressible in Prisma)
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_id_is_user" CHECK (id = "userId");
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_vehicleType_check" CHECK ("vehicleType" IN ('bicycle', 'motorbike', 'car', 'pickup_truck'));
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_workSchedule_array" CHECK (jsonb_typeof("workSchedule") = 'array');
ALTER TABLE "RiderLocation" ADD CONSTRAINT "RiderLocation_range" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "RiderLocationSample" ADD CONSTRAINT "RiderLocationSample_range" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_status_check" CHECK (status IN ('OPEN', 'CLAIMED', 'CLOSED'));
ALTER TABLE "DispatchOffer" ADD CONSTRAINT "DispatchOffer_flag_check" CHECK ("flagReason" IS NULL OR "flagReason" IN ('CLAIM_TIMEOUT', 'NO_ZONE', 'NO_RIDERS', 'PROVIDER_UNAVAILABLE'));
ALTER TABLE "DispatchAssignment" ADD CONSTRAINT "DispatchAssignment_status_check" CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED'));
ALTER TABLE "DispatchAssignment" ADD CONSTRAINT "DispatchAssignment_phase_check" CHECK (phase IN ('ASSIGNED', 'PICKED', 'DELIVERED', 'CANCELLED'));
ALTER TABLE "TrackingEta" ADD CONSTRAINT "TrackingEta_version_positive" CHECK (version >= 1);
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sender_check" CHECK ("senderType" IN ('RIDER', 'CUSTOMER'));
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_not_empty" CHECK (length(message) > 0 OR image IS NOT NULL);
ALTER TABLE "LiveActivitySession" ADD CONSTRAINT "LiveActivitySession_platform_check" CHECK (platform IN ('IOS', 'ANDROID'));
```

### 4.3 Cross-lane foreign keys (append to `docs/CROSS_LANE_FKS.md`)

| Column                          | References                                                       | On delete |
| ------------------------------- | ---------------------------------------------------------------- | --------- |
| `Rider.userId`                  | `IdentityUser.id` (L1)                                           | RESTRICT  |
| `Rider.zoneId`                  | `Zone.id` (L2)                                                   | RESTRICT  |
| `DispatchOffer.orderId`         | `Order.id` (L5)                                                  | RESTRICT  |
| `DispatchOffer.zoneId`          | `Zone.id` (L2)                                                   | RESTRICT  |
| `DispatchOffer.restaurantId`    | `Restaurant.id` (L3)                                             | RESTRICT  |
| `DispatchAssignment.orderId`    | `Order.id` (L5)                                                  | RESTRICT  |
| `DispatchAssignment.customerId` | `IdentityUser.id` (L1)                                           | RESTRICT  |
| `DispatchAssignmentLog.orderId` | `Order.id` (L5)                                                  | RESTRICT  |
| `DispatchAnnouncement.orderId`  | `Order.id` (L5)                                                  | RESTRICT  |
| `TrackingEta.orderId`           | `Order.id` (L5)                                                  | RESTRICT  |
| `TrackingEta.customerId`        | `IdentityUser.id` (L1)                                           | RESTRICT  |
| `TrackingEta.riderId`           | `Rider.id` (L6, same lane; added in L6 migration as a normal FK) | RESTRICT  |
| `ChatMessage.orderId`           | `Order.id` (L5)                                                  | RESTRICT  |
| `ChatMessage.senderId`          | `IdentityUser.id` (L1)                                           | RESTRICT  |
| `LiveActivitySession.orderId`   | `Order.id` (L5)                                                  | RESTRICT  |
| `LiveActivitySession.userId`    | `IdentityUser.id` (L1)                                           | RESTRICT  |

Table names `IdentityUser`, `Zone`, `Order`, `Restaurant` are the owning lanes' W1 names; if a lane renames a table, only this list changes.

---

## 5. Business rules

Exact strings in quotes are returned verbatim; codes are master §4.3 codes. Rider app shows `graphQLErrors.map(m => m.message).join(", ")` (reference/03 §2.8), the admin toasts `graphQLErrors[0].message`, chat shows `sendChatMessage.message` when `success === false`.

**Riders and identity**

- R1. A rider's id is its identity user id (`Rider.id = Rider.userId`); `createRider` creates the login through `AccountsPort.create` inside the same database transaction as the `Rider` insert; nothing is written if either fails.
- R2. `RiderInput` validation (server re-checks the admin Yup rules, `A/lib/utils/schema/rider.ts`): name 1–35 chars "Name must be at most 35 characters"; username lower-cased, 2–35 chars, `[a-z0-9._@+-]` "Username may contain letters, digits and . \_ @ + - only"; phone 5–32 chars `^\+?[0-9 ()-]+$` "Invalid phone number"; zone required "Zone is required" and must exist and be active "Zone not found"; vehicleType ∈ `bicycle motorbike car pickup_truck` "Invalid vehicle type"; on create `_id` must be empty "A new rider must not have an id" and password present "Password is required"; on edit `_id` required "Rider id is required", password optional (blank keeps the current one, reference/04 §2.20). Password policy is L1's.
- R3. A rider session calling `editRider` may change only `vehicleType`; `_id` must equal the caller (else `FORBIDDEN`); every other field it sends (name, username, phone, zone, available) is ignored (reference/03 §2.14, §C.5).
- R4. `deleteRider` is a soft delete (`deletedAt`, `isActive=false`, `available=false`) plus `AccountsPort.deactivate` (sessions revoked) in one transaction; refused with "Rider has active orders and cannot be deleted" while the rider has an ACTIVE assignment.
- R5. `toggleAvailablity(id)` flips `available` atomically (`SET available = NOT available`); caller is the rider itself or A/S(Riders). Toggling while holding orders is allowed (UNVERIFIED, reference/03 §2.4).
- R6. `rider(id)`: RIDER caller with a different id → `FORBIDDEN` (the rider app then logs out by design, reference/03 §0.4); RIDER with own id but no row → `null` (app logs out); `id` null/"" means "self" for a rider and "Invalid rider id" for others; customers get the PUBLIC view only while one of their orders assigned to that rider is `ASSIGNED`/`PICKED`, otherwise `FORBIDDEN`.
- R7. License: number 1–64 "License number is required"; `expiryDate` ISO or `YYYY-MM-DD`, must be in the future "License expiry date must be in the future"; image must start with `${PUBLIC_BASE_URL}/media/` "Image must be uploaded through the app"; with no `PUBLIC_BASE_URL` → `PROVIDER_UNAVAILABLE` "Image uploads are not available". `licenseDetails: null` → "License details are required". Vehicle: number 1–32 "Vehicle number is required", same image rule, null → "Vehicle details are required".
- R8. Bank details (rider): bankName, accountName 1–100; accountCode 1–64; `accountNumber` arrives as a JSON number (`Number(...)`, reference/03 §2.14) or digit string; stored as a digit string 4–34 long "Account number must contain digits only"; null → "Bank details are required".
- R9. Work schedule: 1–7 entries, `day` ∈ MON..SUN "Invalid day", no repeats "Duplicate day", slots `HH:MM` 00:00–23:59 "Invalid time", start < end "Slot must end after it starts", slots of a day must not overlap "Slots must not overlap", `timeZone` must be a valid IANA zone "Invalid time zone". Stored sorted by day order MON..SUN and slot start. Dispatch does not enforce the schedule (UNVERIFIED, reference/03 §2.14).
- R10. Every rider profile change (create, edit, delete, toggle, details) publishes `riderUpdated` `{ _id }` to A and every STAFF.

**Dispatch (D5, D6, reference/03 §B–§C)**

- R11. Routing is provider-independent: `DeliveryRouter` with strategy `own_fleet` (zone broadcast, implemented) and `third_party_courier` (documented interface; `dispatch` throws `PROVIDER_UNAVAILABLE` "Courier delivery is not available"; the order is flagged `PROVIDER_UNAVAILABLE` to the dispatcher). Strategy from `DELIVERY_ROUTING_STRATEGY`.
- R12. When an order becomes `ACCEPTED` and `isPickedUp=false`: create one `DispatchOffer` (OPEN, `offeredAt = acceptedAt`), publish `subscriptionZoneOrders(zoneId)` `{ origin: "new" }` and push "New order" to available riders of that zone. No zone → offer flagged `NO_ZONE`; no available riders → flagged `NO_RIDERS`. Takeaway orders never get an offer and never reach riders.
- R13. Zone events carry only `"new"` and `"remove"`; L6 never sends `"update"` with another rider set (reference/03 §2.7). A `"new"` event is delivered to a subscriber only if the order is still `ACCEPTED` with no rider and the subscriber is still available in that zone.
- R14. `riderOrders` returns (a) the caller's own orders with an ACTIVE assignment or an assignment updated in the last 7 days (ASSIGNED, PICKED, DELIVERED, CANCELLED-after-assignment) and (b) when available, OPEN offers in the caller's zone whose order is still `ACCEPTED`, unassigned, not takeaway. It never returns an order whose `riderId` is another rider. Newest first.
- R15. `assignOrder` (first claim wins): caller is an active rider; order `ACCEPTED`, `riderId = null`, `isPickedUp = false` else "Order is not available for assignment"; already taken → `CONFLICT` "Order already assigned"; caller unavailable → "You must be available to accept orders"; zone mismatch → "This order is outside your zone". The claim is `UPDATE "DispatchOffer" SET status='CLAIMED' … WHERE status='OPEN'` inside a transaction held while `OrdersPort.transition(ASSIGNED, expectedVersion)` runs; a concurrent claim blocks on the row and then finds it CLAIMED. An L5 `CONFLICT` is reported as "Order already assigned". Re-claiming one's own order is an idempotent success.
- R16. `assignRider` (admin): S(Dispatch); rider must exist and be active "Rider not found"; takeaway → "Pickup orders do not need a rider"; PENDING → "Order must be accepted by the store before a rider is assigned"; PICKED → "Order has already been picked up"; DELIVERED → "Order has already been delivered"; CANCELLED → "Order has been cancelled"; same rider already assigned → idempotent success; otherwise `transition(ASSIGNED, riderId)` (reassignment allowed from ASSIGNED). Cross-zone admin assignment and assigning an unavailable rider are allowed (UNVERIFIED, admin override).
- R17. `updateOrderStatusRider`: status must be `PICKED` or `DELIVERED` "Riders can only set PICKED or DELIVERED"; caller must be the order's rider else `FORBIDDEN`; PICKED requires ASSIGNED "Order must be ASSIGNED before it can be PICKED"; DELIVERED requires PICKED "Order must be PICKED before it can be DELIVERED"; repeating the current status is an idempotent success. Cash collection and earnings are L5/L7 effects of the DELIVERED transition.
- R18. Every status change goes through `OrdersPort.transition`; L6 never writes order status.
- R19. Announcement (exactly once per order version, `DispatchAnnouncement`): on ASSIGNED → assignment ACTIVE/ASSIGNED, offer CLAIMED, zone `"remove"`, previous rider `subscriptionAssignRider` `"remove"` on reassignment, new rider `"new"`, push "New delivery assigned" when the actor is not that rider; on PICKED → phase PICKED, rider `"update"`; on DELIVERED → assignment COMPLETED, rider `"update"`, live-activity sessions ended; on CANCELLED → offer CLOSED + zone `"remove"` if it was OPEN, assignment CANCELLED + rider `"update"`, sessions ended; on every status → ETA refresh (except PENDING), `subscriptionOrderTracking` publish, `subscriptionDispatcher` publish, live-activity update. A failure releases the announcement row so the consumer or the reconciler retries.
- R20. Rider claim timeout (D6): the worker flags OPEN offers older than `RIDER_CLAIM_TIMEOUT_SECONDS` (120) with `CLAIM_TIMEOUT` once and publishes `subscriptionDispatcher`; it never cancels or reassigns.
- R21. `getActiveOrders`: S(Dispatch); `actions` ⊆ PENDING ACCEPTED ASSIGNED PICKED DELIVERED CANCELLED "Invalid order status"; empty/absent → PENDING ACCEPTED ASSIGNED PICKED; `restaurantId` "" → all; `rowsPerPage` capped at 100; newest first.
- R22. `getLiveMonitorData(id = vendorId)`: A, S(Vendors), or VENDOR with `vendorId = id` else `FORBIDDEN`; `online_stores` = vendor restaurants `isActive && isAvailable`; `cancelled_orders`/`delayed_orders` from `OrdersPort.liveStats` over the range; `ratings` = mean `reviewAverage` of rated restaurants, 1 dp, 0 when none (UNVERIFIED definitions). `dateKeyword` `All` (default, also every unknown/translated label) | `Today` | `Week` | `Month` | `Year` (UTC calendar) | `Custom` (`starting_date`..`ending_date` inclusive, `YYYY-MM-DD` or ISO; invalid → "Invalid date range").

**Tracking**

- R23. `updateRiderLocation`: rider only; `latitude`/`longitude` numeric strings in range ("Invalid latitude", "Invalid longitude"); `accuracy` 0–10000 "Invalid accuracy"; `heading` −1–360 (negative → null) "Invalid heading"; `speed` −1–100 m/s (negative → null) "Invalid speed"; `deviceTimestamp` ISO "Invalid deviceTimestamp", not more than `LOCATION_MAX_FUTURE_SKEW_SECONDS` ahead "Location timestamp is in the future", not older than `LOCATION_MAX_AGE_SECONDS` "Location timestamp is too old".
- R24. Rate limit and monotonicity in one statement: an update is stored only if the previous one was received at least `LOCATION_MIN_INTERVAL_MS` (5000) earlier (else `RATE_LIMITED` "Location updates are too frequent") and its `recordedAt` is newer than the stored one (else "Location is older than the last update"). Each stored update also appends a `RiderLocationSample`.
- R25. After a stored update, each of the rider's orders whose ETA row is `ASSIGNED`/`PICKED` is recomputed, its `TrackingEta.version` increments (strictly monotonic), `subscriptionOrderTracking(order)` is published, and `subscriptionRiderLocation(rider)` is published with the audience = customers of those orders. Locations are never published for DELIVERED/CANCELLED orders.
- R26. ETA engine: phases PREPARING (ACCEPTED) / TO_RESTAURANT (ASSIGNED) / TO_CUSTOMER (PICKED) / DELIVERED / CANCELLED. Legs: with `MAPS_PORT` returning a route → `source "MAPS"` (refreshed at most every `ETA_MAPS_REFRESH_SECONDS` per order); otherwise or on any Maps error → haversine × `ETA_ROAD_FACTOR` at `ETA_DEFAULT_SPEED_KMH`, `source "ESTIMATE"`. PREPARING arrival = max(readyAt, now) + restaurant→customer; TO_RESTAURANT arrival = max(now + rider→restaurant, readyAt) + restaurant→customer; TO_CUSTOMER arrival = now + rider→customer; DELIVERED arrival = now, duration and distance 0, polyline null. Window = arrival ± `ETA_WINDOW_MINUTES`. `baseArrivalAt` = first arrival ever computed for the order. `origin` = restaurant, `destination` = delivery point. `encodedPolyline` = Google 1e5 encoding of the route points (rider → restaurant → customer as applicable).
- R27. `orderTracking`/`subscriptionOrderTracking` access: CUS(own), RID(assigned), A, S(Dispatch|Orders), RESTAURANT/VENDOR whose `restaurantIds` contain the order's restaurant; else `FORBIDDEN`; unknown order "Order not found" (`NOT_FOUND`). `riderLocation` is the latest rider position while the order is ASSIGNED/PICKED, else `null`; `eta` is `null` before the first ETA is computed.
- R28. `subscriptionRiderLocation(riderId)`: RID(self), A, S(Dispatch|Riders), or a customer with an ASSIGNED/PICKED order of that rider at subscribe time; each event is delivered to a customer only if the customer is in that event's audience.

**Chat**

- R29. Parties are the order's customer and its assigned rider; anyone else → `FORBIDDEN`. `chat` returns newest first (max 200). `sendChatMessage` ignores `message.user` and stamps the sender: rider → `{ id: rider._id, name: rider.name }`, customer → `{ id: user._id, name: UsersPort name or "Customer" }`.
- R30. Sending requires status ASSIGNED or PICKED: before a rider → `{ success: false, message: "Chat is available once a rider is assigned" }`; DELIVERED/CANCELLED → `{ success: false, message: "Chat is closed for this order" }`; text trimmed, empty without image → "Message cannot be empty"; longer than `CHAT_MAX_LENGTH` → "Message is too long"; image must be our media URL → "Image must be uploaded through the app" (no `PUBLIC_BASE_URL` → "Image messages are not available"). History stays readable after delivery.
- R31. A sent message is published on `subscriptionNewMessage(order)` to both parties and pushed to the counterparty with `data { type: "chat", _id, orderId, messageId, order }` (reference/03 §2.12). Push failures (`PROVIDER_UNAVAILABLE` without FCM/Expo) never fail the send; they are logged as `l6_push_unavailable`.

**Live activities (reference/02 §8)**

- R32. `registerLiveActivitySession`: CUSTOMER owning the order, else `FORBIDDEN`; platform `IOS`|`ANDROID` "Invalid platform"; activityId 1–200 "Invalid activity id"; pushToken 1–4096 "Invalid push token"; schemaVersion 1–10 default 2 "Invalid schema version"; language `^[a-z]{2}(-[A-Za-z]{2})?$` default `en` "Invalid language"; terminal order → `{ success: false, message: "Order is no longer active" }`; else upsert on `(orderId, activityId)` → `{ success: true, message: "Live activity session registered" }`.
- R33. `removeLiveActivitySession` deletes the caller's session (idempotent) → `{ success: true, message: "Live activity session removed" }`.
- R34. On every announcement and ETA recompute, each session of the order is sent `{ schemaVersion, status, estimatedArrivalEpoch, etaUpdatedAtEpoch, riderName, riderPhone, language }` through `LIVE_ACTIVITY_PORT` (`"end"` at DELIVERED/CANCELLED, then the sessions are deleted). `PROVIDER_UNAVAILABLE` is recorded in `lastError`; nothing is reported as delivered.

**Cross-cutting**

- R35. Business messages never contain the master §4.3 reserved words; authorisation failures use `appError("FORBIDDEN")` / `appError("UNAUTHENTICATED")` with default messages.
- R36. Subscriptions accept anonymous sockets (D9) but every L6 subscription calls `ctx.auth()` at subscribe time and throws before returning its stream; anonymous → `UNAUTHENTICATED`.
- R37. Pushes for zone offers, admin assignment and chat go through `NOTIFY_PORT.push`; a missing provider never fails the business action (R31).
- R38. UNVERIFIED defaults chosen: customer phone remains visible to zone riders before acceptance (L5 owns `Order.user`; see Open questions Q4); no read-only chat for admins.
