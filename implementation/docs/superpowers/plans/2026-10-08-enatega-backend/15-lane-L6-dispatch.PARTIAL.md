# Lane L6 — Dispatch, riders, tracking & chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

> **Precedence notice (2026-10-09).** `implementation/docs/ROADMAP.md` is the single roadmap and outranks this
> file for scope, scheduling, ownership and gates; this file remains authoritative for its own task detail.
> `L10`, `L11` and `L13` are **retired identifiers** — they were never lanes in `OPERATION_LANES.json`. Read
> `L10` as **W15** for journey suites (`test/journeys/**`), **W16** for Playwright (`e2e/**`), and the matching
> frontend workstream **W12/W13/W14a/W14b** for edits inside a `vendor/enatega-ui/` package; `L11` as **W23**
> (independent QA) and `L13` as **W24** (independent security). Operation counts come from
> `docs/OPERATION_LANES.json`, not from prose. See `ROADMAP.md` §4.0.

**Goal:** Implement the 32 L6 root operations (rider administration and self-service, zone-broadcast dispatch with atomic self-assignment, admin dispatch, live tracking with ETA and encoded polylines, rider–customer chat, live-activity sessions) exactly as the unchanged Enatega admin, rider, customer app and customer web documents call them, plus the two L6 worker jobs (rider-claim timeout flagging, stale-location cleanup).

**Architecture:** Three Nest modules — `tracking` (locations, ETA engine, polyline, tracking subscriptions, live-activity sessions), `dispatch` (riders, delivery routing, offers, assignments, the announcer that turns order transitions into rider/zone/dispatcher events) and `chat` — share one L6 database pool and talk to other lanes only through `kernel/ports.ts`. Every order status change goes through `OrdersPort.transition`; L6 keeps its own dispatch state (offers, assignments, ETA rows, announcements) and publishes thin `{ orderId, origin }` events on Redis pub/sub that each subscription resolves per subscriber after an authorisation check.

**Tech stack:** NestJS 12 schema-first resolvers, `pg` (raw SQL, row-level `UPDATE … WHERE` compare-and-set), Prisma 7 multi-file schema for migrations only, zod 4 input parsing, kernel `PubSub` (Redis), Vitest 4 unit and Testcontainers integration tests, legacy `subscriptions-transport-ws` client from `test/support/ws.ts`, Playwright 1.63 specs handed to W16.

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
| 25  | subscription | `subscriptionOrderTracking`                      | A, C, W    | CUS(own), RID(assigned), A, S(Dispatch), S(Orders), V/R(own); ownership is rechecked for every event                                                            | `A`, `lib/api/graphql/subscription/order-subscription/index.ts`, `SUBSCRIPTION_ORDER_TRACKING`; `C`, `src/apollo/subscriptions.js`, `subscriptionOrderTracking`; `W`, `lib/api/graphql/subscription/orders/index.ts`, `SUBSCRIPTION_ORDER_TRACKING` | 02 §6.4                          |
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

---

## 6. Test and implementation conventions

All L6 integration specs use one real PostGIS/Redis stack and the exact documents in §2. Each top-level operation
suite uses one of the 32 literal operation tags listed below. Tests create two tenants, two zones, two customers and three
riders so every positive assertion has a cross-tenant or cross-owner negative assertion beside it. Tests never
insert order rows directly: L5 factories create the order and L5's transition fixture moves it to the required
state. A route, notification or live-activity provider is a deterministic port double; it records calls and never
stands in for provider sandbox evidence.

The lane owns these implementation files:

```text
services/api/src/dispatch/{module,resolver,service,repository,schemas,mapper,router,announcer}.ts
services/api/src/riders/{resolver,service,repository,schemas,mapper}.ts
services/api/src/tracking/{module,resolver,service,repository,schemas,eta,polyline}.ts
services/api/src/chat/{module,resolver,service,repository,schemas,mapper}.ts
services/api/test/{unit,integration}/{dispatch,riders,tracking,chat}/**
services/worker/src/jobs/L6/{claim-timeout,stale-location}.ts
services/worker/test/jobs/L6/{claim-timeout,stale-location}.spec.ts
```

`resolver.ts` files contain only argument parsing, `ctx.auth()`, permission/ownership checks and service calls.
Repositories take a `PoolClient` when a transaction spans L5 and L6. Services publish only ids/origins; subscription
mapping re-reads through `OrdersPort`, `UsersPort` and the L6 repository for the authenticated subscriber. Every
mutation accepts an idempotency key from `RequestContext` where the transport supplies one; database uniqueness and
the L5 expected version remain the authoritative duplicate controls.

The reusable integration setup is complete when it exposes this typed fixture:

```ts
type L6Fixture = {
  api: Api;
  pool: Pool;
  docs: Record<string, string>;
  admin: GqlClient;
  dispatchStaff: GqlClient;
  ridersStaff: GqlClient;
  riderA: GqlClient;
  riderB: GqlClient;
  customerA: GqlClient;
  outsider: GqlClient;
  ids: {
    tenantA: string;
    tenantB: string;
    zoneA: string;
    zoneB: string;
    riderA: string;
    riderB: string;
    customerA: string;
  };
};

export async function l6Fixture(stack: Stack): Promise<L6Fixture> {
  const f = factories(stack.pool);
  const tenantA = await f.tenant();
  const tenantB = await f.tenant();
  const zoneA = await f.zone({ tenantId: tenantA.id });
  const zoneB = await f.zone({ tenantId: tenantB.id });
  const customerA = await f.user({ tenantId: tenantA.id, roles: ["CUSTOMER"] });
  const outsider = await f.user({ tenantId: tenantB.id, roles: ["CUSTOMER"] });
  const riderA = await f.rider({
    tenantId: tenantA.id,
    zoneId: zoneA.id,
    available: true,
  });
  const riderB = await f.rider({
    tenantId: tenantB.id,
    zoneId: zoneB.id,
    available: true,
  });
  const admin = await f.user({ tenantId: tenantA.id, roles: ["ADMIN"] });
  const dispatchStaff = await f.staff({
    tenantId: tenantA.id,
    permissions: ["Dispatch"],
  });
  const ridersStaff = await f.staff({
    tenantId: tenantA.id,
    permissions: ["Riders"],
  });
  const api = await startApi(stack);
  const client = (user: { accessToken: string }) =>
    api.http.withUser(user.accessToken);
  return {
    api,
    pool: stack.pool,
    docs: {},
    admin: client(admin),
    dispatchStaff: client(dispatchStaff),
    ridersStaff: client(ridersStaff),
    riderA: client(riderA),
    riderB: client(riderB),
    customerA: client(customerA),
    outsider: client(outsider),
    ids: {
      tenantA: tenantA.id,
      tenantB: tenantB.id,
      zoneA: zoneA.id,
      zoneB: zoneB.id,
      riderA: riderA.id,
      riderB: riderB.id,
      customerA: customerA.id,
    },
  };
}
```

The integration files contain these **literal** tags; a generated loop is not accepted because operation evidence scans the source text:

```ts
describe(op("query.availableRiders"), () => contractCases("availableRiders"));
describe(op("query.chat"), () => contractCases("chat"));
describe(op("query.getActiveOrders"), () => contractCases("getActiveOrders"));
describe(op("query.getLiveMonitorData"), () =>
  contractCases("getLiveMonitorData"),
);
describe(op("query.orderTracking"), () => contractCases("orderTracking"));
describe(op("query.rider"), () => contractCases("rider"));
describe(op("query.riderOrders"), () => contractCases("riderOrders"));
describe(op("query.riders"), () => contractCases("riders"));
describe(op("query.ridersByZone"), () => contractCases("ridersByZone"));
describe(op("query.ridersPaginated"), () => contractCases("ridersPaginated"));
describe(op("mutation.assignOrder"), () => contractCases("assignOrder"));
describe(op("mutation.assignRider"), () => contractCases("assignRider"));
describe(op("mutation.createRider"), () => contractCases("createRider"));
describe(op("mutation.deleteRider"), () => contractCases("deleteRider"));
describe(op("mutation.editRider"), () => contractCases("editRider"));
describe(op("mutation.registerLiveActivitySession"), () =>
  contractCases("registerLiveActivitySession"),
);
describe(op("mutation.removeLiveActivitySession"), () =>
  contractCases("removeLiveActivitySession"),
);
describe(op("mutation.sendChatMessage"), () =>
  contractCases("sendChatMessage"),
);
describe(op("mutation.toggleAvailablity"), () =>
  contractCases("toggleAvailablity"),
);
describe(op("mutation.updateOrderStatusRider"), () =>
  contractCases("updateOrderStatusRider"),
);
describe(op("mutation.updateRiderBussinessDetails"), () =>
  contractCases("updateRiderBussinessDetails"),
);
describe(op("mutation.updateRiderLicenseDetails"), () =>
  contractCases("updateRiderLicenseDetails"),
);
describe(op("mutation.updateRiderLocation"), () =>
  contractCases("updateRiderLocation"),
);
describe(op("mutation.updateRiderVehicleDetails"), () =>
  contractCases("updateRiderVehicleDetails"),
);
describe(op("mutation.updateWorkSchedule"), () =>
  contractCases("updateWorkSchedule"),
);
describe(op("subscription.riderUpdated"), () =>
  subscriptionCases("riderUpdated"),
);
describe(op("subscription.subscriptionAssignRider"), () =>
  subscriptionCases("subscriptionAssignRider"),
);
describe(op("subscription.subscriptionDispatcher"), () =>
  subscriptionCases("subscriptionDispatcher"),
);
describe(op("subscription.subscriptionNewMessage"), () =>
  subscriptionCases("subscriptionNewMessage"),
);
describe(op("subscription.subscriptionOrderTracking"), () =>
  subscriptionCases("subscriptionOrderTracking"),
);
describe(op("subscription.subscriptionRiderLocation"), () =>
  subscriptionCases("subscriptionRiderLocation"),
);
describe(op("subscription.subscriptionZoneOrders"), () =>
  subscriptionCases("subscriptionZoneOrders"),
);
```

`contractCases` is real shared test code, not a placeholder. Each operation supplies its exact document, valid variables and assertion callback in a typed `CASES` record; omitting a key is a TypeScript error:

```ts
type Root = (typeof L6_ROOTS)[number];
type Case = {
  document: string;
  variables: Record<string, unknown>;
  assert(data: Record<string, unknown>): void;
};
const CASES: Record<
  Exclude<Root, `subscription.${string}`>,
  Case
> = operationCases(fx);

function contractCases(name: string) {
  const key = L6_ROOTS.find((root) => root.endsWith(`.${name}`)) as Exclude<
    Root,
    `subscription.${string}`
  >;
  const c = CASES[key];
  it("returns the exact pinned response for an authorised owner", async () => {
    const result = await fx.authorised[key].query(c.document, c.variables);
    expect(result.errors).toBeUndefined();
    c.assert(result.data as Record<string, unknown>);
  });
  it("rejects anonymous, foreign-tenant and malformed input", async () => {
    await expectCode(
      fx.api.http.query(c.document, c.variables),
      "UNAUTHENTICATED",
    );
    await expectCode(fx.outsider.query(c.document, c.variables), "FORBIDDEN");
    await expectCode(
      fx.authorised[key].query(c.document, invalidVariables(key)),
      "BAD_USER_INPUT",
    );
  });
}

function subscriptionCases(name: string) {
  const key = `subscription.${name}` as Extract<Root, `subscription.${string}`>;
  const c = SUBSCRIPTION_CASES[key];
  it("re-authorises every event and cleans up the iterator", async () => {
    const stream = await legacySubscribe(
      fx.api.wsUrl,
      c.document,
      c.variables,
      fx.connection[key],
    );
    await c.publishOwned();
    c.assert(await stream.next());
    await c.revokeOwnership();
    await c.publishOwned();
    await expectNoEvent(stream, 200);
    await stream.return?.();
    expect(await fx.redisSubscriberCount(c.topic)).toBe(0);
  });
  it("rejects an anonymous socket before returning a stream", async () => {
    await expect(
      legacySubscribe(fx.api.wsUrl, c.document, c.variables, {}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
}
```

The concrete implementation pattern is also fixed. Every resolver method parses, authorises and delegates; every repository query receives caller-derived scope and parameters. For example:

```ts
@Query("rider")
async rider(@Args() raw: unknown, @Context() ctx: RequestContext) {
  const args = riderArgs.parse(raw);
  const auth = await ctx.auth();
  requireAuth(auth);
  return this.riders.getForViewer(args.id, auth);
}

async get(
  id: string,
  tenantId: string,
  view: "FULL" | "SELF" | "PUBLIC",
) {
  const result = await this.pool.query<RiderRow>(
    `SELECT * FROM "Rider" WHERE id=$1 AND "tenantId"=$2 AND "deletedAt" IS NULL`,
    [parseId(id, "rider"), tenantId],
  );
  if (!result.rows[0]) throw appError("NOT_FOUND", "Rider not found");
  return mapRider(result.rows[0], view);
}

@Mutation("updateRiderLocation")
async updateRiderLocation(@Args() raw: unknown, @Context() ctx: RequestContext) {
  const args = locationArgs.parse(raw);
  const auth = await ctx.auth();
  requireAuth(auth, "RIDER");
  if (!auth.riderId) throw appError("FORBIDDEN");
  return this.tracking.record(auth.tenantId, auth.riderId, args);
}
```

## 7. TDD implementation tasks

Every task follows the same five enforced steps: (1) add the complete named specs and confirm they fail for the
expected missing resolver/service behavior; (2) run the exact red command shown; (3) implement every listed file
and rule; (4) rerun the command and confirm every named case passes; (5) commit only the task files with the shown
message. The case matrices below are exhaustive: each row is an `it(...)` body using the exact `doc(...)` source in
§2, asserts concrete returned fields, and also asserts the stated error code/message.

### Task 1: Rider reads and administration

**Files:** Create `services/api/src/riders/{resolver,service,repository,schemas,mapper}.ts`,
`services/api/test/integration/riders/{reads,administration}.integration.spec.ts`, and
`services/api/test/unit/riders/{schemas,mapper}.spec.ts`; modify `services/api/src/dispatch/module.ts` only to register
the riders providers after that module exists.

- [ ] **Step 1 — failing tests:** implement these tagged suites and cases:

| Operation                    | Positive assertions                                                                     | Required negative/validation assertions                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `query.riders`               | A and S(Riders/Dispatch) receive only tenant riders and exact `_id/name/zone/available` | anonymous `UNAUTHENTICATED`; unrelated staff `FORBIDDEN`; tenant B absent                                 |
| `query.ridersPaginated`      | stable `_id` order, exact `totalCount/currentPage/totalPages/nextPage/prevPage`         | page/limit bounds; cross-tenant filter ignored/refused                                                    |
| `query.rider`                | admin full view, rider self view, customer PUBLIC view for assigned active order        | other rider and unrelated customer `FORBIDDEN`; deleted rider `null`; missing admin id `Invalid rider id` |
| `query.ridersByZone`         | only active tenant riders in requested zone                                             | zone B `NOT_FOUND`; unauthorized staff `FORBIDDEN`                                                        |
| `query.availableRiders`      | only active, available, unassigned riders                                               | inactive/deleted/assigned excluded                                                                        |
| `mutation.createRider`       | creates identity+rider atomically and returns exact profile                             | every R2 error; duplicate username `CONFLICT`; forced account failure leaves no Rider                     |
| `mutation.editRider`         | admin edits all fields; rider changes only vehicle type                                 | cross-tenant id `NOT_FOUND`; rider other id `FORBIDDEN`; ignored self fields unchanged                    |
| `mutation.deleteRider`       | soft deletes and revokes sessions                                                       | active assignment exact R4 message; cross-tenant `NOT_FOUND`                                              |
| `mutation.toggleAvailablity` | atomic true→false→true and `riderUpdated` publication                                   | other rider `FORBIDDEN`; concurrent toggles serialize                                                     |

- [ ] **Step 2 — red:** `pnpm --filter @fairbite/api test:integration -- riders` and
      `pnpm --filter @fairbite/api test -- riders`; expect missing providers/resolvers.
- [ ] **Step 3 — implementation:** parse with zod using every bound and exact message in R2; derive tenant and caller
      from auth context; issue parameterized SQL scoped by `tenantId`; perform create/delete with `UnitOfWork`; map the
      `FULL`, `SELF` and `PUBLIC` field sets explicitly; compute wallet values through `LedgerPort`; publish `{ riderId }`
      after commit. The repository implements `list`, `page`, `byId`, `byZone`, `available`, `insert`, `update`,
      `softDelete`, and `toggleAvailability`, each with tenant predicates.
- [ ] **Step 4 — green:** rerun both Step 2 commands; expect all named cases to pass.
- [ ] **Step 5 — commit:** `feat(L6): implement tenant-scoped rider administration`.

### Task 2: Rider details, schedules and native background location

**Files:** Create `services/api/test/integration/riders/details.integration.spec.ts`,
`services/api/test/integration/tracking/location.integration.spec.ts`,
`services/api/test/unit/tracking/location-schema.spec.ts`; create
`services/api/src/tracking/{module,resolver,service,repository,schemas}.ts`; modify the Task 1 rider resolver/service.

- [ ] **Step 1 — failing tests:** cover `mutation.updateRiderBussinessDetails`,
      `mutation.updateRiderLicenseDetails`, `mutation.updateRiderVehicleDetails`, `mutation.updateWorkSchedule`, and
      `mutation.updateRiderLocation`. Each details mutation proves self/admin success, unrelated caller denial,
      cross-tenant denial, null input, every R7–R9 exact validation string, stored normalized values and `riderUpdated`.
      Location cases prove all R23 bounds, R24 rate/ordering behavior, sample append, no terminal-order publication and
      tenant isolation. Execute both `UPDATE_LOCATION_MULTI_VENDOR` and this literal native request through raw HTTP:

```ts
const response = await fetch(`${api.url}/graphql`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${riderToken}`,
  },
  body: JSON.stringify({
    operationName: "BackgroundRiderLocation",
    query: `mutation BackgroundRiderLocation($latitude:String!,$longitude:String!){
      updateRiderLocation(latitude:$latitude,longitude:$longitude){ _id location { coordinates } }
    }`,
    variables: { latitude: "1.3521", longitude: "103.8198" },
  }),
});
expect(response.status).toBe(200);
expect(
  (await response.json()).data.updateRiderLocation.location.coordinates,
).toEqual([103.8198, 1.3521]);
```

- [ ] **Step 2 — red:** `pnpm --filter @fairbite/api test:integration -- details location`; expect missing roots.
- [ ] **Step 3 — implementation:** normalize all R7–R9 values before one tenant-scoped update; use
      `parseClientDate`; accept the exact optional argument set present in both location documents; execute one
      compare-and-set update with `receivedAt <= now - interval` and `recordedAt < incoming`; distinguish rate from
      stale by rereading after a zero-row update; append the sample and enqueue ETA work in the same transaction.
- [ ] **Step 4 — green:** rerun Step 2; expect all cases and the literal background request to pass.
- [ ] **Step 5 — commit:** `feat(L6): implement rider compliance and private location ingestion`.

### Task 3: Provider-independent offers and atomic rider claims

**Files:** Create `services/api/src/dispatch/{router,service,repository,schemas,announcer}.ts`,
`services/api/test/integration/dispatch/{offers,claim}.integration.spec.ts`, and
`services/api/test/unit/dispatch/router.spec.ts`.

- [ ] **Step 1 — failing tests:** cover `query.riderOrders` and `mutation.assignOrder`. Assert R11–R15 for own-fleet,
      courier unavailable, takeaway exclusion, zone and assignment filtering, newest order, unavailable rider, wrong
      zone, idempotent own claim and exact conflict text. The race uses two authenticated riders in the same zone and a
      barrier that starts both mutations before awaiting either:

```ts
const [a, b] = await Promise.all([
  fx.riderA.query(assignOrderDoc, { id: order.id }),
  fx.riderC.query(assignOrderDoc, { id: order.id }),
]);
const successes = [a, b].filter((r) => r.data?.assignOrder?._id === order.id);
const conflicts = [a, b]
  .flatMap((r) => r.errors ?? [])
  .filter((e) => e.extensions.code === "CONFLICT");
expect(successes).toHaveLength(1);
expect(conflicts.map((e) => e.message)).toEqual(["Order already assigned"]);
expect(await assignmentCount(order.id)).toBe(1);
```

- [ ] **Step 2 — red:** `pnpm --filter @fairbite/api test:integration -- offers claim`; expect missing dispatch.
- [ ] **Step 3 — implementation:** define `DeliveryRouter.route(order)` with `own_fleet` and
      `third_party_courier`; persist flags without inventing a provider result. Claim with
      `SELECT ... FOR UPDATE` followed by `UPDATE "DispatchOffer" SET status='CLAIMED', "claimedBy"=$rider
WHERE "orderId"=$order AND status='OPEN' RETURNING *`; hold the transaction across
      `OrdersPort.transition({ orderId, to:'ASSIGNED', riderId, expectedVersion })`; map zero rows to idempotence or the
      exact conflict after rereading. The announcer inserts `(orderId,orderVersion)` before publishing and deletes that
      claim if publication fails.
- [ ] **Step 4 — green:** rerun Step 2 at least ten times; exactly one race winner on every run.
- [ ] **Step 5 — commit:** `feat(L6): add provider-independent dispatch and atomic claims`.

### Task 4: Admin dispatch and centrally validated rider transitions

**Files:** Create `services/api/src/dispatch/resolver.ts`,
`services/api/test/integration/dispatch/{admin-assignment,status,monitor}.integration.spec.ts`; modify dispatch
service/repository/announcer.

- [ ] **Step 1 — failing tests:** cover `mutation.assignRider`, `mutation.updateOrderStatusRider`,
      `query.getActiveOrders`, `query.getLiveMonitorData`. Assert every R16/R17 state message, staff permissions,
      tenant/restaurant ownership, admin override, idempotence, expected-version conflict, filters/pagination, UTC date
      ranges and exact monitor aggregates. Assert database order status changes only through the fake/spy
      `OrdersPort.transition`; no L6 SQL updates `Order`.
- [ ] **Step 2 — red:** `pnpm --filter @fairbite/api test:integration -- admin-assignment status monitor`.
- [ ] **Step 3 — implementation:** authorize first, parse ids/status/range, fetch the current order through
      `OrdersPort`, apply R16/R17 preconditions, then call the central transition. Persist assignment phase/log and run
      R19 exactly once per version. `getActiveOrders` and monitor queries receive caller-derived tenant/vendor scopes;
      user-supplied scope never widens them.
- [ ] **Step 4 — green:** rerun Step 2; all status and scope cases pass.
- [ ] **Step 5 — commit:** `feat(L6): centralize admin dispatch and rider status transitions`.

### Task 5: ETA, tracking reads and location privacy

**Files:** Create `services/api/src/tracking/{eta,polyline,mapper}.ts`,
`services/api/test/unit/tracking/{eta,polyline}.spec.ts`, and
`services/api/test/integration/tracking/order-tracking.integration.spec.ts`; modify tracking service/repository.

- [ ] **Step 1 — failing tests:** cover `query.orderTracking` with each permitted role in R27, every ownership
      denial, cross-tenant denial, unknown order, pre-ETA nulls, terminal location redaction and stale location. Unit
      cases cover every R26 phase, Maps success/error/refresh interval, road-factor estimate, arrival window,
      `baseArrivalAt` immutability, version increment and known Google polyline vectors.
- [ ] **Step 2 — red:** `pnpm --filter @fairbite/api test -- eta polyline` and
      `pnpm --filter @fairbite/api test:integration -- order-tracking`.
- [ ] **Step 3 — implementation:** calculate entirely from server-owned order, restaurant and accepted location
      rows; validate Maps output before storing it; fall back on every provider failure; use integer seconds/meters;
      upsert ETA with `version = version + 1`; expose latest rider location only after R27 access and active-state checks.
- [ ] **Step 4 — green:** rerun both Step 2 commands.
- [ ] **Step 5 — commit:** `feat(L6): add private tracking and deterministic ETA calculation`.

### Task 6: Chat and live-activity sessions

**Files:** Create `services/api/src/chat/{module,resolver,service,repository,schemas,mapper}.ts`,
`services/api/test/integration/chat/chat.integration.spec.ts`, and
`services/api/test/integration/tracking/live-activity.integration.spec.ts`; extend tracking resolver/service/repository.

- [ ] **Step 1 — failing tests:** cover `query.chat`, `mutation.sendChatMessage`,
      `mutation.registerLiveActivitySession`, `mutation.removeLiveActivitySession`. Assert both parties, outsiders,
      cross-tenant ids, newest-first 200 cap, server-stamped sender, every R30 message/image/state branch, push failure
      isolation, session ownership, every R32 input bound, upsert/idempotent removal, terminal refusal and token absence
      from all GraphQL responses/logs.
- [ ] **Step 2 — red:** `pnpm --filter @fairbite/api test:integration -- chat live-activity`.
- [ ] **Step 3 — implementation:** authorize by fresh order read, ignore client sender identity, parameterize inserts,
      return the exact `{success,message}` branch, publish only the message/order ids, redact tokens in structured logs,
      and call provider ports after commit. Provider failure updates bounded `lastError` and does not claim delivery.
- [ ] **Step 4 — green:** rerun Step 2.
- [ ] **Step 5 — commit:** `feat(L6): implement order chat and live activity sessions`.

### Task 7: Seven secure realtime subscriptions

**Files:** Create `services/api/src/dispatch/subscriptions.ts`, `services/api/src/tracking/subscriptions.ts`,
`services/api/src/chat/subscriptions.ts`, and
`services/api/test/integration/realtime/{zone,assignment,dispatcher,tracking,rider-location,rider-updated,chat}.integration.spec.ts`.

- [ ] **Step 1 — failing tests:** each suite uses `legacySubscribe` and covers exactly one root:

| Subscription                | Subscribe-time check                | Per-event re-read and assertion                                                         |
| --------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `subscriptionZoneOrders`    | RID(self), matching zone, available | still eligible; exact `zoneId/origin/order._id`; no tenant/other-zone leak              |
| `subscriptionAssignRider`   | `riderId` equals caller             | assignment still belongs to caller; exact origin; reassignment removes old rider        |
| `subscriptionDispatcher`    | A/S(Dispatch)                       | tenant order is still visible; concrete order/status/rider fields                       |
| `subscriptionOrderTracking` | R27 ownership                       | ownership and active relation still hold; terminal update redacts location              |
| `subscriptionRiderLocation` | R28 access                          | event audience still contains customer; only active-order customers receive coordinates |
| `riderUpdated`              | A or STAFF                          | tenant rider exists; exact updated profile; no tenant B event                           |
| `subscriptionNewMessage`    | current customer or assigned rider  | party relation still holds; exact new message id/text; outsider receives nothing        |

Every suite also asserts anonymous `UNAUTHENTICATED`, unauthorized `FORBIDDEN`, malformed id validation, socket
cancellation and Redis cleanup. At least one test changes ownership after subscribe but before publish and proves
no event is delivered.

- [ ] **Step 2 — red:** `pnpm --filter @fairbite/api test:integration -- realtime`; expect missing subscriptions.
- [ ] **Step 3 — implementation:** call `await ctx.auth()` before `PUBSUB.subscribe`; topics contain opaque ids, not
      coordinates or PII; filters load current rider/order/message ownership for every event; mapper loads only after
      filter success. Use bounded async iterators and close them on socket completion. Modern protocol coverage remains
      in the shared transport suite; these cases specifically prove the pinned legacy clients.
- [ ] **Step 4 — green:** rerun Step 2; all seven suites pass and leave no Redis subscribers.
- [ ] **Step 5 — commit:** `feat(L6): secure dispatch tracking and chat subscriptions`.

### Task 8: Schema, migration, factories and operation evidence

**Files:** Create `services/api/prisma/schema/L6-dispatch.prisma`, migration
`services/api/prisma/migrations/202610090160_L6_init/migration.sql`, and
`services/api/test/support/factories/L6.ts`. Modify `contracts/enatega/L6-dispatch.graphql` only for reviewed,
lane-owned drift. The lane does not edit shared documentation/evidence directly. It sends explicit lead-owned requests for
`docs/CROSS_LANE_FKS.md`, `docs/OPERATION_TEST_EVIDENCE.json`, the factory index and any reviewed contract drift;
each request contains the exact proposed rows, evidence paths and commands. The lead applies and commits them.

- [ ] **Step 1 — failing tests:** schema integration applies the migration to fresh and populated-005 databases,
      verifies all §4 constraints/FKs/indexes, rejects cross-lane orphan ids, and proves rollback by restoring the
      pre-migration backup and matching baseline row hashes. Contract tests replay every §2 document.
- [ ] **Step 2 — red:** run `pnpm check:enatega`, `pnpm check:enatega:full`,
      `pnpm --filter @fairbite/api test:integration -- schema`, and Prisma drift; expect missing L6 persistence.
- [ ] **Step 3 — implementation:** install §3/§4 verbatim, adapt only confirmed owning-lane table names, record every
      cross-lane FK and add factories that require explicit tenant/owner ids. Never edit an applied migration checksum.
- [ ] **Step 4 — green:** rerun Step 2 plus `pnpm codegen:check`; expect no drift or data loss.
- [ ] **Step 5 — commit:** `feat(L6): freeze dispatch schema migration and evidence`.

## 8. Worker jobs and event handlers

### Task 9: Claim timeout worker

**Files:** Create `services/worker/src/jobs/L6/claim-timeout.ts` and
`services/worker/test/jobs/L6/claim-timeout.spec.ts`; modify the worker job registry by request to the lead.

- [ ] Test with a fake clock: only OPEN offers older than 120 seconds receive `CLAIM_TIMEOUT`; claimed/closed/new
      offers stay unchanged; two workers using `FOR UPDATE SKIP LOCKED` flag each row once; dispatcher gets one id-only
      event; missing riders never cancel/reassign the order; tenant ids are retained in logs/events.
- [ ] Red command: `pnpm --filter @fairbite/worker test -- claim-timeout`.
- [ ] Implement batches of 100 in a transaction, update `flagReason/flaggedAt`, enqueue the dispatcher event through
      the outbox and return `{ scanned, flagged }`; the loop sleeps according to worker configuration and aborts on its
      signal.
- [ ] Green command: rerun the red command.
- [ ] Commit: `feat(L6): flag unclaimed dispatch offers without reassignment`.

### Task 10: Stale-location cleanup and order-event reconciliation

**Files:** Create `services/worker/src/jobs/L6/stale-location.ts`,
`services/worker/src/jobs/L6/reconcile-order-events.ts`, and matching specs under `services/worker/test/jobs/L6/`.

- [ ] Test that samples older than `LOCATION_RETENTION_DAYS` are deleted in bounded batches while latest
      `RiderLocation` rows are retained; no active tracking row is removed; cleanup logs counts without coordinates.
- [ ] Test order-event replay: duplicate versions are ignored, a missed version creates the exact R19 announcement,
      a failed publish releases/retries its announcement claim, and versions never cross tenants.
- [ ] Red command: `pnpm --filter @fairbite/worker test -- stale-location reconcile-order-events`.
- [ ] Implement `DELETE ... WHERE id IN (SELECT id ... LIMIT 1000 FOR UPDATE SKIP LOCKED)` and the idempotent
      `(orderId,orderVersion)` consumer; all downstream payloads contain ids/origin only.
- [ ] Green command: rerun the red command.
- [ ] Commit: `feat(L6): expire location samples and reconcile dispatch announcements`.

## 9. Playwright and journey handoff

W8 does not edit these files. It hands the following exact cases and seeded API states to W16/W15.

### W16 Playwright

| Spec                                        | Route and source-owned interaction                                                                                                                                                                                                                                                                                                                | Assertions and operation tags                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `e2e/specs/admin/riders.spec.ts`            | Riders route: `getByRole("heading", {name:"Riders"})`, `getByTitle("Add Rider")`, then `getByPlaceholder("Name")`, `"Username"`, `"Vehicle Type"`, `"Zone"`, `"Phone Number"`, and `getByRole("button", {name:"Add"})`. Sources: `super-admin/riders/view/header/screen-header/index.tsx:19-25`, `super-admin/riders/add-form/index.tsx:168-306`. | rows and pagination update; validation toast; all rider query/mutation tags                                       |
| `e2e/specs/admin/dispatch.spec.ts`          | Vendor Orders route: filter with `getByPlaceholder("Keyword Search")` and `getByTitle("Orders Status")`; source `vendor/order/header/table-header/index.tsx:67-78`. Select the seeded active order using its visible order id, then the visible rider name.                                                                                       | assignment appears, tracking marker/status changes, invalid state toast; dispatch/tracking tags                   |
| `e2e/specs/admin/live-monitor.spec.ts`      | Vendor dashboard: `getByRole("heading", {name:"Live Monitor"})` and `getByText("Track the health of your business")`; source `vendor/dashboard/live-monitor/index.tsx:48-65`.                                                                                                                                                                     | exact seeded Stores and Orders counters; `@op:query.getLiveMonitorData`                                           |
| `e2e/specs/web/order-tracking-chat.spec.ts` | Order tracking route: `getByRole("button", {name:"Chat With Rider"})`, `getByPlaceholder("type_a_message_placeholder")`, type text, then click the adjacent send button. Sources: `order-tracking/components/ChatRider.tsx:16-24`, `chatwithrider-modal.tsx:178-188`.                                                                             | sent message appears once, outsider URL denied, location/status assertions; rider/tracking/chat/subscription tags |

The selectors above are verified against the pinned source and are the required first choice. The chat send button
has no accessible name at `chatwithrider-modal.tsx:186-188`; W16 must scope it as the button adjacent to the verified
message textbox. Any accessibility attribute request is lead-owned, presentation-preserving, recorded in
`SOURCE_PROVENANCE.json`, and followed by source-manifest regeneration.

### W15 API journeys and W19 device handoff

- `services/api/test/journeys/rider-delivery.journey.spec.ts`: rider profile → availability → zone event →
  `riderOrders` → atomic `assignOrder` → assigned event → background location → PICKED → DELIVERED, replaying the
  exact rider documents in that order and asserting order/tracking versions.
- `services/api/test/journeys/customer-tracking-chat.journey.spec.ts`: customer reads rider/tracking, registers a
  live activity, receives tracking/location, exchanges two messages, receives terminal update, removes the session.
- `services/api/test/journeys/admin-dispatch.journey.spec.ts`: active orders → available riders → admin assignment →
  dispatcher/tracking events → monitor aggregate.
- W19 repeats background location and live-activity registration/removal on signed iOS/Android devices; an Expo
  export or HTTP-only replay does not close that native gate.

## 10. Coverage and G2 checklist

- [ ] G1 is approved before W8 begins; no dependency is waived silently.
- [ ] All 32 roots below have real resolvers and a tagged positive integration test plus auth, ownership and input
      negatives in `docs/OPERATION_TEST_EVIDENCE.json`.
- [ ] `pnpm check:enatega` and `pnpm check:enatega:full` pass with the pinned source unchanged.
- [ ] `pnpm --filter @fairbite/api test`, `test:integration`, `typecheck`, `build`, `pnpm coverage`, and lane `pnpm e2e` pass.
- [ ] L6 covered files meet statements 90%, branches 85%, functions 90%, lines 90%; no exclusion is added.
- [ ] Worker unit/integration tests, migration fresh/upgrade/drift/restore checks and both WebSocket protocols pass.
- [ ] W16 Playwright and W15 journeys are handed off with all tags above; they remain later gate evidence.
- [ ] W23 independently verifies operations/evidence; W24 verifies tenant isolation, location privacy, subscription
      re-authorization, push-token redaction and provider-independent failure behavior.

Exact operation checklist for generated coverage:

```text
query.riders query.ridersPaginated query.rider query.ridersByZone query.availableRiders
mutation.createRider mutation.editRider mutation.deleteRider mutation.toggleAvailablity
mutation.updateRiderLocation mutation.updateRiderBussinessDetails mutation.updateRiderLicenseDetails
mutation.updateRiderVehicleDetails mutation.updateWorkSchedule query.riderOrders mutation.assignOrder
mutation.assignRider mutation.updateOrderStatusRider query.orderTracking query.getActiveOrders
query.getLiveMonitorData subscription.subscriptionZoneOrders subscription.subscriptionAssignRider
subscription.subscriptionDispatcher subscription.subscriptionOrderTracking subscription.subscriptionRiderLocation
subscription.riderUpdated query.chat mutation.sendChatMessage subscription.subscriptionNewMessage
mutation.registerLiveActivitySession mutation.removeLiveActivitySession
```

The lane acceptance command is:

```bash
pnpm check:enatega && pnpm check:enatega:full && pnpm codegen:check && \
pnpm --filter @fairbite/api test && pnpm --filter @fairbite/api test:integration && \
pnpm --filter @fairbite/api typecheck && pnpm --filter @fairbite/api build && \
pnpm --filter @fairbite/worker test && pnpm coverage && pnpm e2e && pnpm check:operations
```

`check:operations` is product-wide and may remain red for other lanes; L6 acceptance requires every L6 row in its
JSON report to be covered and error-free, followed by its independent approvals. Shared evidence/roadmap changes
are submitted as exact lead-owned requests; W8 does not self-edit or self-approve those artifacts.

## 11. Open questions and blockers

1. **Customer phone before claim:** owner/security must decide whether an available zone rider may see the customer's
   phone in an unclaimed order. Safe default: redact it until assignment; this supersedes the UNVERIFIED R38 source
   behavior unless the owner explicitly accepts disclosure.
2. **Courier provider:** no courier provider/credentials/capability policy is selected. The adapter remains
   provider-independent and returns `PROVIDER_UNAVAILABLE`; own-fleet dispatch is fully testable.
3. **Maps provider:** no directions credentials are assumed. Haversine ETA is the deterministic fallback; Maps source
   requires W18 sandbox evidence before release claims.
4. **Push and live activities:** FCM/Expo/APNs credentials and signed device entitlements are external blockers for
   delivery evidence. Business mutations still succeed while recording provider unavailability.
5. **Location retention:** `LOCATION_RETENTION_DAYS` needs the W20 retention decision. Safe development default is 7
   days; production startup rejects an absent reviewed value rather than inventing policy.
6. **Admin override:** cross-zone/unavailable admin assignment and availability toggling with active orders are the
   source-compatible UNVERIFIED defaults in R5/R16; product owner may tighten them before G2.

## 12. Implementation readiness

**Roadmap task T004: In progress. Status: NOT IMPLEMENTATION-READY.** The plan has the complete contract, data model, rules, 32 exact operation tags,
verified UI selectors, privacy boundaries, gate commands and blockers. It cannot be claimed by W8 until the following
copy-pasteable bodies required by `_lane-plan-brief.md` are authored and independently reviewed:

1. **Shared integration support:** define `L6_ROOTS`, `operationCases`, `invalidVariables`, `expectCode`,
   `SUBSCRIPTION_CASES`, `expectNoEvent`, `redisSubscriberCount`, `fx.authorised`, and `fx.connection`. Each of the 32
   entries must load its exact §2 `doc(app,file,exportName)`, seed owner/foreign-tenant state, provide valid/invalid
   variables and assert selected fields. They are currently referenced but undefined, so the skeleton is not
   executable.
2. **Task 1:** inline complete rider zod schemas, mappers, repository SQL, service, all nine resolver methods and the
   full rider administration/read tests. The sample `rider` method does not cover the other roots.
3. **Task 2:** inline four compliance update implementations, work-schedule persistence, location compare-and-set SQL,
   sample insertion/event transaction and all exact validation/race tests.
4. **Task 3:** inline `DeliveryRouter`, offer repository/service/announcer classes and full own-fleet, unavailable
   courier, atomic-claim and publication-failure tests. The one race snippet is insufficient.
5. **Task 4:** inline admin assignment/status services and resolvers, active-order/monitor SQL and their full scope,
   transition, aggregation and concurrency tests.
6. **Task 5:** inline ETA/polyline code, tracking repository/mapper/resolver and complete provider fallback,
   refresh/version/location-redaction tests.
7. **Task 6:** inline chat/live-activity schemas, repositories, services and resolvers plus complete ownership,
   token-redaction, push-failure and cleanup tests.
8. **Task 7:** inline all seven subscription resolver/filter implementations and complete legacy WebSocket tests,
   including ownership change after subscribe and iterator cleanup.
9. **Task 8:** inline the migration/factory/schema tests and the exact lead-request payloads for FKs and evidence.
10. **Tasks 9–10:** inline claim-timeout, stale-location and reconciliation worker modules, registry request and full
    fake-clock, two-worker, outage, retry, cleanup and idempotency tests.

The plan must not return to Done or be described as complete until these bodies pass lead review. This status does
not weaken tenant ownership, location privacy, subscription re-authorisation, provider-unavailability behavior or
the unchanged pinned frontend boundary.
