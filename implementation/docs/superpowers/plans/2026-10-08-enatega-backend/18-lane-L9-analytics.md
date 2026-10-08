# Lane L9 — Dashboards & analytics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

**Goal:** Serve the nine dashboard queries that the unchanged Enatega multivendor admin calls on the super-admin `/home`, vendor `/admin/vendor/dashboard` and store `/admin/store/dashboard` screens, with the exact argument names and response shapes the admin reads, real numbers aggregated from delivered orders and live population counts, strict role scoping, localized `dateKeyword` handling, platform-timezone bucketing, indexed bounded SQL and a short-TTL Redis cache.

**Architecture:** `src/modules/analytics` is a read-only module. It reads five SQL views created by its own migration (`AnalyticsUserView`, `AnalyticsVendorView`, `AnalyticsRestaurantView`, `AnalyticsRiderView`, `AnalyticsOrderView` over L5's `OrderSummaryView`) through its own read-only `pg` pool, and never writes to PostgreSQL. A thin resolver parses arguments with zod, a scope guard authorizes the caller against the requested vendor/store, a pure date-range module turns the (possibly translated) `dateKeyword` into a half-open UTC interval in the platform timezone, and results are cached in Redis for 30 seconds under a key that contains the authorized scope.

**Tech stack:** Node 24, TypeScript 5.9, NestJS 12 + `@nestjs/graphql` 14 (schema-first), graphql-js 16, `pg` 8 (raw SQL, read-only pool), ioredis 5, zod 4, Vitest 4, Testcontainers 11 (`postgis/postgis:17-3.5`, `redis:7-alpine`), Playwright 1.63 (specs handed to L10).

---

## 1. Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

L9 makes **no** edit inside `vendor/enatega-ui/`. Every behaviour below is chosen so the admin works unchanged, including its upstream defects (translated `dateKeyword` labels, the vendor January date bug, `_type` lookups that crash on unknown values).

---

## 2. Operations

Source of truth: `implementation/docs/OPERATION_LANES.json`, filter `lane == "L9"` → **9 operations** (all `query`). Count checked: 9 rows below = 9 entries in the JSON. (The JSON's `wave: 5` value for L9 is a generator artefact; master plan §5/§7 schedule L9 in Wave 2 — see Open question Q9.)

All test documents live in `enatega-multivendor-admin`, file `lib/api/graphql/queries/dashboard/index.ts` (export names verified by reading the file; line numbers are the `export const` lines).

| # | Type | Name | Apps that call it (call site) | Who may call (server-enforced) | Test document `doc(app, file, exportName)` | Reference |
|---|---|---|---|---|---|---|
| 1 | query | `getDashboardUsers` | admin super-admin `/home` cards (`lib/ui/screen-components/protected/super-admin/home/user-stats/index.tsx:27`); svadmin same screen (Wave 5) | ADMIN; STAFF with `Admin` (R3) | `enatega-multivendor-admin`, `lib/api/graphql/queries/dashboard/index.ts`, `GET_DASHBOARD_USERS` (:4) | ref/04 §2.1, §B row "getDashboardUsers…" |
| 2 | query | `getDashboardUsersByYear` | admin `/home` growth chart (`super-admin/home/growth-overview/index.tsx:26-41`, `year: new Date().getFullYear()`) | ADMIN; STAFF with `Admin` | same file, `GET_DASHBOARD_USERS_BY_YEAR` (:17) | ref/04 §2.1, §B, §D.6 |
| 3 | query | `getDashboardOrdersByType` | admin `/home` "Orders" table (`super-admin/home/stats-table/index.tsx:23-29,55-60`) | ADMIN; STAFF with `Admin` | same file, `GET_DASHBOARD_ORDERS_BY_TYPE` (:34) | ref/04 §2.1, §B |
| 4 | query | `getDashboardSalesByType` | admin `/home` "Sales" table (`super-admin/home/stats-table/index.tsx:31-40,61-66`) | ADMIN; STAFF with `Admin` | same file, `GET_DASHBOARD_SALES_BY_TYPE` (:43) | ref/04 §2.1, §B, §5 |
| 5 | query | `getVendorDashboardStatsCardDetails` | admin vendor dashboard cards (`vendor/dashboard/restaurant-stats/index.tsx:40-55`) | ADMIN; STAFF with `Vendors`; VENDOR for its own vendor (R4) | same file, `GET_VENDOR_DASHBOARD_STATS_CARD_DETAILS` (:206) | ref/04 §2.1, §B row "getVendorDashboard*" |
| 6 | query | `getVendorDashboardGrowthDetailsByYear` | admin vendor growth chart (`vendor/dashboard/growth-overview/index.tsx:47-60`) | ADMIN; STAFF with `Vendors`; VENDOR own | same file, `GET_VENDOR_DASHBOARD_GROWTH_DETAILS_BY_YEAR` (:248) | ref/04 §2.1, §B, §D.6 |
| 7 | query | `getRestaurantDashboardOrdersSalesStats` | **not called** by multivendor-admin UI (document exported only); called by svadmin `lib/ui/screen-components/protected/restaurant/dashboard/order-stats/index.tsx` (Wave 5) | ADMIN; STAFF with `Stores`; VENDOR for a store it owns; RESTAURANT for its own store (R5) | same file, `GET_DASHBOARD_RESTAURANT_ORDERS` (:53) | ref/04 §2.1, §B row "getRestaurantDashboard*" |
| 8 | query | `getRestaurantDashboardSalesOrderCountDetailsByYear` | admin store growth chart (`restaurant/dashboard/growth-overview/index.tsx:32-46`) | ADMIN; STAFF `Stores`; VENDOR own store; RESTAURANT own | same file, `GET_DASHBOARD_RESTAURANT_SALES_ORDER_COUNT_DETAILS_BY_YEAR` (:74) | ref/04 §2.1, §B, §D.6 |
| 9 | query | `getRestaurantDashboardOrderSalesDetailsByPaymentMethod` | admin store cards (`restaurant/dashboard/order-stats/index.tsx:37-53`) and payment tables (`restaurant/dashboard/restaurant-stats-table/index.tsx:42-58`) | ADMIN; STAFF `Stores`; VENDOR own store; RESTAURANT own | same file, `GET_RESTAURANT_DASHBOARD_ORDER_SALES_DETAILS_BY_PAYMENT_METHOD` (:89) | ref/04 §2.1, §B, §5 |

Total: **9 / 9**.

Not L9 (same screens, other lanes; they may return `NOT_IMPLEMENTED` until those lanes land): `getLiveMonitorData` (L6), `getStoreDetailsByVendorId`, `getStoreDetailsByVendorIdPaginated` (L3), `getDashboardOrderSalesDetailsByPaymentMethod` (svadmin only, L12).

---

## 3. Contract notes

### 3.1 Verified client facts (read from the vendored source)

| Fact | Source | Consequence |
|---|---|---|
| `getDashboardUsersByYear.*Count` are typed `number[]` and plotted against 12 labels `January…December` | `lib/utils/interfaces/dashboard.interface.ts` (`IDashboardUsersByYearResponseGraphQL`); `super-admin/home/growth-overview/index.tsx:58-71` | Each series is exactly 12 integers, index 0 = January, in the platform timezone. |
| `getVendorDashboardGrowthDetailsByYear.{totalRestaurants,totalOrders,totalSales}` are `number[]`, 12 month labels | `dashboard.interface.ts` (`IGetVendorDashboardGrowthDetailsByYearResponseGraphQL`); `vendor/dashboard/growth-overview/index.tsx:82-95` | 12 values each; `totalSales` Float major units. |
| `getRestaurantDashboardSalesOrderCountDetailsByYear.{salesAmount,ordersCount}` are `number[]`, 12 month labels | `dashboard.interface.ts`; `restaurant/dashboard/growth-overview/index.tsx:69-82` | 12 values each. |
| `all`, `cod`, `card` are **arrays** of `{ _type, data }` | `dashboard.interface.ts` (`IDashboardOrderSalesDetailsByPaymentMethodData[]`); `restaurant-stats-table/index.tsx:69-76,95-104` | Lists, not objects. |
| `_type` is looked up in `DASHBOARD_PAYMENT_METHOD_SUB_TITLE = { all, isPickedUp, isNotPickedUp }` and `.toString()` is called on the result | `lib/utils/constants/dashboard.ts:7-11`; `useable-components/dashboard-restaurant-stats-table/index.tsx:34-38` | Any other `_type` crashes the store dashboard. Each list is exactly `[all, isPickedUp, isNotPickedUp]` in that order. |
| Order stats fall back to `stats.all?.[0]?.data` | `restaurant/dashboard/order-stats/index.tsx:57-76` | Index 0 must be the `all` entry. |
| Orders/Sales tables render `t(item.label)` and `value` (number or currency) | `useable-components/dashboard-stats-table/index.tsx:30-47` | Labels must be existing translation keys: we use `All`, `Delivery`, `Pickup` (present in every `locales/*.json`). |
| Store and vendor sub-headers send `[t('All'), t('Today'), t('Week'), t('Month'), t('Year'), 'Custom']` as `dateKeyword` | `restaurant/dashboard/sub-header/index.tsx:19-26`; `vendor/dashboard/sub-header/index.tsx:41-48` | `dateKeyword` arrives as a translated label (§3.3); `Custom` is always literal. |
| Initial state is `dateKeyword: 'All'` with a date window | `lib/ui/screens/admin/restaurant/dashboard/index.tsx:14-18`; `lib/ui/screens/admin/vendor/dashboard/index.tsx:13-17` | Dates arrive even when the keyword is not `Custom`; they are ignored then (R11). |
| Vendor initial `endDate` is built with `getMonth()` (0-based): in January it is `YYYY-00-31` | `lib/ui/screens/admin/vendor/dashboard/index.tsx:16` | Never validate dates unless the keyword is `Custom` (R11). |
| The date filter's APPLY sets `{ dateKeyword: 'Custom', startDate, endDate }` from `<input type="date">` (`YYYY-MM-DD`) | `useable-components/date-filter/index.tsx:24-30`; `useable-components/date-input/index.tsx:20-29` | Custom dates are `YYYY-MM-DD` civil dates, inclusive. |
| Vendor dashboard sends `vendorId` from localStorage `vendorId`, which for a VENDOR login is the **user id** | `lib/utils/methods/auth.ts:96-99`; `lib/context/vendor/layout-vendor.context.tsx:25` | `vendorId` is accepted as either the vendor id or the vendor's user id (R4). |
| Store dashboard sends `restaurant` from localStorage `restaurantId`; queries are disabled when it is empty | `restaurant/dashboard/order-stats/index.tsx:39-49` | `restaurant` is always a non-empty string when sent. |
| Every STAFF lands on `/home` (`DEFAULT_ROUTES.STAFF = '/home'`) and the UI shows `0` when data is missing | ref/04 §1.7; `super-admin/home/user-stats/index.tsx:36-44` | A FORBIDDEN response leaves the cards at 0; it does not log the user out (only `OwnerSession` clears the session on FORBIDDEN, ref/01 §3.1). |

### 3.2 SDL (`contracts/enatega/L9-analytics.graphql`) — complete

Rules: roots are nullable (an authorization or validation error nulls only the root); every field inside a returned object is non-null because the server always produces it (zeros, never null). No timestamps are returned. Money fields are `Float` major units converted from integer minor units with the platform currency exponent (`kernel/money.ts toMajor`). Upstream snake_case names (`total_orders`, `pickup_total_orders`, `_type`, `starting_date`, `ending_date`) are kept exactly. Type names are not observed by the admin (no fragments, no type policies on these roots), so L9 names them.

```graphql
# L9 — Dashboards & analytics (lane L9, services/api/src/modules/analytics).
# Callers: enatega-multivendor-admin lib/api/graphql/queries/dashboard/index.ts;
# enatega-singlevendor-admin sends the same documents (Wave 5, L12 gate).
# No timestamp fields. Money: Float major units from BIGINT minor units (kernel/money.ts).
# Shapes verified against lib/utils/interfaces/dashboard.interface.ts (reference/04 §2.1, §D.6).

"Platform population counts (super-admin /home cards). Soft-deleted rows are excluded."
type DashboardUsers {
  usersCount: Int!
  vendorsCount: Int!
  restaurantsCount: Int!
  ridersCount: Int!
}

"Year-over-year change of the yearly totals, in percent, rounded to 2 decimals."
type DashboardUsersPercentageChange {
  usersPercent: Float!
  vendorsPercent: Float!
  restaurantsPercent: Float!
  ridersPercent: Float!
}

"New registrations per month of the requested year. Every list has exactly 12 entries, index 0 = January (platform timezone)."
type DashboardUsersByYear {
  usersCount: [Int!]!
  vendorsCount: [Int!]!
  restaurantsCount: [Int!]!
  ridersCount: [Int!]!
  percentageChange: DashboardUsersPercentageChange!
}

"One row of the super-admin Orders/Sales tables. label is a translation key: All, Delivery or Pickup."
type DashboardTypeValue {
  value: Float!
  label: String!
}

"Store dashboard totals over delivered orders in the resolved date range."
type RestaurantDashboardOrdersSalesStats {
  totalOrders: Int!
  totalSales: Float!
  totalCODOrders: Int!
  totalCardOrders: Int!
}

"Delivered orders per month of the requested year; exactly 12 entries each, index 0 = January."
type RestaurantDashboardSalesOrderCountDetailsByYear {
  salesAmount: [Float!]!
  ordersCount: [Int!]!
}

type DashboardOrderSalesTotals {
  total_orders: Int!
  total_sales: Float!
  total_sales_without_delivery: Float!
  total_delivery_fee: Float!
}

"_type is exactly one of: all, isPickedUp, isNotPickedUp (lib/utils/constants/dashboard.ts:7-11)."
type DashboardOrderSalesTypeBreakdown {
  _type: String!
  data: DashboardOrderSalesTotals!
}

type DashboardOrderCount {
  total_orders: Int!
}

"Store dashboard breakdown. all/cod/card always contain exactly [all, isPickedUp, isNotPickedUp] in that order."
type RestaurantDashboardOrderSalesDetailsByPaymentMethod {
  total_orders: Int!
  total_sales: Float!
  total_sales_without_delivery: Float!
  total_delivery_fee: Float!
  pickup_total_orders: Int!
  delivery_total_orders: Int!
  pickup_orders: Int!
  delivery_orders: Int!
  pickup: DashboardOrderCount!
  delivery: DashboardOrderCount!
  all: [DashboardOrderSalesTypeBreakdown!]!
  cod: [DashboardOrderSalesTypeBreakdown!]!
  card: [DashboardOrderSalesTypeBreakdown!]!
}

"Vendor dashboard cards. totalRestaurants is not date-filtered; the other fields cover delivered orders in range."
type VendorDashboardStatsCardDetails {
  totalRestaurants: Int!
  totalOrders: Int!
  totalSales: Float!
  totalDeliveries: Int!
}

"Vendor growth chart; exactly 12 entries each, index 0 = January (platform timezone)."
type VendorDashboardGrowthDetailsByYear {
  totalRestaurants: [Int!]!
  totalOrders: [Int!]!
  totalSales: [Float!]!
}

extend type Query {
  # admin super-admin /home user-stats (and svadmin). Auth: ADMIN or STAFF with "Admin" (reference/04 §B; Q1).
  getDashboardUsers: DashboardUsers
  # admin /home growth-overview. Auth: ADMIN or STAFF("Admin"). year: 2000..2100.
  getDashboardUsersByYear(year: Int!): DashboardUsersByYear
  # admin /home stats-table "Orders". Auth: ADMIN or STAFF("Admin"). All time, delivered orders.
  getDashboardOrdersByType: [DashboardTypeValue!]
  # admin /home stats-table "Sales". Auth: ADMIN or STAFF("Admin"). All time, delivered orders, Float major units.
  getDashboardSalesByType: [DashboardTypeValue!]
  # svadmin store order-stats (UNUSED in multivendor admin UI). Auth: ADMIN, STAFF("Stores"), VENDOR(own store), RESTAURANT(own).
  getRestaurantDashboardOrdersSalesStats(
    restaurant: String!
    starting_date: String!
    ending_date: String!
    dateKeyword: String
  ): RestaurantDashboardOrdersSalesStats
  # admin store growth-overview. Auth: ADMIN, STAFF("Stores"), VENDOR(own store), RESTAURANT(own).
  getRestaurantDashboardSalesOrderCountDetailsByYear(restaurant: String!, year: Int!): RestaurantDashboardSalesOrderCountDetailsByYear
  # admin store order-stats and restaurant-stats-table. Auth: ADMIN, STAFF("Stores"), VENDOR(own store), RESTAURANT(own).
  getRestaurantDashboardOrderSalesDetailsByPaymentMethod(
    restaurant: String!
    starting_date: String!
    ending_date: String!
    dateKeyword: String
  ): RestaurantDashboardOrderSalesDetailsByPaymentMethod
  # admin vendor restaurant-stats. Auth: ADMIN, STAFF("Vendors"), VENDOR(own; vendorId may be the vendor's user id).
  getVendorDashboardStatsCardDetails(
    vendorId: String!
    dateKeyword: String
    starting_date: String!
    ending_date: String!
  ): VendorDashboardStatsCardDetails
  # admin vendor growth-overview. Auth: ADMIN, STAFF("Vendors"), VENDOR(own).
  getVendorDashboardGrowthDetailsByYear(vendorId: String!, year: Int!): VendorDashboardGrowthDetailsByYear
}
```

No enums and no input types are needed (every argument is a scalar). `dateKeyword` stays `String` because it is a translated label (§3.3).

### 3.3 `dateKeyword` label table (from every vendored admin locale)

Extracted from `vendor/enatega-ui/enatega-multivendor-admin/locales/*.json` (32 files: ar az bn de en es fa fr gu he hi id it jp kk km ko ku mr nl pl ps pt ro ru te th tr ur uz vi zh), keys `All`, `Today`, `Week`, `Month`, `Year`. `enatega-singlevendor-admin/locales/*.json` (31 files) has identical values for these keys. Duplicates across locales are listed once (for example `fr` "All" is the Azerbaijani "Hamısı" upstream; `pt` "All" equals `es` "Todos"; `tr`/`az` "Ay"). No label maps to two canonical keywords (checked by Task 5's test). Matching is NFC-normalized, trimmed and case-insensitive. `Custom` is matched only as the literal `Custom` (the UI never translates it). Anything else, `null`, or `""` → `All` (no date filter).

| Canonical | Labels |
|---|---|
| All | الكل, Hamısı, সব, Alle, All, Todos, همه, બધા, הכל, सभी, Semua, Tutti, すべて, Барлығы, ទាំងអស់, 모두, Hemû, सर्व, Alles, Wszystko, ټول, Toate, Все, అన్నీ, ทั้งหมด, Tümü, سب, Hammasi, Tất cả, 所有 |
| Today | اليوم, Bu gün, আজ, Heute, Today, Hoy, امروز, આજે, היום, आज, Hari Ini, Oggi, 今日, Бүгін, ថ្ងៃនេះ, 오늘, Îro, Vandaag, Dzisiaj, نن, Hoje, Astăzi, Сегодня, ఈరోజు, วันนี้, Bugün, آج, Bugun, Hôm nay, 今天 |
| Week | الأسبوع, Həftə, সপ্তাহ, Woche, Week, Semana, هفته, અઠવાડિયું, שבוע, सप्ताह, Minggu, Settimana, 週, Апта, សប្តាហ៍, 주, Hefte, आठवडा, Tydzień, اونۍ, Săptămână, Неделя, వారం, สัปดาห์, Hafta, ہفتہ, Tuần, 周 |
| Month | الشهر, Ay, মাস, Monat, Month, Mes, ماه, મહિનો, חודש, महीना, Bulan, Mese, 月, Ай, ខែ, 월, Meh, महिना, Maand, Miesiąc, میاشت, Mês, Lună, Месяц, నెల, เดือน, مہینہ, Oy, Tháng |
| Year | السنة, İl, বছর, Jahr, Year, Año, سال, વર્ષ, שנה, वर्ष, Tahun, Anno, 年, Жыл, ឆ្នាំ, 년, Sal, Jaar, Rok, کال, Ano, An, Год, సంవత్సరం, ปี, Yıl, Yil, Năm |
| Custom | `Custom` (literal) |

### 3.4 Canonical ranges (half-open `[from, to)`, platform timezone `tz`, `now` from the injected clock)

| Keyword | Range | Status |
|---|---|---|
| All | no date filter | decided (brief) |
| Today | local midnight today → local midnight tomorrow | UNVERIFIED upstream; default |
| Week | local midnight 6 days ago → local midnight tomorrow (rolling 7 days incl. today) | UNVERIFIED; default (Q3) |
| Month | first day of the current month → first day of next month | UNVERIFIED; default (Q3) |
| Year | 1 January of the current year → 1 January next year | UNVERIFIED; default |
| Custom | `starting_date` 00:00 → (`ending_date` + 1 day) 00:00, both `YYYY-MM-DD`, inclusive end, at most 1830 days | decided |

The admin's own `lib/utils/methods/date.sorter.ts:7-53` uses different, client-only semantics (Week from the previous Sunday minus 7 days, Month = previous month) for the orders screen; it is not used by any dashboard and is recorded in Q3.

### 3.5 Error strings L9 emits (none contain a reserved word, master §4.3)

| Code | Message | When |
|---|---|---|
| `UNAUTHENTICATED` (401) | `Unauthenticated` | no user token |
| `FORBIDDEN` (403) | `Forbidden` | wrong role, missing staff permission, not the owner, owner asks for an unknown id |
| `NOT_FOUND` | `Resource not found` | ADMIN/STAFF asks for an unknown store or vendor |
| `BAD_USER_INPUT` | `Invalid restaurant id` / `Invalid vendor id` | argument is not a UUID (`kernel/ids.ts parseId`) |
| `BAD_USER_INPUT` | `Invalid year` | `year` not an integer in 2000..2100 |
| `BAD_USER_INPUT` | `Invalid date` | `Custom` with a missing or non-calendar `YYYY-MM-DD` |
| `BAD_USER_INPUT` | `Invalid date range` | `Custom` with `ending_date` before `starting_date` |
| `BAD_USER_INPUT` | `Date range is too long` | `Custom` span > 1830 days |
| `BAD_USER_INPUT` | `Invalid dashboard arguments` | zod length guards (strings > 64 chars) |
| `SERVICE_UNAVAILABLE` (503) | `Service unavailable` / `Platform time zone is not configured correctly` | DB timeout or connection failure / invalid configured IANA zone |

---

## 4. Data model

### 4.1 Prisma models

**L9 owns no tables and no Prisma models.** No `prisma/schema/L9-*.prisma` file is created. Analytics is a read model over other lanes' data; L9 never writes to PostgreSQL (the pool is opened with `default_transaction_read_only=on`, proven by a test in Task 14). L9 appends no factory builders and implements no port.

### 4.2 Raw SQL — migration `services/api/prisma/migrations/202610090190_L9_init/migration.sql`

The views pin the column contract L9 depends on, so a rename in another lane breaks one migration loudly instead of silently changing numbers. Views are not diffed by Prisma (no `views` preview feature), so they cause no drift.

```sql
-- L9 analytics read model. Read-only views; L9 never writes to any table.
-- Source columns are owned by L1 ("User"), L3 ("Vendor", "Restaurant"), L6 ("Rider")
-- and L5 ("OrderSummaryView" over "Order"). See docs/CROSS_LANE_FKS.md "L9 read dependencies".

CREATE VIEW "AnalyticsUserView" AS
  SELECT "id", "type" AS "kind", "createdAt", "deletedAt" FROM "User";

CREATE VIEW "AnalyticsVendorView" AS
  SELECT "id", "userId", "createdAt", "deletedAt" FROM "Vendor";

CREATE VIEW "AnalyticsRestaurantView" AS
  SELECT "id", "vendorId", "createdAt", "deletedAt" FROM "Restaurant";

CREATE VIEW "AnalyticsRiderView" AS
  SELECT "id", "createdAt", "deletedAt" FROM "Rider";

-- Only delivered orders are sales (R8). The untyped literal coerces to the column type
-- (enum or text) so the predicate matches L5's status-leading indexes.
CREATE VIEW "AnalyticsOrderView" AS
  SELECT "id", "restaurantId", "isPickedUp", "paymentMethod", "totalMinor", "deliveryMinor", "deliveredAt"
  FROM "OrderSummaryView"
  WHERE "status" = 'DELIVERED' AND "deliveredAt" IS NOT NULL;
```

`"type" AS "kind"` and `"paymentMethod"` are exposed **without** a cast so that comparisons with untyped literals keep using the source indexes; the repository casts `"paymentMethod"::text` only in the select list.

### 4.3 Cross-lane read dependencies and index requests (append to `docs/CROSS_LANE_FKS.md`)

L9 adds **no foreign keys**. Append this section for the lead and the owning lanes:

```
## L9 read dependencies (views in 202610090190_L9_init; no FKs)
- "User"."id" uuid, "User"."type" (CUSTOMER|RIDER|RESTAURANT|VENDOR|ADMIN|STAFF), "User"."createdAt" timestamptz(3), "User"."deletedAt" timestamptz(3) NULL  — owner L1
- "Vendor"."id" uuid, "Vendor"."userId" uuid, "Vendor"."createdAt", "Vendor"."deletedAt"  — owner L3
- "Restaurant"."id" uuid, "Restaurant"."vendorId" uuid NULL, "Restaurant"."createdAt", "Restaurant"."deletedAt"  — owner L3
- "Rider"."id" uuid, "Rider"."createdAt", "Rider"."deletedAt"  — owner L6
- "OrderSummaryView"(id uuid, restaurantId uuid, userId uuid, status, isPickedUp boolean, paymentMethod, totalMinor bigint, deliveryMinor bigint, createdAt timestamptz(3), deliveredAt timestamptz(3) NULL) over "Order"  — owner L5
  Invariant requested from L5: "deliveredAt" is set in the same transaction as the DELIVERED transition and is NULL otherwise.
## L9 index requests (declared by the owning lane in its Prisma schema; names are Prisma defaults)
- L5 Order:      @@index([status, restaurantId, deliveredAt])  -> "Order_status_restaurantId_deliveredAt_idx"
- L5 Order:      @@index([status, deliveredAt])                -> "Order_status_deliveredAt_idx"
- L3 Restaurant: @@index([vendorId, createdAt])                -> "Restaurant_vendorId_createdAt_idx"
- L3 Restaurant: @@index([createdAt])                          -> "Restaurant_createdAt_idx"
- L3 Vendor:     @@index([userId])                             -> "Vendor_userId_idx"
- L3 Vendor:     @@index([createdAt])                          -> "Vendor_createdAt_idx"
- L1 User:       @@index([type, createdAt])                    -> "User_type_createdAt_idx"
- L6 Rider:      @@index([createdAt])                          -> "Rider_createdAt_idx"
```

If, when Task 2 runs, an owning lane's merged Prisma file uses a different column name for one of the source columns above, change **only** the `SELECT` expression in the view (for example `SELECT "id", "role" AS "kind", …`); the view column names, the repository and all tests stay unchanged. Record the mapping in the migration comment.

### 4.4 Requests to the lead (shared files L9 may not edit)

| # | File | Change | Needed by |
|---|---|---|---|
| L-1 | `services/api/src/kernel/ports.ts` | Add `timeZone(): Promise<string>;` to `ConfigPort` (IANA zone name of the platform; L2 implements it from configuration, default `"UTC"`). Add the same method to the kernel's `NOT_IMPLEMENTED` placeholder provider and to `test/support/fakes` config fake. | Task 10 onward |
| L-2 | `services/api/src/app.ts` | Add `AnalyticsModule.register(config)` (from `./modules/analytics/index.js`) to the root module `imports`, after `KernelModule.register(config)`. | Task 3 (end of Wave 1) |
| L-3 | `docs/CROSS_LANE_FKS.md` | Append §4.3. Forward the index requests to L1, L3, L5, L6. | W1-Z.1 |
| L-4 | W1-0.5 domain-event table | Remove "L9 (counters)" from the `order.placed` consumers (L9 keeps no counters; §7). | W1 |

---

## 5. Business rules

- **R1 — Read-only.** L9 executes only `SELECT`. Its pool sets `default_transaction_read_only=on` and `statement_timeout=2000`. No outbox events, no writes, no counters.
- **R2 — Authentication first.** Every root first resolves `await ctx.auth()`; `null` → `UNAUTHENTICATED` (HTTP 401). Ownership and validation are checked only after authentication (ownership before argument-content validation, after argument-type validation).
- **R3 — Platform dashboards** (`getDashboardUsers`, `getDashboardUsersByYear`, `getDashboardOrdersByType`, `getDashboardSalesByType`): ADMIN, or STAFF holding the permission string `Admin` (`kernel/auth/guards.ts requirePermission(auth, "Admin")`). Everyone else → `FORBIDDEN` (HTTP 403). Default chosen per reference/04 §B recommendation and the brief ("staff with permission"); the UI lets every STAFF reach `/home` and shows `0` on error (Q1).
- **R4 — Vendor dashboards** (`getVendorDashboardStatsCardDetails`, `getVendorDashboardGrowthDetailsByYear`): ADMIN; STAFF with `Vendors`; VENDOR only when the resolved vendor's id equals `auth.vendorId`. `vendorId` must be a UUID (`Invalid vendor id`) and is resolved against `AnalyticsVendorView` by `id` **or** `userId` (the admin stores the VENDOR's user id as `vendorId`, `auth.ts:96-99`; an ADMIN switching context stores the vendor `_id`). Unknown vendor: ADMIN/STAFF → `NOT_FOUND`; VENDOR → `FORBIDDEN` (no existence oracle).
- **R5 — Store dashboards** (`getRestaurantDashboard*`): ADMIN; STAFF with `Stores` (the UI guard also mentions `Restaurants`, which is not a permission code in `lib/utils/constants/permissions.ts`, so it is not accepted); VENDOR only for a store whose `vendorId` equals `auth.vendorId`; RESTAURANT only when `auth.restaurantIds` contains the store. `restaurant` must be a UUID (`Invalid restaurant id`). Unknown store: ADMIN/STAFF → `NOT_FOUND`; VENDOR/RESTAURANT → `FORBIDDEN`. A soft-deleted store remains viewable (history).
- **R6 — Any other user type** (CUSTOMER, RIDER) → `FORBIDDEN` on all nine roots.
- **R7 — Scope before cache.** Authorization runs before any cache read; the cache key contains the authorized scope (`platform`, `vendor:<vendorId>`, `restaurant:<restaurantId>`), so a cached value is only ever returned to a caller already proven to own that scope.
- **R8 — Sales definition.** An order contributes to every L9 order count and money figure **iff** its status is `DELIVERED` (pending, accepted, assigned, picked and cancelled orders contribute nothing). It is attributed to the instant `deliveredAt` (range filters and month buckets use `deliveredAt`, not `createdAt`). Source: `OrderSummaryView` (L5) via `AnalyticsOrderView`. Earnings/commission figures are L7's and are not shown by these screens (reference/04 §5).
- **R9 — Money.** `total_sales`/`totalSales`/`salesAmount[i]`/sales `value` = Σ `totalMinor` (the server-computed order total paid by the customer: items − discount + delivery + tax + tip, L5). `total_delivery_fee` = Σ `deliveryMinor`. `total_sales_without_delivery` = Σ (`totalMinor` − `deliveryMinor`). Sums are computed in SQL as `bigint`, returned as text, converted to a safe JS integer (`> 2^53` → `INTERNAL_SERVER_ERROR`) and then to major units with `toMajor(minor, exponent)` where `exponent` comes from `ConfigPort.currency()`. The platform has one currency (Q13).
- **R10 — Payment method buckets.** `cod` / `totalCODOrders` = `paymentMethod = 'COD'`; `card` / `totalCardOrders` = `paymentMethod = 'STRIPE'`. `PAYPAL` orders (none exist while D12 rejects PayPal) count only in `all`/totals.
- **R11 — Date keyword.** `dateKeyword` is mapped with the §3.3 table (NFC, trim, case-insensitive). Unknown, `null` or `""` → `All` = no date filter. `starting_date`/`ending_date` are read **only** for `Custom`; for every other keyword they are ignored even when malformed (vendor January bug `YYYY-00-31`, §3.1). For `Custom` they must be calendar dates `YYYY-MM-DD` with year 2000..2100 (`Invalid date`), `ending_date ≥ starting_date` (`Invalid date range`), span ≤ 1830 days (`Date range is too long`). Ranges per §3.4, half-open, in the platform timezone.
- **R12 — Platform timezone.** All day/month/year boundaries and month buckets use `ConfigPort.timeZone()` (request L-1). An invalid IANA zone → `SERVICE_UNAVAILABLE` "Platform time zone is not configured correctly". Store-local zones (`RestaurantForOrdering.timeZone`) are not used (Q4).
- **R13 — Monthly arrays.** Every `*ByYear` series has exactly 12 numbers, index `m-1` = calendar month `m` of `year` in the platform timezone; months without data are `0` (future months too). `year` must be an integer 2000..2100 (`Invalid year`).
- **R14 — `getDashboardUsers`.** `usersCount` = non-deleted users of type `CUSTOMER`; `vendorsCount` = non-deleted vendors; `restaurantsCount` = non-deleted stores; `ridersCount` = non-deleted riders. All-time, not date-filtered. Inactive (`isActive = false`) rows are counted; only soft-deleted rows are excluded.
- **R15 — `getDashboardUsersByYear`.** Each series = number of non-deleted entities **created** in each month of `year` (new registrations, not cumulative; UNVERIFIED, Q6). `percentageChange.<x>Percent` = (total(year) − total(year−1)) / total(year−1) × 100, rounded half-away-from-zero to 2 decimals; if total(year−1) = 0 then 100 when total(year) > 0, else 0.
- **R16 — `getDashboardOrdersByType` / `getDashboardSalesByType`.** All-time, all stores (including soft-deleted stores' history), delivered orders. Exactly three rows in this order: `{ label: "All" }`, `{ label: "Delivery" }` (`isPickedUp = false`), `{ label: "Pickup" }` (`isPickedUp = true`). Orders: `value` = count (as Float). Sales: `value` = Σ total in major units. Labels are existing translation keys in every admin locale (UNVERIFIED upstream labels, Q5).
- **R17 — `getRestaurantDashboardOrdersSalesStats`.** `totalOrders` = delivered orders of the store in range; `totalSales` = Σ total; `totalCODOrders`, `totalCardOrders` per R10.
- **R18 — `getRestaurantDashboardOrderSalesDetailsByPaymentMethod`.** Top-level totals over the store's delivered orders in range; `pickup_total_orders` = `pickup_orders` = `pickup.total_orders` = count with `isPickedUp`; `delivery_total_orders` = `delivery_orders` = `delivery.total_orders` = count without. `all`, `cod`, `card` are each exactly `[{ _type: "all" }, { _type: "isPickedUp" }, { _type: "isNotPickedUp" }]` with `DashboardOrderSalesTotals` over the method's orders (all methods / COD / STRIPE), the pickup subset and the delivery subset. Never null, zeros when empty.
- **R19 — `getRestaurantDashboardSalesOrderCountDetailsByYear`.** `salesAmount[i]` = Σ total (major units) and `ordersCount[i]` = count of the store's delivered orders delivered in month i+1 of `year`.
- **R20 — `getVendorDashboardStatsCardDetails`.** `totalRestaurants` = non-deleted stores of the vendor (not date-filtered); `totalOrders`, `totalSales`, `totalDeliveries` (= delivered orders with `isPickedUp = false`) over delivered orders in range of **all** the vendor's stores, including soft-deleted stores' history.
- **R21 — `getVendorDashboardGrowthDetailsByYear`.** `totalRestaurants[i]` = non-deleted stores of the vendor created in month i+1; `totalOrders[i]`, `totalSales[i]` = delivered orders / Σ total of the vendor's stores (including soft-deleted stores' history) delivered in month i+1.
- **R22 — Cache.** Redis key `analytics:v1:<operationName>:<scopeKey>:<sha256(parts)[0..32]>`; `parts` contain every input that changes the result: resolved range instants (so `Today` rolls over at local midnight), `year`, timezone and currency exponent. TTL 30 s (`EX 30`). Redis failures (connection, timeout, parse) are swallowed and the value is computed from PostgreSQL; the request never fails because of the cache. Values may be up to 30 s stale (documented, acceptable for dashboards).
- **R23 — Bounded, indexed queries.** Order aggregates use the `status`-leading indexes requested from L5; entity series use `createdAt` indexes (§4.3). Time windows are bounded by `year` (≤ 2 years for the users series), by `Custom` ≤ 1830 days, or are all-time aggregates served from the status index and cached. Vendor scopes use a sub-select on `AnalyticsRestaurantView` (no id-list size limit). Statement timeout 2 s → `SERVICE_UNAVAILABLE`. Proven by explain-plan tests with `enable_seqscan = off` (Task 14).
- **R24 — Arguments.** Argument names and types exactly as the admin declares them (§3.2). zod guards string lengths (`restaurant`, `vendorId` ≤ 64; dates ≤ 32; `dateKeyword` ≤ 64) → `Invalid dashboard arguments`.
- **R25 — No subscriptions, no timeouts, no worker jobs.** Dashboards are polled by the UI (`fetchPolicy: 'cache-and-network'` / `'network-only'`); nothing is published.

---

## 6. Tasks

### 6.0 Harness assumptions (single place to adapt)

The integration tests depend on Wave 0/1 harness pieces whose exact builder names are fixed by other lanes. All such calls are confined to `services/api/test/integration/analytics/support.ts`; if a merged builder differs, adapt only that file.

| Used | Expected API (W1-0.7 "insert a valid row with overridable fields, return it") |
|---|---|
| `factories(stack.pool).user({ type, permissions?, createdAt?, deletedAt? })` | L1 user row; returns `{ id }` |
| `.session({ userId })` | active `IdentitySessionFamily` row; returns `{ id }` (the kernel `SessionValidator` checks it) |
| `.vendor({ userId, createdAt?, deletedAt? })` | L3 vendor; returns `{ id }` |
| `.restaurant({ vendorId, ownerUserIds, createdAt?, deletedAt? })` | L3 store with owners; returns `{ id }` |
| `.rider({ createdAt?, deletedAt? })` | L6 rider; returns `{ id }` |
| `.order({ restaurantId, userId, status, isPickedUp, paymentMethod, totalMinor, deliveryMinor, createdAt, deliveredAt })` | L5 order; returns `{ id }` |
| `api.app.get(UserTokens, { strict: false }).issue({ sub, typ, sid })` | kernel token signer (W0-A5) |
| kernel `PRINCIPAL_LOADER` | returns `permissions` (STAFF), `vendorId` (VENDOR), `restaurantIds` (RESTAURANT) for the seeded rows (L1) |
| `vi.spyOn(api.app.get(CONFIG_PORT), "currency" | "timeZone")` | test double for the L2 port (master §7 "fakes for ports"); pins exponent and zone |
| `vi.spyOn(api.app.get(ANALYTICS_CLOCK), "now")` | pins `now` for keyword ranges |

---

Conventions for every task: run commands from `implementation/`. Unit: `pnpm --filter @fairbite/api exec vitest run <file>`. Integration: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts <file>` (Docker required, master §10). Every commit message ends with the session attribution line (master §4.8). Branches: `wave1/L9-schema` for Tasks 1–3, `wave2/L9-analytics` for Tasks 4–15.

### Wave 1 (W1-L9)

#### Task 1: L9 SDL

**Files:**
- Modify (lane-owned after W1-0.3): `contracts/enatega/L9-analytics.graphql`
- Test: `services/api/test/unit/analytics/sdl.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/sdl.spec.ts
import { describe, expect, it } from "vitest";
import { buildSchema, parse, validate, type GraphQLObjectType } from "graphql";
import { loadTypeDefs } from "../../../src/kernel/schema.js";
import { doc } from "../../support/documents.js";

const schema = buildSchema(loadTypeDefs().join("\n"));
const FILE = "lib/api/graphql/queries/dashboard/index.ts";
const DOCUMENTS = [
  "GET_DASHBOARD_USERS",
  "GET_DASHBOARD_USERS_BY_YEAR",
  "GET_DASHBOARD_ORDERS_BY_TYPE",
  "GET_DASHBOARD_SALES_BY_TYPE",
  "GET_DASHBOARD_RESTAURANT_ORDERS",
  "GET_DASHBOARD_RESTAURANT_SALES_ORDER_COUNT_DETAILS_BY_YEAR",
  "GET_RESTAURANT_DASHBOARD_ORDER_SALES_DETAILS_BY_PAYMENT_METHOD",
  "GET_VENDOR_DASHBOARD_STATS_CARD_DETAILS",
  "GET_VENDOR_DASHBOARD_GROWTH_DETAILS_BY_YEAR",
] as const;

const fields = (name: string) => (schema.getType(name) as GraphQLObjectType).getFields();
const typeOf = (type: string, field: string) => String(fields(type)[field].type);
const args = (root: string) =>
  Object.fromEntries(schema.getQueryType()!.getFields()[root].args.map((a) => [a.name, String(a.type)]));

describe("L9 analytics SDL", () => {
  it.each(DOCUMENTS)("validates the admin document %s", (name) => {
    expect(validate(schema, parse(doc("enatega-multivendor-admin", FILE, name)))).toEqual([]);
  });

  it("declares every monthly series as a non-null list of non-null numbers", () => {
    for (const field of ["usersCount", "vendorsCount", "restaurantsCount", "ridersCount"])
      expect(typeOf("DashboardUsersByYear", field)).toBe("[Int!]!");
    expect(typeOf("RestaurantDashboardSalesOrderCountDetailsByYear", "salesAmount")).toBe("[Float!]!");
    expect(typeOf("RestaurantDashboardSalesOrderCountDetailsByYear", "ordersCount")).toBe("[Int!]!");
    expect(typeOf("VendorDashboardGrowthDetailsByYear", "totalRestaurants")).toBe("[Int!]!");
    expect(typeOf("VendorDashboardGrowthDetailsByYear", "totalOrders")).toBe("[Int!]!");
    expect(typeOf("VendorDashboardGrowthDetailsByYear", "totalSales")).toBe("[Float!]!");
  });

  it("returns all, cod and card as lists of _type/data breakdowns", () => {
    for (const key of ["all", "cod", "card"])
      expect(typeOf("RestaurantDashboardOrderSalesDetailsByPaymentMethod", key)).toBe("[DashboardOrderSalesTypeBreakdown!]!");
    expect(typeOf("DashboardOrderSalesTypeBreakdown", "_type")).toBe("String!");
    expect(typeOf("DashboardOrderSalesTotals", "total_sales_without_delivery")).toBe("Float!");
  });

  it("keeps the argument names and types the admin declares", () => {
    expect(args("getDashboardUsers")).toEqual({});
    expect(args("getDashboardUsersByYear")).toEqual({ year: "Int!" });
    expect(args("getDashboardOrdersByType")).toEqual({});
    expect(args("getDashboardSalesByType")).toEqual({});
    const range = { starting_date: "String!", ending_date: "String!", dateKeyword: "String" };
    expect(args("getRestaurantDashboardOrdersSalesStats")).toEqual({ restaurant: "String!", ...range });
    expect(args("getRestaurantDashboardOrderSalesDetailsByPaymentMethod")).toEqual({ restaurant: "String!", ...range });
    expect(args("getRestaurantDashboardSalesOrderCountDetailsByYear")).toEqual({ restaurant: "String!", year: "Int!" });
    expect(args("getVendorDashboardStatsCardDetails")).toEqual({ vendorId: "String!", ...range });
    expect(args("getVendorDashboardGrowthDetailsByYear")).toEqual({ vendorId: "String!", year: "Int!" });
  });

  it("makes the roots nullable so an error nulls only the root", () => {
    const roots = schema.getQueryType()!.getFields();
    expect(String(roots.getDashboardUsers.type)).toBe("DashboardUsers");
    expect(String(roots.getDashboardOrdersByType.type)).toBe("[DashboardTypeValue!]");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/sdl.spec.ts`. Expected: FAIL — the generated SDL uses generator names (e.g. no `DashboardOrderSalesTypeBreakdown`) and generic leaf types.
- [ ] **Step 3: Implement** — replace the contents of `contracts/enatega/L9-analytics.graphql` with the SDL in §3.2 verbatim. Remove any L9 entries from `docs/SDL_TYPE_REVIEW.md` that this resolves (lead-owned file: list them in the handoff instead of editing). Run `pnpm codegen`.
- [ ] **Step 4: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/sdl.spec.ts && pnpm check:enatega && pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/contract/all-operations.integration.spec.ts`. Expected: PASS (13 tests); `staticCompatibility: PASS`; contract test green (L9 roots still return `NOT_IMPLEMENTED`).
- [ ] **Step 5: Commit** `git add contracts/enatega/L9-analytics.graphql services/api/test/unit/analytics/sdl.spec.ts packages/api-contracts && git commit -m "feat(L9): define dashboard SDL with verified monthly and breakdown shapes"`

#### Task 2: Analytics views migration

**Files:**
- Create: `services/api/prisma/migrations/202610090190_L9_init/migration.sql`
- Test: `services/api/test/integration/analytics/views.integration.spec.ts`

This task goes green only on the integration branch after the L1, L3, L5 and L6 Wave 1 migrations are merged (migrations apply in timestamp order; `…0190` runs last).

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/integration/analytics/views.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";
import { factories } from "../../support/factories.js";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => stack?.stop());
beforeEach(async () => stack.reset());

describe("L9 analytics views", () => {
  it("creates the five read-only views with the documented columns", async () => {
    const { rows } = await stack.pool.query(
      `SELECT table_name::text AS "view", array_agg(column_name::text ORDER BY column_name::text COLLATE "C") AS "columns"
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name::text LIKE 'Analytics%View'
        GROUP BY table_name ORDER BY table_name::text COLLATE "C"`,
    );
    expect(rows).toEqual([
      { view: "AnalyticsOrderView", columns: ["deliveredAt", "deliveryMinor", "id", "isPickedUp", "paymentMethod", "restaurantId", "totalMinor"] },
      { view: "AnalyticsRestaurantView", columns: ["createdAt", "deletedAt", "id", "vendorId"] },
      { view: "AnalyticsRiderView", columns: ["createdAt", "deletedAt", "id"] },
      { view: "AnalyticsUserView", columns: ["createdAt", "deletedAt", "id", "kind"] },
      { view: "AnalyticsVendorView", columns: ["createdAt", "deletedAt", "id", "userId"] },
    ]);
  });

  it("exposes only delivered orders and keeps soft-deleted stores for history", async () => {
    const f = factories(stack.pool);
    const customer = await f.user({ type: "CUSTOMER" });
    const vendorUser = await f.user({ type: "VENDOR" });
    const vendor = await f.vendor({ userId: vendorUser.id });
    const store = await f.restaurant({ vendorId: vendor.id, ownerUserIds: [], deletedAt: new Date("2026-04-02T00:00:00Z") });
    const base = { restaurantId: store.id, userId: customer.id, isPickedUp: false, paymentMethod: "COD", totalMinor: 1000, deliveryMinor: 100 };
    const delivered = await f.order({ ...base, status: "DELIVERED", createdAt: new Date("2026-04-01T10:00:00Z"), deliveredAt: new Date("2026-04-01T10:30:00Z") });
    await f.order({ ...base, status: "CANCELLED", createdAt: new Date("2026-04-01T11:00:00Z"), deliveredAt: null });
    await f.order({ ...base, status: "PENDING", createdAt: new Date("2026-04-01T12:00:00Z"), deliveredAt: null });

    const orders = await stack.pool.query(`SELECT "id", "paymentMethod"::text AS "paymentMethod", "totalMinor"::text AS "totalMinor" FROM "AnalyticsOrderView"`);
    expect(orders.rows).toEqual([{ id: delivered.id, paymentMethod: "COD", totalMinor: "1000" }]);
    const stores = await stack.pool.query(`SELECT "id", "vendorId", "deletedAt" IS NOT NULL AS "deleted" FROM "AnalyticsRestaurantView"`);
    expect(stores.rows).toEqual([{ id: store.id, vendorId: vendor.id, deleted: true }]);
    const kinds = await stack.pool.query(`SELECT "kind"::text AS "kind" FROM "AnalyticsUserView" ORDER BY 1`);
    expect(kinds.rows.map((r) => r.kind)).toEqual(["CUSTOMER", "VENDOR"]);
  });

  it("has every index the analytics queries rely on (requested from L1, L3, L5, L6)", async () => {
    const { rows } = await stack.pool.query(`SELECT indexname::text AS "name" FROM pg_indexes WHERE schemaname = 'public'`);
    const names = new Set(rows.map((r) => r.name));
    for (const name of [
      "Order_status_restaurantId_deliveredAt_idx",
      "Order_status_deliveredAt_idx",
      "Restaurant_vendorId_createdAt_idx",
      "Restaurant_createdAt_idx",
      "Vendor_userId_idx",
      "Vendor_createdAt_idx",
      "User_type_createdAt_idx",
      "Rider_createdAt_idx",
    ])
      expect(names.has(name), name).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/analytics/views.integration.spec.ts`. Expected: FAIL — `AnalyticsOrderView` does not exist (empty `rows`), and the third test lists the missing index names until the owning lanes merge them.
- [ ] **Step 3: Implement** — create `services/api/prisma/migrations/202610090190_L9_init/migration.sql` with the SQL in §4.2 verbatim. Before saving, open the merged `prisma/schema/L1-identity.prisma`, `L3-vendors-catalog.prisma`, `L5-orders.prisma`, `L6-dispatch.prisma` and confirm each source column in §4.3; adapt only `SELECT` expressions as §4.3 describes. Send the index list (§4.3) to the lead for L1/L3/L5/L6.
- [ ] **Step 4: Run** the Step 2 command and `pnpm --filter @fairbite/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code`. Expected: 3 PASS; no drift (views are ignored by Prisma; the indexes are declared by their owners).
- [ ] **Step 5: Commit** `git add services/api/prisma/migrations/202610090190_L9_init services/api/test/integration/analytics/views.integration.spec.ts && git commit -m "feat(L9): add read-only analytics views over identity, vendor, rider and order data"`

#### Task 3: Module skeleton (read-only pool, cache client, clock)

**Files:**
- Create: `services/api/src/modules/analytics/module.ts`, `services/api/src/modules/analytics/index.ts`
- Test: `services/api/test/unit/analytics/module.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/module.spec.ts
import { describe, expect, it, vi } from "vitest";
import { AnalyticsLifecycle, AnalyticsModule, ANALYTICS_CLOCK, ANALYTICS_POOL, ANALYTICS_REDIS, readOnlyPoolConfig } from "../../../src/modules/analytics/module.js";

describe("AnalyticsModule", () => {
  it("registers the read-only pool, the cache client and the clock", () => {
    const dynamic = AnalyticsModule.register({ DATABASE_URL: "postgresql://x@127.0.0.1:1/x", REDIS_URL: "redis://127.0.0.1:1" });
    const tokens = (dynamic.providers ?? []).map((p) => (typeof p === "function" ? p : (p as { provide: unknown }).provide));
    expect(tokens).toEqual(expect.arrayContaining([ANALYTICS_POOL, ANALYTICS_REDIS, ANALYTICS_CLOCK, AnalyticsLifecycle]));
    expect(dynamic.module).toBe(AnalyticsModule);
  });
  it("opens PostgreSQL sessions read-only with a statement timeout", () => {
    expect(readOnlyPoolConfig("postgresql://x@h/db")).toMatchObject({
      connectionString: "postgresql://x@h/db",
      options: "-c default_transaction_read_only=on",
      statement_timeout: 2000,
      max: 4,
    });
  });
  it("closes the pool and the cache client on shutdown", async () => {
    const pool = { end: vi.fn().mockResolvedValue(undefined) };
    const redis = { disconnect: vi.fn() };
    await new AnalyticsLifecycle(pool as never, redis as never).onApplicationShutdown();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(redis.disconnect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/module.spec.ts`. Expected: FAIL — module not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/module.ts
import { Inject, Module, type DynamicModule, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { Pool, type PoolConfig } from "pg";
import { Redis } from "ioredis";
import type { Config } from "../../config.js";
import { systemClock, type Clock } from "../../kernel/time.js";

export const ANALYTICS_POOL = Symbol("ANALYTICS_POOL");
export const ANALYTICS_REDIS = Symbol("ANALYTICS_REDIS");
export const ANALYTICS_CLOCK = Symbol("ANALYTICS_CLOCK");

// R1: L9 never writes. Every session is read-only and bounded (R23).
export function readOnlyPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: 4,
    connectionTimeoutMillis: 1000,
    statement_timeout: 2000,
    options: "-c default_transaction_read_only=on",
  };
}

export class AnalyticsLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(ANALYTICS_POOL) private readonly pool: Pick<Pool, "end">,
    @Inject(ANALYTICS_REDIS) private readonly redis: Pick<Redis, "disconnect">,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
    await this.pool.end();
  }
}

export function infrastructureProviders(config: Pick<Config, "DATABASE_URL" | "REDIS_URL">): Provider[] {
  return [
    {
      provide: ANALYTICS_POOL,
      useFactory: () => {
        const pool = new Pool(readOnlyPoolConfig(config.DATABASE_URL));
        pool.on("error", () => {});
        return pool;
      },
    },
    {
      provide: ANALYTICS_REDIS,
      useFactory: () => {
        // The cache is best-effort (R22): fail fast, never queue, reconnect in the background.
        const redis = new Redis(config.REDIS_URL, {
          connectTimeout: 500,
          commandTimeout: 200,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        redis.on("error", () => {});
        return redis;
      },
    },
    // A plain object so tests can pin `now` with vi.spyOn (Task 11+).
    { provide: ANALYTICS_CLOCK, useValue: { now: () => systemClock.now() } satisfies Clock },
    AnalyticsLifecycle,
  ];
}

@Module({})
export class AnalyticsModule {
  static register(config: Pick<Config, "DATABASE_URL" | "REDIS_URL">): DynamicModule {
    return { module: AnalyticsModule, providers: [...infrastructureProviders(config)] };
  }
}
```

```ts
// services/api/src/modules/analytics/index.ts
// L9 implements no cross-lane port; this is the module's public entry for app.ts.
export { AnalyticsModule } from "./module.js";
```

Send request L-2 (§4.4) to the lead so `app.ts` imports `AnalyticsModule.register(config)`.

- [ ] **Step 4: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/module.spec.ts && pnpm typecheck`. Expected: PASS (3 tests); typecheck clean.
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics services/api/test/unit/analytics/module.spec.ts && git commit -m "feat(L9): add analytics module with read-only pool, cache client and clock"`

### Wave 2 (W2-L9) — pure building blocks

#### Task 4: Timezone helpers

**Files:**
- Create: `services/api/src/modules/analytics/zoned-time.ts`
- Test: `services/api/test/unit/analytics/zoned-time.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/zoned-time.spec.ts
import { describe, expect, it } from "vitest";
import { assertTimeZone, civilDate, offsetMs, startOfCivilDay } from "../../../src/modules/analytics/zoned-time.js";

describe("zoned time", () => {
  it("reads the civil date of an instant in a zone", () => {
    const instant = new Date("2026-01-31T23:30:00Z");
    expect(civilDate(instant, "UTC")).toEqual({ year: 2026, month: 1, day: 31 });
    expect(civilDate(instant, "Europe/Berlin")).toEqual({ year: 2026, month: 2, day: 1 });
  });
  it("computes offsets east-positive", () => {
    expect(offsetMs(new Date("2026-06-15T12:00:00Z"), "Asia/Kolkata")).toBe(19_800_000);
    expect(offsetMs(new Date("2026-06-15T12:00:00Z"), "America/New_York")).toBe(-14_400_000);
  });
  it("finds local midnight, including on DST change days", () => {
    expect(startOfCivilDay(2026, 6, 15, "UTC").toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(startOfCivilDay(2026, 6, 15, "America/New_York").toISOString()).toBe("2026-06-15T04:00:00.000Z");
    expect(startOfCivilDay(2026, 1, 1, "Asia/Kolkata").toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(startOfCivilDay(2026, 3, 29, "Europe/Berlin").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfCivilDay(2026, 10, 25, "Europe/Berlin").toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
  it("normalises month and day overflow", () => {
    expect(startOfCivilDay(2026, 13, 1, "UTC").toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(startOfCivilDay(2026, 6, 15 - 6, "UTC").toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(startOfCivilDay(2026, 3, 0, "UTC").toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
  it("rejects an invalid configured zone with SERVICE_UNAVAILABLE", () => {
    expect(assertTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(() => assertTimeZone("Mars/Base")).toThrow(
      expect.objectContaining({ message: "Platform time zone is not configured correctly", extensions: { code: "SERVICE_UNAVAILABLE" } }),
    );
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/zoned-time.spec.ts`. Expected: FAIL — module not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/zoned-time.ts
import { appError } from "../../kernel/errors.js";

export type CivilDate = { year: number; month: number; day: number };
type WallClock = CivilDate & { hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    throw appError("SERVICE_UNAVAILABLE", "Platform time zone is not configured correctly");
  }
  formatters.set(timeZone, created);
  return created;
}

export function assertTimeZone(timeZone: string): string {
  formatter(timeZone);
  return timeZone;
}

function wallClock(at: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at))
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  return parts as WallClock;
}

// Offset of `timeZone` from UTC at instant `at`, in milliseconds (east positive).
export function offsetMs(at: Date, timeZone: string): number {
  const wall = wallClock(at, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - (at.getTime() - at.getUTCMilliseconds());
}

export function civilDate(at: Date, timeZone: string): CivilDate {
  const wall = wallClock(at, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

// Instant of local midnight at the start of a civil day. Month and day may overflow or
// underflow (month 13, day 0, day 15 - 6); Date.UTC normalises them. Two passes settle
// the offset on DST change days.
export function startOfCivilDay(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (5 tests).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/zoned-time.ts services/api/test/unit/analytics/zoned-time.spec.ts && git commit -m "feat(L9): add platform-timezone civil date helpers"`

#### Task 5: Localized `dateKeyword` table

**Files:**
- Create: `services/api/src/modules/analytics/date-keywords.ts`
- Test: `services/api/test/unit/analytics/date-keywords.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/date-keywords.spec.ts
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalKeyword, DATE_KEYWORD_LABELS, normaliseLabel } from "../../../src/modules/analytics/date-keywords.js";

const KEYS = ["All", "Today", "Week", "Month", "Year"] as const;
const localeDirs = ["enatega-multivendor-admin", "enatega-singlevendor-admin"].map((app) =>
  fileURLToPath(new URL(`../../../../../vendor/enatega-ui/${app}/locales/`, import.meta.url)),
);

describe("dateKeyword labels", () => {
  it("maps every label of every vendored admin locale back to its canonical keyword", () => {
    let checked = 0;
    for (const dir of localeDirs)
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const messages = JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as Record<string, unknown>;
        for (const key of KEYS) {
          expect(typeof messages[key], `${file} ${key}`).toBe("string");
          expect(canonicalKeyword(messages[key] as string), `${file} ${key}`).toBe(key);
          checked++;
        }
      }
    expect(checked).toBe((32 + 31) * 5);
  });
  it("never maps one label to two keywords", () => {
    const seen = new Map<string, string>();
    for (const [canonical, labels] of Object.entries(DATE_KEYWORD_LABELS))
      for (const label of labels) {
        const key = normaliseLabel(label);
        expect(seen.get(key) ?? canonical, label).toBe(canonical);
        seen.set(key, canonical);
      }
  });
  it("matches Custom only as the literal, case-insensitively and trimmed", () => {
    expect(canonicalKeyword("Custom")).toBe("Custom");
    expect(canonicalKeyword("  custom ")).toBe("Custom");
    expect(canonicalKeyword("مخصص")).toBe("All");
  });
  it("normalises case and Unicode composition", () => {
    expect(canonicalKeyword("TODAY")).toBe("Today");
    expect(canonicalKeyword("Año")).toBe("Year");
    expect(canonicalKeyword(" السنة ")).toBe("Year");
  });
  it("treats unknown, empty and missing keywords as All (no filter)", () => {
    expect(canonicalKeyword("Fortnight")).toBe("All");
    expect(canonicalKeyword("")).toBe("All");
    expect(canonicalKeyword(null)).toBe("All");
    expect(canonicalKeyword(undefined)).toBe("All");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/date-keywords.spec.ts`. Expected: FAIL — module not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/date-keywords.ts
// The admin sends t('All') … t('Year') as dateKeyword (restaurant/dashboard/sub-header/index.tsx:19-26,
// vendor/dashboard/sub-header/index.tsx:41-48). Labels copied from
// vendor/enatega-ui/enatega-multivendor-admin/locales/*.json (32 locales; singlevendor-admin identical).
// date-keywords.spec.ts re-reads the locale files so this table cannot drift.
export type CanonicalKeyword = "All" | "Today" | "Week" | "Month" | "Year" | "Custom";

export const DATE_KEYWORD_LABELS: Record<Exclude<CanonicalKeyword, "Custom">, readonly string[]> = {
  All: [
    "الكل", "Hamısı", "সব", "Alle", "All", "Todos", "همه", "બધા", "הכל", "सभी", "Semua", "Tutti", "すべて", "Барлығы", "ទាំងអស់",
    "모두", "Hemû", "सर्व", "Alles", "Wszystko", "ټول", "Toate", "Все", "అన్నీ", "ทั้งหมด", "Tümü", "سب", "Hammasi", "Tất cả", "所有",
  ],
  Today: [
    "اليوم", "Bu gün", "আজ", "Heute", "Today", "Hoy", "امروز", "આજે", "היום", "आज", "Hari Ini", "Oggi", "今日", "Бүгін", "ថ្ងៃនេះ",
    "오늘", "Îro", "Vandaag", "Dzisiaj", "نن", "Hoje", "Astăzi", "Сегодня", "ఈరోజు", "วันนี้", "Bugün", "آج", "Bugun", "Hôm nay", "今天",
  ],
  Week: [
    "الأسبوع", "Həftə", "সপ্তাহ", "Woche", "Week", "Semana", "هفته", "અઠવાડિયું", "שבוע", "सप्ताह", "Minggu", "Settimana", "週", "Апта",
    "សប្តាហ៍", "주", "Hefte", "आठवडा", "Tydzień", "اونۍ", "Săptămână", "Неделя", "వారం", "สัปดาห์", "Hafta", "ہفتہ", "Tuần", "周",
  ],
  Month: [
    "الشهر", "Ay", "মাস", "Monat", "Month", "Mes", "ماه", "મહિનો", "חודש", "महीना", "Bulan", "Mese", "月", "Ай", "ខែ", "월", "Meh",
    "महिना", "Maand", "Miesiąc", "میاشت", "Mês", "Lună", "Месяц", "నెల", "เดือน", "مہینہ", "Oy", "Tháng",
  ],
  Year: [
    "السنة", "İl", "বছর", "Jahr", "Year", "Año", "سال", "વર્ષ", "שנה", "वर्ष", "Tahun", "Anno", "年", "Жыл", "ឆ្នាំ", "년", "Sal", "Jaar",
    "Rok", "کال", "Ano", "An", "Год", "సంవత్సరం", "ปี", "Yıl", "Yil", "Năm",
  ],
};

export const normaliseLabel = (value: string): string => value.normalize("NFC").trim().toLowerCase();

const lookup = new Map<string, CanonicalKeyword>([["custom", "Custom"]]);
for (const [canonical, labels] of Object.entries(DATE_KEYWORD_LABELS) as [CanonicalKeyword, readonly string[]][])
  for (const label of labels) lookup.set(normaliseLabel(label), canonical);

// R11: unknown, empty or missing → All (no date filter).
export function canonicalKeyword(value: string | null | undefined): CanonicalKeyword {
  if (typeof value !== "string") return "All";
  return lookup.get(normaliseLabel(value)) ?? "All";
}
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (5 tests; 315 locale labels checked).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/date-keywords.ts services/api/test/unit/analytics/date-keywords.spec.ts && git commit -m "feat(L9): map every translated dateKeyword label to canonical keywords"`

#### Task 6: Date ranges and year validation

**Files:**
- Create: `services/api/src/modules/analytics/date-range.ts`
- Test: `services/api/test/unit/analytics/date-range.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/date-range.spec.ts
import { describe, expect, it } from "vitest";
import { parseYear, resolveDateRange, type DateRange } from "../../../src/modules/analytics/date-range.js";

const now = new Date("2026-06-15T12:00:00Z");
const iso = (range: DateRange) => (range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null);
const bad = (message: string) => expect.objectContaining({ message, extensions: { code: "BAD_USER_INPUT" } });

describe("resolveDateRange", () => {
  it.each([
    ["Today", "2026-06-15T00:00:00.000Z", "2026-06-16T00:00:00.000Z"],
    ["Week", "2026-06-09T00:00:00.000Z", "2026-06-16T00:00:00.000Z"],
    ["Month", "2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"],
    ["Year", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
    ["اليوم", "2026-06-15T00:00:00.000Z", "2026-06-16T00:00:00.000Z"],
  ])("resolves %s in UTC", (dateKeyword, from, to) => {
    expect(iso(resolveDateRange({ dateKeyword }, now, "UTC"))).toEqual({ from, to });
  });
  it("returns no filter for All, unknown, empty and missing keywords", () => {
    for (const dateKeyword of ["All", "Hamısı", "Fortnight", "", null, undefined])
      expect(resolveDateRange({ dateKeyword, starting_date: "2026-01-01", ending_date: "2026-06-30" }, now, "UTC")).toBeNull();
  });
  it("ignores malformed dates unless the keyword is Custom (vendor January defect)", () => {
    expect(resolveDateRange({ dateKeyword: "All", starting_date: "2026-01-01", ending_date: "2026-00-31" }, now, "UTC")).toBeNull();
    expect(iso(resolveDateRange({ dateKeyword: "Year", starting_date: "x", ending_date: "Thu Oct 08 2026" }, now, "UTC"))?.from).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
  it("uses the platform timezone for day boundaries", () => {
    expect(iso(resolveDateRange({ dateKeyword: "Today" }, now, "Europe/Berlin"))).toEqual({
      from: "2026-06-14T22:00:00.000Z",
      to: "2026-06-15T22:00:00.000Z",
    });
    expect(iso(resolveDateRange({ dateKeyword: "Today" }, new Date("2026-06-15T22:30:00Z"), "Europe/Berlin"))).toEqual({
      from: "2026-06-15T22:00:00.000Z",
      to: "2026-06-16T22:00:00.000Z",
    });
  });
  it("resolves Custom as inclusive civil dates", () => {
    expect(iso(resolveDateRange({ dateKeyword: "Custom", starting_date: "2026-03-01", ending_date: "2026-03-31" }, now, "UTC"))).toEqual({
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    });
    expect(iso(resolveDateRange({ dateKeyword: "Custom", starting_date: "2026-06-12", ending_date: "2026-06-12" }, now, "Asia/Kolkata"))).toEqual({
      from: "2026-06-11T18:30:00.000Z",
      to: "2026-06-12T18:30:00.000Z",
    });
  });
  it("validates Custom dates", () => {
    const custom = (starting_date: unknown, ending_date: unknown) => () =>
      resolveDateRange({ dateKeyword: "Custom", starting_date: starting_date as string, ending_date: ending_date as string }, now, "UTC");
    expect(custom("2026-02-30", "2026-03-01")).toThrow(bad("Invalid date"));
    expect(custom("Thu Oct 08 2026", "2026-10-09")).toThrow(bad("Invalid date"));
    expect(custom(null, "2026-10-09")).toThrow(bad("Invalid date"));
    expect(custom("1999-12-31", "2000-01-01")).toThrow(bad("Invalid date"));
    expect(custom("2026-03-02", "2026-03-01")).toThrow(bad("Invalid date range"));
    expect(custom("2021-01-01", "2026-01-05")).toThrow(bad("Date range is too long"));
    expect(custom("2021-01-01", "2026-01-04")).not.toThrow();
  });
});

describe("parseYear", () => {
  it("accepts integers from 2000 to 2100", () => {
    expect(parseYear(2000)).toBe(2000);
    expect(parseYear(2026)).toBe(2026);
    expect(parseYear(2100)).toBe(2100);
  });
  it("rejects anything else with Invalid year", () => {
    for (const year of [1999, 2101, 2026.5, Number.NaN, "2026"]) expect(() => parseYear(year)).toThrow(bad("Invalid year"));
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/date-range.spec.ts`. Expected: FAIL — module not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/date-range.ts
import { appError } from "../../kernel/errors.js";
import { canonicalKeyword } from "./date-keywords.js";
import { civilDate, startOfCivilDay, type CivilDate } from "./zoned-time.js";

// Half-open [from, to) in UTC instants; null = no date filter.
export type DateRange = { from: Date; to: Date } | null;
export type DateRangeInput = { dateKeyword?: string | null; starting_date?: string | null; ending_date?: string | null };

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
export const MAX_CUSTOM_RANGE_DAYS = 1830;
const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYear(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_YEAR || value > MAX_YEAR)
    throw appError("BAD_USER_INPUT", "Invalid year");
  return value;
}

export function parseCivilDate(value: unknown): CivilDate {
  const match = typeof value === "string" ? YMD.exec(value.trim()) : null;
  if (!match) throw appError("BAD_USER_INPUT", "Invalid date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (year < MIN_YEAR || year > MAX_YEAR || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day)
    throw appError("BAD_USER_INPUT", "Invalid date");
  return { year, month, day };
}

const dayNumber = (date: CivilDate) => Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;

// R11 and reference §3.4. Dates are read only for Custom.
export function resolveDateRange(input: DateRangeInput, now: Date, timeZone: string): DateRange {
  const keyword = canonicalKeyword(input.dateKeyword);
  if (keyword === "All") return null;
  if (keyword === "Custom") {
    const start = parseCivilDate(input.starting_date);
    const end = parseCivilDate(input.ending_date);
    const days = dayNumber(end) - dayNumber(start) + 1;
    if (days < 1) throw appError("BAD_USER_INPUT", "Invalid date range");
    if (days > MAX_CUSTOM_RANGE_DAYS) throw appError("BAD_USER_INPUT", "Date range is too long");
    return {
      from: startOfCivilDay(start.year, start.month, start.day, timeZone),
      to: startOfCivilDay(end.year, end.month, end.day + 1, timeZone),
    };
  }
  const today = civilDate(now, timeZone);
  const at = (year: number, month: number, day: number) => startOfCivilDay(year, month, day, timeZone);
  switch (keyword) {
    case "Today":
      return { from: at(today.year, today.month, today.day), to: at(today.year, today.month, today.day + 1) };
    case "Week":
      return { from: at(today.year, today.month, today.day - 6), to: at(today.year, today.month, today.day + 1) };
    case "Month":
      return { from: at(today.year, today.month, 1), to: at(today.year, today.month + 1, 1) };
    case "Year":
      return { from: at(today.year, 1, 1), to: at(today.year + 1, 1, 1) };
  }
}
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (13 tests).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/date-range.ts services/api/test/unit/analytics/date-range.spec.ts && git commit -m "feat(L9): resolve dashboard date keywords and custom ranges in the platform timezone"`

#### Task 7: Mappers (aggregates → GraphQL shapes)

**Files:**
- Create: `services/api/src/modules/analytics/mappers.ts`
- Test: `services/api/test/unit/analytics/mappers.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/mappers.spec.ts
import { describe, expect, it } from "vitest";
import {
  anyMethod, breakdown, isCard, isCod, isDelivery, isPickup, months, percentChange, salesTotals, totalsOf, typeValues, type OrderGroup,
} from "../../../src/modules/analytics/mappers.js";

// Store R1 "All" from the integration dataset (Task 11).
const groups: OrderGroup[] = [
  { isPickedUp: false, paymentMethod: "COD", orders: 2, totalMinor: 3500, deliveryMinor: 500 },
  { isPickedUp: true, paymentMethod: "COD", orders: 1, totalMinor: 1500, deliveryMinor: 0 },
  { isPickedUp: true, paymentMethod: "STRIPE", orders: 1, totalMinor: 1800, deliveryMinor: 0 },
  { isPickedUp: false, paymentMethod: "STRIPE", orders: 1, totalMinor: 4000, deliveryMinor: 500 },
];

describe("analytics mappers", () => {
  it("sums groups with any combination of filters", () => {
    expect(totalsOf(groups)).toEqual({ orders: 5, totalMinor: 10800, deliveryMinor: 1000 });
    expect(totalsOf(groups, isCod, isDelivery)).toEqual({ orders: 2, totalMinor: 3500, deliveryMinor: 500 });
    expect(totalsOf(groups, isCard, isPickup)).toEqual({ orders: 1, totalMinor: 1800, deliveryMinor: 0 });
    expect(totalsOf([], isCod)).toEqual({ orders: 0, totalMinor: 0, deliveryMinor: 0 });
  });
  it("converts minor units with the configured exponent", () => {
    expect(salesTotals({ orders: 5, totalMinor: 10800, deliveryMinor: 1000 }, 2)).toEqual({
      total_orders: 5, total_sales: 108, total_sales_without_delivery: 98, total_delivery_fee: 10,
    });
    expect(salesTotals({ orders: 1, totalMinor: 1250, deliveryMinor: 250 }, 3).total_sales).toBe(1.25);
    expect(salesTotals({ orders: 1, totalMinor: 1250, deliveryMinor: 250 }, 0).total_sales_without_delivery).toBe(1000);
  });
  it("builds the all/isPickedUp/isNotPickedUp breakdown in the order the admin indexes", () => {
    const cod = breakdown(groups, isCod, 2);
    expect(cod.map((entry) => entry._type)).toEqual(["all", "isPickedUp", "isNotPickedUp"]);
    expect(cod).toEqual([
      { _type: "all", data: { total_orders: 3, total_sales: 50, total_sales_without_delivery: 45, total_delivery_fee: 5 } },
      { _type: "isPickedUp", data: { total_orders: 1, total_sales: 15, total_sales_without_delivery: 15, total_delivery_fee: 0 } },
      { _type: "isNotPickedUp", data: { total_orders: 2, total_sales: 35, total_sales_without_delivery: 30, total_delivery_fee: 5 } },
    ]);
    expect(breakdown([], anyMethod, 2)[2]).toEqual({
      _type: "isNotPickedUp", data: { total_orders: 0, total_sales: 0, total_sales_without_delivery: 0, total_delivery_fee: 0 },
    });
  });
  it("labels the super-admin rows All, Delivery, Pickup", () => {
    expect(typeValues(groups, (t) => t.orders)).toEqual([
      { label: "All", value: 5 }, { label: "Delivery", value: 3 }, { label: "Pickup", value: 2 },
    ]);
  });
  it("always returns 12 monthly values, January first", () => {
    expect(months([{ month: 3, value: 1000 }, { month: 6, value: 8300 }, { month: 13, value: 9 }, { month: 0, value: 9 }])).toEqual([
      0, 0, 1000, 0, 0, 8300, 0, 0, 0, 0, 0, 0,
    ]);
    expect(months([])).toHaveLength(12);
  });
  it("computes year-over-year change in percent with 2 decimals", () => {
    expect(percentChange(3, 1)).toBe(200);
    expect(percentChange(1, 1)).toBe(0);
    expect(percentChange(0, 3)).toBe(-100);
    expect(percentChange(2, 3)).toBe(-33.33);
    expect(percentChange(5, 0)).toBe(100);
    expect(percentChange(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/mappers.spec.ts`. Expected: FAIL — module not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/mappers.ts
import { toMajor } from "../../kernel/money.js";

// One row of SELECT … GROUP BY "isPickedUp", "paymentMethod" over delivered orders (R8).
export type OrderGroup = { isPickedUp: boolean; paymentMethod: string; orders: number; totalMinor: number; deliveryMinor: number };
export type Totals = { orders: number; totalMinor: number; deliveryMinor: number };
export type Keep = (group: OrderGroup) => boolean;

export const anyMethod: Keep = () => true;
export const isCod: Keep = (group) => group.paymentMethod === "COD"; // R10
export const isCard: Keep = (group) => group.paymentMethod === "STRIPE"; // R10
export const isPickup: Keep = (group) => group.isPickedUp;
export const isDelivery: Keep = (group) => !group.isPickedUp;

export function totalsOf(groups: OrderGroup[], ...filters: Keep[]): Totals {
  return groups
    .filter((group) => filters.every((keep) => keep(group)))
    .reduce<Totals>(
      (sum, group) => ({
        orders: sum.orders + group.orders,
        totalMinor: sum.totalMinor + group.totalMinor,
        deliveryMinor: sum.deliveryMinor + group.deliveryMinor,
      }),
      { orders: 0, totalMinor: 0, deliveryMinor: 0 },
    );
}

// GraphQL DashboardOrderSalesTotals (R9).
export type SalesTotals = {
  total_orders: number;
  total_sales: number;
  total_sales_without_delivery: number;
  total_delivery_fee: number;
};
export function salesTotals(totals: Totals, exponent: number): SalesTotals {
  return {
    total_orders: totals.orders,
    total_sales: toMajor(totals.totalMinor, exponent),
    total_sales_without_delivery: toMajor(totals.totalMinor - totals.deliveryMinor, exponent),
    total_delivery_fee: toMajor(totals.deliveryMinor, exponent),
  };
}

// GraphQL [DashboardOrderSalesTypeBreakdown!]! — _type keys of DASHBOARD_PAYMENT_METHOD_SUB_TITLE
// (lib/utils/constants/dashboard.ts:7-11), index 0 = all (order-stats/index.tsx:57-76). R18.
export const BREAKDOWN_TYPES = ["all", "isPickedUp", "isNotPickedUp"] as const;
export function breakdown(groups: OrderGroup[], method: Keep, exponent: number) {
  return [
    { _type: BREAKDOWN_TYPES[0], data: salesTotals(totalsOf(groups, method), exponent) },
    { _type: BREAKDOWN_TYPES[1], data: salesTotals(totalsOf(groups, method, isPickup), exponent) },
    { _type: BREAKDOWN_TYPES[2], data: salesTotals(totalsOf(groups, method, isDelivery), exponent) },
  ];
}

// GraphQL [DashboardTypeValue!] — labels are translation keys present in every admin locale (R16).
export function typeValues(groups: OrderGroup[], value: (totals: Totals) => number) {
  return [
    { label: "All", value: value(totalsOf(groups)) },
    { label: "Delivery", value: value(totalsOf(groups, isDelivery)) },
    { label: "Pickup", value: value(totalsOf(groups, isPickup)) },
  ];
}

// Exactly 12 values, index month-1 (R13).
export function months(rows: { month: number; value: number }[]): number[] {
  const series = Array.from({ length: 12 }, () => 0);
  for (const row of rows) if (Number.isInteger(row.month) && row.month >= 1 && row.month <= 12) series[row.month - 1] += row.value;
  return series;
}

// R15.
export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  const percent = ((current - previous) / previous) * 100;
  return Math.sign(percent) * Math.round(Math.abs(percent) * 100) / 100;
}
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (6 tests).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/mappers.ts services/api/test/unit/analytics/mappers.spec.ts && git commit -m "feat(L9): map order aggregates to dashboard shapes"`

#### Task 8: Short-TTL scoped cache

**Files:**
- Create: `services/api/src/modules/analytics/cache.ts`
- Test: `services/api/test/unit/analytics/cache.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/cache.spec.ts
import { describe, expect, it, vi } from "vitest";
import { AnalyticsCache, CACHE_TTL_SECONDS, type CacheStore } from "../../../src/modules/analytics/cache.js";

class MemoryStore implements CacheStore {
  readonly entries = new Map<string, { value: string; ttl: number }>();
  async get(key: string) {
    return this.entries.get(key)?.value ?? null;
  }
  async set(key: string, value: string, _mode: "EX", ttl: number) {
    this.entries.set(key, { value, ttl });
    return "OK";
  }
}

describe("AnalyticsCache", () => {
  it("builds deterministic keys that contain the operation and the authorized scope", () => {
    const a = AnalyticsCache.key("getDashboardUsers", "platform", { year: 2026, timeZone: "UTC" });
    expect(a).toMatch(/^analytics:v1:getDashboardUsers:platform:[0-9a-f]{32}$/);
    expect(AnalyticsCache.key("getDashboardUsers", "platform", { year: 2026, timeZone: "UTC" })).toBe(a);
    expect(AnalyticsCache.key("getDashboardUsers", "platform", { year: 2025, timeZone: "UTC" })).not.toBe(a);
    expect(AnalyticsCache.key("getDashboardUsers", "vendor:x", { year: 2026, timeZone: "UTC" })).not.toBe(a);
  });
  it("computes on a miss, stores with a 30 s TTL, and serves the next call from the cache", async () => {
    const store = new MemoryStore();
    const cache = new AnalyticsCache(store);
    const compute = vi.fn().mockResolvedValue({ totalOrders: 3 });
    expect(await cache.remember("k", compute)).toEqual({ totalOrders: 3 });
    expect(await cache.remember("k", compute)).toEqual({ totalOrders: 3 });
    expect(compute).toHaveBeenCalledOnce();
    expect(store.entries.get("k")).toEqual({ value: '{"totalOrders":3}', ttl: CACHE_TTL_SECONDS });
    expect(CACHE_TTL_SECONDS).toBe(30);
  });
  it("falls back to computing when the store fails to read or write", async () => {
    const failing: CacheStore = { get: vi.fn().mockRejectedValue(new Error("down")), set: vi.fn().mockRejectedValue(new Error("down")) };
    const cache = new AnalyticsCache(failing);
    expect(await cache.remember("k", async () => 42)).toBe(42);
    expect(failing.set).toHaveBeenCalledOnce();
  });
  it("ignores unreadable cached values", async () => {
    const store = new MemoryStore();
    store.entries.set("k", { value: "{not json", ttl: 30 });
    expect(await new AnalyticsCache(store).remember("k", async () => "fresh")).toBe("fresh");
  });
  it("works without a store", async () => {
    expect(await new AnalyticsCache(null).remember("k", async () => "x")).toBe("x");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/cache.spec.ts`. Expected: FAIL — module not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/cache.ts
import { createHash } from "node:crypto";

export const CACHE_TTL_SECONDS = 30;
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
}

// R7, R22: callers authorize first; the key carries the authorized scope.
export class AnalyticsCache {
  constructor(
    private readonly store: CacheStore | null,
    private readonly ttlSeconds = CACHE_TTL_SECONDS,
  ) {}

  static key(operation: string, scopeKey: string, parts: unknown): string {
    const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
    return `analytics:v1:${operation}:${scopeKey}:${digest}`;
  }

  async remember<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (this.store) {
      try {
        const hit = await this.store.get(key);
        if (hit !== null) return JSON.parse(hit) as T;
      } catch {
        // Best-effort cache: fall through to PostgreSQL.
      }
    }
    const value = await compute();
    if (this.store) {
      try {
        await this.store.set(key, JSON.stringify(value), "EX", this.ttlSeconds);
      } catch {
        // Best-effort cache: the computed value is still returned.
      }
    }
    return value;
  }
}
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (5 tests).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/cache.ts services/api/test/unit/analytics/cache.spec.ts && git commit -m "feat(L9): add best-effort scoped Redis cache for dashboards"`

#### Task 9: Repository SQL and scope guard

**Files:**
- Create: `services/api/src/modules/analytics/repository.ts`, `services/api/src/modules/analytics/scope.ts`
- Test: `services/api/test/unit/analytics/repository-sql.spec.ts`, `services/api/test/unit/analytics/scope.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/api/test/unit/analytics/repository-sql.spec.ts
import { describe, expect, it, vi } from "vitest";
import { analyticsSql, AnalyticsRepository } from "../../../src/modules/analytics/repository.js";

const R = "0190a6f0-0000-7000-8000-000000000001";
const V = "0190a6f0-0000-7000-8000-000000000002";

describe("analytics SQL", () => {
  it("filters order groups by store, vendor and range with positional parameters", () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-07-01T00:00:00Z");
    const store = analyticsSql.orderGroups({ restaurantId: R, vendorId: null, range: { from, to } });
    expect(store.values).toEqual([R, from, to]);
    expect(store.text).toContain(`"restaurantId" = $1::uuid`);
    expect(store.text).toContain(`"deliveredAt" >= $2 AND "deliveredAt" < $3`);
    expect(store.text).toContain(`GROUP BY "isPickedUp", "paymentMethod"`);
    const vendor = analyticsSql.orderGroups({ restaurantId: null, vendorId: V, range: null });
    expect(vendor.values).toEqual([V]);
    expect(vendor.text).toContain(`"restaurantId" IN (SELECT "id" FROM "AnalyticsRestaurantView" WHERE "vendorId" = $1::uuid)`);
    const platform = analyticsSql.orderGroups({ restaurantId: null, vendorId: null, range: null });
    expect(platform.values).toEqual([]);
    expect(platform.text).not.toContain("WHERE");
  });
  it("buckets by month of the platform timezone within one year", () => {
    const q = analyticsSql.ordersByMonth({ restaurantId: R, vendorId: null }, 2026, "Europe/Berlin");
    expect(q.values).toEqual(["Europe/Berlin", 2026, R]);
    expect(q.text).toContain(`extract(month FROM "deliveredAt" AT TIME ZONE $1::text)`);
    expect(q.text).toContain(`make_timestamptz($2::int + 1, 1, 1, 0, 0, 0, $1::text)`);
  });
  it("converts bigint sums to safe integers and refuses unsafe ones", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ isPickedUp: false, paymentMethod: "COD", orders: 2, totalMinor: "3500", deliveryMinor: "500" }] }) };
    const repository = new AnalyticsRepository(pool);
    expect(await repository.orderGroups({ restaurantId: null, vendorId: null, range: null })).toEqual([
      { isPickedUp: false, paymentMethod: "COD", orders: 2, totalMinor: 3500, deliveryMinor: 500 },
    ]);
    pool.query.mockResolvedValue({ rows: [{ isPickedUp: false, paymentMethod: "COD", orders: 1, totalMinor: "9007199254740993", deliveryMinor: "0" }] });
    await expect(repository.orderGroups({ restaurantId: null, vendorId: null, range: null })).rejects.toMatchObject({
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  });
  it("maps statement timeouts and lost connections to SERVICE_UNAVAILABLE", async () => {
    for (const code of ["57014", "08006", "ECONNREFUSED"]) {
      const repository = new AnalyticsRepository({ query: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code })) });
      await expect(repository.platformCounts()).rejects.toMatchObject({ extensions: { code: "SERVICE_UNAVAILABLE" } });
    }
    const broken = new AnalyticsRepository({ query: vi.fn().mockRejectedValue(Object.assign(new Error("syntax"), { code: "42601" })) });
    await expect(broken.platformCounts()).rejects.toThrow("syntax");
  });
});
```

```ts
// services/api/test/unit/analytics/scope.spec.ts
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../../src/kernel/auth/guards.js";
import { AnalyticsScopes } from "../../../src/modules/analytics/scope.js";

const V1 = "0190a6f0-0000-7000-8000-0000000000a1";
const V1_USER = "0190a6f0-0000-7000-8000-0000000000a2";
const V2 = "0190a6f0-0000-7000-8000-0000000000b1";
const R1 = "0190a6f0-0000-7000-8000-0000000000c1";
const R3 = "0190a6f0-0000-7000-8000-0000000000c3";
const ORPHAN = "0190a6f0-0000-7000-8000-0000000000c9";
const MISSING = "0190a6f0-0000-7000-8000-0000000000ff";

const principal = (type: AuthContext["type"], extra: Partial<AuthContext> = {}): AuthContext => ({
  userId: "0190a6f0-0000-7000-8000-000000000001", type, sessionId: "s", permissions: [], restaurantIds: [], vendorId: null, riderId: null, ...extra,
});
const reads = {
  vendorByIdOrUser: vi.fn(async (id: string) =>
    id === V1 || id === V1_USER ? { id: V1, userId: V1_USER } : id === V2 ? { id: V2, userId: null } : null,
  ),
  restaurant: vi.fn(async (id: string) =>
    id === R1 ? { id: R1, vendorId: V1 } : id === R3 ? { id: R3, vendorId: V2 } : id === ORPHAN ? { id: ORPHAN, vendorId: null } : null,
  ),
};
const scopes = new AnalyticsScopes(reads);
const code = (c: string) => expect.objectContaining({ extensions: { code: c } });

describe("platform scope (R3, R6)", () => {
  it("allows ADMIN and STAFF with Admin", () => {
    expect(scopes.platform(principal("ADMIN"))).toEqual({ kind: "platform", key: "platform" });
    expect(scopes.platform(principal("STAFF", { permissions: ["Admin"] })).key).toBe("platform");
  });
  it("rejects anonymous, other staff and every other type", () => {
    expect(() => scopes.platform(null)).toThrow(code("UNAUTHENTICATED"));
    for (const caller of [principal("STAFF", { permissions: ["Vendors", "Stores"] }), principal("VENDOR"), principal("RESTAURANT"), principal("CUSTOMER"), principal("RIDER")])
      expect(() => scopes.platform(caller)).toThrow(code("FORBIDDEN"));
  });
});

describe("vendor scope (R4)", () => {
  it("lets a vendor read itself by vendor id or by its user id", async () => {
    const vendor = principal("VENDOR", { vendorId: V1 });
    expect(await scopes.vendor(vendor, V1)).toEqual({ kind: "vendor", key: `vendor:${V1}`, vendorId: V1 });
    expect(await scopes.vendor(vendor, V1_USER)).toEqual({ kind: "vendor", key: `vendor:${V1}`, vendorId: V1 });
  });
  it("rejects another vendor and unknown ids for vendors without revealing existence", async () => {
    const vendor = principal("VENDOR", { vendorId: V1 });
    await expect(scopes.vendor(vendor, V2)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.vendor(vendor, MISSING)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.vendor(principal("VENDOR"), V1)).rejects.toThrow(code("FORBIDDEN"));
  });
  it("lets ADMIN and STAFF with Vendors read any vendor; unknown is NOT_FOUND", async () => {
    expect((await scopes.vendor(principal("ADMIN"), V2)).vendorId).toBe(V2);
    expect((await scopes.vendor(principal("STAFF", { permissions: ["Vendors"] }), V2)).vendorId).toBe(V2);
    await expect(scopes.vendor(principal("ADMIN"), MISSING)).rejects.toThrow(code("NOT_FOUND"));
  });
  it("rejects STAFF without Vendors, store owners, anonymous and bad ids", async () => {
    await expect(scopes.vendor(principal("STAFF", { permissions: ["Stores", "Admin"] }), V1)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.vendor(principal("RESTAURANT", { restaurantIds: [R1] }), V1)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.vendor(null, V1)).rejects.toThrow(code("UNAUTHENTICATED"));
    await expect(scopes.vendor(principal("ADMIN"), "abc")).rejects.toThrow(expect.objectContaining({ message: "Invalid vendor id" }));
  });
});

describe("restaurant scope (R5)", () => {
  it("lets the owner, the owning vendor, STAFF with Stores and ADMIN read a store", async () => {
    expect(await scopes.restaurant(principal("RESTAURANT", { restaurantIds: [R1] }), R1)).toEqual({ kind: "restaurant", key: `restaurant:${R1}`, restaurantId: R1 });
    expect((await scopes.restaurant(principal("VENDOR", { vendorId: V1 }), R1)).restaurantId).toBe(R1);
    expect((await scopes.restaurant(principal("STAFF", { permissions: ["Stores"] }), R3)).restaurantId).toBe(R3);
    expect((await scopes.restaurant(principal("ADMIN"), R3)).restaurantId).toBe(R3);
  });
  it("rejects stores the caller does not own", async () => {
    await expect(scopes.restaurant(principal("RESTAURANT", { restaurantIds: [R1] }), R3)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.restaurant(principal("VENDOR", { vendorId: V1 }), R3)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.restaurant(principal("VENDOR", { vendorId: V1 }), ORPHAN)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.restaurant(principal("VENDOR", { vendorId: V1 }), MISSING)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.restaurant(principal("STAFF", { permissions: ["Vendors", "Restaurants"] }), R1)).rejects.toThrow(code("FORBIDDEN"));
    await expect(scopes.restaurant(principal("CUSTOMER"), R1)).rejects.toThrow(code("FORBIDDEN"));
  });
  it("reports unknown stores to ADMIN as NOT_FOUND and validates the id", async () => {
    await expect(scopes.restaurant(principal("ADMIN"), MISSING)).rejects.toThrow(code("NOT_FOUND"));
    await expect(scopes.restaurant(principal("ADMIN"), "abc")).rejects.toThrow(expect.objectContaining({ message: "Invalid restaurant id" }));
    await expect(scopes.restaurant(null, R1)).rejects.toThrow(code("UNAUTHENTICATED"));
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/repository-sql.spec.ts test/unit/analytics/scope.spec.ts`. Expected: FAIL — modules not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/repository.ts
import type { Pool } from "pg";
import { appError } from "../../kernel/errors.js";
import type { DateRange } from "./date-range.js";
import type { OrderGroup } from "./mappers.js";

export type Sql = { text: string; values: unknown[] };
export type OrderScope = { restaurantId: string | null; vendorId: string | null };
export type OrderFilter = OrderScope & { range: DateRange };
export type SignupSeries = "users" | "vendors" | "restaurants" | "riders";
export type SignupRow = { series: SignupSeries; year: number; month: number; n: number };
export type MonthlyOrders = { month: number; orders: number; totalMinor: number };
export type MonthlyCount = { month: number; n: number };
export type PlatformCounts = { usersCount: number; vendorsCount: number; restaurantsCount: number; ridersCount: number };

export interface AnalyticsReads {
  platformCounts(): Promise<PlatformCounts>;
  signupsByMonth(year: number, timeZone: string): Promise<SignupRow[]>;
  orderGroups(filter: OrderFilter): Promise<OrderGroup[]>;
  ordersByMonth(scope: OrderScope, year: number, timeZone: string): Promise<MonthlyOrders[]>;
  restaurantsCreatedByMonth(vendorId: string, year: number, timeZone: string): Promise<MonthlyCount[]>;
  vendorRestaurantCount(vendorId: string): Promise<number>;
  vendorByIdOrUser(id: string): Promise<{ id: string; userId: string | null } | null>;
  restaurant(id: string): Promise<{ id: string; vendorId: string | null } | null>;
}

function scopeConditions(scope: OrderScope, values: unknown[]): string[] {
  const where: string[] = [];
  if (scope.restaurantId) {
    values.push(scope.restaurantId);
    where.push(`"restaurantId" = $${values.length}::uuid`);
  }
  if (scope.vendorId) {
    values.push(scope.vendorId);
    // R20/R21: includes soft-deleted stores' history.
    where.push(`"restaurantId" IN (SELECT "id" FROM "AnalyticsRestaurantView" WHERE "vendorId" = $${values.length}::uuid)`);
  }
  return where;
}
const whereClause = (conditions: string[]) => (conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "");
const SUMS = `count(*)::int AS "orders", coalesce(sum("totalMinor"), 0)::bigint::text AS "totalMinor"`;

// Exported for the explain-plan test (Task 14). Every value is a bind parameter.
export const analyticsSql = {
  platformCounts(): Sql {
    return {
      text: `SELECT
        (SELECT count(*)::int FROM "AnalyticsUserView" WHERE "kind" = 'CUSTOMER' AND "deletedAt" IS NULL) AS "usersCount",
        (SELECT count(*)::int FROM "AnalyticsVendorView" WHERE "deletedAt" IS NULL) AS "vendorsCount",
        (SELECT count(*)::int FROM "AnalyticsRestaurantView" WHERE "deletedAt" IS NULL) AS "restaurantsCount",
        (SELECT count(*)::int FROM "AnalyticsRiderView" WHERE "deletedAt" IS NULL) AS "ridersCount"`,
      values: [],
    };
  },
  // Two calendar years (year-1 for percentageChange, R15), non-deleted rows only.
  signupsByMonth(year: number, timeZone: string): Sql {
    const window = `"createdAt" >= make_timestamptz($1::int - 1, 1, 1, 0, 0, 0, $2::text) AND "createdAt" < make_timestamptz($1::int + 1, 1, 1, 0, 0, 0, $2::text) AND "deletedAt" IS NULL`;
    return {
      text: `WITH s AS (
          SELECT 'users'::text AS "series", "createdAt" FROM "AnalyticsUserView" WHERE "kind" = 'CUSTOMER' AND ${window}
          UNION ALL SELECT 'vendors', "createdAt" FROM "AnalyticsVendorView" WHERE ${window}
          UNION ALL SELECT 'restaurants', "createdAt" FROM "AnalyticsRestaurantView" WHERE ${window}
          UNION ALL SELECT 'riders', "createdAt" FROM "AnalyticsRiderView" WHERE ${window}
        )
        SELECT "series",
               extract(year FROM "createdAt" AT TIME ZONE $2::text)::int AS "year",
               extract(month FROM "createdAt" AT TIME ZONE $2::text)::int AS "month",
               count(*)::int AS "n"
          FROM s GROUP BY 1, 2, 3`,
      values: [year, timeZone],
    };
  },
  orderGroups(filter: OrderFilter): Sql {
    const values: unknown[] = [];
    const where = scopeConditions(filter, values);
    if (filter.range) {
      values.push(filter.range.from, filter.range.to);
      where.push(`"deliveredAt" >= $${values.length - 1} AND "deliveredAt" < $${values.length}`);
    }
    return {
      text: `SELECT "isPickedUp", "paymentMethod"::text AS "paymentMethod", ${SUMS},
                    coalesce(sum("deliveryMinor"), 0)::bigint::text AS "deliveryMinor"
               FROM "AnalyticsOrderView"${whereClause(where)}
              GROUP BY "isPickedUp", "paymentMethod"`,
      values,
    };
  },
  ordersByMonth(scope: OrderScope, year: number, timeZone: string): Sql {
    const values: unknown[] = [timeZone, year];
    const where = [
      ...scopeConditions(scope, values),
      `"deliveredAt" >= make_timestamptz($2::int, 1, 1, 0, 0, 0, $1::text)`,
      `"deliveredAt" < make_timestamptz($2::int + 1, 1, 1, 0, 0, 0, $1::text)`,
    ];
    return {
      text: `SELECT extract(month FROM "deliveredAt" AT TIME ZONE $1::text)::int AS "month", ${SUMS}
               FROM "AnalyticsOrderView"${whereClause(where)} GROUP BY 1`,
      values,
    };
  },
  restaurantsCreatedByMonth(vendorId: string, year: number, timeZone: string): Sql {
    return {
      text: `SELECT extract(month FROM "createdAt" AT TIME ZONE $1::text)::int AS "month", count(*)::int AS "n"
               FROM "AnalyticsRestaurantView"
              WHERE "vendorId" = $3::uuid AND "deletedAt" IS NULL
                AND "createdAt" >= make_timestamptz($2::int, 1, 1, 0, 0, 0, $1::text)
                AND "createdAt" < make_timestamptz($2::int + 1, 1, 1, 0, 0, 0, $1::text)
              GROUP BY 1`,
      values: [timeZone, year, vendorId],
    };
  },
  vendorRestaurantCount(vendorId: string): Sql {
    return {
      text: `SELECT count(*)::int AS "n" FROM "AnalyticsRestaurantView" WHERE "vendorId" = $1::uuid AND "deletedAt" IS NULL`,
      values: [vendorId],
    };
  },
  vendorByIdOrUser(id: string): Sql {
    return {
      text: `SELECT "id", "userId" FROM "AnalyticsVendorView" WHERE "id" = $1::uuid OR "userId" = $1::uuid ORDER BY ("id" = $1::uuid) DESC LIMIT 1`,
      values: [id],
    };
  },
  restaurant(id: string): Sql {
    return { text: `SELECT "id", "vendorId" FROM "AnalyticsRestaurantView" WHERE "id" = $1::uuid`, values: [id] };
  },
};

const UNAVAILABLE = new Set(["57014", "57P01", "08000", "08001", "08003", "08006", "53300", "ECONNREFUSED", "ETIMEDOUT"]);

function minor(value: string | number): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < -BigInt(Number.MAX_SAFE_INTEGER)) throw appError("INTERNAL_SERVER_ERROR");
  return Number(parsed);
}

export class AnalyticsRepository implements AnalyticsReads {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  private async rows<T>(sql: Sql): Promise<T[]> {
    try {
      return (await this.pool.query(sql.text, sql.values)).rows as T[];
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && UNAVAILABLE.has(code)) throw appError("SERVICE_UNAVAILABLE");
      throw error;
    }
  }

  async platformCounts(): Promise<PlatformCounts> {
    const [row] = await this.rows<PlatformCounts>(analyticsSql.platformCounts());
    return row;
  }
  signupsByMonth(year: number, timeZone: string): Promise<SignupRow[]> {
    return this.rows<SignupRow>(analyticsSql.signupsByMonth(year, timeZone));
  }
  async orderGroups(filter: OrderFilter): Promise<OrderGroup[]> {
    const rows = await this.rows<{ isPickedUp: boolean; paymentMethod: string; orders: number; totalMinor: string; deliveryMinor: string }>(
      analyticsSql.orderGroups(filter),
    );
    return rows.map((row) => ({ ...row, totalMinor: minor(row.totalMinor), deliveryMinor: minor(row.deliveryMinor) }));
  }
  async ordersByMonth(scope: OrderScope, year: number, timeZone: string): Promise<MonthlyOrders[]> {
    const rows = await this.rows<{ month: number; orders: number; totalMinor: string }>(analyticsSql.ordersByMonth(scope, year, timeZone));
    return rows.map((row) => ({ month: row.month, orders: row.orders, totalMinor: minor(row.totalMinor) }));
  }
  restaurantsCreatedByMonth(vendorId: string, year: number, timeZone: string): Promise<MonthlyCount[]> {
    return this.rows<MonthlyCount>(analyticsSql.restaurantsCreatedByMonth(vendorId, year, timeZone));
  }
  async vendorRestaurantCount(vendorId: string): Promise<number> {
    const [row] = await this.rows<{ n: number }>(analyticsSql.vendorRestaurantCount(vendorId));
    return row.n;
  }
  async vendorByIdOrUser(id: string) {
    const [row] = await this.rows<{ id: string; userId: string | null }>(analyticsSql.vendorByIdOrUser(id));
    return row ?? null;
  }
  async restaurant(id: string) {
    const [row] = await this.rows<{ id: string; vendorId: string | null }>(analyticsSql.restaurant(id));
    return row ?? null;
  }
}
```

```ts
// services/api/src/modules/analytics/scope.ts
import { appError } from "../../kernel/errors.js";
import { requireAuth, requirePermission, type AuthContext } from "../../kernel/auth/guards.js";
import { parseId } from "../../kernel/ids.js";
import type { AnalyticsReads } from "./repository.js";

// Permission codes from vendor/enatega-ui/enatega-multivendor-admin/lib/utils/constants/permissions.ts.
export const PLATFORM_PERMISSION = "Admin"; // R3 (Q1)
export const VENDOR_PERMISSION = "Vendors"; // R4
export const STORE_PERMISSION = "Stores"; // R5

export type PlatformScope = { kind: "platform"; key: "platform" };
export type VendorScope = { kind: "vendor"; key: string; vendorId: string };
export type RestaurantScope = { kind: "restaurant"; key: string; restaurantId: string };

export class AnalyticsScopes {
  constructor(private readonly reads: Pick<AnalyticsReads, "vendorByIdOrUser" | "restaurant">) {}

  platform(auth: AuthContext | null): PlatformScope {
    requirePermission(auth, PLATFORM_PERMISSION);
    return { kind: "platform", key: "platform" };
  }

  async vendor(auth: AuthContext | null, vendorIdArg: unknown): Promise<VendorScope> {
    const caller = requireAuth(auth, "ADMIN", "STAFF", "VENDOR");
    if (caller.type === "STAFF" && !caller.permissions.includes(VENDOR_PERMISSION)) throw appError("FORBIDDEN");
    const requested = parseId(vendorIdArg, "vendor");
    const vendor = await this.reads.vendorByIdOrUser(requested);
    if (caller.type === "VENDOR" && (!vendor || caller.vendorId === null || vendor.id !== caller.vendorId)) throw appError("FORBIDDEN");
    if (!vendor) throw appError("NOT_FOUND");
    return { kind: "vendor", key: `vendor:${vendor.id}`, vendorId: vendor.id };
  }

  async restaurant(auth: AuthContext | null, restaurantArg: unknown): Promise<RestaurantScope> {
    const caller = requireAuth(auth, "ADMIN", "STAFF", "VENDOR", "RESTAURANT");
    if (caller.type === "STAFF" && !caller.permissions.includes(STORE_PERMISSION)) throw appError("FORBIDDEN");
    const id = parseId(restaurantArg, "restaurant");
    const restaurant = await this.reads.restaurant(id);
    if (caller.type === "VENDOR" && (!restaurant || caller.vendorId === null || restaurant.vendorId !== caller.vendorId))
      throw appError("FORBIDDEN");
    if (caller.type === "RESTAURANT" && (!restaurant || !caller.restaurantIds.includes(restaurant.id))) throw appError("FORBIDDEN");
    if (!restaurant) throw appError("NOT_FOUND");
    return { kind: "restaurant", key: `restaurant:${restaurant.id}`, restaurantId: restaurant.id };
  }
}
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (4 + 9 tests).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/repository.ts services/api/src/modules/analytics/scope.ts services/api/test/unit/analytics/repository-sql.spec.ts services/api/test/unit/analytics/scope.spec.ts && git commit -m "feat(L9): add bounded analytics SQL and role scope guard"`

#### Task 10: Analytics service

**Files:**
- Create: `services/api/src/modules/analytics/service.ts`
- Test: `services/api/test/unit/analytics/service.spec.ts`

Requires request L-1 (`ConfigPort.timeZone`) merged.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/analytics/service.spec.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../../src/kernel/auth/guards.js";
import { AnalyticsCache, type CacheStore } from "../../../src/modules/analytics/cache.js";
import type { OrderGroup } from "../../../src/modules/analytics/mappers.js";
import type { AnalyticsReads } from "../../../src/modules/analytics/repository.js";
import { AnalyticsScopes } from "../../../src/modules/analytics/scope.js";
import { AnalyticsService } from "../../../src/modules/analytics/service.js";

const R1 = "0190a6f0-0000-7000-8000-0000000000c1";
const V1 = "0190a6f0-0000-7000-8000-0000000000a1";
const admin: AuthContext = { userId: "u", type: "ADMIN", sessionId: "s", permissions: [], restaurantIds: [], vendorId: null, riderId: null };
const groups: OrderGroup[] = [
  { isPickedUp: false, paymentMethod: "COD", orders: 2, totalMinor: 3500, deliveryMinor: 500 },
  { isPickedUp: true, paymentMethod: "COD", orders: 1, totalMinor: 1500, deliveryMinor: 0 },
  { isPickedUp: true, paymentMethod: "STRIPE", orders: 1, totalMinor: 1800, deliveryMinor: 0 },
  { isPickedUp: false, paymentMethod: "STRIPE", orders: 1, totalMinor: 4000, deliveryMinor: 500 },
];

class MemoryStore implements CacheStore {
  readonly map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
    return "OK";
  }
}

let reads: { [K in keyof AnalyticsReads]: ReturnType<typeof vi.fn> };
let store: MemoryStore;
let service: AnalyticsService;
beforeEach(() => {
  reads = {
    platformCounts: vi.fn().mockResolvedValue({ usersCount: 4, vendorsCount: 2, restaurantsCount: 3, ridersCount: 2 }),
    signupsByMonth: vi.fn().mockResolvedValue([
      { series: "users", year: 2026, month: 1, n: 2 },
      { series: "users", year: 2026, month: 6, n: 1 },
      { series: "users", year: 2025, month: 12, n: 1 },
      { series: "riders", year: 2026, month: 3, n: 1 },
    ]),
    orderGroups: vi.fn().mockResolvedValue(groups),
    ordersByMonth: vi.fn().mockResolvedValue([{ month: 3, orders: 1, totalMinor: 1000 }, { month: 6, orders: 3, totalMinor: 8300 }]),
    restaurantsCreatedByMonth: vi.fn().mockResolvedValue([{ month: 2, n: 1 }, { month: 5, n: 1 }]),
    vendorRestaurantCount: vi.fn().mockResolvedValue(2),
    vendorByIdOrUser: vi.fn().mockResolvedValue({ id: V1, userId: null }),
    restaurant: vi.fn().mockResolvedValue({ id: R1, vendorId: V1 }),
  };
  store = new MemoryStore();
  service = new AnalyticsService(
    reads as unknown as AnalyticsReads,
    new AnalyticsScopes(reads as unknown as AnalyticsReads),
    new AnalyticsCache(store),
    { currency: vi.fn().mockResolvedValue({ code: "USD", symbol: "$", exponent: 2 }), timeZone: vi.fn().mockResolvedValue("UTC") },
    { now: () => new Date("2026-06-15T12:00:00Z") },
  );
});

describe("AnalyticsService", () => {
  it("returns platform counts and caches them under the platform scope", async () => {
    expect(await service.dashboardUsers(admin)).toEqual({ usersCount: 4, vendorsCount: 2, restaurantsCount: 3, ridersCount: 2 });
    await service.dashboardUsers(admin);
    expect(reads.platformCounts).toHaveBeenCalledOnce();
    expect([...store.map.keys()][0]).toMatch(/^analytics:v1:getDashboardUsers:platform:/);
  });
  it("builds 12-month user series and year-over-year change", async () => {
    const result = await service.dashboardUsersByYear(admin, 2026);
    expect(reads.signupsByMonth).toHaveBeenCalledWith(2026, "UTC");
    expect(result.usersCount).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(result.ridersCount).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.percentageChange).toEqual({ usersPercent: 200, vendorsPercent: 0, restaurantsPercent: 0, ridersPercent: 100 });
  });
  it("returns all-time order counts and sales by type for the platform", async () => {
    expect(await service.dashboardOrdersByType(admin)).toEqual([
      { label: "All", value: 5 }, { label: "Delivery", value: 3 }, { label: "Pickup", value: 2 },
    ]);
    expect(reads.orderGroups).toHaveBeenCalledWith({ restaurantId: null, vendorId: null, range: null });
    expect(await service.dashboardSalesByType(admin)).toEqual([
      { label: "All", value: 108 }, { label: "Delivery", value: 75 }, { label: "Pickup", value: 33 },
    ]);
  });
  it("resolves the date keyword before reading store totals", async () => {
    const result = await service.restaurantOrdersSalesStats(admin, { restaurant: R1, dateKeyword: "Today", starting_date: "2026-01-01", ending_date: "2026-06-30" });
    expect(reads.orderGroups).toHaveBeenCalledWith({
      restaurantId: R1, vendorId: null, range: { from: new Date("2026-06-15T00:00:00Z"), to: new Date("2026-06-16T00:00:00Z") },
    });
    expect(result).toEqual({ totalOrders: 5, totalSales: 108, totalCODOrders: 3, totalCardOrders: 2 });
  });
  it("caches per resolved range so different keywords never share a value", async () => {
    await service.restaurantOrdersSalesStats(admin, { restaurant: R1, dateKeyword: "Today", starting_date: "x", ending_date: "x" });
    await service.restaurantOrdersSalesStats(admin, { restaurant: R1, dateKeyword: "Year", starting_date: "x", ending_date: "x" });
    await service.restaurantOrdersSalesStats(admin, { restaurant: R1, dateKeyword: "Today", starting_date: "y", ending_date: "y" });
    expect(reads.orderGroups).toHaveBeenCalledTimes(2);
    expect([...store.map.keys()].every((key) => key.includes(`:restaurant:${R1}:`))).toBe(true);
  });
  it("builds the payment-method breakdown", async () => {
    const result = await service.restaurantOrderSalesByPaymentMethod(admin, { restaurant: R1, dateKeyword: "All", starting_date: "", ending_date: "" });
    expect(result).toMatchObject({
      total_orders: 5, total_sales: 108, total_sales_without_delivery: 98, total_delivery_fee: 10,
      pickup_total_orders: 2, delivery_total_orders: 3, pickup_orders: 2, delivery_orders: 3,
      pickup: { total_orders: 2 }, delivery: { total_orders: 3 },
    });
    expect(result.card.map((entry) => entry.data.total_orders)).toEqual([2, 1, 1]);
    expect(result.all[0]).toEqual({ _type: "all", data: { total_orders: 5, total_sales: 108, total_sales_without_delivery: 98, total_delivery_fee: 10 } });
  });
  it("returns monthly store series in major units", async () => {
    expect(await service.restaurantSalesOrderCountByYear(admin, { restaurant: R1, year: 2026 })).toEqual({
      salesAmount: [0, 0, 10, 0, 0, 83, 0, 0, 0, 0, 0, 0],
      ordersCount: [0, 0, 1, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    });
    expect(reads.ordersByMonth).toHaveBeenCalledWith({ restaurantId: R1, vendorId: null }, 2026, "UTC");
  });
  it("returns vendor cards and growth series", async () => {
    expect(await service.vendorStatsCard(admin, { vendorId: V1, dateKeyword: null, starting_date: "", ending_date: "" })).toEqual({
      totalRestaurants: 2, totalOrders: 5, totalSales: 108, totalDeliveries: 3,
    });
    expect(reads.orderGroups).toHaveBeenLastCalledWith({ restaurantId: null, vendorId: V1, range: null });
    expect(await service.vendorGrowthByYear(admin, { vendorId: V1, year: 2026 })).toEqual({
      totalRestaurants: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      totalOrders: [0, 0, 1, 0, 0, 3, 0, 0, 0, 0, 0, 0],
      totalSales: [0, 0, 10, 0, 0, 83, 0, 0, 0, 0, 0, 0],
    });
  });
  it("authorizes before reading or caching anything", async () => {
    await expect(service.dashboardUsers(null)).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } });
    await expect(service.dashboardUsersByYear(admin, 1999)).rejects.toMatchObject({ message: "Invalid year" });
    expect(reads.platformCounts).not.toHaveBeenCalled();
    expect(store.map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run test/unit/analytics/service.spec.ts`. Expected: FAIL — module not found.
- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/analytics/service.ts
import type { AuthContext } from "../../kernel/auth/guards.js";
import { toMajor } from "../../kernel/money.js";
import type { ConfigPort } from "../../kernel/ports.js";
import type { Clock } from "../../kernel/time.js";
import { AnalyticsCache } from "./cache.js";
import { parseYear, resolveDateRange, type DateRangeInput } from "./date-range.js";
import { anyMethod, breakdown, isCard, isCod, isDelivery, isPickup, months, percentChange, totalsOf, typeValues, salesTotals } from "./mappers.js";
import type { AnalyticsReads, SignupSeries } from "./repository.js";
import type { AnalyticsScopes } from "./scope.js";
import { assertTimeZone } from "./zoned-time.js";

export type RestaurantRangeArgs = DateRangeInput & { restaurant: string };
export type RestaurantYearArgs = { restaurant: string; year: number };
export type VendorRangeArgs = DateRangeInput & { vendorId: string };
export type VendorYearArgs = { vendorId: string; year: number };

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export class AnalyticsService {
  constructor(
    private readonly reads: AnalyticsReads,
    private readonly scopes: AnalyticsScopes,
    private readonly cache: AnalyticsCache,
    private readonly config: Pick<ConfigPort, "currency" | "timeZone">,
    private readonly clock: Clock,
  ) {}

  private async settings() {
    const [currency, timeZone] = await Promise.all([this.config.currency(), this.config.timeZone()]);
    return { exponent: currency.exponent, timeZone: assertTimeZone(timeZone) };
  }

  // R14
  async dashboardUsers(auth: AuthContext | null) {
    const scope = this.scopes.platform(auth);
    return this.cache.remember(AnalyticsCache.key("getDashboardUsers", scope.key, {}), () => this.reads.platformCounts());
  }

  // R13, R15
  async dashboardUsersByYear(auth: AuthContext | null, yearArg: number) {
    const scope = this.scopes.platform(auth);
    const year = parseYear(yearArg);
    const { timeZone } = await this.settings();
    return this.cache.remember(AnalyticsCache.key("getDashboardUsersByYear", scope.key, { year, timeZone }), async () => {
      const rows = await this.reads.signupsByMonth(year, timeZone);
      const series = (name: SignupSeries, inYear: number) =>
        months(rows.filter((row) => row.series === name && row.year === inYear).map((row) => ({ month: row.month, value: row.n })));
      const change = (name: SignupSeries) => percentChange(sum(series(name, year)), sum(series(name, year - 1)));
      return {
        usersCount: series("users", year),
        vendorsCount: series("vendors", year),
        restaurantsCount: series("restaurants", year),
        ridersCount: series("riders", year),
        percentageChange: {
          usersPercent: change("users"),
          vendorsPercent: change("vendors"),
          restaurantsPercent: change("restaurants"),
          ridersPercent: change("riders"),
        },
      };
    });
  }

  // R16
  async dashboardOrdersByType(auth: AuthContext | null) {
    const scope = this.scopes.platform(auth);
    return this.cache.remember(AnalyticsCache.key("getDashboardOrdersByType", scope.key, {}), async () =>
      typeValues(await this.reads.orderGroups({ restaurantId: null, vendorId: null, range: null }), (totals) => totals.orders),
    );
  }

  // R16, R9
  async dashboardSalesByType(auth: AuthContext | null) {
    const scope = this.scopes.platform(auth);
    const { exponent } = await this.settings();
    return this.cache.remember(AnalyticsCache.key("getDashboardSalesByType", scope.key, { exponent }), async () =>
      typeValues(await this.reads.orderGroups({ restaurantId: null, vendorId: null, range: null }), (totals) =>
        toMajor(totals.totalMinor, exponent),
      ),
    );
  }

  // R17
  async restaurantOrdersSalesStats(auth: AuthContext | null, args: RestaurantRangeArgs) {
    const scope = await this.scopes.restaurant(auth, args.restaurant);
    const { exponent, timeZone } = await this.settings();
    const range = resolveDateRange(args, this.clock.now(), timeZone);
    return this.cache.remember(AnalyticsCache.key("getRestaurantDashboardOrdersSalesStats", scope.key, { range, exponent }), async () => {
      const groups = await this.reads.orderGroups({ restaurantId: scope.restaurantId, vendorId: null, range });
      const all = totalsOf(groups);
      return {
        totalOrders: all.orders,
        totalSales: toMajor(all.totalMinor, exponent),
        totalCODOrders: totalsOf(groups, isCod).orders,
        totalCardOrders: totalsOf(groups, isCard).orders,
      };
    });
  }

  // R19
  async restaurantSalesOrderCountByYear(auth: AuthContext | null, args: RestaurantYearArgs) {
    const scope = await this.scopes.restaurant(auth, args.restaurant);
    const year = parseYear(args.year);
    const { exponent, timeZone } = await this.settings();
    return this.cache.remember(
      AnalyticsCache.key("getRestaurantDashboardSalesOrderCountDetailsByYear", scope.key, { year, timeZone, exponent }),
      async () => {
        const rows = await this.reads.ordersByMonth({ restaurantId: scope.restaurantId, vendorId: null }, year, timeZone);
        return {
          salesAmount: months(rows.map((row) => ({ month: row.month, value: row.totalMinor }))).map((minor) => toMajor(minor, exponent)),
          ordersCount: months(rows.map((row) => ({ month: row.month, value: row.orders }))),
        };
      },
    );
  }

  // R18
  async restaurantOrderSalesByPaymentMethod(auth: AuthContext | null, args: RestaurantRangeArgs) {
    const scope = await this.scopes.restaurant(auth, args.restaurant);
    const { exponent, timeZone } = await this.settings();
    const range = resolveDateRange(args, this.clock.now(), timeZone);
    return this.cache.remember(
      AnalyticsCache.key("getRestaurantDashboardOrderSalesDetailsByPaymentMethod", scope.key, { range, exponent }),
      async () => {
        const groups = await this.reads.orderGroups({ restaurantId: scope.restaurantId, vendorId: null, range });
        const pickup = totalsOf(groups, isPickup).orders;
        const delivery = totalsOf(groups, isDelivery).orders;
        return {
          ...salesTotals(totalsOf(groups), exponent),
          pickup_total_orders: pickup,
          delivery_total_orders: delivery,
          pickup_orders: pickup,
          delivery_orders: delivery,
          pickup: { total_orders: pickup },
          delivery: { total_orders: delivery },
          all: breakdown(groups, anyMethod, exponent),
          cod: breakdown(groups, isCod, exponent),
          card: breakdown(groups, isCard, exponent),
        };
      },
    );
  }

  // R20
  async vendorStatsCard(auth: AuthContext | null, args: VendorRangeArgs) {
    const scope = await this.scopes.vendor(auth, args.vendorId);
    const { exponent, timeZone } = await this.settings();
    const range = resolveDateRange(args, this.clock.now(), timeZone);
    return this.cache.remember(AnalyticsCache.key("getVendorDashboardStatsCardDetails", scope.key, { range, exponent }), async () => {
      const [restaurants, groups] = await Promise.all([
        this.reads.vendorRestaurantCount(scope.vendorId),
        this.reads.orderGroups({ restaurantId: null, vendorId: scope.vendorId, range }),
      ]);
      const all = totalsOf(groups);
      return {
        totalRestaurants: restaurants,
        totalOrders: all.orders,
        totalSales: toMajor(all.totalMinor, exponent),
        totalDeliveries: totalsOf(groups, isDelivery).orders,
      };
    });
  }

  // R21
  async vendorGrowthByYear(auth: AuthContext | null, args: VendorYearArgs) {
    const scope = await this.scopes.vendor(auth, args.vendorId);
    const year = parseYear(args.year);
    const { exponent, timeZone } = await this.settings();
    return this.cache.remember(
      AnalyticsCache.key("getVendorDashboardGrowthDetailsByYear", scope.key, { year, timeZone, exponent }),
      async () => {
        const [created, orders] = await Promise.all([
          this.reads.restaurantsCreatedByMonth(scope.vendorId, year, timeZone),
          this.reads.ordersByMonth({ restaurantId: null, vendorId: scope.vendorId }, year, timeZone),
        ]);
        return {
          totalRestaurants: months(created.map((row) => ({ month: row.month, value: row.n }))),
          totalOrders: months(orders.map((row) => ({ month: row.month, value: row.orders }))),
          totalSales: months(orders.map((row) => ({ month: row.month, value: row.totalMinor }))).map((minor) => toMajor(minor, exponent)),
        };
      },
    );
  }
}
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (9 tests).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/service.ts services/api/test/unit/analytics/service.spec.ts && git commit -m "feat(L9): add analytics service assembling dashboard results"`

### Wave 2 — resolvers and integration tests (exact admin documents)

#### Task 11: Platform dashboards (`getDashboardUsers`, `getDashboardUsersByYear`, `getDashboardOrdersByType`, `getDashboardSalesByType`)

**Files:**
- Create: `services/api/src/modules/analytics/resolver.ts`
- Modify: `services/api/src/modules/analytics/module.ts` (final version below)
- Create: `services/api/test/integration/analytics/support.ts`
- Test: `services/api/test/integration/analytics/platform-dashboards.integration.spec.ts`

- [ ] **Step 1: Write the failing test** (support file first, then the spec)

```ts
// services/api/test/integration/analytics/support.ts
// Integration dataset and helpers for L9. All harness assumptions (plan §6.0) live here.
import { expect, vi } from "vitest";
import type { Api } from "../../support/app.js";
import type { GqlResult } from "../../support/gql.js";
import type { Stack } from "../../support/stack.js";
import { factories } from "../../support/factories.js";
import { UserTokens, type UserType } from "../../../src/kernel/auth/tokens.js";
import { CONFIG_PORT, type ConfigPort } from "../../../src/kernel/ports.js";
import type { Clock } from "../../../src/kernel/time.js";
import { ANALYTICS_CLOCK } from "../../../src/modules/analytics/module.js";

export const ADMIN_APP = "enatega-multivendor-admin" as const;
export const DASHBOARD_FILE = "lib/api/graphql/queries/dashboard/index.ts";
export const NOW = "2026-06-15T12:00:00Z";
const at = (iso: string) => new Date(iso);

type Ref = { id: string; ownerUserId: string };
export type Seeded = {
  customerId: string;
  vendors: Record<"v1" | "v2", { id: string; userId: string }>;
  restaurants: Record<"r1" | "r2" | "r3" | "r4", Ref>;
};
export type OrderSeed = {
  at: string;
  pickup?: boolean;
  method?: "COD" | "STRIPE";
  totalMinor: number;
  deliveryMinor?: number;
  status?: "DELIVERED" | "CANCELLED" | "PENDING";
};

export async function addOrder(stack: Stack, restaurantId: string, userId: string, seed: OrderSeed) {
  const status = seed.status ?? "DELIVERED";
  return factories(stack.pool).order({
    restaurantId,
    userId,
    status,
    isPickedUp: seed.pickup ?? false,
    paymentMethod: seed.method ?? "COD",
    totalMinor: seed.totalMinor,
    deliveryMinor: seed.deliveryMinor ?? 0,
    createdAt: at(seed.at),
    deliveredAt: status === "DELIVERED" ? at(seed.at) : null,
  });
}

// Dataset (UTC). Expected numbers are derived in the plan (§6 Tasks 11–13) and asserted exactly.
export async function seedAnalytics(stack: Stack): Promise<Seeded> {
  const f = factories(stack.pool);
  const customer = await f.user({ type: "CUSTOMER", createdAt: at("2025-12-01T10:00:00Z") });
  await f.user({ type: "CUSTOMER", createdAt: at("2026-01-10T10:00:00Z") });
  await f.user({ type: "CUSTOMER", createdAt: at("2026-01-20T10:00:00Z") });
  await f.user({ type: "CUSTOMER", createdAt: at("2026-06-01T10:00:00Z") });
  await f.user({ type: "CUSTOMER", createdAt: at("2026-02-01T10:00:00Z"), deletedAt: at("2026-03-01T10:00:00Z") });

  const vendor = async (createdAt: string) => {
    const user = await f.user({ type: "VENDOR", createdAt: at(createdAt) });
    const row = await f.vendor({ userId: user.id, createdAt: at(createdAt) });
    return { id: row.id as string, userId: user.id as string };
  };
  const v1 = await vendor("2026-01-05T10:00:00Z");
  const v2 = await vendor("2025-08-01T10:00:00Z");

  const restaurant = async (vendorId: string, createdAt: string, deletedAt?: string): Promise<Ref> => {
    const owner = await f.user({ type: "RESTAURANT", createdAt: at(createdAt) });
    const row = await f.restaurant({ vendorId, ownerUserIds: [owner.id], createdAt: at(createdAt), deletedAt: deletedAt ? at(deletedAt) : null });
    return { id: row.id as string, ownerUserId: owner.id as string };
  };
  const r1 = await restaurant(v1.id, "2026-02-10T10:00:00Z");
  const r2 = await restaurant(v1.id, "2026-05-01T10:00:00Z");
  const r3 = await restaurant(v2.id, "2025-09-01T10:00:00Z");
  const r4 = await restaurant(v2.id, "2026-04-01T10:00:00Z", "2026-04-02T10:00:00Z");

  await f.rider({ createdAt: at("2026-03-03T10:00:00Z") });
  await f.rider({ createdAt: at("2025-02-02T10:00:00Z") });
  await f.rider({ createdAt: at("2026-03-10T10:00:00Z"), deletedAt: at("2026-03-11T10:00:00Z") });

  const order = (ref: Ref, seed: OrderSeed) => addOrder(stack, ref.id, customer.id, seed);
  await order(r1, { at: "2026-06-15T09:00:00Z", totalMinor: 2500, deliveryMinor: 300 }); // o1
  await order(r1, { at: "2026-06-12T10:00:00Z", pickup: true, method: "STRIPE", totalMinor: 1800 }); // o2
  await order(r1, { at: "2026-06-02T10:00:00Z", method: "STRIPE", totalMinor: 4000, deliveryMinor: 500 }); // o3
  await order(r1, { at: "2026-03-20T10:00:00Z", totalMinor: 1000, deliveryMinor: 200 }); // o4
  await order(r1, { at: "2025-11-05T10:00:00Z", pickup: true, totalMinor: 1500 }); // o5
  await order(r1, { at: "2026-06-14T10:00:00Z", totalMinor: 9900, deliveryMinor: 300, status: "CANCELLED" }); // o6 excluded
  await order(r1, { at: "2026-06-15T08:00:00Z", totalMinor: 1200, deliveryMinor: 100, status: "PENDING" }); // o7 excluded
  await order(r2, { at: "2026-06-15T07:00:00Z", totalMinor: 3000, deliveryMinor: 400 }); // o8
  await order(r2, { at: "2026-01-31T23:30:00Z", pickup: true, method: "STRIPE", totalMinor: 1200 }); // o9 (Feb in Berlin)
  await order(r3, { at: "2026-06-15T06:00:00Z", totalMinor: 7000, deliveryMinor: 700 }); // o10
  await order(r4, { at: "2026-04-01T12:00:00Z", totalMinor: 500, deliveryMinor: 100 }); // o11 (deleted store history)

  return { customerId: customer.id, vendors: { v1, v2 }, restaurants: { r1, r2, r3, r4 } };
}

export async function tokenFor(
  api: Api,
  stack: Stack,
  principal: { type: UserType; userId?: string; permissions?: string[] },
): Promise<string> {
  const f = factories(stack.pool);
  const userId = principal.userId ?? (await f.user({ type: principal.type, permissions: principal.permissions ?? [] })).id;
  const session = await f.session({ userId });
  const { token } = await api.app.get(UserTokens, { strict: false }).issue({ sub: userId, typ: principal.type, sid: session.id });
  return token;
}

// Test doubles for the L2 port and the clock (master §7: ports have fakes; never fake L9 output).
export function pinPlatform(api: Api, options: { now?: string; timeZone?: string; exponent?: number } = {}) {
  const config = api.app.get<ConfigPort>(CONFIG_PORT, { strict: false });
  vi.spyOn(config, "currency").mockResolvedValue({ code: "USD", symbol: "$", exponent: options.exponent ?? 2 });
  vi.spyOn(config, "timeZone").mockResolvedValue(options.timeZone ?? "UTC");
  vi.spyOn(api.app.get<Clock>(ANALYTICS_CLOCK, { strict: false }), "now").mockReturnValue(new Date(options.now ?? NOW));
}

export function expectError(result: GqlResult, code: string, status: number, message?: string) {
  expect(result.data?.[Object.keys(result.data ?? {})[0]] ?? null).toBeNull();
  expect(result.errors[0]?.extensions.code).toBe(code);
  expect(result.status).toBe(status);
  if (message) expect(result.errors[0]?.message).toBe(message);
}

export const months12 = (entries: Record<number, number>) => Array.from({ length: 12 }, (_, i) => entries[i + 1] ?? 0);
```

```ts
// services/api/test/integration/analytics/platform-dashboards.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";
import { startApi, type Api } from "../../support/app.js";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { ADMIN_APP, DASHBOARD_FILE, expectError, months12, pinPlatform, seedAnalytics, tokenFor, type Seeded } from "./support.js";

let stack: Stack;
let api: Api;
let seeded: Seeded;
beforeAll(async () => {
  stack = await startStack();
  api = await startApi(stack);
});
afterAll(async () => {
  await api?.close();
  await stack?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await stack.reset();
  seeded = await seedAnalytics(stack);
  pinPlatform(api);
});

const as = async (principal: Parameters<typeof tokenFor>[2]) => api.http.withUser(await tokenFor(api, stack, principal));
const outsiders = () => [
  { type: "STAFF" as const, permissions: ["Vendors", "Stores", "Orders"] },
  { type: "VENDOR" as const, userId: seeded.vendors.v1.userId },
  { type: "RESTAURANT" as const, userId: seeded.restaurants.r1.ownerUserId },
  { type: "CUSTOMER" as const },
];

describe(op("query.getDashboardUsers"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_USERS");
  it("counts customers, vendors, stores and riders, excluding soft-deleted rows (R14)", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query);
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({ getDashboardUsers: { usersCount: 4, vendorsCount: 2, restaurantsCount: 3, ridersCount: 2 } });
  });
  it("allows STAFF holding the Admin permission (R3)", async () => {
    const result = await (await as({ type: "STAFF", permissions: ["Admin"] })).query(query);
    expect(result.data).toEqual({ getDashboardUsers: { usersCount: 4, vendorsCount: 2, restaurantsCount: 3, ridersCount: 2 } });
  });
  it("rejects anonymous callers with UNAUTHENTICATED and HTTP 401 (R2)", async () => {
    expectError(await api.http.query(query), "UNAUTHENTICATED", 401);
  });
  it("rejects other staff, vendors, store owners and customers with FORBIDDEN and HTTP 403 (R3, R6)", async () => {
    for (const principal of outsiders()) expectError(await (await as(principal)).query(query), "FORBIDDEN", 403);
  });
  it("rejects arguments the admin never sends (validation)", async () => {
    const result = await (await as({ type: "ADMIN" })).query("query { getDashboardUsers(year: 2026) { usersCount } }");
    expect(result.errors[0].extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
  });
});

describe(op("query.getDashboardUsersByYear"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_USERS_BY_YEAR");
  it("returns 12 monthly registration counts per series and year-over-year change (R13, R15)", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query, { year: 2026 });
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      getDashboardUsersByYear: {
        usersCount: months12({ 1: 2, 6: 1 }),
        vendorsCount: months12({ 1: 1 }),
        restaurantsCount: months12({ 2: 1, 5: 1 }),
        ridersCount: months12({ 3: 1 }),
        percentageChange: { usersPercent: 200, vendorsPercent: 0, restaurantsPercent: 100, ridersPercent: 0 },
      },
    });
  });
  it("reports +100 % when the previous year had no registrations", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query, { year: 2025 });
    expect(result.data).toEqual({
      getDashboardUsersByYear: {
        usersCount: months12({ 12: 1 }),
        vendorsCount: months12({ 8: 1 }),
        restaurantsCount: months12({ 9: 1 }),
        ridersCount: months12({ 2: 1 }),
        percentageChange: { usersPercent: 100, vendorsPercent: 100, restaurantsPercent: 100, ridersPercent: 100 },
      },
    });
  });
  it("returns zero series and -100 % for a year without registrations", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query, { year: 2027 });
    expect(result.data?.getDashboardUsersByYear).toEqual({
      usersCount: months12({}), vendorsCount: months12({}), restaurantsCount: months12({}), ridersCount: months12({}),
      percentageChange: { usersPercent: -100, vendorsPercent: -100, restaurantsPercent: -100, ridersPercent: -100 },
    });
  });
  it("rejects years outside 2000..2100 with Invalid year", async () => {
    expectError(await (await as({ type: "ADMIN" })).query(query, { year: 1999 }), "BAD_USER_INPUT", 200, "Invalid year");
  });
  it("enforces authentication and the Admin permission", async () => {
    expectError(await api.http.query(query, { year: 2026 }), "UNAUTHENTICATED", 401);
    for (const principal of outsiders()) expectError(await (await as(principal)).query(query, { year: 2026 }), "FORBIDDEN", 403);
  });
});

describe(op("query.getDashboardOrdersByType"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_ORDERS_BY_TYPE");
  it("counts delivered orders of every store, all time, as All/Delivery/Pickup (R8, R16)", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query);
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      getDashboardOrdersByType: [{ value: 9, label: "All" }, { value: 6, label: "Delivery" }, { value: 3, label: "Pickup" }],
    });
  });
  it("enforces authentication and the Admin permission", async () => {
    expectError(await api.http.query(query), "UNAUTHENTICATED", 401);
    for (const principal of outsiders()) expectError(await (await as(principal)).query(query), "FORBIDDEN", 403);
  });
  it("rejects arguments the admin never sends (validation)", async () => {
    const result = await (await as({ type: "ADMIN" })).query('query { getDashboardOrdersByType(dateKeyword: "All") { value } }');
    expect(result.errors[0].extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
  });
});

describe(op("query.getDashboardSalesByType"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_SALES_BY_TYPE");
  it("sums delivered order totals in major units (R9, R16)", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query);
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      getDashboardSalesByType: [{ value: 225, label: "All" }, { value: 180, label: "Delivery" }, { value: 45, label: "Pickup" }],
    });
  });
  it("uses the configured currency exponent", async () => {
    pinPlatform(api, { exponent: 3 });
    const result = await (await as({ type: "ADMIN" })).query(query);
    expect(result.data?.getDashboardSalesByType).toEqual([{ value: 22.5, label: "All" }, { value: 18, label: "Delivery" }, { value: 4.5, label: "Pickup" }]);
  });
  it("enforces authentication and the Admin permission", async () => {
    expectError(await api.http.query(query), "UNAUTHENTICATED", 401);
    for (const principal of outsiders()) expectError(await (await as(principal)).query(query), "FORBIDDEN", 403);
  });
  it("rejects arguments the admin never sends (validation)", async () => {
    const result = await (await as({ type: "ADMIN" })).query("query { getDashboardSalesByType(year: 1) { value } }");
    expect(result.errors[0].extensions.code).toBe("GRAPHQL_VALIDATION_FAILED");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/analytics/platform-dashboards.integration.spec.ts`. Expected: FAIL — every happy path returns `NOT_IMPLEMENTED` ("getDashboardUsers is not available yet").
- [ ] **Step 3: Implement** the resolver (platform methods; Tasks 12–13 add the others) and the final module.

```ts
// services/api/src/modules/analytics/resolver.ts
import { Inject } from "@nestjs/common";
import { Args, Context, Query, Resolver } from "@nestjs/graphql";
import { z } from "zod";
import { appError } from "../../kernel/errors.js";
import type { RequestContext } from "../../kernel/context.js";
import { AnalyticsService } from "./service.js";

// R24: GraphQL already enforces types; zod bounds lengths before any database work.
const text = (max: number) => z.string().max(max);
const range = { starting_date: text(32).nullish(), ending_date: text(32).nullish(), dateKeyword: text(64).nullish() };
export const argumentSchemas = {
  year: z.object({ year: z.number().int() }),
  restaurantRange: z.object({ restaurant: text(64), ...range }),
  restaurantYear: z.object({ restaurant: text(64), year: z.number().int() }),
  vendorRange: z.object({ vendorId: text(64), ...range }),
  vendorYear: z.object({ vendorId: text(64), year: z.number().int() }),
};

export function parseArgs<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args);
  if (!result.success) throw appError("BAD_USER_INPUT", "Invalid dashboard arguments");
  return result.data;
}

@Resolver()
export class AnalyticsResolver {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Query("getDashboardUsers")
  async getDashboardUsers(@Context() context: RequestContext) {
    return this.analytics.dashboardUsers(await context.auth());
  }

  @Query("getDashboardUsersByYear")
  async getDashboardUsersByYear(@Args() args: unknown, @Context() context: RequestContext) {
    const auth = await context.auth();
    const { year } = parseArgs(argumentSchemas.year, args);
    return this.analytics.dashboardUsersByYear(auth, year);
  }

  @Query("getDashboardOrdersByType")
  async getDashboardOrdersByType(@Context() context: RequestContext) {
    return this.analytics.dashboardOrdersByType(await context.auth());
  }

  @Query("getDashboardSalesByType")
  async getDashboardSalesByType(@Context() context: RequestContext) {
    return this.analytics.dashboardSalesByType(await context.auth());
  }
}
```

Replace `services/api/src/modules/analytics/module.ts` with the final version (keeps everything from Task 3, adds the domain providers):

```ts
// services/api/src/modules/analytics/module.ts
import { Inject, Module, type DynamicModule, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { Pool, type PoolConfig } from "pg";
import { Redis } from "ioredis";
import type { Config } from "../../config.js";
import { CONFIG_PORT, type ConfigPort } from "../../kernel/ports.js";
import { systemClock, type Clock } from "../../kernel/time.js";
import { AnalyticsCache } from "./cache.js";
import { AnalyticsRepository } from "./repository.js";
import { AnalyticsResolver } from "./resolver.js";
import { AnalyticsScopes } from "./scope.js";
import { AnalyticsService } from "./service.js";

export const ANALYTICS_POOL = Symbol("ANALYTICS_POOL");
export const ANALYTICS_REDIS = Symbol("ANALYTICS_REDIS");
export const ANALYTICS_CLOCK = Symbol("ANALYTICS_CLOCK");

// R1: L9 never writes. Every session is read-only and bounded (R23).
export function readOnlyPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: 4,
    connectionTimeoutMillis: 1000,
    statement_timeout: 2000,
    options: "-c default_transaction_read_only=on",
  };
}

export class AnalyticsLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(ANALYTICS_POOL) private readonly pool: Pick<Pool, "end">,
    @Inject(ANALYTICS_REDIS) private readonly redis: Pick<Redis, "disconnect">,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
    await this.pool.end();
  }
}

export function infrastructureProviders(config: Pick<Config, "DATABASE_URL" | "REDIS_URL">): Provider[] {
  return [
    {
      provide: ANALYTICS_POOL,
      useFactory: () => {
        const pool = new Pool(readOnlyPoolConfig(config.DATABASE_URL));
        pool.on("error", () => {});
        return pool;
      },
    },
    {
      provide: ANALYTICS_REDIS,
      useFactory: () => {
        // The cache is best-effort (R22): fail fast, never queue, reconnect in the background.
        const redis = new Redis(config.REDIS_URL, {
          connectTimeout: 500,
          commandTimeout: 200,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        redis.on("error", () => {});
        return redis;
      },
    },
    // A plain object so tests can pin `now` with vi.spyOn.
    { provide: ANALYTICS_CLOCK, useValue: { now: () => systemClock.now() } satisfies Clock },
    AnalyticsLifecycle,
  ];
}

const domainProviders: Provider[] = [
  { provide: AnalyticsRepository, useFactory: (pool: Pool) => new AnalyticsRepository(pool), inject: [ANALYTICS_POOL] },
  { provide: AnalyticsScopes, useFactory: (reads: AnalyticsRepository) => new AnalyticsScopes(reads), inject: [AnalyticsRepository] },
  { provide: AnalyticsCache, useFactory: (redis: Redis) => new AnalyticsCache(redis), inject: [ANALYTICS_REDIS] },
  {
    provide: AnalyticsService,
    useFactory: (reads: AnalyticsRepository, scopes: AnalyticsScopes, cache: AnalyticsCache, config: ConfigPort, clock: Clock) =>
      new AnalyticsService(reads, scopes, cache, config, clock),
    inject: [AnalyticsRepository, AnalyticsScopes, AnalyticsCache, CONFIG_PORT, ANALYTICS_CLOCK],
  },
  AnalyticsResolver,
];

@Module({})
export class AnalyticsModule {
  static register(config: Pick<Config, "DATABASE_URL" | "REDIS_URL">): DynamicModule {
    return { module: AnalyticsModule, providers: [...infrastructureProviders(config), ...domainProviders] };
  }
}
```

- [ ] **Step 4: Run** the Step 2 command and `pnpm --filter @fairbite/api exec vitest run test/unit/analytics`. Expected: PASS (17 integration tests); unit suite still green.
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics services/api/test/integration/analytics/support.ts services/api/test/integration/analytics/platform-dashboards.integration.spec.ts && git commit -m "feat(L9): serve super-admin dashboard queries from delivered orders and live counts"`

#### Task 12: Store dashboards (`getRestaurantDashboardOrdersSalesStats`, `getRestaurantDashboardSalesOrderCountDetailsByYear`, `getRestaurantDashboardOrderSalesDetailsByPaymentMethod`)

**Files:**
- Modify: `services/api/src/modules/analytics/resolver.ts`
- Test: `services/api/test/integration/analytics/restaurant-dashboards.integration.spec.ts`

Expected numbers for store R1 (from `seedAnalytics`, now = 2026-06-15T12:00Z, UTC): All = o1–o5: 5 orders, 108.00 sales, 10.00 delivery, 3 COD, 2 card, 2 pickup, 3 delivery. Today = o1: 1 / 25.00 / COD 1. Week (06-09…06-15) = o1, o2: 2 / 43.00 / 1 / 1. Month = o1–o3: 3 / 83.00 / 1 / 2. Year = o1–o4: 4 / 93.00 / 2 / 2.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/integration/analytics/restaurant-dashboards.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";
import { startApi, type Api } from "../../support/app.js";
import { doc } from "../../support/documents.js";
import type { GqlClient, GqlResult } from "../../support/gql.js";
import { op } from "../../support/op.js";
import { newId } from "../../../src/kernel/ids.js";
import { ADMIN_APP, DASHBOARD_FILE, expectError, months12, pinPlatform, seedAnalytics, tokenFor, type Seeded } from "./support.js";

let stack: Stack;
let api: Api;
let seeded: Seeded;
beforeAll(async () => {
  stack = await startStack();
  api = await startApi(stack);
});
afterAll(async () => {
  await api?.close();
  await stack?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await stack.reset();
  seeded = await seedAnalytics(stack);
  pinPlatform(api);
});

const as = async (principal: Parameters<typeof tokenFor>[2]) => api.http.withUser(await tokenFor(api, stack, principal));
// The admin's default filter state (lib/ui/screens/admin/restaurant/dashboard/index.tsx:14-18).
const vars = (restaurant: string, dateKeyword: string | null = "All", starting_date = "2026-01-01", ending_date = "2026-06-30") => ({
  restaurant, dateKeyword, starting_date, ending_date,
});
const totals = (o: number, s: number, w: number, d: number) => ({ total_orders: o, total_sales: s, total_sales_without_delivery: w, total_delivery_fee: d });
const types = (all: object, pickup: object, delivery: object) => [
  { _type: "all", data: all }, { _type: "isPickedUp", data: pickup }, { _type: "isNotPickedUp", data: delivery },
];

const ownersCanRead = (call: (client: GqlClient, restaurant: string) => Promise<GqlResult>) =>
  it("lets the store owner, the owning vendor and STAFF with Stores read the store (R5)", async () => {
    const { r1 } = seeded.restaurants;
    for (const principal of [
      { type: "RESTAURANT" as const, userId: r1.ownerUserId },
      { type: "VENDOR" as const, userId: seeded.vendors.v1.userId },
      { type: "STAFF" as const, permissions: ["Stores"] },
    ]) {
      const result = await call(await as(principal), r1.id);
      expect(result.errors, principal.type).toEqual([]);
    }
  });

describe(op("query.getRestaurantDashboardOrdersSalesStats"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_RESTAURANT_ORDERS");
  const stats = (o: number, s: number, cod: number, card: number) => ({
    getRestaurantDashboardOrdersSalesStats: { totalOrders: o, totalSales: s, totalCODOrders: cod, totalCardOrders: card },
  });
  it.each([
    ["All", stats(5, 108, 3, 2)],
    ["Today", stats(1, 25, 1, 0)],
    ["Week", stats(2, 43, 1, 1)],
    ["Month", stats(3, 83, 1, 2)],
    ["Year", stats(4, 93, 2, 2)],
    ["السنة", stats(4, 93, 2, 2)],
    ["Heute", stats(1, 25, 1, 0)],
    ["Hamısı", stats(5, 108, 3, 2)],
    ["Fortnight", stats(5, 108, 3, 2)],
    ["", stats(5, 108, 3, 2)],
    [null, stats(5, 108, 3, 2)],
  ])("dateKeyword %j counts only delivered orders in range (R8, R11, R17)", async (dateKeyword, expected) => {
    const result = await (await as({ type: "ADMIN" })).query(query, vars(seeded.restaurants.r1.id, dateKeyword));
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual(expected);
  });
  it("applies inclusive Custom civil dates", async () => {
    const admin = await as({ type: "ADMIN" });
    const r1 = seeded.restaurants.r1.id;
    expect((await admin.query(query, vars(r1, "Custom", "2026-03-01", "2026-03-31"))).data).toEqual(stats(1, 10, 1, 0));
    expect((await admin.query(query, vars(r1, "Custom", "2026-06-12", "2026-06-12"))).data).toEqual(stats(1, 18, 0, 1));
  });
  it("ignores malformed dates unless the keyword is Custom (vendor January defect, R11)", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query, vars(seeded.restaurants.r1.id, "All", "2026-01-01", "2026-00-31"));
    expect(result.data).toEqual(stats(5, 108, 3, 2));
  });
  it("validates ids and Custom dates", async () => {
    const admin = await as({ type: "ADMIN" });
    const r1 = seeded.restaurants.r1.id;
    expectError(await admin.query(query, vars("abc")), "BAD_USER_INPUT", 200, "Invalid restaurant id");
    expectError(await admin.query(query, vars(r1, "Custom", "2026-02-30", "2026-03-01")), "BAD_USER_INPUT", 200, "Invalid date");
    expectError(await admin.query(query, vars(r1, "Custom", "2026-03-02", "2026-03-01")), "BAD_USER_INPUT", 200, "Invalid date range");
    expectError(await admin.query(query, vars(r1, "Custom", "2020-01-01", "2026-01-01")), "BAD_USER_INPUT", 200, "Date range is too long");
  });
  ownersCanRead((client, restaurant) => client.query(query, vars(restaurant)));
  it("rejects stores the caller does not own (R5)", async () => {
    const { r1, r2, r3 } = seeded.restaurants;
    expectError(await (await as({ type: "RESTAURANT", userId: r1.ownerUserId })).query(query, vars(r2.id)), "FORBIDDEN", 403);
    expectError(await (await as({ type: "VENDOR", userId: seeded.vendors.v1.userId })).query(query, vars(r3.id)), "FORBIDDEN", 403);
    expectError(await (await as({ type: "STAFF", permissions: ["Vendors", "Admin"] })).query(query, vars(r1.id)), "FORBIDDEN", 403);
    expectError(await (await as({ type: "VENDOR", userId: seeded.vendors.v1.userId })).query(query, vars(newId())), "FORBIDDEN", 403);
    expectError(await (await as({ type: "ADMIN" })).query(query, vars(newId())), "NOT_FOUND", 200, "Resource not found");
  });
  it("enforces authentication and rejects customers", async () => {
    expectError(await api.http.query(query, vars(seeded.restaurants.r1.id)), "UNAUTHENTICATED", 401);
    expectError(await (await as({ type: "CUSTOMER" })).query(query, vars(seeded.restaurants.r1.id)), "FORBIDDEN", 403);
  });
});

describe(op("query.getRestaurantDashboardSalesOrderCountDetailsByYear"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_RESTAURANT_SALES_ORDER_COUNT_DETAILS_BY_YEAR");
  it("returns 12 monthly sales and order counts of delivered orders (R13, R19)", async () => {
    const admin = await as({ type: "ADMIN" });
    expect((await admin.query(query, { restaurant: seeded.restaurants.r1.id, year: 2026 })).data).toEqual({
      getRestaurantDashboardSalesOrderCountDetailsByYear: { salesAmount: months12({ 3: 10, 6: 83 }), ordersCount: months12({ 3: 1, 6: 3 }) },
    });
    expect((await admin.query(query, { restaurant: seeded.restaurants.r1.id, year: 2025 })).data).toEqual({
      getRestaurantDashboardSalesOrderCountDetailsByYear: { salesAmount: months12({ 11: 15 }), ordersCount: months12({ 11: 1 }) },
    });
  });
  it("buckets months in the platform timezone (R12)", async () => {
    const admin = await as({ type: "ADMIN" });
    const r2 = seeded.restaurants.r2.id;
    expect((await admin.query(query, { restaurant: r2, year: 2026 })).data?.getRestaurantDashboardSalesOrderCountDetailsByYear).toEqual({
      salesAmount: months12({ 1: 12, 6: 30 }), ordersCount: months12({ 1: 1, 6: 1 }),
    });
    pinPlatform(api, { timeZone: "Europe/Berlin" });
    expect((await admin.query(query, { restaurant: r2, year: 2026 })).data?.getRestaurantDashboardSalesOrderCountDetailsByYear).toEqual({
      salesAmount: months12({ 2: 12, 6: 30 }), ordersCount: months12({ 2: 1, 6: 1 }),
    });
  });
  it("validates the year and the id", async () => {
    const admin = await as({ type: "ADMIN" });
    expectError(await admin.query(query, { restaurant: seeded.restaurants.r1.id, year: 2101 }), "BAD_USER_INPUT", 200, "Invalid year");
    expectError(await admin.query(query, { restaurant: "abc", year: 2026 }), "BAD_USER_INPUT", 200, "Invalid restaurant id");
  });
  ownersCanRead((client, restaurant) => client.query(query, { restaurant, year: 2026 }));
  it("rejects stores the caller does not own and anonymous callers", async () => {
    const { r1, r2 } = seeded.restaurants;
    expectError(await (await as({ type: "RESTAURANT", userId: r1.ownerUserId })).query(query, { restaurant: r2.id, year: 2026 }), "FORBIDDEN", 403);
    expectError(await api.http.query(query, { restaurant: r1.id, year: 2026 }), "UNAUTHENTICATED", 401);
  });
});

describe(op("query.getRestaurantDashboardOrderSalesDetailsByPaymentMethod"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_RESTAURANT_DASHBOARD_ORDER_SALES_DETAILS_BY_PAYMENT_METHOD");
  it("returns totals, pickup/delivery counts and all/cod/card breakdowns in the admin's order (R18)", async () => {
    const result = await (await as({ type: "RESTAURANT", userId: seeded.restaurants.r1.ownerUserId })).query(query, vars(seeded.restaurants.r1.id));
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      getRestaurantDashboardOrderSalesDetailsByPaymentMethod: {
        ...totals(5, 108, 98, 10),
        pickup_total_orders: 2, delivery_total_orders: 3, pickup_orders: 2, delivery_orders: 3,
        pickup: { total_orders: 2 }, delivery: { total_orders: 3 },
        all: types(totals(5, 108, 98, 10), totals(2, 33, 33, 0), totals(3, 75, 65, 10)),
        cod: types(totals(3, 50, 45, 5), totals(1, 15, 15, 0), totals(2, 35, 30, 5)),
        card: types(totals(2, 58, 53, 5), totals(1, 18, 18, 0), totals(1, 40, 35, 5)),
      },
    });
  });
  it("filters the breakdown by the translated Year label", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query, vars(seeded.restaurants.r1.id, "Jahr"));
    expect(result.data?.getRestaurantDashboardOrderSalesDetailsByPaymentMethod).toMatchObject({
      ...totals(4, 93, 83, 10),
      pickup_total_orders: 1, delivery_total_orders: 3,
      cod: types(totals(2, 35, 30, 5), totals(0, 0, 0, 0), totals(2, 35, 30, 5)),
      card: types(totals(2, 58, 53, 5), totals(1, 18, 18, 0), totals(1, 40, 35, 5)),
    });
  });
  it("returns zeros, never nulls, for a range without delivered orders", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query, vars(seeded.restaurants.r3.id, "Custom", "2024-01-01", "2024-01-31"));
    const zero = totals(0, 0, 0, 0);
    expect(result.data?.getRestaurantDashboardOrderSalesDetailsByPaymentMethod).toEqual({
      ...zero, pickup_total_orders: 0, delivery_total_orders: 0, pickup_orders: 0, delivery_orders: 0,
      pickup: { total_orders: 0 }, delivery: { total_orders: 0 },
      all: types(zero, zero, zero), cod: types(zero, zero, zero), card: types(zero, zero, zero),
    });
  });
  it("validates Custom dates and ids", async () => {
    const admin = await as({ type: "ADMIN" });
    expectError(await admin.query(query, vars(seeded.restaurants.r1.id, "Custom", "", "2026-01-01")), "BAD_USER_INPUT", 200, "Invalid date");
    expectError(await admin.query(query, vars("x".repeat(65))), "BAD_USER_INPUT", 200, "Invalid dashboard arguments");
  });
  ownersCanRead((client, restaurant) => client.query(query, vars(restaurant)));
  it("rejects stores the caller does not own and anonymous callers", async () => {
    const { r1, r3 } = seeded.restaurants;
    expectError(await (await as({ type: "VENDOR", userId: seeded.vendors.v1.userId })).query(query, vars(r3.id)), "FORBIDDEN", 403);
    expectError(await (await as({ type: "RIDER" })).query(query, vars(r1.id)), "FORBIDDEN", 403);
    expectError(await api.http.query(query, vars(r1.id)), "UNAUTHENTICATED", 401);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/analytics/restaurant-dashboards.integration.spec.ts`. Expected: FAIL — happy paths return `NOT_IMPLEMENTED`.
- [ ] **Step 3: Implement** — add these three methods to `AnalyticsResolver` in `resolver.ts` (after `getDashboardSalesByType`):

```ts
  @Query("getRestaurantDashboardOrdersSalesStats")
  async getRestaurantDashboardOrdersSalesStats(@Args() args: unknown, @Context() context: RequestContext) {
    const auth = await context.auth();
    return this.analytics.restaurantOrdersSalesStats(auth, parseArgs(argumentSchemas.restaurantRange, args));
  }

  @Query("getRestaurantDashboardSalesOrderCountDetailsByYear")
  async getRestaurantDashboardSalesOrderCountDetailsByYear(@Args() args: unknown, @Context() context: RequestContext) {
    const auth = await context.auth();
    return this.analytics.restaurantSalesOrderCountByYear(auth, parseArgs(argumentSchemas.restaurantYear, args));
  }

  @Query("getRestaurantDashboardOrderSalesDetailsByPaymentMethod")
  async getRestaurantDashboardOrderSalesDetailsByPaymentMethod(@Args() args: unknown, @Context() context: RequestContext) {
    const auth = await context.auth();
    return this.analytics.restaurantOrderSalesByPaymentMethod(auth, parseArgs(argumentSchemas.restaurantRange, args));
  }
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (all cases, 11 keyword rows included).
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/resolver.ts services/api/test/integration/analytics/restaurant-dashboards.integration.spec.ts && git commit -m "feat(L9): serve store dashboard queries with localized date filters and ownership checks"`

#### Task 13: Vendor dashboards (`getVendorDashboardStatsCardDetails`, `getVendorDashboardGrowthDetailsByYear`)

**Files:**
- Modify: `services/api/src/modules/analytics/resolver.ts`
- Test: `services/api/test/integration/analytics/vendor-dashboards.integration.spec.ts`

Expected numbers: V1 (stores R1, R2) All = 2 stores, 7 orders, 150.00, 4 deliveries; Today = o1, o8: 2 / 55.00 / 2; Year = 6 / 135.00 / 4. V2 All (R3 + deleted R4 history) = 1 store, 2 orders, 75.00, 2 deliveries. V1 growth 2026: stores Feb 1, May 1; orders Jan 1, Mar 1, Jun 4; sales Jan 12, Mar 10, Jun 113.

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/integration/analytics/vendor-dashboards.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";
import { startApi, type Api } from "../../support/app.js";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { newId } from "../../../src/kernel/ids.js";
import { ADMIN_APP, DASHBOARD_FILE, expectError, months12, pinPlatform, seedAnalytics, tokenFor, type Seeded } from "./support.js";

let stack: Stack;
let api: Api;
let seeded: Seeded;
beforeAll(async () => {
  stack = await startStack();
  api = await startApi(stack);
});
afterAll(async () => {
  await api?.close();
  await stack?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await stack.reset();
  seeded = await seedAnalytics(stack);
  pinPlatform(api);
});

const as = async (principal: Parameters<typeof tokenFor>[2]) => api.http.withUser(await tokenFor(api, stack, principal));
// The admin's default filter state (lib/ui/screens/admin/vendor/dashboard/index.tsx:13-17).
const vars = (vendorId: string, dateKeyword: string | null = "All", starting_date = "2026-01-01", ending_date = "2026-05-31") => ({
  vendorId, dateKeyword, starting_date, ending_date,
});
const card = (stores: number, orders: number, sales: number, deliveries: number) => ({
  getVendorDashboardStatsCardDetails: { totalRestaurants: stores, totalOrders: orders, totalSales: sales, totalDeliveries: deliveries },
});

describe(op("query.getVendorDashboardStatsCardDetails"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_VENDOR_DASHBOARD_STATS_CARD_DETAILS");
  it("aggregates delivered orders of all the vendor's stores (R20)", async () => {
    const vendor = await as({ type: "VENDOR", userId: seeded.vendors.v1.userId });
    expect((await vendor.query(query, vars(seeded.vendors.v1.id))).data).toEqual(card(2, 7, 150, 4));
    expect((await vendor.query(query, vars(seeded.vendors.v1.id, "Today"))).data).toEqual(card(2, 2, 55, 2));
    expect((await vendor.query(query, vars(seeded.vendors.v1.id, "سال"))).data).toEqual(card(2, 6, 135, 4));
  });
  it("accepts the vendor's user id, which is what the admin stores as vendorId (R4)", async () => {
    const vendor = await as({ type: "VENDOR", userId: seeded.vendors.v1.userId });
    expect((await vendor.query(query, vars(seeded.vendors.v1.userId))).data).toEqual(card(2, 7, 150, 4));
  });
  it("keeps soft-deleted stores' history in sales but not in the store count", async () => {
    expect((await (await as({ type: "ADMIN" })).query(query, vars(seeded.vendors.v2.id))).data).toEqual(card(1, 2, 75, 2));
  });
  it("allows STAFF with Vendors", async () => {
    const result = await (await as({ type: "STAFF", permissions: ["Vendors"] })).query(query, vars(seeded.vendors.v2.id));
    expect(result.data).toEqual(card(1, 2, 75, 2));
  });
  it("rejects another vendor, other staff and store owners (R4)", async () => {
    const { v1, v2 } = seeded.vendors;
    expectError(await (await as({ type: "VENDOR", userId: v1.userId })).query(query, vars(v2.id)), "FORBIDDEN", 403);
    expectError(await (await as({ type: "VENDOR", userId: v1.userId })).query(query, vars(newId())), "FORBIDDEN", 403);
    expectError(await (await as({ type: "STAFF", permissions: ["Stores", "Admin"] })).query(query, vars(v1.id)), "FORBIDDEN", 403);
    expectError(await (await as({ type: "RESTAURANT", userId: seeded.restaurants.r1.ownerUserId })).query(query, vars(v1.id)), "FORBIDDEN", 403);
    expectError(await (await as({ type: "ADMIN" })).query(query, vars(newId())), "NOT_FOUND", 200, "Resource not found");
  });
  it("validates the vendor id and Custom dates", async () => {
    const admin = await as({ type: "ADMIN" });
    expectError(await admin.query(query, vars("abc")), "BAD_USER_INPUT", 200, "Invalid vendor id");
    expectError(await admin.query(query, vars(seeded.vendors.v1.id, "Custom", "2026-00-31", "2026-01-31")), "BAD_USER_INPUT", 200, "Invalid date");
  });
  it("enforces authentication", async () => {
    expectError(await api.http.query(query, vars(seeded.vendors.v1.id)), "UNAUTHENTICATED", 401);
  });
});

describe(op("query.getVendorDashboardGrowthDetailsByYear"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_VENDOR_DASHBOARD_GROWTH_DETAILS_BY_YEAR");
  it("returns 12 monthly store, order and sales values (R13, R21)", async () => {
    const result = await (await as({ type: "VENDOR", userId: seeded.vendors.v1.userId })).query(query, { vendorId: seeded.vendors.v1.userId, year: 2026 });
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      getVendorDashboardGrowthDetailsByYear: {
        totalRestaurants: months12({ 2: 1, 5: 1 }),
        totalOrders: months12({ 1: 1, 3: 1, 6: 4 }),
        totalSales: months12({ 1: 12, 3: 10, 6: 113 }),
      },
    });
  });
  it("counts deleted stores' orders but not the deleted store itself", async () => {
    const result = await (await as({ type: "ADMIN" })).query(query, { vendorId: seeded.vendors.v2.id, year: 2026 });
    expect(result.data?.getVendorDashboardGrowthDetailsByYear).toEqual({
      totalRestaurants: months12({}), totalOrders: months12({ 4: 1, 6: 1 }), totalSales: months12({ 4: 5, 6: 70 }),
    });
  });
  it("buckets in the platform timezone", async () => {
    pinPlatform(api, { timeZone: "Europe/Berlin" });
    const result = await (await as({ type: "ADMIN" })).query(query, { vendorId: seeded.vendors.v1.id, year: 2026 });
    expect(result.data?.getVendorDashboardGrowthDetailsByYear.totalOrders).toEqual(months12({ 2: 1, 3: 1, 6: 4 }));
  });
  it("validates the year and the id", async () => {
    const admin = await as({ type: "ADMIN" });
    expectError(await admin.query(query, { vendorId: seeded.vendors.v1.id, year: 1999 }), "BAD_USER_INPUT", 200, "Invalid year");
    expectError(await admin.query(query, { vendorId: "abc", year: 2026 }), "BAD_USER_INPUT", 200, "Invalid vendor id");
  });
  it("enforces authentication and ownership", async () => {
    expectError(await api.http.query(query, { vendorId: seeded.vendors.v1.id, year: 2026 }), "UNAUTHENTICATED", 401);
    expectError(
      await (await as({ type: "VENDOR", userId: seeded.vendors.v2.userId })).query(query, { vendorId: seeded.vendors.v1.id, year: 2026 }),
      "FORBIDDEN",
      403,
    );
    expectError(await (await as({ type: "CUSTOMER" })).query(query, { vendorId: seeded.vendors.v1.id, year: 2026 }), "FORBIDDEN", 403);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/analytics/vendor-dashboards.integration.spec.ts`. Expected: FAIL — happy paths return `NOT_IMPLEMENTED`.
- [ ] **Step 3: Implement** — add these two methods to `AnalyticsResolver`:

```ts
  @Query("getVendorDashboardStatsCardDetails")
  async getVendorDashboardStatsCardDetails(@Args() args: unknown, @Context() context: RequestContext) {
    const auth = await context.auth();
    return this.analytics.vendorStatsCard(auth, parseArgs(argumentSchemas.vendorRange, args));
  }

  @Query("getVendorDashboardGrowthDetailsByYear")
  async getVendorDashboardGrowthDetailsByYear(@Args() args: unknown, @Context() context: RequestContext) {
    const auth = await context.auth();
    return this.analytics.vendorGrowthByYear(auth, parseArgs(argumentSchemas.vendorYear, args));
  }
```

- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `git add services/api/src/modules/analytics/resolver.ts services/api/test/integration/analytics/vendor-dashboards.integration.spec.ts && git commit -m "feat(L9): serve vendor dashboard queries scoped to the vendor's own stores"`

#### Task 14: Cache behaviour, explain plans and read-only enforcement

**Files:**
- Test: `services/api/test/integration/analytics/cache-and-plans.integration.spec.ts`
- Modify only if a test fails for a real defect: `services/api/src/modules/analytics/*.ts`

- [ ] **Step 1: Write the test**

```ts
// services/api/test/integration/analytics/cache-and-plans.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { startStack, type Stack } from "../../support/stack.js";
import { startApi, type Api } from "../../support/app.js";
import { doc } from "../../support/documents.js";
import { op } from "../../support/op.js";
import { analyticsSql, type Sql } from "../../../src/modules/analytics/repository.js";
import { ANALYTICS_POOL } from "../../../src/modules/analytics/module.js";
import { ADMIN_APP, DASHBOARD_FILE, addOrder, expectError, pinPlatform, seedAnalytics, tokenFor, type Seeded } from "./support.js";

let stack: Stack;
let api: Api;
let seeded: Seeded;
beforeAll(async () => {
  stack = await startStack();
  api = await startApi(stack);
});
afterAll(async () => {
  await api?.close();
  await stack?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await stack.reset();
  seeded = await seedAnalytics(stack);
  pinPlatform(api);
});
const as = async (principal: Parameters<typeof tokenFor>[2]) => api.http.withUser(await tokenFor(api, stack, principal));

describe(op("query.getDashboardOrdersByType"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_ORDERS_BY_TYPE");
  it("serves repeated calls from the 30 s cache and recomputes after expiry (R22)", async () => {
    const admin = await as({ type: "ADMIN" });
    expect((await admin.query(query)).data?.getDashboardOrdersByType[0]).toEqual({ value: 9, label: "All" });
    await addOrder(stack, seeded.restaurants.r3.id, seeded.customerId, { at: "2026-06-15T11:00:00Z", totalMinor: 100 });
    expect((await admin.query(query)).data?.getDashboardOrdersByType[0]).toEqual({ value: 9, label: "All" });
    const [key] = await stack.redis.keys("analytics:v1:getDashboardOrdersByType:platform:*");
    const ttl = await stack.redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
    await stack.redis.del(key);
    expect((await admin.query(query)).data?.getDashboardOrdersByType[0]).toEqual({ value: 10, label: "All" });
  });
});

describe(op("query.getRestaurantDashboardOrdersSalesStats"), () => {
  const query = doc(ADMIN_APP, DASHBOARD_FILE, "GET_DASHBOARD_RESTAURANT_ORDERS");
  const vars = (restaurant: string, dateKeyword = "Today") => ({ restaurant, dateKeyword, starting_date: "2026-01-01", ending_date: "2026-06-30" });
  it("keys the cache by authorized scope and never serves it to a non-owner (R7)", async () => {
    const { r1, r2 } = seeded.restaurants;
    await (await as({ type: "ADMIN" })).query(query, vars(r1.id));
    expect(await stack.redis.keys(`analytics:v1:getRestaurantDashboardOrdersSalesStats:restaurant:${r1.id}:*`)).toHaveLength(1);
    expectError(await (await as({ type: "RESTAURANT", userId: r2.ownerUserId })).query(query, vars(r1.id)), "FORBIDDEN", 403);
  });
  it("rolls Today over at local midnight even with a warm cache", async () => {
    const admin = await as({ type: "ADMIN" });
    const r1 = seeded.restaurants.r1.id;
    expect((await admin.query(query, vars(r1))).data?.getRestaurantDashboardOrdersSalesStats).toMatchObject({ totalOrders: 1 });
    pinPlatform(api, { now: "2026-06-16T12:00:00Z" });
    expect((await admin.query(query, vars(r1))).data?.getRestaurantDashboardOrdersSalesStats).toMatchObject({ totalOrders: 0, totalSales: 0 });
  });
  it("still answers when Redis is unavailable (best-effort cache)", async () => {
    await stack.redis.call("CLIENT", "PAUSE", "1500", "ALL");
    const result = await (await as({ type: "ADMIN" })).query(query, vars(seeded.restaurants.r1.id, "All"));
    expect(result.data?.getRestaurantDashboardOrdersSalesStats).toEqual({ totalOrders: 5, totalSales: 108, totalCODOrders: 3, totalCardOrders: 2 });
  });
});

describe("analytics query plans (R23)", () => {
  const ORDER_INDEXES = new Set(["Order_status_restaurantId_deliveredAt_idx", "Order_status_deliveredAt_idx"]);
  type PlanNode = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Plans?: PlanNode[] };
  const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
  async function plan(sql: Sql): Promise<PlanNode[]> {
    const client = await stack.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql.text}`, sql.values);
      await client.query("ROLLBACK");
      return flatten(rows[0]["QUERY PLAN"][0].Plan as PlanNode);
    } finally {
      client.release();
    }
  }
  const seqScans = (nodes: PlanNode[]) => nodes.filter((n) => n["Node Type"] === "Seq Scan").map((n) => n["Relation Name"]);
  const indexes = (nodes: PlanNode[]) => nodes.map((n) => n["Index Name"]).filter(Boolean) as string[];

  it("serves every order aggregate from a status-leading Order index", async () => {
    await stack.pool.query('ANALYZE "Order"; ANALYZE "Restaurant"');
    const { r1 } = seeded.restaurants;
    const range = { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-07-01T00:00:00Z") };
    for (const sql of [
      analyticsSql.orderGroups({ restaurantId: null, vendorId: null, range: null }),
      analyticsSql.orderGroups({ restaurantId: r1.id, vendorId: null, range }),
      analyticsSql.orderGroups({ restaurantId: null, vendorId: seeded.vendors.v1.id, range }),
      analyticsSql.ordersByMonth({ restaurantId: r1.id, vendorId: null }, 2026, "UTC"),
      analyticsSql.ordersByMonth({ restaurantId: null, vendorId: seeded.vendors.v1.id }, 2026, "UTC"),
    ]) {
      const nodes = await plan(sql);
      expect(seqScans(nodes), sql.text).toEqual([]);
      expect(indexes(nodes).some((name) => ORDER_INDEXES.has(name)), sql.text).toBe(true);
    }
  });
  it("serves entity series and lookups from createdAt/vendor indexes", async () => {
    await stack.pool.query('ANALYZE "User"; ANALYZE "Vendor"; ANALYZE "Restaurant"; ANALYZE "Rider"');
    for (const sql of [
      analyticsSql.signupsByMonth(2026, "UTC"),
      analyticsSql.restaurantsCreatedByMonth(seeded.vendors.v1.id, 2026, "UTC"),
      analyticsSql.vendorRestaurantCount(seeded.vendors.v1.id),
      analyticsSql.vendorByIdOrUser(seeded.vendors.v1.userId),
      analyticsSql.restaurant(seeded.restaurants.r1.id),
    ])
      expect(seqScans(await plan(sql)), sql.text).toEqual([]);
  });
});

describe("analytics database access (R1)", () => {
  it("runs on a read-only pool that rejects writes", async () => {
    const pool = api.app.get<Pool>(ANALYTICS_POOL, { strict: false });
    await expect(pool.query('DELETE FROM "DomainEvent"')).rejects.toMatchObject({ code: "25006" });
    const { rows } = await pool.query("SHOW statement_timeout");
    expect(rows[0].statement_timeout).toBe("2s");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/analytics/cache-and-plans.integration.spec.ts`. Expected before the owning lanes add the §4.3 indexes: the plan tests FAIL listing `Seq Scan` on `Order`/`User`/…; everything else PASS. If any non-plan test fails, it is a real defect in Tasks 8–13 — fix it in the module with a new failing unit test first.
- [ ] **Step 3: Implement** — no new production code is expected. If a plan test fails after the indexes exist, adjust only the SQL in `repository.ts` (keep predicates sargable: no casts on indexed columns, `"status" = 'DELIVERED'` via the view) and re-run Task 9's unit test.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS (7 tests).
- [ ] **Step 5: Commit** `git add services/api/test/integration/analytics/cache-and-plans.integration.spec.ts services/api/src/modules/analytics && git commit -m "test(L9): prove scoped caching, indexed plans and read-only access"`

#### Task 15: Coverage, operation gate and handoff

**Files:**
- No new files. Lead updates `docs/OPERATION_COVERAGE.json` via the tool.

- [ ] **Step 1: Run the lane suite**

```bash
pnpm --filter @fairbite/api exec vitest run test/unit/analytics
pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/analytics
```
Expected: all unit (10 files) and integration (6 files) tests PASS.

- [ ] **Step 2: Coverage** — `pnpm coverage`. Expected: thresholds met for `src/modules/analytics/**` (lines ≥ 90 %, branches ≥ 85 %, functions ≥ 90 %). If below, add unit cases for the uncovered branch (for example `AnalyticsRepository.vendorByIdOrUser` returning `null`) before continuing.
- [ ] **Step 3: Gates** — `pnpm lint && pnpm format:check && pnpm typecheck && pnpm build && pnpm check:enatega && node tools/check-operations.mjs --lane L9 --require-implemented --require-tests && node tools/check-error-messages.mjs`. Expected: exit 0; the coverage report lists the 9 operations in §9 with `implemented: true`, `integrationTested: true`.
- [ ] **Step 4: Handoff** — send L10 the specs in §8 and the seed in §8.1; send the lead requests L-1…L-4 status; request L11 review (and L13 for R3–R7 scoping).
- [ ] **Step 5: Commit** any formatting fixes: `git commit -am "chore(L9): satisfy lane gate"` (only if files changed).

---

## 7. Worker jobs and event handlers

**None.** L9 is a pull-based read model (R1, R25): it owns no `services/worker/src/jobs/L9/**` handlers, consumes no domain events and keeps no counters. The W1-0.5 event table lists "L9 (counters)" as an `order.placed` consumer; this plan deliberately replaces counters with indexed aggregates plus a 30 s cache, so no projection can drift from the order source of truth (request L-4). If load testing in Wave 4 shows the all-time platform aggregates exceed the p95 budget, the follow-up is a materialized monthly rollup refreshed by a worker job — not part of this lane's Wave 2 scope.

---

## 8. Playwright specs to hand to L10

All flows are in the multivendor admin (`http://localhost:3000`, project `admin`). Specs use the real Enatega UI; selectors come from the vendored source. Each test title carries its `@op:` tags. No mobile flows exist for L9 (no journey tests).

### 8.1 Seed (L10 adds to `e2e/seed.ts`, file `e2e/seeds/analytics.ts`)

Platform configuration: currency `USD` (exponent 2), timezone `UTC`. Dates are relative to the current UTC year `Y` so the suite is deterministic all year. Password for every owner: `E2e-Passw0rd!` (stored by L1's user builder as an argon2 hash).

```ts
// e2e/seeds/analytics.ts — owned by L10; content specified by L9.
import { writeFileSync } from "node:fs";
import type { Pool } from "pg";
import { factories } from "../../services/api/test/support/factories.js";

export const E2E_PASSWORD = "E2e-Passw0rd!";
export async function seedAnalyticsE2E(pool: Pool) {
  const f = factories(pool);
  const Y = new Date().getUTCFullYear();
  const jan2 = new Date(`${Y}-01-02T12:00:00Z`);
  const lastJune = new Date(`${Y - 1}-06-15T12:00:00Z`);
  await f.user({ type: "ADMIN", email: "admin@e2e.test", password: E2E_PASSWORD });
  await f.user({ type: "STAFF", email: "staff@e2e.test", password: E2E_PASSWORD, permissions: ["Orders"] });
  const c1 = await f.user({ type: "CUSTOMER", createdAt: jan2 });
  await f.user({ type: "CUSTOMER", createdAt: jan2 });
  await f.user({ type: "CUSTOMER", createdAt: lastJune });
  const vendorUser = await f.user({ type: "VENDOR", email: "vendor@e2e.test", password: E2E_PASSWORD, createdAt: jan2 });
  const vendor = await f.vendor({ userId: vendorUser.id, createdAt: jan2 });
  const otherUser = await f.user({ type: "VENDOR", email: "other-vendor@e2e.test", password: E2E_PASSWORD, createdAt: jan2 });
  const other = await f.vendor({ userId: otherUser.id, createdAt: jan2 });
  const ownerA = await f.user({ type: "RESTAURANT", email: "store-a@e2e.test", password: E2E_PASSWORD });
  const storeA = await f.restaurant({ name: "E2E Store A", vendorId: vendor.id, ownerUserIds: [ownerA.id], createdAt: jan2 });
  const storeB = await f.restaurant({ name: "E2E Store B", vendorId: vendor.id, ownerUserIds: [], createdAt: jan2 });
  const storeO = await f.restaurant({ name: "Other Store", vendorId: other.id, ownerUserIds: [], createdAt: jan2 });
  await f.rider({ createdAt: jan2 });
  await f.rider({ createdAt: jan2 });
  const order = (restaurantId: string, at: Date, totalMinor: number, deliveryMinor: number, o: { pickup?: boolean; method?: string; status?: string } = {}) =>
    f.order({
      restaurantId, userId: c1.id, status: o.status ?? "DELIVERED", isPickedUp: o.pickup ?? false, paymentMethod: o.method ?? "COD",
      totalMinor, deliveryMinor, createdAt: at, deliveredAt: (o.status ?? "DELIVERED") === "DELIVERED" ? at : null,
    });
  await order(storeA.id, jan2, 2500, 300); // A1 delivery COD
  await order(storeA.id, jan2, 1800, 0, { pickup: true, method: "STRIPE" }); // A2 pickup card
  await order(storeA.id, lastJune, 4000, 500); // A3 delivery COD, previous year
  await order(storeA.id, jan2, 9900, 300, { status: "CANCELLED" }); // excluded
  await order(storeA.id, jan2, 1200, 100, { status: "PENDING" }); // excluded
  await order(storeB.id, jan2, 3000, 400, { method: "STRIPE" }); // B1 delivery card
  await order(storeO.id, jan2, 7000, 700); // O1 other vendor
  writeFileSync("e2e/.seed-analytics.json", JSON.stringify({ year: Y, vendorId: vendor.id, otherVendorId: other.id, storeAId: storeA.id, storeBId: storeB.id }));
}
```

Expected numbers (all derived from the seed): platform users 3, vendors 2, stores 3, riders 2; orders All 5 / Delivery 4 / Pickup 1; sales $183.00 / $165.00 / $18.00. Vendor (A+B) All: stores 2, sales $113.00, orders 4, deliveries 3; Year: $73.00, 3, 2. Store A All: orders 3, pickup 1, delivery 2, sales $83.00; Year: 2, 1, 1, $43.00; Custom (Y−1)-06-01…(Y−1)-06-30: 1, 0, 1, $40.00.

### 8.2 Shared helpers — `e2e/specs/admin/support/dashboard.ts`

```ts
import type { Page, Response } from "@playwright/test";
import { expect } from "../../../fixtures.js";

export const E2E_PASSWORD = "E2e-Passw0rd!";
// sign-in-email-password/index.tsx:166-221 (placeholders "Email", "Password"; button label "Login").
export async function login(page: Page, email: string) {
  await page.goto("/authentication/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
}
// useable-components/stats-card/index.tsx:23 (div.card), :28 (label), :34 (div.text-2xl total).
export const statsCardValue = (page: Page, label: string) =>
  page.locator("div.card").filter({ has: page.getByText(label, { exact: true }) }).locator("div.text-2xl");
// useable-components/dashboard-stats-table/index.tsx:22-47 (div.shadow-md, h2 title, rows div.flex.justify-between.py-2).
export const statsTableValue = (page: Page, title: string, label: string) =>
  page
    .locator("div.shadow-md")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .locator("div.flex.justify-between.py-2")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("span")
    .nth(1);
// restaurant-stats-table/index.tsx:85-86 (section, HeaderText div.heading-2) and
// dashboard-restaurant-stats-table/index.tsx:31-83 (box with h2 sub-title and four rows).
export const paymentValue = (page: Page, section: "All" | "COD" | "Card", sub: "All" | "Pickup" | "Delivery", label: string) =>
  page
    .locator("div.flex.flex-col.space-y-2")
    .filter({ has: page.locator("div.heading-2", { hasText: new RegExp(`^${section}$`) }) })
    .locator("div.shadow-md")
    .filter({ has: page.getByRole("heading", { name: sub, exact: true }) })
    .locator("div.flex.justify-between.py-2")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("span")
    .nth(1);
// useable-components/date-filter-custom-tab/index.tsx:13-26 (div.h-10.w-fit tab strip).
export const dateTab = (page: Page, label: string) => page.locator("div.h-10.w-fit").getByText(label, { exact: true });
export function operation(page: Page, name: string, match: (variables: Record<string, unknown>) => boolean = () => true): Promise<Response> {
  return page.waitForResponse((response) => {
    if (!response.url().startsWith("http://localhost:4100/graphql") || response.request().method() !== "POST") return false;
    const body = response.request().postDataJSON() as { operationName?: string; variables?: Record<string, unknown> } | null;
    return body?.operationName === name && match(body.variables ?? {});
  });
}
export async function dataOf<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data: T; errors?: unknown[] };
  expect(body.errors ?? []).toEqual([]);
  return body.data;
}
export const months12 = (entries: Record<number, number>) => Array.from({ length: 12 }, (_, i) => entries[i + 1] ?? 0);
```

### 8.3 `e2e/specs/admin/dashboard-super-admin.spec.ts` — route `/home`

```ts
import { test, expect } from "../../fixtures.js";
import { dataOf, login, months12, operation, statsCardValue, statsTableValue } from "./support/dashboard.js";

test.describe("super-admin dashboard (L9)", () => {
  test("cards and Orders/Sales tables show seeded platform numbers @op:query.getDashboardUsers @op:query.getDashboardOrdersByType @op:query.getDashboardSalesByType", async ({ page }) => {
    await login(page, "admin@e2e.test");
    await expect(page).toHaveURL(/\/home$/);
    await expect(statsCardValue(page, "Total Users")).toHaveText("3");
    await expect(statsCardValue(page, "Total Vendors")).toHaveText("2");
    await expect(statsCardValue(page, "Total Stores")).toHaveText("3");
    await expect(statsCardValue(page, "Total Riders")).toHaveText("2");
    await expect(statsTableValue(page, "Orders", "All")).toHaveText("5");
    await expect(statsTableValue(page, "Orders", "Delivery")).toHaveText("4");
    await expect(statsTableValue(page, "Orders", "Pickup")).toHaveText("1");
    await expect(statsTableValue(page, "Sales", "All")).toHaveText("$183.00");
    await expect(statsTableValue(page, "Sales", "Delivery")).toHaveText("$165.00");
    await expect(statsTableValue(page, "Sales", "Pickup")).toHaveText("$18.00");
  });

  test("growth chart receives 12 monthly values for the current year @op:query.getDashboardUsersByYear", async ({ page }) => {
    const year = new Date().getFullYear();
    const response = operation(page, "GetDashboardUsersByYear", (v) => v.year === year);
    await login(page, "admin@e2e.test");
    const data = await dataOf<{ getDashboardUsersByYear: Record<string, number[]> }>(await response);
    expect(data.getDashboardUsersByYear.usersCount).toEqual(months12({ 1: 2 }));
    expect(data.getDashboardUsersByYear.vendorsCount).toEqual(months12({ 1: 2 }));
    expect(data.getDashboardUsersByYear.restaurantsCount).toEqual(months12({ 1: 3 }));
    expect(data.getDashboardUsersByYear.ridersCount).toEqual(months12({ 1: 2 }));
    await expect(page.getByText("Growth Overview")).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible(); // super-admin/home/growth-overview/index.tsx:162
  });

  test("staff without the Admin permission is refused by the server and the cards stay at 0 @op:query.getDashboardUsers", async ({ page, graphqlLog }) => {
    await login(page, "staff@e2e.test");
    await expect(page).toHaveURL(/\/home$/);
    await expect.poll(() => graphqlLog.find((e) => e.operation === "GetDashboardUsers")?.status).toBe(403);
    await expect(statsCardValue(page, "Total Users")).toHaveText("0");
  });
});
```

### 8.4 `e2e/specs/admin/dashboard-vendor.spec.ts` — route `/admin/vendor/dashboard`

```ts
import { readFileSync } from "node:fs";
import { test, expect } from "../../fixtures.js";
import { dataOf, login, months12, operation, statsCardValue } from "./support/dashboard.js";

const seed = () => JSON.parse(readFileSync("e2e/.seed-analytics.json", "utf8")) as { otherVendorId: string };

test.describe("vendor dashboard (L9)", () => {
  test("cards show the vendor's own stores' delivered orders @op:query.getVendorDashboardStatsCardDetails", async ({ page }) => {
    await login(page, "vendor@e2e.test");
    await expect(page).toHaveURL(/\/admin\/vendor\/dashboard$/);
    await expect(statsCardValue(page, "Total Stores")).toHaveText("2");
    await expect(statsCardValue(page, "Total Sales")).toHaveText("$113.00");
    await expect(statsCardValue(page, "Total Orders")).toHaveText("4");
    await expect(statsCardValue(page, "Total Deliveries")).toHaveText("3");
  });

  test("growth chart receives the vendor's monthly series @op:query.getVendorDashboardGrowthDetailsByYear", async ({ page }) => {
    const response = operation(page, "GetVendorDashboardGrowthDetailsByYear");
    await login(page, "vendor@e2e.test");
    const data = await dataOf<{ getVendorDashboardGrowthDetailsByYear: Record<string, number[]> }>(await response);
    expect(data.getVendorDashboardGrowthDetailsByYear).toEqual({
      totalRestaurants: months12({ 1: 2 }), totalOrders: months12({ 1: 3 }), totalSales: months12({ 1: 73 }),
    });
    await expect(page.locator("canvas").first()).toBeVisible(); // vendor/dashboard/growth-overview/index.tsx:176
  });

  test("a vendor cannot read another vendor's dashboard by editing localStorage @op:query.getVendorDashboardStatsCardDetails", async ({ page, graphqlLog }) => {
    await login(page, "vendor@e2e.test");
    await expect(statsCardValue(page, "Total Stores")).toHaveText("2");
    await page.evaluate((id) => localStorage.setItem("vendorId", id), seed().otherVendorId); // layout-vendor.context.tsx:25
    await page.reload();
    await expect
      .poll(() => graphqlLog.filter((e) => e.operation === "GetVendorDashboardStatsCardDetails").at(-1)?.status)
      .toBe(403);
    await expect(statsCardValue(page, "Total Stores")).toHaveText("0");
  });
});
```

### 8.5 `e2e/specs/admin/dashboard-store.spec.ts` — route `/admin/store/dashboard`

```ts
import { test, expect } from "../../fixtures.js";
import { dataOf, login, months12, operation, paymentValue, statsCardValue } from "./support/dashboard.js";

test.describe("store dashboard (L9)", () => {
  test("cards and payment tables show the store's delivered orders @op:query.getRestaurantDashboardOrderSalesDetailsByPaymentMethod", async ({ page }) => {
    await login(page, "store-a@e2e.test");
    await expect(page).toHaveURL(/\/admin\/store\/dashboard$/);
    await expect(statsCardValue(page, "Total Orders")).toHaveText("3");
    await expect(statsCardValue(page, "Pickup Orders")).toHaveText("1");
    await expect(statsCardValue(page, "Delivery Orders")).toHaveText("2");
    await expect(statsCardValue(page, "Total Sales")).toHaveText("$83.00");
    const rows: [Parameters<typeof paymentValue>[1], Parameters<typeof paymentValue>[2], string, string, string, string][] = [
      ["All", "All", "3", "$83.00", "$75.00", "$8.00"],
      ["All", "Pickup", "1", "$18.00", "$18.00", "$0.00"],
      ["All", "Delivery", "2", "$65.00", "$57.00", "$8.00"],
      ["COD", "All", "2", "$65.00", "$57.00", "$8.00"],
      ["COD", "Pickup", "0", "$0.00", "$0.00", "$0.00"],
      ["Card", "All", "1", "$18.00", "$18.00", "$0.00"],
      ["Card", "Delivery", "0", "$0.00", "$0.00", "$0.00"],
    ];
    for (const [section, sub, orders, sales, withoutDelivery, fee] of rows) {
      await expect(paymentValue(page, section, sub, "Total Orders")).toHaveText(orders);
      await expect(paymentValue(page, section, sub, "Total Sales")).toHaveText(sales);
      await expect(paymentValue(page, section, sub, "Total Sales Without Delivery")).toHaveText(withoutDelivery);
      await expect(paymentValue(page, section, sub, "Total Delivery Fee")).toHaveText(fee);
    }
  });

  test("growth chart receives the store's monthly series @op:query.getRestaurantDashboardSalesOrderCountDetailsByYear", async ({ page }) => {
    const response = operation(page, "GetRestaurantDashboardSalesOrderCountDetailsByYear");
    await login(page, "store-a@e2e.test");
    const data = await dataOf<{ getRestaurantDashboardSalesOrderCountDetailsByYear: Record<string, number[]> }>(await response);
    expect(data.getRestaurantDashboardSalesOrderCountDetailsByYear).toEqual({ salesAmount: months12({ 1: 43 }), ordersCount: months12({ 1: 2 }) });
    await expect(page.locator("canvas").first()).toBeVisible(); // restaurant/dashboard/growth-overview/index.tsx:155
  });
});
```

### 8.6 `e2e/specs/admin/dashboard-date-filter.spec.ts` — date filter changes numbers

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "../../fixtures.js";
import { dataOf, dateTab, login, operation, statsCardValue } from "./support/dashboard.js";

const ar = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../vendor/enatega-ui/enatega-multivendor-admin/locales/ar.json", import.meta.url)), "utf8"),
) as Record<string, string>;
const year = () => (JSON.parse(readFileSync("e2e/.seed-analytics.json", "utf8")) as { year: number }).year;

test.describe("dashboard date filter (L9)", () => {
  test("Year and Custom tabs change the store numbers @op:query.getRestaurantDashboardOrderSalesDetailsByPaymentMethod", async ({ page }) => {
    await login(page, "store-a@e2e.test");
    await expect(statsCardValue(page, "Total Orders")).toHaveText("3");
    await dateTab(page, "Year").click(); // restaurant/dashboard/sub-header/index.tsx:19-26
    await expect(statsCardValue(page, "Total Orders")).toHaveText("2");
    await expect(statsCardValue(page, "Pickup Orders")).toHaveText("1");
    await expect(statsCardValue(page, "Delivery Orders")).toHaveText("1");
    await expect(statsCardValue(page, "Total Sales")).toHaveText("$43.00");
    await dateTab(page, "Custom").click();
    const dates = page.locator('input[type="date"]'); // useable-components/date-filter/index.tsx:42-69
    await dates.nth(0).fill(`${year() - 1}-06-01`);
    await dates.nth(1).fill(`${year() - 1}-06-30`);
    const applied = operation(page, "GetRestaurantDashboardOrderSalesDetailsByPaymentMethod", (v) => v.dateKeyword === "Custom" && v.starting_date === `${year() - 1}-06-01`);
    await page.getByRole("button", { name: "APPLY" }).click(); // date-filter/index.tsx:77-82
    await dataOf(await applied);
    await expect(statsCardValue(page, "Total Orders")).toHaveText("1");
    await expect(statsCardValue(page, "Delivery Orders")).toHaveText("1");
    await expect(statsCardValue(page, "Total Sales")).toHaveText("$40.00");
  });

  test("the Arabic Year label is understood by the server @op:query.getRestaurantDashboardOrderSalesDetailsByPaymentMethod @op:query.getVendorDashboardStatsCardDetails", async ({ page, context }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://localhost:3000" }]); // lib/utils/methods/locale.ts:8
    await login(page, "store-a@e2e.test");
    const yearly = operation(page, "GetRestaurantDashboardOrderSalesDetailsByPaymentMethod", (v) => v.dateKeyword === ar["Year"]);
    await dateTab(page, ar["Year"]).click();
    const data = await dataOf<{ getRestaurantDashboardOrderSalesDetailsByPaymentMethod: { total_orders: number; total_sales: number } }>(await yearly);
    expect(data.getRestaurantDashboardOrderSalesDetailsByPaymentMethod).toMatchObject({ total_orders: 2, total_sales: 43 });
    await expect(statsCardValue(page, ar["Total Orders"])).toHaveText("2");
    await expect(statsCardValue(page, ar["Total Sales"])).toHaveText("$43.00");

    await page.evaluate(() => localStorage.clear()); // client-only logout, reference/04 §1.10
    await login(page, "vendor@e2e.test");
    const vendorYearly = operation(page, "GetVendorDashboardStatsCardDetails", (v) => v.dateKeyword === ar["Year"]);
    await dateTab(page, ar["Year"]).click(); // vendor/dashboard/sub-header/index.tsx:41-48
    const vendor = await dataOf<{ getVendorDashboardStatsCardDetails: Record<string, number> }>(await vendorYearly);
    expect(vendor.getVendorDashboardStatsCardDetails).toEqual({ totalRestaurants: 2, totalOrders: 3, totalSales: 73, totalDeliveries: 2 });
  });
});
```

E2E-only notes for L10: `getRestaurantDashboardOrdersSalesStats` has no multivendor UI call site (§2 row 7); it is covered by integration tests and, in Wave 5, by the svadmin store dashboard. The vendor dashboard also calls `getLiveMonitorData` (L6) and the store view calls `getStoreDetailsByVendorIdPaginated` (L3); these specs do not assert them.

---

## 9. Coverage and gate checklist (G2 for L9)

Commands (all must exit 0 on a clean checkout; record in `docs/GATES.json` via the lead):

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm build
pnpm --filter @fairbite/api exec vitest run test/unit/analytics
pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/analytics
pnpm coverage                                   # src/modules/analytics/** ≥ 90 % lines, ≥ 85 % branches, ≥ 90 % functions
pnpm check:enatega                              # staticCompatibility: PASS
node tools/check-operations.mjs --lane L9 --require-implemented --require-tests
node tools/check-error-messages.mjs
pnpm e2e -- e2e/specs/admin/dashboard-super-admin.spec.ts e2e/specs/admin/dashboard-vendor.spec.ts e2e/specs/admin/dashboard-store.spec.ts e2e/specs/admin/dashboard-date-filter.spec.ts
```

Operations that must show `implemented: true` and `integrationTested: true` in `docs/OPERATION_COVERAGE.json` (9):

1. `query.getDashboardUsers`
2. `query.getDashboardUsersByYear`
3. `query.getDashboardOrdersByType`
4. `query.getDashboardSalesByType`
5. `query.getVendorDashboardStatsCardDetails`
6. `query.getVendorDashboardGrowthDetailsByYear`
7. `query.getRestaurantDashboardOrdersSalesStats`
8. `query.getRestaurantDashboardSalesOrderCountDetailsByYear`
9. `query.getRestaurantDashboardOrderSalesDetailsByPaymentMethod`

`e2e: true` is expected for 1–6, 8, 9 after L10 lands §8; 7 has no multivendor UI call site (covered at G5 by svadmin).

Self-review performed: every one of the 9 operations appears in §2 and has tagged integration cases (happy path, auth failure, ownership/permission failure, validation failure, and its rules) in Tasks 11–14; unit coverage in Tasks 4–10.

Independent review: L11 (QA) reviews Tasks 1–15; L13 (security) reviews R2–R7 (scoping, cache isolation) and R1 (read-only pool).

---

## 10. Open questions / blockers

| # | Question / blocker | Default used | Needs |
|---|---|---|---|
| Q1 | Platform dashboards: require STAFF permission `Admin`, or allow any STAFF as the UI does (every STAFF lands on `/home` and sees zeros)? | `Admin` required (ref/04 §B recommendation) | owner |
| Q2 | Sales definition: delivered orders only, gross order total (incl. delivery, tax, tip), attributed to `deliveredAt`. Should counts include accepted/in-progress orders, or should sales exclude tax/tip? | as stated (R8, R9) | owner |
| Q3 | Keyword semantics: Week = rolling 7 days incl. today; Month/Year = current calendar month/year. The admin's `date.sorter.ts` (orders screen only) uses "previous month" and "since last week's Sunday". | rolling 7 days, calendar month/year | owner |
| Q4 | Timezone: platform zone for all dashboards (requires `ConfigPort.timeZone()`, request L-1) vs each store's own zone for store dashboards. | platform zone | lead (L-1), owner |
| Q5 | Labels/semantics of `getDashboardOrdersByType`/`getDashboardSalesByType` rows are UNVERIFIED upstream. | All / Delivery / Pickup | owner |
| Q6 | `getDashboardUsersByYear` arrays: monthly new registrations (chosen) vs cumulative totals; `percentageChange` = year over year (selected by the document, not displayed). | monthly new, YoY | owner |
| Q7 | Cross-lane read contract (§4.3): column names in L1 `User.type`, L3 `Vendor.userId`, `Restaurant.vendorId`, L6 `Rider`, L5 `OrderSummaryView.deliveredAt` + invariant, and eight requested indexes. | as listed | L1, L3, L5, L6 via lead |
| Q8 | Harness: factory builder names/fields (§6.0) and `PRINCIPAL_LOADER` providing `vendorId`/`restaurantIds`; E2E user builder accepting `email`/`password`. | as listed | lead, L1, L10 |
| Q9 | `OPERATION_LANES.json` gives L9 `wave: 5`, master plan schedules L9 in Wave 2. | Wave 2 | lead (regenerate `tools/operation-lanes.mjs` wave map) |
| Q10 | `getRestaurantDashboardOrdersSalesStats` is exported but unused by the multivendor admin UI (used by svadmin). Implemented anyway; no multivendor E2E possible. | implemented | none |
| Q11 | Upstream vendor dashboard January defect (`endDate = YYYY-00-31`): picking Custom then APPLY without editing the end date in January returns `Invalid date`. L9 cannot fix the UI; documented as an integration note. | error returned honestly | owner (accept) |
| Q12 | W1-0.5 lists L9 as an `order.placed` consumer for counters; this plan keeps no counters (request L-4). | no counters | lead |
| Q13 | Single platform currency assumed for summing `totalMinor` across orders; multi-currency platforms are not supported by these dashboards. | single currency | owner |
| B1 | Docker Desktop sign-in (master §10) blocks every integration and E2E command in this plan. | — | owner |
