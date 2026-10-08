# Lane L7 — Payments, ledger & finance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

**Goal:** Implement the 11 L7 GraphQL operations (earnings, transaction history, withdrawals, earnings graphs, commission) and the Stripe REST surface (`/stripe/*`) on top of an immutable, balanced, double-entry ledger, so the unchanged Enatega admin, store and rider apps show wallet and earnings figures derived only from journal lines, and card payments work end to end once Stripe sandbox keys exist (and fail with `PROVIDER_UNAVAILABLE`-style responses until then).

**Architecture:** `modules/finance` owns the chart of accounts, pure posting builders, a transactional journal writer (`postEntry`, idempotency key per source event, DB-enforced balance and immutability), SQL-derived balances (`LedgerPort`), read models (earnings rows, day-bucketed graphs, withdraw requests) and the withdrawal lifecycle. `modules/payments` owns the `PaymentProvider`/`ConnectProvider` ports, a dependency-free Stripe adapter (HMAC webhook verification with `node:crypto`, form-encoded HTTPS calls with idempotency keys), checkout sessions, webhooks, Stripe Connect onboarding and refunds; `rest/stripe.controller.ts` exposes them. The worker's `jobs/L7` consumes `order.transitioned` from the outbox and posts settlements idempotently.

**Tech stack:** NestJS 12 (schema-first GraphQL resolvers + Express REST controllers), `pg` 8 with hand-written SQL, PostgreSQL 17 triggers and partial indexes, zod 4, `node:crypto` (no Stripe SDK — the registry is blocked, master §10, and the SDK is not needed), Vitest 4, Testcontainers, supertest, a local fake Stripe HTTP server for contract tests, Playwright (handed to L10).

---

## 1. Frontend boundary (verbatim from master §1)

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

L7 never edits `vendor/enatega-ui`. The one frontend change this lane needs (E8 below: the admin's `POST /stripe/account` sends no `Authorization` header) is requested from L10 as a recorded "secure session handling" edit; until it lands the endpoint answers 401 and the admin shows its own "Error connecting to Stripe" toast.

---

## 2. Operations

Authority: `implementation/docs/OPERATION_LANES.json`, filter `lane == "L7"` → **11 operations** (8 queries, 3 mutations). All 11 are listed below; the count matches `perLane.L7 = 11`. Paths in "Documents" are relative to `vendor/enatega-ui/<app>/`; every export name was verified by reading the file.

Legend (reference/04 §B): A = ADMIN, S(x) = STAFF with permission `x`, R = RESTAURANT (own store), V = VENDOR (own stores), RI = RIDER (self), C = CUSTOMER.

| # | Type | Name | Apps (multivendor) | Who may call | Documents used in tests (`app`, `file`, `exportName`) | Reference |
|---|---|---|---|---|---|---|
| 1 | query | `earnings` | admin, store | A; S(`Admin`); R/V scoped to own store(s) (`userType` forced to STORE); RI self (not called by apps, allowed read-only) | `enatega-multivendor-admin`, `lib/api/graphql/queries/earnings/index.ts`, `GET_EARNING` and `GET_EARNING_FOR_STORE`; `enatega-multivendor-store`, `lib/apollo/queries/store.query.ts`, `STORE_EARNINGS`; `enatega-multivendor-store`, `lib/apollo/queries/earnings.query.ts`, `STORE_GRAND_TOTAL_EARNINGS` | 04 §5.2, §B; 03 §1.14 |
| 2 | query | `transactionHistory` | admin, rider, store | same as `earnings` | `enatega-multivendor-admin`, `lib/api/graphql/queries/transaction-history/index.ts`, `GET_TRANSACTION_HISTORY`; `enatega-multivendor-store`, `lib/apollo/queries/store.query.ts`, `STORE_TRANSACTIONS_HISTORY`; `enatega-multivendor-rider`, `lib/apollo/queries/rider.query.ts`, `RIDER_TRANSACTIONS_HISTORY` | 04 §5.3; 03 §1.14, §2.15, §D |
| 3 | query | `withdrawRequests` | admin | A; S(`Withdraw Request`); R/V own store(s) | `enatega-multivendor-admin`, `lib/api/graphql/queries/withdraw-requests/index.ts`, `GET_ALL_WITHDRAW_REQUESTS` | 04 §5.4, §B |
| 4 | query | `riderCurrentWithdrawRequest` | rider | RI self; A; S(`Withdraw Request`) | `enatega-multivendor-rider`, `lib/apollo/queries/rider.query.ts`, `RIDER_CURRENT_WITHDRAW_REQUEST` | 03 §2.15, §D |
| 5 | query | `storeCurrentWithdrawRequest` | store | R/V own; A; S(`Withdraw Request`) | `enatega-multivendor-store`, `lib/apollo/queries/store.query.ts`, `STORE_CURRENT_WITHDRAW_REQUEST` | 03 §1.14, §D |
| 6 | query | `riderEarningsGraph` | rider | RI self; A; S(`Riders`) | `enatega-multivendor-rider`, `lib/apollo/queries/earnings.query.ts`, `RIDER_EARNINGS_GRAPH` | 03 §2.15, §D |
| 7 | query | `storeEarningsGraph` | store | R/V own; A; S(`Stores`) | `enatega-multivendor-store`, `lib/apollo/queries/earnings.query.ts`, `STORE_EARNINGS_GRAPH` | 03 §1.14, §D |
| 8 | query | `commissionRate` | admin | A; S(`Commission Rate`) | `enatega-multivendor-admin`, `lib/api/graphql/queries/restaurants/index.ts`, `GET_COMMISSION_RATES_PAGINATED` | 04 §5.1, §B |
| 9 | mutation | `createWithdrawRequest` | admin, rider, store | R (own store) and RI (self) only; A/V/S/C rejected `FORBIDDEN` | `enatega-multivendor-admin`, `lib/api/graphql/mutations/withdraw-requests/index.ts`, `CREATE_WITHDRAW_REQUEST`; `enatega-multivendor-store`, `lib/apollo/mutations/withdraw-request.mutation.ts`, `CREATE_WITHDRAW_REQUEST`; `enatega-multivendor-rider`, `lib/apollo/mutations/withdraw-request.mutation.ts`, `CREATE_WITHDRAW_REQUEST` | 03 §1.14, §2.15, §D; 04 §5.4, §B |
| 10 | mutation | `updateWithdrawReqStatus` | admin | A; S(`Withdraw Request`) | `enatega-multivendor-admin`, `lib/api/graphql/mutations/withdraw-requests/index.ts`, `UPDATE_WITHDRAW_REQUEST` | 04 §5.4, §B, §D.2 |
| 11 | mutation | `updateCommission` | admin | A; S(`Commission Rate`) | `enatega-multivendor-admin`, `lib/api/graphql/mutations/commission-rate/index.ts`, `updateCommission` | 04 §5.1; master D4 |

The single-vendor admin (`svadmin(sv)`) also calls `earnings`, `transactionHistory`, `withdrawRequests`, `createWithdrawRequest`, `updateCommission`, `updateWithdrawReqStatus`; those documents are L12 scope (D1) and are only required to validate statically.

### 2.1 REST routes owned by L7 (`services/api/src/rest/stripe.controller.ts`)

| Method + path | Caller (reference/01 §5.2) | Auth | Behaviour |
|---|---|---|---|
| `GET /stripe/create-checkout-session?id=<orderRef>[&platform=web]` | APP WebView (P6, `Authorization: Bearer`), WEB top-level navigation (P3, no header) | APP: bearer CUSTOMER, must own the order. WEB: no header accepted (R40) | 303 to the Stripe Checkout URL for the server-computed order total; HTML error pages otherwise; 503 "Card payments are not available" until Stripe is configured |
| `GET /stripe/success`, `GET /stripe/cancel` | APP WebView detects `stripe/success` / `stripe/cancel` in the URL; must be on the backend host (P6 allowed hosts) | none | static HTML pages; never change payment state |
| `POST /stripe/webhook` | Stripe | `Stripe-Signature` HMAC-SHA256 over the raw body | marks orders paid (via `OrdersPort.markPaid`), posts the payment journal, emits `order.paid`, updates Connect status |
| `POST /stripe/account` body `{ "restaurantId" }` | ADMIN store Payment screen (P1) | bearer R(own)/V(own)/A/S(`Stores`); **the unmodified admin sends no header → 401** until L10 edit E8 | `{ "url": "https://connect.stripe.com/…" }` Stripe Connect onboarding link |
| `POST /stripe/create-web-checkout-session` | WEB single-vendor (P5) | — | gated behind L12 (D1): HTTP 501 `{ "error": "create-web-checkout-session is not available yet", "code": "NOT_IMPLEMENTED" }` |
| `GET /paypal` | APP PayPal WebView (P7; currently reaches `/graphqlpaypal` because of the upstream URL defect) | — | D12: HTTP 503 HTML "PayPal payments are not available". `/graphqlpaypal` is deliberately **not** served (reference/02 §5.7). |

---

## 3. Contract notes (guides W1-L.1)

Conventions for every L7 type:

- **Money:** every `Float` is major units = `toMajor(minor, exponent)`; the exponent is the one stored on the journal entry / withdraw request (single platform currency from `ConfigPort.currency()`). Inputs (`requestAmount`, `commissionRate`) are validated server-side; amounts are never trusted for balances.
- **Timestamps:** ISO-8601 via `isoString` (`createdAt`, `updatedAt`, `requestTime`, graph `date`). The admin calls `new Date(x).toISOString()` on `requestTime` and `createdAt` (`withdraw-requests-columns.tsx:259-262`, `transaction-history-columns.tsx:48-55`); an epoch-ms string would throw `RangeError`, so ISO is mandatory.
- **Graph day keys:** `_id` of each day bucket is `DD-MM-YYYY` in `FINANCE_TIME_ZONE` — the store parses `value.split("-")` as `[day, month, year]` (`store/lib/ui/screen-components/earnings/view/main/index.tsx:62-70`); the rider prints `_id` as the bar label and parses `date` with `new Date(String(date))` (`rider/lib/ui/screen-components/earnings/view/main/index.tsx:55-63`), so `date` is the ISO instant of the local midnight.
- **Misspellings kept:** `updateWithdrawReqStatus`, `bussinessDetails` (on L3/L6 types selected inside L7 responses), store message "The withdraw amount must be atleast 10 or greater" (copied from `store/lib/ui/screen-components/wallet/view/main/index.tsx:171`).
- **Nested foreign objects:** `RiderEarnings.riderId: Rider`, `StoreEarnings.storeId: Restaurant`, `WithdrawRequest.rider/store`, `TransactionHistory.rider/store`, `CommissionRatePaginated.restaurant: [Restaurant]` are L6/L3 types. L7 resolves them in batch through the requested port methods `RidersPort.summaries` / `RestaurantsPort.summaries` / `RestaurantsPort.list` (§5.1), which return the owning lane's mapper output; every other field (`bussinessDetails`, wallet fields, `stripeDetailsSubmitted`, `commissionRate`, `username`, `unique_restaurant_id`, `orderId` …) is resolved by L3/L6 (wallet fields call `LedgerPort.balances`).
- **Field-level restriction:** `platformEarnings` and `grandTotalEarnings.platformTotal` are `null` unless the viewer is A or S(`Admin`); `storeEarnings` is `null` for a RIDER viewer; `toBank.accountNumber` is masked (`*********6789`) unless the viewer is ADMIN or the payee itself.
- **`PaginationInput` and `DateFilter`** are declared here and are also referenced by L2's `fetchShopTypes(pagination: PaginationInput)` (reference/04 §4 P5); one definition only. The store's unused `STORE_GRAND_TOTAL_EARNINGS` declares `$pagination: PaginationInput, $dateFilter: DateFilter`, which fixes both names.
- `PaginationTotal { total: Int! }` is a core type (W1-0.2 type map).

SDL (complete; replaces whatever W1-0.3 generated for L7):

```graphql
# contracts/enatega/L7-finance.graphql
# Lane L7 — payments, ledger and finance.
# Money: every Float is major units converted from integer minor units (D3).
# Timestamps: ISO-8601 strings (kernel/time.ts isoString) — the admin calls
# new Date(x).toISOString() on requestTime/createdAt, so epoch strings would throw.

# reference/04 §5.2 (admin lib/utils/interfaces/earnings.interface.ts:44-61).
# ALL is declared but the UI maps it to undefined before sending.
enum UserTypeEnum {
  ALL
  RIDER
  STORE
}
enum OrderTypeEnum {
  ALL
  DELIVERY
  PICKUP
}
enum PaymentMethodEnum {
  ALL
  COD
  PAYPAL
  STRIPE
}
# reference/04 §5.1 (commission-rate/view/main/index.tsx:68-81)
enum CommissionRateSortField {
  NAME
  COMMISSION_RATE
}
enum CommissionRateSortOrder {
  ASC
  DESC
}

# P4 pagination (reference/04 §4). Also used by L2 fetchShopTypes.
input PaginationInput {
  pageSize: Int!
  pageNo: Int!
}
# Wallet date filters: full ISO UTC strings or YYYY-MM-DD (reference/04 §4).
input DateFilter {
  starting_date: String
  ending_date: String
}

# Null unless the viewer is ADMIN or STAFF(Admin).
type PlatformEarnings {
  marketplaceCommission: Float!
  deliveryCommission: Float!
  tax: Float!
  platformFee: Float!
  totalEarnings: Float!
}
type RiderEarnings {
  riderId: Rider
  deliveryFee: Float!
  tip: Float!
  totalEarnings: Float!
}
type StoreEarnings {
  storeId: Restaurant
  orderAmount: Float!
  totalEarnings: Float!
}
# One row per delivered order (ORDER_SETTLEMENT journal entry).
type Earnings {
  _id: ID!
  orderId: String!
  orderType: String!
  paymentMethod: String!
  createdAt: String!
  updatedAt: String!
  platformEarnings: PlatformEarnings
  riderEarnings: RiderEarnings
  storeEarnings: StoreEarnings
}
type GrandTotalEarnings {
  platformTotal: Float
  riderTotal: Float!
  storeTotal: Float!
}
type EarningsData {
  earnings: [Earnings!]!
  grandTotalEarnings: GrandTotalEarnings!
}
type EarningsResponse {
  success: Boolean!
  message: String
  data: EarningsData!
  pagination: PaginationTotal!
}

type BankTransferDetails {
  accountName: String
  bankName: String
  accountNumber: String
  accountCode: String
}
# One row per withdraw request (all statuses). transactionId is set on TRANSFERRED.
type TransactionHistory {
  _id: ID!
  amountCurrency: String!
  status: String!
  transactionId: String
  userType: String!
  userId: String!
  amountTransferred: Float!
  createdAt: String!
  toBank: BankTransferDetails
  rider: Rider
  store: Restaurant
}
type TransactionHistoryResponse {
  success: Boolean!
  message: String
  data: [TransactionHistory!]!
  pagination: PaginationTotal!
}

# status ∈ REQUESTED | TRANSFERRED | CANCELLED (PAID is never emitted).
type WithdrawRequest {
  _id: ID!
  requestId: String!
  requestAmount: Float!
  requestTime: String!
  status: String!
  createdAt: String!
  rider: Rider
  store: Restaurant
}
type WithdrawRequestsResponse {
  success: Boolean!
  message: String
  data: [WithdrawRequest!]!
  pagination: PaginationTotal!
}
type WithdrawRequestUpdateResponse {
  success: Boolean!
  message: String
  data: WithdrawRequest
}

type EarningsOrderDetails {
  orderId: String!
  orderType: String!
  paymentMethod: String!
}
type StoreEarningsEntry {
  totalOrderAmount: Float!
  totalEarnings: Float!
  orderDetails: EarningsOrderDetails!
  date: String!
}
# _id: DD-MM-YYYY in FINANCE_TIME_ZONE; date: ISO instant of that local midnight.
type StoreEarningsDay {
  _id: String!
  date: String!
  totalEarningsSum: Float!
  earningsArray: [StoreEarningsEntry!]!
}
type StoreEarningsGraph {
  totalCount: Int!
  earnings: [StoreEarningsDay!]!
}
type RiderEarningsEntry {
  tip: Float!
  deliveryFee: Float!
  totalEarnings: Float!
  orderDetails: EarningsOrderDetails!
  date: String!
}
# totalHours is not tracked (R31): always 0.
type RiderEarningsDay {
  _id: String!
  date: String!
  earningsArray: [RiderEarningsEntry!]!
  totalDeliveries: Int!
  totalEarningsSum: Float!
  totalHours: Float!
  totalTipsSum: Float!
}
type RiderEarningsGraph {
  totalCount: Int!
  earnings: [RiderEarningsDay!]!
}

# P1b (reference/04 §4): `restaurant` is a list despite the singular name.
type CommissionRatePaginated {
  restaurant: [Restaurant!]!
  currentPage: Int!
  totalPages: Int!
  totalCount: Int!
  nextPage: Int
  prevPage: Int
}

extend type Query {
  # admin, store. A, S(Admin), R/V own store, RIDER self. ISO timestamps.
  earnings(
    userId: String
    userType: UserTypeEnum
    orderType: OrderTypeEnum
    paymentMethod: PaymentMethodEnum
    search: String
    pagination: PaginationInput
    dateFilter: DateFilter
  ): EarningsResponse!
  # admin, rider, store. Same rule as earnings; subject from the token when no args.
  transactionHistory(
    userType: UserTypeEnum
    userId: String
    search: String
    pagination: PaginationInput
    dateFilter: DateFilter
  ): TransactionHistoryResponse!
  # admin. A, S(Withdraw Request), R/V own store.
  withdrawRequests(
    userType: UserTypeEnum
    userId: String
    pagination: PaginationInput
    search: String
  ): WithdrawRequestsResponse!
  # rider. RIDER self, A, S(Withdraw Request). The open request or null.
  riderCurrentWithdrawRequest(riderId: String): WithdrawRequest
  # store. R/V own, A, S(Withdraw Request). The open request or null.
  storeCurrentWithdrawRequest(storeId: String): WithdrawRequest
  # rider. RIDER self, A, S(Riders). limit = number of day buckets.
  riderEarningsGraph(
    riderId: ID!
    page: Int
    limit: Int
    startDate: String
    endDate: String
  ): RiderEarningsGraph!
  # store. R/V own, A, S(Stores). limit = number of day buckets.
  storeEarningsGraph(
    storeId: ID!
    page: Int
    limit: Int
    startDate: String
    endDate: String
  ): StoreEarningsGraph!
  # admin. A, S(Commission Rate).
  commissionRate(
    page: Int
    limit: Int
    search: String
    sortBy: CommissionRateSortField
    sortOrder: CommissionRateSortOrder
  ): CommissionRatePaginated!
}

extend type Mutation {
  # admin (store context), store (sends userId), rider (no userId). RESTAURANT and RIDER only.
  createWithdrawRequest(requestAmount: Float!, userId: String): WithdrawRequest!
  # admin. A, S(Withdraw Request). REQUESTED -> TRANSFERRED | CANCELLED only.
  updateWithdrawReqStatus(id: ID!, status: String!): WithdrawRequestUpdateResponse!
  # admin. A, S(Commission Rate). Core plan: always BAD_USER_INPUT (D4).
  updateCommission(id: String!, commissionRate: Float!): Restaurant!
}
```

Fields that other lanes must have on their types because L7 documents select them (raise in W1 review if missing): `Rider { _id name email username phone image available isActive accountNumber currentWalletAmount totalWalletAmount withdrawnWalletAmount createdAt updatedAt bussinessDetails { bankName accountName accountCode accountNumber bussinessRegNo companyRegNo taxRate } }` (L6); `Restaurant { _id unique_restaurant_id orderId orderPrefix name commissionRate image logo address username slug stripeDetailsSubmitted rating reviewAverage isActive isAvailable phone city postCode bussinessDetails {…} }` (L3).

---

## 4. Data model (guides W1-L.2)

### 4.1 Prisma models — `services/api/prisma/schema/L7-finance.prisma`

```prisma
// Lane L7 — ledger, withdrawals, payments. Money is BIGINT minor units (D3).
// Cross-lane ids are scalar columns without relations (docs/CROSS_LANE_FKS.md).

enum LedgerAccountType {
  PLATFORM_CASH
  PLATFORM_REVENUE
  PROVIDER_CLEARING
  CUSTOMER_RECEIVABLE
  RESTAURANT_PAYABLE
  RESTAURANT_CASH_HELD
  RIDER_PAYABLE
  RIDER_CASH_HELD
  PAYOUT_RESERVED
  TIPS_PAYABLE
  TAX_PAYABLE
}

enum LedgerOwnerType {
  PLATFORM
  RESTAURANT
  RIDER
  CUSTOMER
}

enum LedgerSide {
  DEBIT
  CREDIT
}

enum JournalKind {
  ORDER_SETTLEMENT
  ORDER_PAYMENT
  ORDER_REFUND
  WITHDRAWAL_RESERVE
  WITHDRAWAL_SETTLE
  WITHDRAWAL_RELEASE
}

enum LineComponent {
  FOOD
  TAX
  DELIVERY_FEE
  TIP
  COMMISSION
  DELIVERY_MARGIN
  PLATFORM_FEE
  ORDER_TOTAL
  CASH_COLLECTED
  PAYMENT
  REFUND
  WITHDRAWAL
}

enum PayeeType {
  RESTAURANT
  RIDER
}

enum WithdrawStatus {
  REQUESTED
  TRANSFERRED
  CANCELLED
}

enum PaymentSessionStatus {
  OPEN
  COMPLETED
  EXPIRED
}

enum RefundStatus {
  PENDING
  SUCCEEDED
  FAILED
}

model LedgerAccount {
  id        String            @id @db.Uuid
  type      LedgerAccountType
  ownerType LedgerOwnerType
  ownerId   String?           @db.Uuid
  ownerKey  String            @db.VarChar(80)
  currency  String            @db.Char(3)
  createdAt DateTime          @default(now()) @db.Timestamptz(3)
  lines     JournalLine[]

  @@unique([type, ownerKey, currency])
  @@index([ownerType, ownerId])
}

model JournalEntry {
  id                String           @id @db.Uuid
  kind              JournalKind
  idempotencyKey    String           @unique @db.VarChar(200)
  currency          String           @db.Char(3)
  exponent          Int              @db.SmallInt
  postedAt          DateTime         @db.Timestamptz(3)
  orderId           String?          @db.Uuid
  withdrawRequestId String?          @db.Uuid
  orderRef          String?          @db.VarChar(64)
  orderType         String?          @db.VarChar(16)
  paymentMethod     String?          @db.VarChar(16)
  restaurantId      String?          @db.Uuid
  riderId           String?          @db.Uuid
  customerId        String?          @db.Uuid
  grossMinor        BigInt?
  createdAt         DateTime         @default(now()) @db.Timestamptz(3)
  withdrawRequest   WithdrawRequest? @relation(fields: [withdrawRequestId], references: [id], onDelete: Restrict)
  lines             JournalLine[]

  @@index([kind, postedAt])
  @@index([restaurantId, postedAt])
  @@index([riderId, postedAt])
  @@index([orderId])
}

model JournalLine {
  id          String        @id @db.Uuid
  entryId     String        @db.Uuid
  lineNo      Int           @db.SmallInt
  accountId   String        @db.Uuid
  side        LedgerSide
  amountMinor BigInt
  component   LineComponent
  entry       JournalEntry  @relation(fields: [entryId], references: [id], onDelete: Restrict)
  account     LedgerAccount @relation(fields: [accountId], references: [id], onDelete: Restrict)

  @@unique([entryId, lineNo])
  @@index([accountId])
}

model WithdrawRequest {
  id                String         @id @db.Uuid
  requestNumber     BigInt         @unique
  requestRef        String         @unique @db.VarChar(20)
  payeeType         PayeeType
  payeeId           String         @db.Uuid
  requestedByUserId String         @db.Uuid
  amountMinor       BigInt
  currency          String         @db.Char(3)
  exponent          Int            @db.SmallInt
  status            WithdrawStatus @default(REQUESTED)
  requestedAt       DateTime       @db.Timestamptz(3)
  decidedAt         DateTime?      @db.Timestamptz(3)
  decidedByUserId   String?        @db.Uuid
  decidedByType     String?        @db.VarChar(16)
  transactionRef    String?        @unique @db.VarChar(20)
  version           Int            @default(1)
  createdAt         DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime       @default(now()) @db.Timestamptz(3)
  entries           JournalEntry[]

  @@index([payeeType, payeeId, requestedAt])
  @@index([status, requestedAt])
}

model PaymentSession {
  id                String               @id @db.Uuid
  orderId           String               @db.Uuid
  orderRef          String               @db.VarChar(64)
  provider          String               @db.VarChar(16)
  providerSessionId String               @unique @db.VarChar(255)
  url               String               @db.VarChar(2048)
  amountMinor       BigInt
  currency          String               @db.Char(3)
  platform          String               @db.VarChar(8)
  status            PaymentSessionStatus @default(OPEN)
  paymentIntentId   String?              @db.VarChar(255)
  expiresAt         DateTime             @db.Timestamptz(3)
  completedAt       DateTime?            @db.Timestamptz(3)
  createdAt         DateTime             @default(now()) @db.Timestamptz(3)

  @@index([orderId, status])
}

model ProviderEvent {
  id          String    @id @db.VarChar(255)
  provider    String    @db.VarChar(16)
  type        String    @db.VarChar(100)
  receivedAt  DateTime  @default(now()) @db.Timestamptz(3)
  processedAt DateTime? @db.Timestamptz(3)
  outcome     String?   @db.VarChar(64)
}

model StripeConnectAccount {
  restaurantId     String   @id @db.Uuid
  accountId        String   @unique @db.VarChar(255)
  detailsSubmitted Boolean  @default(false)
  chargesEnabled   Boolean  @default(false)
  payoutsEnabled   Boolean  @default(false)
  createdAt        DateTime @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime @default(now()) @db.Timestamptz(3)
}

model PaymentRefund {
  id               String       @id @db.Uuid
  orderId          String       @unique @db.Uuid
  orderRef         String       @db.VarChar(64)
  customerId       String       @db.Uuid
  amountMinor      BigInt
  currency         String       @db.Char(3)
  exponent         Int          @db.SmallInt
  paymentIntentId  String?      @db.VarChar(255)
  status           RefundStatus @default(PENDING)
  providerRefundId String?      @unique @db.VarChar(255)
  attempts         Int          @default(0)
  nextAttemptAt    DateTime     @default(now()) @db.Timestamptz(3)
  lastError        String?      @db.VarChar(100)
  orderMarkedAt    DateTime?    @db.Timestamptz(3)
  createdAt        DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime     @default(now()) @db.Timestamptz(3)

  @@index([status, nextAttemptAt])
}
```

### 4.2 Raw SQL appended to migration `prisma/migrations/202610090170_L7_init/migration.sql`

Generate the Prisma part with `pnpm --filter @fairbite/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script`, keep only L7 tables, then append exactly:

```sql
-- Sequences for human references.
CREATE SEQUENCE "WithdrawRequestNumber" START 1;
CREATE SEQUENCE "PayoutTransactionNumber" START 1;

-- Integer minor units are always positive on lines and requests (D3).
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_exponent_range" CHECK (exponent BETWEEN 0 AND 4);
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_one_source" CHECK (num_nonnulls("orderId", "withdrawRequestId") = 1);
ALTER TABLE "WithdrawRequest" ADD CONSTRAINT "WithdrawRequest_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_amount_positive" CHECK ("amountMinor" > 0);

-- One open (REQUESTED) withdraw request per payee.
CREATE UNIQUE INDEX "WithdrawRequest_one_open_per_payee"
  ON "WithdrawRequest" ("payeeType", "payeeId") WHERE status = 'REQUESTED';

-- Immutable ledger: no UPDATE or DELETE on accounts, entries or lines.
-- (TRUNCATE is not blocked so test/support/stack.ts reset() works; the production
-- database role must not hold TRUNCATE on these tables — Wave 4 security checklist.)
CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger rows are immutable' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER "LedgerAccount_immutable" BEFORE UPDATE OR DELETE ON "LedgerAccount"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER "JournalEntry_immutable" BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER "JournalLine_immutable" BEFORE UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Balanced entries: checked at COMMIT for every entry touched in the transaction.
CREATE FUNCTION ledger_assert_balanced(entry uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  debits bigint;
  credits bigint;
  line_count int;
BEGIN
  SELECT COALESCE(SUM("amountMinor") FILTER (WHERE side = 'DEBIT'), 0),
         COALESCE(SUM("amountMinor") FILTER (WHERE side = 'CREDIT'), 0),
         count(*)
    INTO debits, credits, line_count
    FROM "JournalLine" WHERE "entryId" = entry;
  IF line_count < 2 OR debits <> credits THEN
    RAISE EXCEPTION 'journal entry % is not balanced (debits %, credits %, lines %)',
      entry, debits, credits, line_count USING ERRCODE = 'check_violation';
  END IF;
END
$$;
CREATE FUNCTION ledger_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.id);
  RETURN NULL;
END
$$;
CREATE FUNCTION ledger_line_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW."entryId");
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER "JournalEntry_balanced" AFTER INSERT ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_entry_balanced();
CREATE CONSTRAINT TRIGGER "JournalLine_balanced" AFTER INSERT ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_line_balanced();

-- A line's account currency must equal its entry currency.
CREATE FUNCTION ledger_line_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT currency FROM "LedgerAccount" WHERE id = NEW."accountId")
     IS DISTINCT FROM (SELECT currency FROM "JournalEntry" WHERE id = NEW."entryId") THEN
    RAISE EXCEPTION 'journal line currency mismatch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "JournalLine_currency" BEFORE INSERT ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION ledger_line_currency();

-- Withdraw request lifecycle: terms immutable, REQUESTED -> TRANSFERRED | CANCELLED only, never deleted.
CREATE FUNCTION withdraw_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'withdraw requests cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."amountMinor" <> OLD."amountMinor" OR NEW."payeeType" <> OLD."payeeType"
     OR NEW."payeeId" <> OLD."payeeId" OR NEW.currency <> OLD.currency
     OR NEW."requestRef" <> OLD."requestRef" OR NEW."requestedAt" <> OLD."requestedAt" THEN
    RAISE EXCEPTION 'withdraw request terms are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'REQUESTED' AND NEW.status IN ('TRANSFERRED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'invalid withdraw request transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "WithdrawRequest_guard" BEFORE UPDATE OR DELETE ON "WithdrawRequest"
  FOR EACH ROW EXECUTE FUNCTION withdraw_request_guard();
```

### 4.3 Cross-lane foreign keys for `docs/CROSS_LANE_FKS.md`

Table names follow master §4.2 (`Order`, `Restaurant`, `Rider`, `User`); the lead substitutes the owning lane's final table name if it differs.

| Column | References | On delete |
|---|---|---|
| `JournalEntry.orderId` | `Order.id` (L5) | RESTRICT |
| `JournalEntry.restaurantId` | `Restaurant.id` (L3) | RESTRICT |
| `JournalEntry.riderId` | `Rider.id` (L6) | RESTRICT |
| `JournalEntry.customerId` | `User.id` (L1) | RESTRICT |
| `PaymentSession.orderId` | `Order.id` (L5) | RESTRICT |
| `PaymentRefund.orderId` | `Order.id` (L5) | RESTRICT |
| `PaymentRefund.customerId` | `User.id` (L1) | RESTRICT |
| `StripeConnectAccount.restaurantId` | `Restaurant.id` (L3) | RESTRICT |
| `WithdrawRequest.requestedByUserId` | `User.id` (L1 principal table) | RESTRICT |
| `WithdrawRequest.decidedByUserId` | `User.id` (L1 principal table) | RESTRICT |

Polymorphic, intentionally without FK (validated in the service through ports): `LedgerAccount.ownerId`, `WithdrawRequest.payeeId`.

### 4.4 Factory builders (W1-L.3, appended to `test/support/factories.ts` under `// L7`)

```ts
    // L7
    async stripeConnectAccount(overrides: Partial<{ restaurantId: string; accountId: string; detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean }> = {}) {
      const row = {
        restaurantId: newId(),
        accountId: `acct_${randomBytes(8).toString("hex")}`,
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: false,
        ...overrides,
      };
      await pool.query(
        'INSERT INTO "StripeConnectAccount"("restaurantId", "accountId", "detailsSubmitted", "chargesEnabled", "payoutsEnabled") VALUES ($1, $2, $3, $4, $5)',
        [row.restaurantId, row.accountId, row.detailsSubmitted, row.chargesEnabled, row.payoutsEnabled],
      );
      return row;
    },
```

Journal entries and withdraw requests are **not** seeded by factories: they must go through `postEntry` (balanced) and the withdrawal service, so tests seed them with the lane's own functions (`handleOrderTransitioned`, `createWithdrawRequest`).

---

## 5. Business rules

### 5.1 Dependencies requested from the lead (shared files L7 may not edit)

These are prerequisites for Wave 2 Task 3 onward. Each is a small, additive change; the lead applies them in `kernel/**`, `config.ts`, `app.ts`, `test/support/**` and `package.json`.

**D-L7-1 Port additions in `services/api/src/kernel/ports.ts`:**

```ts
export type GraphqlParent = { _id: string } & Record<string, unknown>;
export type PayoutProfile = {
  hasBusinessDetails: boolean; // bankName, accountName, accountNumber and accountCode all non-empty
  bankName: string | null;
  accountName: string | null;
  accountCode: string | null;
  accountNumber: string | null;
};
export type RestaurantListInput = {
  page: number;
  limit: number;
  search: string | null;
  sortBy: "NAME" | "COMMISSION_RATE";
  sortOrder: "ASC" | "DESC";
};
// RestaurantsPort (L3) — add:
//   summaries(ids: string[]): Promise<Map<string, GraphqlParent>>;   // L3 mapper output for type Restaurant
//   list(input: RestaurantListInput): Promise<{ rows: GraphqlParent[]; total: number }>; // non-deleted, name ILIKE search; COMMISSION_RATE ties broken by name
//   payoutProfile(id: string): Promise<PayoutProfile | null>;        // decrypted bussinessDetails
// RidersPort (L6) — add:
//   summaries(ids: string[]): Promise<Map<string, GraphqlParent>>;   // L6 mapper output for type Rider
//   payoutProfile(id: string): Promise<PayoutProfile | null>;
// OrdersPort (L5) — add (both idempotent: repeating with the same reference returns the same snapshot):
//   getByOrderRef(orderRef: string): Promise<OrderSnapshot | null>;  // human orderId
//   markRefunded(id: string, providerReference: string, refundedMinor: number): Promise<OrderSnapshot>;
// PaymentsPort (L7) — add:
//   stripeDetailsSubmitted(restaurantIds: string[]): Promise<Map<string, boolean>>; // for L3 Restaurant.stripeDetailsSubmitted
export const SECRETS_PORT = Symbol("SECRETS_PORT");
export interface SecretsPort {                       // L2 (provider-secret store, reference/04 §C)
  get(name: "stripe.secretKey" | "stripe.webhookSecret"): Promise<string | null>;
}
```

`stripe.secretKey` is written by L2's `saveStripeConfiguration`; `stripe.webhookSecret` has no admin UI and is provisioned by operations into the same store (L2 imports env `STRIPE_WEBHOOK_SECRET` at boot). `OrdersPort.markPaid` must also be idempotent (same reference → same snapshot, no second event).

**D-L7-2 `services/api/src/config.ts`** — add to the zod object:

```ts
    STRIPE_API_BASE_URL: z.url().default("https://api.stripe.com"),
    WEB_PUBLIC_URL: z.url().default("http://localhost:3001"),
    ADMIN_PUBLIC_URL: z.url().default("http://localhost:3000"),
    FINANCE_TIME_ZONE: z
      .string()
      .default("UTC")
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "Unknown time zone"),
```

and to the `superRefine` body:

```ts
    if (value.APP_ENV === "production") {
      if (value.STRIPE_API_BASE_URL !== "https://api.stripe.com")
        context.addIssue({ code: "custom", path: ["STRIPE_API_BASE_URL"], message: "Production must use https://api.stripe.com" });
      for (const key of ["WEB_PUBLIC_URL", "ADMIN_PUBLIC_URL"] as const)
        if (new URL(value[key]).protocol !== "https:")
          context.addIssue({ code: "custom", path: [key], message: "https required" });
    }
```

**D-L7-3 `services/api/src/app.ts`:** `NestFactory.create(AppModule, { rawBody: true })` (the webhook needs `req.rawBody`); add `FinanceModule.register(config)` and `PaymentsModule.register(config)` to `imports`. Both modules are `global: true` and provide `LEDGER_PORT` / `PAYMENTS_PORT` through the lead's port-registration mechanism (replacing the Wave 1 `NOT_IMPLEMENTED` providers).

**D-L7-4 `services/api/src/kernel/auth/resolver.ts`:** export the HTTP auth resolver already built inside `createApp` (A9) as a global provider so REST controllers can authenticate exactly like GraphQL:

```ts
import type { AuthContext } from "./guards.js";
export type AuthResolver = (authorizationHeader: string) => Promise<AuthContext | null>;
export const AUTH_RESOLVER = Symbol("AUTH_RESOLVER");
```

**D-L7-5 Test harness override (`test/support/app.ts`):** `startApi(stack, env, { ports })` where `ports: Map<symbol, unknown>` replaces the provider for each given token (any `kernel/ports.ts` token, `SESSION_VALIDATOR`, `PRINCIPAL_LOADER`) before `app.init()`. L7 integration tests inject lane-local fakes for L1/L2/L3/L5/L6 ports so Wave 2 does not wait for other lanes; the Wave 3 journeys run without overrides.

**D-L7-6 Worker import:** add to `services/api/package.json` `"exports": { "./finance-ledger": { "types": "./dist/modules/finance/ledger/index.d.ts", "default": "./dist/modules/finance/ledger/index.js" } }`; add `"@fairbite/api": "workspace:*"` (dependency) to `@fairbite/worker`; make the worker build depend on the API build in `turbo.json`; `services/worker/src/jobs/outbox.ts` dispatches to the `handlers` exported by `services/worker/src/jobs/L7/index.ts`, signature `(event: { id: string; type: string; payload: unknown; createdAt: Date }, db: Pool) => Promise<void>`.

**D-L7-7 L10 recorded frontend edit E8 (secure session handling):** in `vendor/enatega-ui/enatega-multivendor-admin/lib/ui/screen-components/protected/restaurant/payment/main/index.tsx:58-60` add an `Authorization` header with value `"Bearer " + (localStorage.getItem("token") ?? "")` to the existing `fetch` headers (token key `token`, `lib/utils/methods/auth.ts:10-17`; the single-vendor admin already sends it, reference/01 §5.2 P2). Record in `SOURCE_PROVENANCE.json` `allowedModifications` and re-run `node tools/manifest-enatega-ui.mjs`. Without it `POST /stripe/account` returns 401 and the admin shows its own "Error connecting to Stripe" toast.

### 5.2 Chart of accounts

| Account type | Owner | Normal side | Meaning |
|---|---|---|---|
| `PLATFORM_CASH` | platform | debit | platform bank money; credited when a payout is confirmed (manual in v1) |
| `PLATFORM_REVENUE` | platform | credit | commission (0 % on core), delivery margin, platform fees |
| `PROVIDER_CLEARING` | platform | debit | money held by Stripe for the platform |
| `CUSTOMER_RECEIVABLE` | customer | debit | what a customer owes; a credit balance means the customer prepaid by card |
| `RESTAURANT_PAYABLE` | restaurant | credit | store wallet: what the platform owes the store |
| `RESTAURANT_CASH_HELD` | restaurant | debit | cash a store collected on COD takeaway orders (store owes platform) |
| `RIDER_PAYABLE` | rider | credit | rider wallet |
| `RIDER_CASH_HELD` | rider | debit | cash a rider collected on COD delivery (rider owes platform) |
| `PAYOUT_RESERVED` | restaurant or rider | credit | funds reserved by an open withdraw request |
| `TIPS_PAYABLE` | platform | credit | tips on takeaway orders (no rider), held pending owner policy (Q4) |
| `TAX_PAYABLE` | platform | credit | tax when the platform is the tax collector (policy switch, default off) |

### 5.3 Posting tables (integer minor units; worked examples in USD, exponent 2)

Example order E: items 2500, discount 0, tax 200, delivery 300, tip 100, total 3100, restaurant S, rider R, customer U. Policy defaults (`finance/policy.ts`): `commissionPercent 0` (D4 core plan), `riderDeliverySharePercent 100`, `taxCollector "RESTAURANT"` (reference/03 §D: restaurant credit = food + tax).

Zero-amount lines are omitted. `foodNet = items − discount`; `commission = percentOf(foodNet, commissionPercent)`; `riderDelivery = percentOf(delivery, riderDeliverySharePercent)`. The builder throws `PostingError` when `foodNet + tax + delivery + tip ≠ total`, when `discount > items`, or when a delivery order has no rider.

**P1 ORDER_SETTLEMENT, COD delivery** (key `order:<id>:settlement`; on `order.transitioned` to DELIVERED)

| Side | Account | Component | E |
|---|---|---|---|
| Dr | RIDER_CASH_HELD(R) | CASH_COLLECTED | 3100 |
| Cr | RESTAURANT_PAYABLE(S) | FOOD | 2500 |
| Cr | PLATFORM_REVENUE | COMMISSION | 0 (omitted) |
| Cr | RESTAURANT_PAYABLE(S) | TAX | 200 |
| Cr | RIDER_PAYABLE(R) | DELIVERY_FEE | 300 |
| Cr | PLATFORM_REVENUE | DELIVERY_MARGIN | 0 (omitted) |
| Cr | RIDER_PAYABLE(R) | TIP | 100 |

Result: store wallet total = current = 27.00; rider wallet total = current = 4.00; the rider holds 31.00 cash owed to the platform (not shown in any app; Q3).

**P2 ORDER_SETTLEMENT, card (STRIPE) delivery** — identical credits; the debit line is `Dr CUSTOMER_RECEIVABLE(U) ORDER_TOTAL 3100`. Posting does not depend on whether the payment entry (P5) arrived first; the receivable nets to 0 once both exist.

**P3 ORDER_SETTLEMENT, takeaway (isPickedUp) COD**, order T: items 1800, tax 144, delivery 0, tip 50, total 1994

| Side | Account | Component | T |
|---|---|---|---|
| Dr | RESTAURANT_CASH_HELD(S) | CASH_COLLECTED | 1994 |
| Cr | RESTAURANT_PAYABLE(S) | FOOD | 1800 |
| Cr | RESTAURANT_PAYABLE(S) | TAX | 144 |
| Cr | PLATFORM_REVENUE | DELIVERY_MARGIN | delivery fee (0, omitted) |
| Cr | TIPS_PAYABLE | TIP | 50 |

Card takeaway: the debit is `CUSTOMER_RECEIVABLE(U) ORDER_TOTAL`.

**P4 tax-collector variant** (`taxCollector: "PLATFORM"`): the TAX line credits `TAX_PAYABLE` instead of `RESTAURANT_PAYABLE` (E: store 25.00, TAX_PAYABLE 2.00).

**P5 ORDER_PAYMENT** (key `order:<id>:payment`; on a verified `checkout.session.completed` with `payment_status = "paid"`): `Dr PROVIDER_CLEARING PAYMENT 3100 / Cr CUSTOMER_RECEIVABLE(U) PAYMENT 3100`.

**P6 cancellation before payment** (COD, or card not yet paid): no entry (no money moved); the handler returns `"ignored"`.

**P7 cancellation after payment** (snapshot `paymentStatus = "PAID"`, or a payment webhook for an order already `CANCELLED`): insert `PaymentRefund` (PENDING, unique per order). When the provider refund succeeds, post **ORDER_REFUND** (key `order:<id>:refund`): `Dr CUSTOMER_RECEIVABLE(U) REFUND 3100 / Cr PROVIDER_CLEARING REFUND 3100`, then `OrdersPort.markRefunded`.

**P8 tip** — tips are part of the order total and are posted inside P1–P3 (`TIP` component): to the rider on delivery orders, to `TIPS_PAYABLE` on takeaway orders. No app has a tip-after-delivery operation.

**P9 WITHDRAWAL_RESERVE** (key `withdraw:<id>:reserve`; inside the `createWithdrawRequest` transaction): `Dr <PAYABLE>(payee) WITHDRAWAL / Cr PAYOUT_RESERVED(payee) WITHDRAWAL`. Example: S requests 20.00 → S balances total 2700, pending 2000, withdrawn 0, current 700.

**P10 WITHDRAWAL_SETTLE** (key `withdraw:<id>:settle`; `updateWithdrawReqStatus(TRANSFERRED)`): `Dr PAYOUT_RESERVED(payee) / Cr PLATFORM_CASH`. S: total 2700, pending 0, withdrawn 2000, current 700.

**P11 WITHDRAWAL_RELEASE** (key `withdraw:<id>:release`; `updateWithdrawReqStatus(CANCELLED)`): `Dr PAYOUT_RESERVED(payee) / Cr <PAYABLE>(payee)`. S after cancelling the 20.00 request instead: total 2700, pending 0, withdrawn 0, current 2700.

**Balances** (`LedgerPort.balances`, SQL over lines): `total` = Σ credits to the payee's PAYABLE in ORDER_SETTLEMENT entries; `pending` = PAYOUT_RESERVED balance (credits − debits); `withdrawn` = Σ PAYOUT_RESERVED debits in WITHDRAWAL_SETTLE entries; `current` = PAYABLE balance (credits − debits) = total − pending − withdrawn.

### 5.4 Rules

- **R1** Money is integer minor units in every table and computation; conversion to `Float` happens only in mappers via `toMajor` with the entry's exponent. `requestAmount` is converted with `toMinor` and rejected with `BAD_USER_INPUT` "Invalid amount" when non-finite, ≤ 0, or carrying more decimals than the currency exponent.
- **R2** Journal entries and lines are immutable (DB triggers reject UPDATE/DELETE with `ledger rows are immutable`) and balanced (deferred constraint triggers reject at COMMIT; `assertBalanced` rejects before any SQL). Line amounts are positive integers; every entry has ≥ 2 lines; line account currency = entry currency.
- **R3** Every entry has an idempotency key unique per source event (§5.3). `postEntry` uses `INSERT … ON CONFLICT ("idempotencyKey") DO NOTHING` and returns `{ created: false }` on replay, so outbox redelivery, webhook redelivery and retries never double-post.
- **R4** Wallet balances (`totalWalletAmount`, `currentWalletAmount`, `withdrawnWalletAmount` on Restaurant and Rider) are never stored; `LedgerPort.balances` computes them from lines in the platform currency. L3/L6 resolve those fields through `LEDGER_PORT`.
- **R5** Settlement credits happen exactly at DELIVERED (store `orderPickedUp` for takeaway, rider `updateOrderStatusRider` for delivery; reference/03 §D), from the `order.transitioned` outbox event. `postedAt` = the event's `createdAt`, so retries never move an order into another day bucket.
- **R6** Core-plan food commission is 0 % (D4): `percentOf(foodNet, 0) = 0`, so `marketplaceCommission` is 0 and no COMMISSION line is written.
- **R7** `earnings` rows are projections of ORDER_SETTLEMENT entries (one per delivered order): `platformEarnings { marketplaceCommission = COMMISSION, deliveryCommission = DELIVERY_MARGIN, tax = TAX credited to TAX_PAYABLE, platformFee = PLATFORM_FEE (0 in v1), totalEarnings = commission + deliveryMargin + platformFee }`; `riderEarnings { deliveryFee, tip, totalEarnings = deliveryFee + tip }` (null for takeaway); `storeEarnings { orderAmount = FOOD credited to the store, totalEarnings = FOOD + TAX credited to the store }`. `grandTotalEarnings` sums PLATFORM_REVENUE / RIDER_PAYABLE / RESTAURANT_PAYABLE credits over the whole filtered set, not the page. `orderType` is `DELIVERY` or `PICKUP`.
- **R8** `earnings`/`transactionHistory` filters: `userType` (`ALL` ≡ absent), `userId` (platform viewers must also send `userType`, else "userType is required with userId"), `orderType`, `paymentMethod` (`ALL` ≡ absent), `search` (case-insensitive substring of `orderRef` / `requestRef` / `transactionRef`, LIKE wildcards escaped), `dateFilter` (ISO instant or `YYYY-MM-DD`; a date-only `ending_date` includes that whole UTC day, an ISO end instant is inclusive; unparseable → "Invalid date"; start ≥ end → "Invalid date range"), `pagination { pageNo, pageSize }` → `paginate({ page: pageNo, limit: pageSize, maxLimit: 100 })` (the super-admin sends `pageSize + 30`). Response P4 `{ success: true, message: null, data, pagination: { total } }`, newest first.
- **R9** Subject resolution (reference/03 §D, reference/04 §B). Platform viewers: ADMIN, or STAFF holding the operation's permission (`Admin` for earnings/transactionHistory, `Withdraw Request` for withdrawRequests). RESTAURANT/VENDOR: scoped to `auth.restaurantIds`; `userType: RIDER` → FORBIDDEN; `userId` outside their stores → FORBIDDEN; no stores → FORBIDDEN. RIDER: scoped to `auth.riderId`; `userType: STORE` or a foreign `userId` → FORBIDDEN. STAFF without the permission and CUSTOMER → FORBIDDEN. Anonymous → UNAUTHENTICATED (HTTP 401).
- **R10** `storeEarningsGraph`/`storeCurrentWithdrawRequest`: `storeId` must belong to the caller unless A or S(`Stores` / `Withdraw Request` respectively); a missing `storeId` (only possible on `storeCurrentWithdrawRequest`) means the caller's single store, otherwise "Select a store". `riderEarningsGraph`/`riderCurrentWithdrawRequest` likewise with `riderId` and S(`Riders` / `Withdraw Request`), "Select a rider". Malformed ids → `BAD_USER_INPUT` "Invalid store id" / "Invalid rider id".
- **R11** Graphs bucket ORDER_SETTLEMENT entries per local day in `FINANCE_TIME_ZONE` (`(postedAt AT TIME ZONE tz)::date`), newest day first; only days with at least one delivered order appear; `limit` = number of day buckets (default 10, max 366), `page` 1-based; `totalCount` = number of non-empty days in the range. Store entry: `totalOrderAmount` = order total, `totalEarnings` = credits to that store's PAYABLE; bucket `totalEarningsSum` = Σ entry `totalEarnings`. Rider entry: `deliveryFee`, `tip`, `totalEarnings = deliveryFee + tip`; bucket `totalDeliveries` = entry count, `totalTipsSum`, `totalEarningsSum`.
- **R12** `createWithdrawRequest` is allowed for RESTAURANT and RIDER callers only (`requireAuth(auth, "RESTAURANT", "RIDER")` plus an explicit type check, because ADMIN passes `requireAuth`); ADMIN, VENDOR, STAFF, CUSTOMER → FORBIDDEN (reference/04 §B recommendation). The payee is derived from the token; `userId` (the store sends its restaurant id, the rider and the admin store-context send none) must equal the caller's restaurant/rider when given, else FORBIDDEN.
- **R13** Withdraw validation order: amount format (R1) → minimum `amountMinor ≥ 10 × 10^exponent`, else "The withdraw amount must be atleast 10 or greater" → payout profile exists (else NOT_FOUND) and `hasBusinessDetails`, else "Add your bank details before requesting a withdrawal" → inside the transaction, under `pg_advisory_xact_lock(hashtextextended('withdraw:<type>:<id>', 0))`: no open request, else "You already have a pending withdraw request" (also mapped from the partial unique index violation `23505`) → `amountMinor ≤ current`, else "Withdraw amount exceeds your available balance". On success, in one transaction: insert `WithdrawRequest` (REQUESTED, `requestRef` `WR000001`…), post P9, enqueue `withdraw.updated { requestId, status: "REQUESTED" }`. Returns the `WithdrawRequest` including its `rider`/`store` parent. The store app shows the error `message` verbatim in an Alert (`store/.../wallet/view/main/index.tsx:119-125`).
- **R14** `updateWithdrawReqStatus(id, status)`: `requirePermission(auth, "Withdraw Request")`; `parseId` ("Invalid withdraw request id"); `status ∉ {REQUESTED, TRANSFERRED, CANCELLED}` → "Invalid withdraw request status"; `SELECT … FOR UPDATE`; missing → NOT_FOUND; only `REQUESTED → TRANSFERRED | CANCELLED` (central table `finance/withdraw-transitions.ts`, mirrored by the DB trigger): same status → "Withdraw request is already <STATUS>", anything else → "Withdraw request cannot change from <FROM> to <TO>". TRANSFERRED sets `transactionRef` (`TXN000001`…) from a sequence and posts P10; CANCELLED posts P11; both enqueue `withdraw.updated` and call `AuditPort.record({ action: "withdraw.transferred" | "withdraw.cancelled", entity: "WithdrawRequest", entityId, changes: { from, to, amount, manualPayout } })` before COMMIT (an audit failure rolls the change back). Response `{ success: true, message: "Withdraw request updated", data }`. The admin dropdown also offers REQUESTED; it is rejected for non-REQUESTED rows by the same rule.
- **R15** TRANSFERRED is a **manual admin confirmation** in v1: FairBite has no payout provider (reference/04 §D.2), so the admin pays the bank account outside FairBite and then marks the request; the server moves no money and the audit entry records `manualPayout: true`. `PAID` is never emitted (reference/03 §D: UNVERIFIED distinction).
- **R16** `withdrawRequests` lists requests (all statuses) newest first, P4 shape with `message: null`; filters `userType` → payee type, `userId`, `search` on `requestRef`. Status filtering stays client-side (reference/04 §4). Each row carries `rider` (rider payee) or `store` (restaurant payee); the other is null.
- **R17** `transactionHistory` lists withdraw requests (all statuses, R8 filters) as payout records: `amountTransferred` = requested amount, `amountCurrency` = ISO code, `transactionId` = `transactionRef` (null until TRANSFERRED), `userType` `RIDER`/`STORE`, `userId` = payee id, `createdAt` = request creation time, `toBank` = the payee's current payout profile with the account number masked (`"*".repeat(length − 4) + last 4`) unless the viewer is ADMIN or the payee. UNVERIFIED (reference/04 §5.3): upstream may list only executed payouts; the store/rider UIs render REQUESTED/CANCELLED too, so all statuses are returned.
- **R18** `storeCurrentWithdrawRequest`/`riderCurrentWithdrawRequest` return the payee's single REQUESTED request or `null`.
- **R19** `commissionRate`: `requirePermission("Commission Rate")`; `paginate({ page, limit })`; rows from `RestaurantsPort.list` (search, `sortBy` default `NAME`, `sortOrder` default `ASC`); response P1b `{ restaurant, currentPage, totalPages, totalCount, nextPage, prevPage }` (`nextPage`/`prevPage` Int or null). Every core restaurant shows `commissionRate: 0` (resolved by L3).
- **R20** `updateCommission(id, commissionRate)`: `requirePermission("Commission Rate")` → `parseId` ("Invalid restaurant id") → finite and `0 ≤ rate ≤ 100`, else "Commission rate must be between 0 and 100" → restaurant exists (else NOT_FOUND) → core plan → `BAD_USER_INPUT` **"Commission is fixed at 0% on the core plan"** (D4). No other plan exists, so nothing is ever written. The admin shows "Error updating commission rate for <name>" (`commission-rate/view/main/index.tsx:118-124`).
- **R21** No L7 operation publishes a GraphQL subscription. Outbox events (same transaction as the change): `withdraw.updated { requestId, status }` (L8 notifies), `order.paid { orderId, providerReference, paidMinor }` (L5/L8).
- **R22** Outbox consumer `order.transitioned`: `to = DELIVERED` → P1/P2/P3; `to = CANCELLED` with `paymentStatus = PAID` → schedule refund (P7); everything else is ignored. Idempotent by R3 and by `PaymentRefund.orderId` uniqueness. A `PostingError` (non-reconciling order) throws so the outbox retries and finally dead-letters (`outbox_dead_letter`); a partial or unbalanced entry is never written.
- **R23** Stripe availability (D12): `PaymentsPort.available("STRIPE")` is true only when `SecretsPort` holds `stripe.secretKey` (`sk_`/`rk_` + `test|live` + `_…`) and `stripe.webhookSecret`, and the platform currency's exponent equals Stripe's (zero-decimal BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF UGX VND VUV XAF XOF XPF → 0; three-decimal BHD JOD KWD OMR TND unsupported; others 2). `available("PAYPAL")` is always false. L5 uses this to reject `placeOrder(paymentMethod: STRIPE)` with "Card payments are not available".
- **R24** Checkout (`GET /stripe/create-checkout-session`): not configured or unsupported currency → 503 page "Card payments are not available"; `id` must match `^[A-Za-z0-9-]{1,64}$` (400 "Invalid order reference"); bad/expired bearer → 401 "Your session has expired. Sign in and try again."; no bearer and `platform ≠ web` → 401 "Sign in to pay for this order"; unknown order → 404 "Order not found"; bearer of a non-CUSTOMER or another customer → 403 "This order belongs to another account"; `paymentMethod ≠ STRIPE` → 409 "This order is not paid by card"; already PAID → 303 to the success URL; CANCELLED → 409 "This order was cancelled"; an OPEN session for the same order and platform with ≥ 60 s left and the same amount → 303 to it; otherwise create a Checkout Session for exactly `order.totalMinor` in `order.currency.code` (lower-case), one line item named `Order <orderRef>` (no PII), `client_reference_id` and `metadata[orderId]` = order uuid, `expires_at` = start of the current 30-minute bucket + 61 min (deterministic per idempotency key `checkout:<orderId>:<version>:<platform>:<bucket>`, always 31–61 min ahead; Stripe requires at least 30), store a `PaymentSession`, 303 to `session.url` (must be `https://*.stripe.com`, else 502). Stripe errors → 502 "Card payments are temporarily unavailable. Try again later.". The amount always comes from the server's order snapshot.
- **R25** Return URLs: `platform=web` → `<WEB_PUBLIC_URL>/stripe/success?id=<orderRef>` and `/stripe/cancel?id=<orderRef>` (the web pages poll `orders`); otherwise `<PUBLIC_BASE_URL>/stripe/success?id=<orderRef>` / `/stripe/cancel?id=…` on the backend host, because the app WebView only allows Stripe hosts and the backend host (`app/src/screens/Stripe/StripeCheckout.js:43-53,168-176`). `GET /stripe/success` → 200 "Payment received" / "Your payment is being confirmed. You can return to the app."; `GET /stripe/cancel` → 200 "Payment cancelled" / "No payment was taken. You can return to the app.". Both are static (`cache-control: no-store`, CSP `default-src 'none'`) and never change state; only the webhook marks payment.
- **R26** Webhook (`POST /stripe/webhook`): not configured → 503 `{ error: "Card payments are not available" }`; missing body → 400 `{ error: "Invalid payload" }`; verify `Stripe-Signature` (`t=<unix>,v1=<hex>`; HMAC-SHA256 of `"<t>." + rawBody` with the webhook secret; constant-time comparison against every `v1`; tolerance 300 s) → otherwise 400 `{ error: "Invalid signature" }`; malformed JSON → 400 `{ error: "Invalid payload" }`; dedupe by Stripe event id in `ProviderEvent` (already processed → 200 without side effects). `checkout.session.completed` / `checkout.session.async_payment_succeeded` with `payment_status = "paid"`: the session must be ours (else outcome `unknown_session`), match `client_reference_id` (`order_mismatch`), already-completed sessions are `already_paid`, and `amount_total`, `currency` and the current order total must all equal the stored session (`amount_mismatch`, logged `stripe_amount_mismatch`, not marked paid — Q6). Then `OrdersPort.markPaid(order.id, payment_intent, amount)` and, in one transaction, P5 + session COMPLETED + `order.paid` + (if the order is CANCELLED) refund scheduling + event processed. `checkout.session.expired` → session EXPIRED. `account.updated` → `StripeConnectAccount` flags. Other types → `ignored`. Business outcomes return 200 so Stripe stops retrying; infrastructure failures return 500 so Stripe retries.
- **R27** Connect (`POST /stripe/account`): bearer required (401 `{ error: "Sign in required" }`; bad token 401 `{ error: "Session expired" }`); types RESTAURANT, VENDOR, STAFF, ADMIN (others 403 `{ error: "Not allowed" }`); `restaurantId` valid uuid (400 `{ error: "Invalid restaurant id" }`) and owned unless A or S(`Stores`) (403 `{ error: "Not allowed for this store" }`); not configured → 503 `{ error: "Card payments are not available", message: "Card payments are not available" }` (never a fabricated URL, reference/04 §5.7); unknown store → 404 `{ error: "Store not found" }`; reuse or create an Express account (`POST /v1/accounts type=express`, idempotency `connect:<restaurantId>`), then `POST /v1/account_links` (`type=account_onboarding`, return and refresh URL `<ADMIN_PUBLIC_URL>/admin/store/general/payment`) → 200 `{ url }` (must be `https://*.stripe.com`, else 502). `stripeDetailsSubmitted` becomes true only from a verified `account.updated` with `details_submitted: true`.
- **R28** Refunds run in the API process (`RefundScheduler`, every 15 s unless `APP_ENV=test`; tests call `PaymentsService.runRefunds()`): claim one due PENDING row `FOR UPDATE SKIP LOCKED`, call `POST /v1/refunds` (idempotency `refund:<id>`), on success post P7 and mark SUCCEEDED; afterwards call `OrdersPort.markRefunded` and set `orderMarkedAt` (retried on the next run until it succeeds). Provider errors: `attempts + 1`, `nextAttemptAt = now + min(2^attempts, 60) min`, `lastError` = Stripe error type; after 10 attempts FAILED. Missing payment reference → FAILED `missing_payment_reference` (admin attention, Q7).
- **R29** `POST /stripe/create-web-checkout-session` (single-vendor P5) → 501 `{ error: "create-web-checkout-session is not available yet", code: "NOT_IMPLEMENTED" }` until L12. `GET /paypal` → 503 page "PayPal payments are not available". No Stripe secret, raw card data or provider error text ever reaches a client (pages carry fixed text only).
- **R30** All business error strings are produced with `appError` and avoid the reserved words (master §4.3); REST bodies are fixed strings.
- **R31** `totalHours` is not tracked by any lane (reference/03 §2.15 UNVERIFIED): return `0`, recorded as blocker Q8; never fabricated.
- **R32** COD cash held (`RIDER_CASH_HELD`, `RESTAURANT_CASH_HELD`) is recorded but not netted against wallets or withdrawals in v1 (no app shows it; Q3).
- **R33** UNVERIFIED defaults chosen here (each lives in one function or constant): the discount reduces the store's food share; 100 % of the delivery fee goes to the rider; tax belongs to the store; takeaway tips go to `TIPS_PAYABLE`; zero-total orders produce no settlement entry; web checkout accepts no bearer (R24, Q2).

---

## 6. Tasks

Paths are relative to `implementation/`. Branch: `wave2/L7-finance` from `enatega-ui-backend`. Run commands from `implementation/`. Commit messages end with the session's attribution line.

Commands used throughout:

- Unit: `pnpm --filter @fairbite/api exec vitest run <file>`
- Integration: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts <file>`

Shared test type used in integration specs (defined in Task 6 `support.ts`): `Data` (an `any` alias for GraphQL `data`, so assertions read specific fields).

### Task 1: Ledger schema constraints

Proves §4.2 (the W1-L.2 migration) enforces immutability, balance, currency, single-source, open-request uniqueness and the withdraw lifecycle in the database itself.

**Files:**
- Test: `services/api/test/integration/finance/schema.integration.spec.ts`
- Modify (only if Step 2 fails because W1-L.2 omitted it): `services/api/prisma/migrations/202610090170_L7_init/migration.sql`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/integration/finance/schema.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { startStack, type Stack } from "../../support/stack.js";
import { newId } from "../../../src/kernel/ids.js";

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});
beforeEach(async () => {
  await stack.reset();
});

async function inTransaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await stack.pool.connect();
  try {
    await client.query("BEGIN");
    await work(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
async function account(client: PoolClient, type: string, ownerType: string, ownerId: string | null, currency = "USD") {
  const id = newId();
  await client.query(
    'INSERT INTO "LedgerAccount"(id, type, "ownerType", "ownerId", "ownerKey", currency) VALUES ($1, $2::"LedgerAccountType", $3::"LedgerOwnerType", $4, $5, $6)',
    [id, type, ownerType, ownerId, ownerId ? `${ownerType}:${ownerId}` : "PLATFORM", currency],
  );
  return id;
}
async function entry(client: PoolClient, options: { currency?: string; orderId?: string | null } = {}) {
  const id = newId();
  await client.query(
    'INSERT INTO "JournalEntry"(id, kind, "idempotencyKey", currency, exponent, "postedAt", "orderId") VALUES ($1, \'ORDER_SETTLEMENT\', $2, $3, 2, now(), $4)',
    [id, `test:${id}`, options.currency ?? "USD", options.orderId === undefined ? newId() : options.orderId],
  );
  return id;
}
async function line(client: PoolClient, entryId: string, accountId: string, side: "DEBIT" | "CREDIT", amount: number, lineNo: number) {
  await client.query(
    'INSERT INTO "JournalLine"(id, "entryId", "lineNo", "accountId", side, "amountMinor", component) VALUES ($1, $2, $3, $4, $5::"LedgerSide", $6, \'FOOD\')',
    [newId(), entryId, lineNo, accountId, side, amount],
  );
}
async function balancedEntry() {
  let entryId = "";
  await inTransaction(async (client) => {
    const cash = await account(client, "RIDER_CASH_HELD", "RIDER", newId());
    const payable = await account(client, "RESTAURANT_PAYABLE", "RESTAURANT", newId());
    entryId = await entry(client);
    await line(client, entryId, cash, "DEBIT", 100, 1);
    await line(client, entryId, payable, "CREDIT", 100, 2);
  });
  return entryId;
}
async function withdraw(payeeId: string, status = "REQUESTED") {
  const id = newId();
  await stack.pool.query(
    'INSERT INTO "WithdrawRequest"(id, "requestNumber", "requestRef", "payeeType", "payeeId", "requestedByUserId", "amountMinor", currency, exponent, status, "requestedAt") VALUES ($1, nextval(\'"WithdrawRequestNumber"\'), $2, \'RESTAURANT\', $3, $4, 1000, \'USD\', 2, $5::"WithdrawStatus", now())',
    [id, `WR-${id.slice(0, 8)}`, payeeId, newId(), status],
  );
  return id;
}

describe("ledger schema", () => {
  it("commits a balanced two-line entry", async () => {
    const entryId = await balancedEntry();
    const { rows } = await stack.pool.query('SELECT count(*)::int AS n FROM "JournalLine" WHERE "entryId" = $1', [entryId]);
    expect(rows[0].n).toBe(2);
  });

  it("rejects an unbalanced entry at COMMIT", async () => {
    await expect(
      inTransaction(async (client) => {
        const a = await account(client, "RIDER_CASH_HELD", "RIDER", newId());
        const b = await account(client, "RESTAURANT_PAYABLE", "RESTAURANT", newId());
        const e = await entry(client);
        await line(client, e, a, "DEBIT", 100, 1);
        await line(client, e, b, "CREDIT", 90, 2);
      }),
    ).rejects.toThrow(/is not balanced/);
  });

  it("rejects single-line and empty entries", async () => {
    await expect(
      inTransaction(async (client) => {
        const a = await account(client, "PLATFORM_CASH", "PLATFORM", null);
        const e = await entry(client);
        await line(client, e, a, "DEBIT", 100, 1);
      }),
    ).rejects.toThrow(/is not balanced/);
    await expect(
      inTransaction(async (client) => {
        await entry(client);
      }),
    ).rejects.toThrow(/is not balanced/);
  });

  it("rejects zero and negative line amounts", async () => {
    await expect(
      inTransaction(async (client) => {
        const a = await account(client, "PLATFORM_CASH", "PLATFORM", null);
        const b = await account(client, "PLATFORM_REVENUE", "PLATFORM", null);
        const e = await entry(client);
        await line(client, e, a, "DEBIT", 0, 1);
        await line(client, e, b, "CREDIT", 0, 2);
      }),
    ).rejects.toThrow(/JournalLine_amount_positive/);
  });

  it("requires exactly one source (order or withdraw request)", async () => {
    await expect(
      inTransaction(async (client) => {
        await entry(client, { orderId: null });
      }),
    ).rejects.toThrow(/JournalEntry_one_source/);
  });

  it("rejects a line whose account currency differs from the entry currency", async () => {
    await expect(
      inTransaction(async (client) => {
        const a = await account(client, "PLATFORM_CASH", "PLATFORM", null, "EUR");
        const b = await account(client, "PLATFORM_REVENUE", "PLATFORM", null, "EUR");
        const e = await entry(client, { currency: "USD" });
        await line(client, e, a, "DEBIT", 100, 1);
        await line(client, e, b, "CREDIT", 100, 2);
      }),
    ).rejects.toThrow(/currency mismatch/);
  });

  it("makes accounts, entries and lines immutable", async () => {
    const entryId = await balancedEntry();
    await expect(stack.pool.query('UPDATE "JournalLine" SET "amountMinor" = 1 WHERE "entryId" = $1', [entryId])).rejects.toThrow(/immutable/);
    await expect(stack.pool.query('DELETE FROM "JournalLine" WHERE "entryId" = $1', [entryId])).rejects.toThrow(/immutable/);
    await expect(stack.pool.query('DELETE FROM "JournalEntry" WHERE id = $1', [entryId])).rejects.toThrow(/immutable/);
    await expect(stack.pool.query('UPDATE "LedgerAccount" SET currency = \'EUR\'')).rejects.toThrow(/immutable/);
  });

  it("allows one open withdraw request per payee", async () => {
    const payee = newId();
    await withdraw(payee);
    await expect(withdraw(payee)).rejects.toThrow(/WithdrawRequest_one_open_per_payee/);
    await withdraw(payee, "CANCELLED");
  });

  it("guards the withdraw lifecycle and terms", async () => {
    const id = await withdraw(newId());
    await expect(stack.pool.query('UPDATE "WithdrawRequest" SET "amountMinor" = 5 WHERE id = $1', [id])).rejects.toThrow(/terms are immutable/);
    await stack.pool.query('UPDATE "WithdrawRequest" SET status = \'TRANSFERRED\' WHERE id = $1', [id]);
    await expect(stack.pool.query('UPDATE "WithdrawRequest" SET status = \'REQUESTED\' WHERE id = $1', [id])).rejects.toThrow(/invalid withdraw request transition TRANSFERRED -> REQUESTED/);
    await expect(stack.pool.query('DELETE FROM "WithdrawRequest" WHERE id = $1', [id])).rejects.toThrow(/cannot be deleted/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/finance/schema.integration.spec.ts`
Expected: FAIL if any part of §4.2 is missing (e.g. `relation "LedgerAccount" does not exist`, or an `it` passing without the expected rejection). If W1-L.2 applied §4.2 completely the test passes already; record that and skip Step 3.

- [ ] **Step 3: Implement** — append the SQL of §4.2 verbatim to `services/api/prisma/migrations/202610090170_L7_init/migration.sql` (after the Prisma-generated DDL for the §4.1 models). If the migration was already applied to a shared database, put the missing statements in a new migration `202610100170_L7_ledger_constraints/migration.sql` instead of editing an applied one.

- [ ] **Step 4: Run it again**

Run: the Step 2 command, then `pnpm --filter @fairbite/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code`
Expected: PASS (9 tests); the diff reports no drift.

- [ ] **Step 5: Commit**

```bash
git add services/api/test/integration/finance/schema.integration.spec.ts services/api/prisma/migrations
git commit -m "test(L7): prove ledger immutability, balance and withdraw lifecycle constraints"
```

### Task 2: Chart of accounts and posting builders (pure)

**Files:**
- Create: `services/api/src/modules/finance/types.ts`
- Create: `services/api/src/modules/finance/policy.ts`
- Create: `services/api/src/modules/finance/ledger/accounts.ts`
- Create: `services/api/src/modules/finance/ledger/postings.ts`
- Test: `services/api/test/unit/finance/postings.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/finance/postings.spec.ts
import { describe, expect, it } from "vitest";
import type { OrderSnapshot } from "../../../src/kernel/ports.js";
import { account, ownerKey } from "../../../src/modules/finance/ledger/accounts.js";
import {
  PostingError,
  assertBalanced,
  orderPayment,
  orderRefund,
  orderSettlement,
  withdrawalRelease,
  withdrawalReserve,
  withdrawalSettle,
  type EntryDraft,
} from "../../../src/modules/finance/ledger/postings.js";
import { SETTLEMENT_POLICY } from "../../../src/modules/finance/policy.js";

const S = "0190a000-0000-7000-8000-000000000001";
const R = "0190a000-0000-7000-8000-000000000002";
const U = "0190a000-0000-7000-8000-000000000003";
const O = "0190a000-0000-7000-8000-000000000004";
const W = "0190a000-0000-7000-8000-000000000005";
const at = new Date("2026-10-08T03:00:00.000Z");
const order = (overrides: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  id: O,
  orderId: "PP-1",
  status: "DELIVERED",
  restaurantId: S,
  userId: U,
  riderId: R,
  zoneId: null,
  isPickedUp: false,
  paymentMethod: "COD",
  paymentStatus: "PENDING",
  currency: { code: "USD", symbol: "$", exponent: 2 },
  itemsMinor: 2500,
  discountMinor: 0,
  deliveryMinor: 300,
  taxMinor: 200,
  tipMinor: 100,
  totalMinor: 3100,
  version: 3,
  createdAt: at,
  acceptedAt: at,
  ...overrides,
});
const lines = (draft: EntryDraft | null) =>
  draft!.lines.map((l) => [l.side, l.account.type, l.account.ownerId, l.amountMinor, l.component]);

describe("accounts", () => {
  it("enforces owner rules and builds stable owner keys", () => {
    expect(ownerKey(account("PLATFORM_CASH", "PLATFORM"))).toBe("PLATFORM");
    expect(ownerKey(account("RIDER_PAYABLE", "RIDER", R))).toBe(`RIDER:${R}`);
    expect(() => account("RIDER_PAYABLE", "PLATFORM")).toThrow(/cannot be owned by PLATFORM/);
    expect(() => account("PLATFORM_CASH", "PLATFORM", S)).toThrow(/owner id/);
    expect(() => account("RESTAURANT_PAYABLE", "RESTAURANT", null)).toThrow(/owner id/);
    expect(account("PAYOUT_RESERVED", "RIDER", R).ownerType).toBe("RIDER");
  });
});

describe("order settlement (P1–P4)", () => {
  it("P1 COD delivery: rider holds the cash, store gets food + tax, rider gets fee + tip", () => {
    const draft = orderSettlement(order(), at, SETTLEMENT_POLICY);
    expect(draft).toMatchObject({
      kind: "ORDER_SETTLEMENT",
      idempotencyKey: `order:${O}:settlement`,
      currency: "USD",
      exponent: 2,
      postedAt: at,
      orderId: O,
      withdrawRequestId: null,
      order: { orderRef: "PP-1", orderType: "DELIVERY", paymentMethod: "COD", restaurantId: S, riderId: R, customerId: U, grossMinor: 3100 },
    });
    expect(lines(draft)).toEqual([
      ["DEBIT", "RIDER_CASH_HELD", R, 3100, "CASH_COLLECTED"],
      ["CREDIT", "RESTAURANT_PAYABLE", S, 2500, "FOOD"],
      ["CREDIT", "RESTAURANT_PAYABLE", S, 200, "TAX"],
      ["CREDIT", "RIDER_PAYABLE", R, 300, "DELIVERY_FEE"],
      ["CREDIT", "RIDER_PAYABLE", R, 100, "TIP"],
    ]);
    expect(() => assertBalanced(draft!)).not.toThrow();
  });

  it("P2 card delivery debits the customer receivable", () => {
    const draft = orderSettlement(order({ paymentMethod: "STRIPE", paymentStatus: "PAID" }), at, SETTLEMENT_POLICY);
    expect(lines(draft)[0]).toEqual(["DEBIT", "CUSTOMER_RECEIVABLE", U, 3100, "ORDER_TOTAL"]);
    expect(lines(draft)).toHaveLength(5);
  });

  it("P3 takeaway COD: the store holds the cash, tips go to TIPS_PAYABLE, no rider lines", () => {
    const draft = orderSettlement(
      order({ isPickedUp: true, riderId: null, itemsMinor: 1800, taxMinor: 144, deliveryMinor: 0, tipMinor: 50, totalMinor: 1994 }),
      at,
      SETTLEMENT_POLICY,
    );
    expect(draft!.order).toMatchObject({ orderType: "PICKUP", riderId: null });
    expect(lines(draft)).toEqual([
      ["DEBIT", "RESTAURANT_CASH_HELD", S, 1994, "CASH_COLLECTED"],
      ["CREDIT", "RESTAURANT_PAYABLE", S, 1800, "FOOD"],
      ["CREDIT", "RESTAURANT_PAYABLE", S, 144, "TAX"],
      ["CREDIT", "TIPS_PAYABLE", null, 50, "TIP"],
    ]);
  });

  it("P4 platform tax collector credits TAX_PAYABLE", () => {
    const draft = orderSettlement(order(), at, { ...SETTLEMENT_POLICY, taxCollector: "PLATFORM" });
    expect(lines(draft)).toContainEqual(["CREDIT", "TAX_PAYABLE", null, 200, "TAX"]);
    expect(lines(draft)).not.toContainEqual(["CREDIT", "RESTAURANT_PAYABLE", S, 200, "TAX"]);
  });

  it("applies the discount to the food share and splits delivery and commission by policy", () => {
    const draft = orderSettlement(
      order({ discountMinor: 500, totalMinor: 2600 }),
      at,
      { taxCollector: "RESTAURANT", riderDeliverySharePercent: 80, commissionPercent: 10 },
    );
    expect(lines(draft)).toEqual([
      ["DEBIT", "RIDER_CASH_HELD", R, 2600, "CASH_COLLECTED"],
      ["CREDIT", "RESTAURANT_PAYABLE", S, 1800, "FOOD"],
      ["CREDIT", "PLATFORM_REVENUE", null, 200, "COMMISSION"],
      ["CREDIT", "RESTAURANT_PAYABLE", S, 200, "TAX"],
      ["CREDIT", "RIDER_PAYABLE", R, 240, "DELIVERY_FEE"],
      ["CREDIT", "PLATFORM_REVENUE", null, 60, "DELIVERY_MARGIN"],
      ["CREDIT", "RIDER_PAYABLE", R, 100, "TIP"],
    ]);
  });

  it("core plan writes no commission line (D4)", () => {
    expect(lines(orderSettlement(order(), at, SETTLEMENT_POLICY)).some((l) => l[4] === "COMMISSION")).toBe(false);
  });

  it("returns null for zero-total orders", () => {
    expect(orderSettlement(order({ itemsMinor: 0, taxMinor: 0, deliveryMinor: 0, tipMinor: 0, totalMinor: 0 }), at, SETTLEMENT_POLICY)).toBeNull();
  });

  it("refuses orders that do not reconcile, over-discounted orders and deliveries without a rider", () => {
    expect(() => orderSettlement(order({ totalMinor: 3000 }), at, SETTLEMENT_POLICY)).toThrow(PostingError);
    expect(() => orderSettlement(order({ discountMinor: 3000, totalMinor: 100 }), at, SETTLEMENT_POLICY)).toThrow(/discount exceeds items/);
    expect(() => orderSettlement(order({ riderId: null }), at, SETTLEMENT_POLICY)).toThrow(/without a rider/);
  });
});

describe("payment, refund and withdrawal entries (P5, P7, P9–P11)", () => {
  const payment = { orderId: O, orderRef: "PP-1", customerId: U, amountMinor: 3100, currency: "USD", exponent: 2, postedAt: at };
  it("P5 payment moves provider clearing against the customer receivable", () => {
    const draft = orderPayment(payment);
    expect(draft.idempotencyKey).toBe(`order:${O}:payment`);
    expect(draft.kind).toBe("ORDER_PAYMENT");
    expect(lines(draft)).toEqual([
      ["DEBIT", "PROVIDER_CLEARING", null, 3100, "PAYMENT"],
      ["CREDIT", "CUSTOMER_RECEIVABLE", U, 3100, "PAYMENT"],
    ]);
  });
  it("P7 refund reverses it", () => {
    const draft = orderRefund(payment);
    expect(draft.idempotencyKey).toBe(`order:${O}:refund`);
    expect(lines(draft)).toEqual([
      ["DEBIT", "CUSTOMER_RECEIVABLE", U, 3100, "REFUND"],
      ["CREDIT", "PROVIDER_CLEARING", null, 3100, "REFUND"],
    ]);
  });
  const request = { requestId: W, payeeType: "RESTAURANT" as const, payeeId: S, amountMinor: 2000, currency: "USD", exponent: 2, postedAt: at };
  it("P9 reserve, P10 settle and P11 release", () => {
    expect(withdrawalReserve(request)).toMatchObject({ kind: "WITHDRAWAL_RESERVE", idempotencyKey: `withdraw:${W}:reserve`, withdrawRequestId: W, orderId: null });
    expect(lines(withdrawalReserve(request))).toEqual([
      ["DEBIT", "RESTAURANT_PAYABLE", S, 2000, "WITHDRAWAL"],
      ["CREDIT", "PAYOUT_RESERVED", S, 2000, "WITHDRAWAL"],
    ]);
    expect(lines(withdrawalSettle(request))).toEqual([
      ["DEBIT", "PAYOUT_RESERVED", S, 2000, "WITHDRAWAL"],
      ["CREDIT", "PLATFORM_CASH", null, 2000, "WITHDRAWAL"],
    ]);
    expect(lines(withdrawalRelease({ ...request, payeeType: "RIDER", payeeId: R }))).toEqual([
      ["DEBIT", "PAYOUT_RESERVED", R, 2000, "WITHDRAWAL"],
      ["CREDIT", "RIDER_PAYABLE", R, 2000, "WITHDRAWAL"],
    ]);
    expect(withdrawalSettle(request).idempotencyKey).toBe(`withdraw:${W}:settle`);
    expect(withdrawalRelease(request).idempotencyKey).toBe(`withdraw:${W}:release`);
  });
});

describe("assertBalanced", () => {
  const base = withdrawalReserve({ requestId: W, payeeType: "RIDER", payeeId: R, amountMinor: 1000, currency: "USD", exponent: 2, postedAt: at });
  it("rejects unbalanced, single-line, zero and fractional drafts", () => {
    expect(() => assertBalanced({ ...base, lines: [base.lines[0], { ...base.lines[1], amountMinor: 999 }] })).toThrow(/debits 1000 != credits 999/);
    expect(() => assertBalanced({ ...base, lines: [base.lines[0]] })).toThrow(/at least two lines/);
    expect(() => assertBalanced({ ...base, lines: base.lines.map((l) => ({ ...l, amountMinor: 0 })) })).toThrow(/positive integers/);
    expect(() => assertBalanced({ ...base, lines: base.lines.map((l) => ({ ...l, amountMinor: 10.5 })) })).toThrow(/positive integers/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/finance/postings.spec.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/finance/ledger/accounts.js'`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/finance/types.ts
export type PayeeType = "RESTAURANT" | "RIDER";
export const WITHDRAW_STATUSES = ["REQUESTED", "TRANSFERRED", "CANCELLED"] as const;
export type WithdrawStatus = (typeof WITHDRAW_STATUSES)[number];
```

```ts
// services/api/src/modules/finance/policy.ts
// Settlement policy defaults (R33). Each value is an owner decision; changing one
// changes only orderSettlement() output for orders delivered afterwards.
export type SettlementPolicy = {
  taxCollector: "RESTAURANT" | "PLATFORM";
  riderDeliverySharePercent: number;
  commissionPercent: number;
};
export const SETTLEMENT_POLICY: SettlementPolicy = {
  taxCollector: "RESTAURANT",
  riderDeliverySharePercent: 100,
  commissionPercent: 0, // D4: core plan food commission is fixed at 0 %.
};
export const MIN_WITHDRAW_MAJOR = 10;
export const MESSAGES = {
  minimumWithdraw: "The withdraw amount must be atleast 10 or greater",
  overBalance: "Withdraw amount exceeds your available balance",
  openRequest: "You already have a pending withdraw request",
  bankDetails: "Add your bank details before requesting a withdrawal",
  invalidAmount: "Invalid amount",
  invalidStatus: "Invalid withdraw request status",
  coreCommission: "Commission is fixed at 0% on the core plan",
  commissionRange: "Commission rate must be between 0 and 100",
  selectStore: "Select a store",
  selectRider: "Select a rider",
  userTypeRequired: "userType is required with userId",
  invalidDate: "Invalid date",
  invalidDateRange: "Invalid date range",
  updated: "Withdraw request updated",
} as const;
```

```ts
// services/api/src/modules/finance/ledger/accounts.ts
import type { PayeeType } from "../types.js";

export const ACCOUNT_TYPES = [
  "PLATFORM_CASH",
  "PLATFORM_REVENUE",
  "PROVIDER_CLEARING",
  "CUSTOMER_RECEIVABLE",
  "RESTAURANT_PAYABLE",
  "RESTAURANT_CASH_HELD",
  "RIDER_PAYABLE",
  "RIDER_CASH_HELD",
  "PAYOUT_RESERVED",
  "TIPS_PAYABLE",
  "TAX_PAYABLE",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type OwnerType = "PLATFORM" | "RESTAURANT" | "RIDER" | "CUSTOMER";
export type Side = "DEBIT" | "CREDIT";
export type AccountRef = { type: AccountType; ownerType: OwnerType; ownerId: string | null };

const OWNERS: Record<AccountType, readonly OwnerType[]> = {
  PLATFORM_CASH: ["PLATFORM"],
  PLATFORM_REVENUE: ["PLATFORM"],
  PROVIDER_CLEARING: ["PLATFORM"],
  TIPS_PAYABLE: ["PLATFORM"],
  TAX_PAYABLE: ["PLATFORM"],
  CUSTOMER_RECEIVABLE: ["CUSTOMER"],
  RESTAURANT_PAYABLE: ["RESTAURANT"],
  RESTAURANT_CASH_HELD: ["RESTAURANT"],
  RIDER_PAYABLE: ["RIDER"],
  RIDER_CASH_HELD: ["RIDER"],
  PAYOUT_RESERVED: ["RESTAURANT", "RIDER"],
};
export const NORMAL_SIDE: Record<AccountType, Side> = {
  PLATFORM_CASH: "DEBIT",
  PROVIDER_CLEARING: "DEBIT",
  CUSTOMER_RECEIVABLE: "DEBIT",
  RESTAURANT_CASH_HELD: "DEBIT",
  RIDER_CASH_HELD: "DEBIT",
  PLATFORM_REVENUE: "CREDIT",
  RESTAURANT_PAYABLE: "CREDIT",
  RIDER_PAYABLE: "CREDIT",
  PAYOUT_RESERVED: "CREDIT",
  TIPS_PAYABLE: "CREDIT",
  TAX_PAYABLE: "CREDIT",
};

export function account(type: AccountType, ownerType: OwnerType, ownerId: string | null = null): AccountRef {
  if (!OWNERS[type].includes(ownerType)) throw new Error(`Account ${type} cannot be owned by ${ownerType}`);
  if ((ownerType === "PLATFORM") !== (ownerId === null)) throw new Error(`Account ${type} owner id mismatch`);
  return { type, ownerType, ownerId };
}
export function ownerKey(ref: AccountRef): string {
  return ref.ownerType === "PLATFORM" ? "PLATFORM" : `${ref.ownerType}:${ref.ownerId}`;
}
export const payableOf = (payeeType: PayeeType, payeeId: string): AccountRef =>
  account(payeeType === "RESTAURANT" ? "RESTAURANT_PAYABLE" : "RIDER_PAYABLE", payeeType, payeeId);
export const reserveOf = (payeeType: PayeeType, payeeId: string): AccountRef =>
  account("PAYOUT_RESERVED", payeeType, payeeId);
```

```ts
// services/api/src/modules/finance/ledger/postings.ts
import { percentOf } from "../../../kernel/money.js";
import type { OrderSnapshot } from "../../../kernel/ports.js";
import type { SettlementPolicy } from "../policy.js";
import type { PayeeType } from "../types.js";
import { account, payableOf, reserveOf, type AccountRef, type Side } from "./accounts.js";

export const COMPONENTS = [
  "FOOD",
  "TAX",
  "DELIVERY_FEE",
  "TIP",
  "COMMISSION",
  "DELIVERY_MARGIN",
  "PLATFORM_FEE",
  "ORDER_TOTAL",
  "CASH_COLLECTED",
  "PAYMENT",
  "REFUND",
  "WITHDRAWAL",
] as const;
export type Component = (typeof COMPONENTS)[number];
export type EntryKind =
  | "ORDER_SETTLEMENT"
  | "ORDER_PAYMENT"
  | "ORDER_REFUND"
  | "WITHDRAWAL_RESERVE"
  | "WITHDRAWAL_SETTLE"
  | "WITHDRAWAL_RELEASE";
export type LineDraft = { account: AccountRef; side: Side; amountMinor: number; component: Component };
export type EntryOrderMeta = {
  orderRef: string;
  customerId: string;
  orderType?: "DELIVERY" | "PICKUP";
  paymentMethod?: string;
  restaurantId?: string;
  riderId?: string | null;
  grossMinor?: number;
};
export type EntryDraft = {
  kind: EntryKind;
  idempotencyKey: string;
  currency: string;
  exponent: number;
  postedAt: Date;
  orderId: string | null;
  withdrawRequestId: string | null;
  order: EntryOrderMeta | null;
  lines: LineDraft[];
};

export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingError";
  }
}

const line = (target: AccountRef, side: Side, amountMinor: number, component: Component): LineDraft => ({
  account: target,
  side,
  amountMinor,
  component,
});

export function assertBalanced(draft: EntryDraft): void {
  if (draft.lines.length < 2) throw new PostingError(`${draft.idempotencyKey}: an entry needs at least two lines`);
  let debits = 0;
  let credits = 0;
  for (const entry of draft.lines) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0)
      throw new PostingError(`${draft.idempotencyKey}: line amounts must be positive integers`);
    if (entry.side === "DEBIT") debits += entry.amountMinor;
    else credits += entry.amountMinor;
  }
  if (debits !== credits) throw new PostingError(`${draft.idempotencyKey}: debits ${debits} != credits ${credits}`);
}

// P1–P4 (§5.3). Pure: the same snapshot, time and policy always give the same draft.
export function orderSettlement(order: OrderSnapshot, postedAt: Date, policy: SettlementPolicy): EntryDraft | null {
  const foodNet = order.itemsMinor - order.discountMinor;
  if (foodNet < 0) throw new PostingError(`order ${order.id}: discount exceeds items`);
  const expected = foodNet + order.taxMinor + order.deliveryMinor + order.tipMinor;
  if (expected !== order.totalMinor)
    throw new PostingError(`order ${order.id}: total ${order.totalMinor} does not reconcile to ${expected}`);
  if (order.totalMinor === 0) return null;
  const pickup = order.isPickedUp;
  if (!pickup && !order.riderId) throw new PostingError(`order ${order.id}: delivery order delivered without a rider`);

  const store = (type: "RESTAURANT_PAYABLE" | "RESTAURANT_CASH_HELD") => account(type, "RESTAURANT", order.restaurantId);
  const revenue = account("PLATFORM_REVENUE", "PLATFORM");
  const lines: LineDraft[] = [];
  const credit = (target: AccountRef, amount: number, component: Component) => {
    if (amount > 0) lines.push(line(target, "CREDIT", amount, component));
  };

  if (order.paymentMethod === "COD")
    lines.push(
      line(
        pickup ? store("RESTAURANT_CASH_HELD") : account("RIDER_CASH_HELD", "RIDER", order.riderId),
        "DEBIT",
        order.totalMinor,
        "CASH_COLLECTED",
      ),
    );
  else lines.push(line(account("CUSTOMER_RECEIVABLE", "CUSTOMER", order.userId), "DEBIT", order.totalMinor, "ORDER_TOTAL"));

  const commission = percentOf(foodNet, policy.commissionPercent);
  credit(store("RESTAURANT_PAYABLE"), foodNet - commission, "FOOD");
  credit(revenue, commission, "COMMISSION");
  credit(
    policy.taxCollector === "RESTAURANT" ? store("RESTAURANT_PAYABLE") : account("TAX_PAYABLE", "PLATFORM"),
    order.taxMinor,
    "TAX",
  );
  if (pickup) {
    credit(revenue, order.deliveryMinor, "DELIVERY_MARGIN");
    credit(account("TIPS_PAYABLE", "PLATFORM"), order.tipMinor, "TIP");
  } else {
    const rider = account("RIDER_PAYABLE", "RIDER", order.riderId);
    const riderDelivery = percentOf(order.deliveryMinor, policy.riderDeliverySharePercent);
    credit(rider, riderDelivery, "DELIVERY_FEE");
    credit(revenue, order.deliveryMinor - riderDelivery, "DELIVERY_MARGIN");
    credit(rider, order.tipMinor, "TIP");
  }

  return {
    kind: "ORDER_SETTLEMENT",
    idempotencyKey: `order:${order.id}:settlement`,
    currency: order.currency.code,
    exponent: order.currency.exponent,
    postedAt,
    orderId: order.id,
    withdrawRequestId: null,
    order: {
      orderRef: order.orderId,
      customerId: order.userId,
      orderType: pickup ? "PICKUP" : "DELIVERY",
      paymentMethod: order.paymentMethod,
      restaurantId: order.restaurantId,
      riderId: pickup ? null : order.riderId,
      grossMinor: order.totalMinor,
    },
    lines,
  };
}

export type PaymentInput = {
  orderId: string;
  orderRef: string;
  customerId: string;
  amountMinor: number;
  currency: string;
  exponent: number;
  postedAt: Date;
};
const paymentEntry = (kind: "ORDER_PAYMENT" | "ORDER_REFUND", input: PaymentInput, lines: LineDraft[]): EntryDraft => ({
  kind,
  idempotencyKey: `order:${input.orderId}:${kind === "ORDER_PAYMENT" ? "payment" : "refund"}`,
  currency: input.currency,
  exponent: input.exponent,
  postedAt: input.postedAt,
  orderId: input.orderId,
  withdrawRequestId: null,
  order: { orderRef: input.orderRef, customerId: input.customerId, paymentMethod: "STRIPE" },
  lines,
});
// P5
export function orderPayment(input: PaymentInput): EntryDraft {
  return paymentEntry("ORDER_PAYMENT", input, [
    line(account("PROVIDER_CLEARING", "PLATFORM"), "DEBIT", input.amountMinor, "PAYMENT"),
    line(account("CUSTOMER_RECEIVABLE", "CUSTOMER", input.customerId), "CREDIT", input.amountMinor, "PAYMENT"),
  ]);
}
// P7
export function orderRefund(input: PaymentInput): EntryDraft {
  return paymentEntry("ORDER_REFUND", input, [
    line(account("CUSTOMER_RECEIVABLE", "CUSTOMER", input.customerId), "DEBIT", input.amountMinor, "REFUND"),
    line(account("PROVIDER_CLEARING", "PLATFORM"), "CREDIT", input.amountMinor, "REFUND"),
  ]);
}

export type WithdrawalInput = {
  requestId: string;
  payeeType: PayeeType;
  payeeId: string;
  amountMinor: number;
  currency: string;
  exponent: number;
  postedAt: Date;
};
const withdrawalEntry = (
  kind: "WITHDRAWAL_RESERVE" | "WITHDRAWAL_SETTLE" | "WITHDRAWAL_RELEASE",
  suffix: "reserve" | "settle" | "release",
  input: WithdrawalInput,
  debit: AccountRef,
  credit: AccountRef,
): EntryDraft => ({
  kind,
  idempotencyKey: `withdraw:${input.requestId}:${suffix}`,
  currency: input.currency,
  exponent: input.exponent,
  postedAt: input.postedAt,
  orderId: null,
  withdrawRequestId: input.requestId,
  order: null,
  lines: [line(debit, "DEBIT", input.amountMinor, "WITHDRAWAL"), line(credit, "CREDIT", input.amountMinor, "WITHDRAWAL")],
});
// P9
export const withdrawalReserve = (input: WithdrawalInput) =>
  withdrawalEntry("WITHDRAWAL_RESERVE", "reserve", input, payableOf(input.payeeType, input.payeeId), reserveOf(input.payeeType, input.payeeId));
// P10
export const withdrawalSettle = (input: WithdrawalInput) =>
  withdrawalEntry("WITHDRAWAL_SETTLE", "settle", input, reserveOf(input.payeeType, input.payeeId), account("PLATFORM_CASH", "PLATFORM"));
// P11
export const withdrawalRelease = (input: WithdrawalInput) =>
  withdrawalEntry("WITHDRAWAL_RELEASE", "release", input, reserveOf(input.payeeType, input.payeeId), payableOf(input.payeeType, input.payeeId));
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/finance/postings.spec.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/finance/types.ts services/api/src/modules/finance/policy.ts services/api/src/modules/finance/ledger services/api/test/unit/finance/postings.spec.ts
git commit -m "feat(L7): add chart of accounts and balanced posting builders"
```

### Task 3: Journal writer, SQL balances and `LedgerPort`

**Files:**
- Create: `services/api/src/modules/finance/tokens.ts`
- Create: `services/api/src/modules/finance/ledger/journal.ts`
- Create: `services/api/src/modules/finance/ledger/balances.ts`
- Create: `services/api/src/modules/finance/ledger.port.ts`
- Test: `services/api/test/integration/finance/ledger.integration.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/integration/finance/ledger.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";
import { newId } from "../../../src/kernel/ids.js";
import type { ConfigPort, OrderSnapshot } from "../../../src/kernel/ports.js";
import { postEntry, withTransaction } from "../../../src/modules/finance/ledger/journal.js";
import { balancesFor } from "../../../src/modules/finance/ledger/balances.js";
import {
  PostingError,
  orderSettlement,
  withdrawalRelease,
  withdrawalReserve,
  withdrawalSettle,
} from "../../../src/modules/finance/ledger/postings.js";
import { SETTLEMENT_POLICY } from "../../../src/modules/finance/policy.js";
import { LedgerPortImpl } from "../../../src/modules/finance/ledger.port.js";

const USD = { code: "USD", symbol: "$", exponent: 2 };
const at = new Date("2026-10-08T03:00:00.000Z");
let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});
beforeEach(async () => {
  await stack.reset();
});

const order = (restaurantId: string, riderId: string, overrides: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  id: newId(), orderId: "PP-1", status: "DELIVERED", restaurantId, userId: newId(), riderId, zoneId: null,
  isPickedUp: false, paymentMethod: "COD", paymentStatus: "PENDING", currency: USD, itemsMinor: 2500,
  discountMinor: 0, deliveryMinor: 300, taxMinor: 200, tipMinor: 100, totalMinor: 3100, version: 1,
  createdAt: at, acceptedAt: at, ...overrides,
});
const post = (draft: Parameters<typeof postEntry>[1]) => withTransaction(stack.pool, (client) => postEntry(client, draft));
const request = (payeeId: string, amountMinor: number) => ({
  requestId: newId(), payeeType: "RESTAURANT" as const, payeeId, amountMinor, currency: "USD", exponent: 2, postedAt: at,
});
const seedRequest = async (id: string, payeeId: string, amountMinor: number) =>
  stack.pool.query(
    'INSERT INTO "WithdrawRequest"(id, "requestNumber", "requestRef", "payeeType", "payeeId", "requestedByUserId", "amountMinor", currency, exponent, "requestedAt") VALUES ($1, nextval(\'"WithdrawRequestNumber"\'), $2, \'RESTAURANT\', $3, $4, $5, \'USD\', 2, now())',
    [id, `WR-${id.slice(0, 8)}`, payeeId, newId(), amountMinor],
  );

describe("journal writer", () => {
  it("posts a balanced entry exactly once per idempotency key", async () => {
    const draft = orderSettlement(order(newId(), newId()), at, SETTLEMENT_POLICY)!;
    const first = await post(draft);
    const second = await post(draft);
    expect(first.created).toBe(true);
    expect(second).toEqual({ entryId: first.entryId, created: false });
    const { rows } = await stack.pool.query('SELECT count(*)::int AS n FROM "JournalLine" WHERE "entryId" = $1', [first.entryId]);
    expect(rows[0].n).toBe(5);
    const entry = await stack.pool.query(
      'SELECT kind::text, "orderRef", "orderType", "paymentMethod", "grossMinor"::int AS gross, "postedAt" FROM "JournalEntry" WHERE id = $1',
      [first.entryId],
    );
    expect(entry.rows[0]).toMatchObject({ kind: "ORDER_SETTLEMENT", orderRef: "PP-1", orderType: "DELIVERY", paymentMethod: "COD", gross: 3100, postedAt: at });
  });

  it("serialises concurrent duplicates to a single entry", async () => {
    const draft = orderSettlement(order(newId(), newId()), at, SETTLEMENT_POLICY)!;
    const results = await Promise.all([post(draft), post(draft), post(draft)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const { rows } = await stack.pool.query('SELECT count(*)::int AS n FROM "JournalEntry"');
    expect(rows[0].n).toBe(1);
  });

  it("reuses one account per type, owner and currency", async () => {
    const store = newId();
    await post(orderSettlement(order(store, newId()), at, SETTLEMENT_POLICY)!);
    await post(orderSettlement(order(store, newId()), at, SETTLEMENT_POLICY)!);
    const { rows } = await stack.pool.query('SELECT count(*)::int AS n FROM "LedgerAccount" WHERE "ownerId" = $1', [store]);
    expect(rows[0].n).toBe(1);
  });

  it("rejects unbalanced drafts before any SQL runs", async () => {
    const draft = orderSettlement(order(newId(), newId()), at, SETTLEMENT_POLICY)!;
    await expect(post({ ...draft, lines: draft.lines.slice(0, 2) })).rejects.toBeInstanceOf(PostingError);
    const { rows } = await stack.pool.query('SELECT count(*)::int AS n FROM "JournalEntry"');
    expect(rows[0].n).toBe(0);
  });
});

describe("balances", () => {
  it("derives total, current, pending and withdrawn through reserve, settle and release", async () => {
    const store = newId();
    const rider = newId();
    await post(orderSettlement(order(store, rider), at, SETTLEMENT_POLICY)!);
    expect(await balancesFor(stack.pool, "RESTAURANT", store, "USD")).toEqual({ totalMinor: 2700, currentMinor: 2700, pendingMinor: 0, withdrawnMinor: 0 });
    expect(await balancesFor(stack.pool, "RIDER", rider, "USD")).toEqual({ totalMinor: 400, currentMinor: 400, pendingMinor: 0, withdrawnMinor: 0 });

    const first = request(store, 2000);
    await seedRequest(first.requestId, store, 2000);
    await post(withdrawalReserve(first));
    expect(await balancesFor(stack.pool, "RESTAURANT", store, "USD")).toEqual({ totalMinor: 2700, currentMinor: 700, pendingMinor: 2000, withdrawnMinor: 0 });
    await post(withdrawalSettle(first));
    expect(await balancesFor(stack.pool, "RESTAURANT", store, "USD")).toEqual({ totalMinor: 2700, currentMinor: 700, pendingMinor: 0, withdrawnMinor: 2000 });

    await stack.pool.query('UPDATE "WithdrawRequest" SET status = \'TRANSFERRED\' WHERE id = $1', [first.requestId]);
    const second = request(store, 500);
    await seedRequest(second.requestId, store, 500);
    await post(withdrawalReserve(second));
    expect((await balancesFor(stack.pool, "RESTAURANT", store, "USD")).currentMinor).toBe(200);
    await post(withdrawalRelease(second));
    expect(await balancesFor(stack.pool, "RESTAURANT", store, "USD")).toEqual({ totalMinor: 2700, currentMinor: 700, pendingMinor: 0, withdrawnMinor: 2000 });
  });

  it("returns zeros for a payee without lines and ignores other currencies", async () => {
    expect(await balancesFor(stack.pool, "RIDER", newId(), "USD")).toEqual({ totalMinor: 0, currentMinor: 0, pendingMinor: 0, withdrawnMinor: 0 });
    const store = newId();
    await post(orderSettlement(order(store, newId(), { currency: { code: "EUR", symbol: "€", exponent: 2 } }), at, SETTLEMENT_POLICY)!);
    expect((await balancesFor(stack.pool, "RESTAURANT", store, "USD")).totalMinor).toBe(0);
  });

  it("serves LEDGER_PORT in the configured platform currency", async () => {
    const store = newId();
    await post(orderSettlement(order(store, newId()), at, SETTLEMENT_POLICY)!);
    const config = { currency: async () => USD } as unknown as ConfigPort;
    expect(await new LedgerPortImpl(stack.pool, config).balances({ type: "RESTAURANT", id: store })).toEqual({
      totalMinor: 2700, currentMinor: 2700, pendingMinor: 0, withdrawnMinor: 0,
    });
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/finance/ledger.integration.spec.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/finance/ledger/journal.js'`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/finance/tokens.ts
import type { Clock } from "../../kernel/time.js";

export const FINANCE_POOL = Symbol("FINANCE_POOL");
export const FINANCE_SETTINGS = Symbol("FINANCE_SETTINGS");
export type FinanceSettings = { timeZone: string; clock: Clock };
```

```ts
// services/api/src/modules/finance/ledger/journal.ts
import type { Pool, PoolClient } from "pg";
import { newId } from "../../../kernel/ids.js";
import { ownerKey, type AccountRef } from "./accounts.js";
import { assertBalanced, type EntryDraft } from "./postings.js";

export type Db = Pick<PoolClient, "query">;

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureAccount(db: Db, ref: AccountRef, currency: string): Promise<string> {
  const key = ownerKey(ref);
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO "LedgerAccount"(id, type, "ownerType", "ownerId", "ownerKey", currency)
     VALUES ($1, $2::"LedgerAccountType", $3::"LedgerOwnerType", $4, $5, $6)
     ON CONFLICT (type, "ownerKey", currency) DO NOTHING
     RETURNING id`,
    [newId(), ref.type, ref.ownerType, ref.ownerId, key, currency],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM "LedgerAccount" WHERE type = $1::"LedgerAccountType" AND "ownerKey" = $2 AND currency = $3',
    [ref.type, key, currency],
  );
  return existing.rows[0].id;
}

// Must run inside a transaction: the balance check is a deferred constraint trigger.
export async function postEntry(db: Db, draft: EntryDraft): Promise<{ entryId: string; created: boolean }> {
  assertBalanced(draft);
  const id = newId();
  const meta = draft.order;
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO "JournalEntry"(id, kind, "idempotencyKey", currency, exponent, "postedAt", "orderId", "withdrawRequestId",
       "orderRef", "orderType", "paymentMethod", "restaurantId", "riderId", "customerId", "grossMinor")
     VALUES ($1, $2::"JournalKind", $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT ("idempotencyKey") DO NOTHING
     RETURNING id`,
    [
      id,
      draft.kind,
      draft.idempotencyKey,
      draft.currency,
      draft.exponent,
      draft.postedAt,
      draft.orderId,
      draft.withdrawRequestId,
      meta?.orderRef ?? null,
      meta?.orderType ?? null,
      meta?.paymentMethod ?? null,
      meta?.restaurantId ?? null,
      meta?.riderId ?? null,
      meta?.customerId ?? null,
      meta?.grossMinor ?? null,
    ],
  );
  if (!inserted.rows[0]) {
    const existing = await db.query<{ id: string }>('SELECT id FROM "JournalEntry" WHERE "idempotencyKey" = $1', [draft.idempotencyKey]);
    return { entryId: existing.rows[0].id, created: false };
  }
  let lineNo = 1;
  for (const entryLine of draft.lines) {
    const accountId = await ensureAccount(db, entryLine.account, draft.currency);
    await db.query(
      `INSERT INTO "JournalLine"(id, "entryId", "lineNo", "accountId", side, "amountMinor", component)
       VALUES ($1, $2, $3, $4, $5::"LedgerSide", $6, $7::"LineComponent")`,
      [newId(), id, lineNo++, accountId, entryLine.side, entryLine.amountMinor, entryLine.component],
    );
  }
  return { entryId: id, created: true };
}
```

```ts
// services/api/src/modules/finance/ledger/balances.ts
import type { PayeeType } from "../types.js";
import type { Db } from "./journal.js";

export type Balances = { totalMinor: number; withdrawnMinor: number; currentMinor: number; pendingMinor: number };

// R4: balances are always derived from journal lines, never stored.
export async function balancesFor(db: Db, payeeType: PayeeType, payeeId: string, currency: string): Promise<Balances> {
  const payable = payeeType === "RESTAURANT" ? "RESTAURANT_PAYABLE" : "RIDER_PAYABLE";
  const { rows } = await db.query<{ total: string; pending: string; withdrawn: string; current: string }>(
    `SELECT
       COALESCE(SUM(l."amountMinor") FILTER (WHERE a.type::text = $3 AND l.side = 'CREDIT' AND e.kind = 'ORDER_SETTLEMENT'), 0)::text AS total,
       COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l."amountMinor" ELSE -l."amountMinor" END) FILTER (WHERE a.type = 'PAYOUT_RESERVED'), 0)::text AS pending,
       COALESCE(SUM(l."amountMinor") FILTER (WHERE a.type = 'PAYOUT_RESERVED' AND l.side = 'DEBIT' AND e.kind = 'WITHDRAWAL_SETTLE'), 0)::text AS withdrawn,
       COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l."amountMinor" ELSE -l."amountMinor" END) FILTER (WHERE a.type::text = $3), 0)::text AS current
     FROM "LedgerAccount" a
     JOIN "JournalLine" l ON l."accountId" = a.id
     JOIN "JournalEntry" e ON e.id = l."entryId"
     WHERE a."ownerType"::text = $1 AND a."ownerId" = $2 AND a.currency = $4`,
    [payeeType, payeeId, payable, currency],
  );
  const row = rows[0];
  return {
    totalMinor: Number(row.total),
    withdrawnMinor: Number(row.withdrawn),
    currentMinor: Number(row.current),
    pendingMinor: Number(row.pending),
  };
}
```

```ts
// services/api/src/modules/finance/ledger.port.ts
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { CONFIG_PORT, type ConfigPort, type LedgerPort } from "../../kernel/ports.js";
import { balancesFor } from "./ledger/balances.js";
import { FINANCE_POOL } from "./tokens.js";

@Injectable()
export class LedgerPortImpl implements LedgerPort {
  constructor(
    @Inject(FINANCE_POOL) private readonly pool: Pool,
    @Inject(CONFIG_PORT) private readonly config: ConfigPort,
  ) {}
  async balances(target: { type: "RESTAURANT" | "RIDER"; id: string }) {
    const currency = await this.config.currency();
    return balancesFor(this.pool, target.type, target.id, currency.code);
  }
}
```

- [ ] **Step 4: Run it**

Run: the Step 2 command.
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/finance services/api/test/integration/finance/ledger.integration.spec.ts
git commit -m "feat(L7): add idempotent journal writer, SQL balances and LedgerPort"
```

### Task 4: Outbox consumer `order.transitioned` and worker wiring

**Files:**
- Create: `services/api/src/modules/finance/ledger/handlers.ts`
- Create: `services/api/src/modules/finance/ledger/index.ts`
- Create: `services/worker/src/jobs/L7/index.ts`
- Test: `services/api/test/integration/finance/order-postings.integration.spec.ts`
- Test: `services/worker/test/jobs/L7/index.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/api/test/integration/finance/order-postings.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startStack, type Stack } from "../../support/stack.js";
import { newId } from "../../../src/kernel/ids.js";
import type { OrderSnapshot } from "../../../src/kernel/ports.js";
import { PostingError, balancesFor, handleOrderTransitioned } from "../../../src/modules/finance/ledger/index.js";

const USD = { code: "USD", symbol: "$", exponent: 2 };
let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});
beforeEach(async () => {
  await stack.reset();
});

const snapshot = (overrides: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  id: newId(), orderId: "PP-7", status: "DELIVERED", restaurantId: newId(), userId: newId(), riderId: newId(),
  zoneId: null, isPickedUp: false, paymentMethod: "COD", paymentStatus: "PENDING", currency: USD, itemsMinor: 2500,
  discountMinor: 0, deliveryMinor: 300, taxMinor: 200, tipMinor: 100, totalMinor: 3100, version: 4,
  createdAt: new Date("2026-10-08T02:00:00Z"), acceptedAt: new Date("2026-10-08T02:01:00Z"), ...overrides,
});
const transitioned = (order: OrderSnapshot, to: string, createdAt = new Date("2026-10-08T03:00:00.000Z")) =>
  // Payload exactly as stored in "DomainEvent".payload (JSON round trip).
  ({ id: newId(), type: "order.transitioned", payload: JSON.parse(JSON.stringify({ from: "PICKED", to, order, actor: { type: "RIDER", id: "r" } })), createdAt });
const count = async (table: string) => (await stack.pool.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n as number;
const accountBalance = async (type: string, ownerId: string) =>
  Number(
    (
      await stack.pool.query(
        `SELECT COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l."amountMinor" ELSE -l."amountMinor" END), 0)::text AS b
         FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" WHERE a.type::text = $1 AND a."ownerId" = $2`,
        [type, ownerId],
      )
    ).rows[0].b,
  );

describe("order.transitioned consumer (outbox, R22)", () => {
  it("posts the COD delivery settlement at DELIVERED with the event time", async () => {
    const order = snapshot();
    expect(await handleOrderTransitioned(stack.pool, transitioned(order, "DELIVERED"))).toBe("posted");
    expect(await balancesFor(stack.pool, "RESTAURANT", order.restaurantId, "USD")).toEqual({ totalMinor: 2700, currentMinor: 2700, pendingMinor: 0, withdrawnMinor: 0 });
    expect(await balancesFor(stack.pool, "RIDER", order.riderId!, "USD")).toEqual({ totalMinor: 400, currentMinor: 400, pendingMinor: 0, withdrawnMinor: 0 });
    expect(await accountBalance("RIDER_CASH_HELD", order.riderId!)).toBe(3100);
    const { rows } = await stack.pool.query('SELECT "postedAt", "orderRef" FROM "JournalEntry"');
    expect(rows[0]).toEqual({ postedAt: new Date("2026-10-08T03:00:00.000Z"), orderRef: "PP-7" });
  });

  it("is idempotent across redelivery and concurrent delivery", async () => {
    const order = snapshot();
    const outcomes = await Promise.all([
      handleOrderTransitioned(stack.pool, transitioned(order, "DELIVERED")),
      handleOrderTransitioned(stack.pool, transitioned(order, "DELIVERED")),
    ]);
    expect(outcomes.sort()).toEqual(["duplicate", "posted"]);
    expect(await handleOrderTransitioned(stack.pool, transitioned(order, "DELIVERED"))).toBe("duplicate");
    expect(await count("JournalEntry")).toBe(1);
    expect(await count("JournalLine")).toBe(5);
  });

  it("posts card deliveries against the customer receivable", async () => {
    const order = snapshot({ paymentMethod: "STRIPE", paymentStatus: "PAID" });
    await handleOrderTransitioned(stack.pool, transitioned(order, "DELIVERED"));
    expect(await accountBalance("CUSTOMER_RECEIVABLE", order.userId)).toBe(3100);
  });

  it("posts takeaway COD with the store holding the cash and the tip in TIPS_PAYABLE", async () => {
    const order = snapshot({ isPickedUp: true, riderId: null, itemsMinor: 1800, taxMinor: 144, deliveryMinor: 0, tipMinor: 50, totalMinor: 1994 });
    await handleOrderTransitioned(stack.pool, transitioned(order, "DELIVERED"));
    expect(await accountBalance("RESTAURANT_CASH_HELD", order.restaurantId)).toBe(1994);
    expect((await balancesFor(stack.pool, "RESTAURANT", order.restaurantId, "USD")).totalMinor).toBe(1944);
    const tips = await stack.pool.query(`SELECT count(*)::int AS n FROM "LedgerAccount" WHERE type = 'TIPS_PAYABLE'`);
    expect(tips.rows[0].n).toBe(1);
  });

  it("refuses an order whose total does not reconcile and writes nothing", async () => {
    await expect(handleOrderTransitioned(stack.pool, transitioned(snapshot({ totalMinor: 9999 }), "DELIVERED"))).rejects.toBeInstanceOf(PostingError);
    expect(await count("JournalEntry")).toBe(0);
  });

  it("ignores non-final transitions and unpaid cancellations (P6)", async () => {
    expect(await handleOrderTransitioned(stack.pool, transitioned(snapshot(), "ACCEPTED"))).toBe("ignored");
    expect(await handleOrderTransitioned(stack.pool, transitioned(snapshot({ status: "CANCELLED" }), "CANCELLED"))).toBe("ignored");
    expect(await count("JournalEntry")).toBe(0);
    expect(await count("PaymentRefund")).toBe(0);
  });

  it("schedules exactly one refund for a paid cancellation (P7), copying the payment reference", async () => {
    const order = snapshot({ status: "CANCELLED", paymentMethod: "STRIPE", paymentStatus: "PAID" });
    await stack.pool.query(
      `INSERT INTO "PaymentSession"(id, "orderId", "orderRef", provider, "providerSessionId", url, "amountMinor", currency, platform, status, "paymentIntentId", "expiresAt", "completedAt")
       VALUES ($1, $2, 'PP-7', 'STRIPE', 'cs_test_x', 'https://checkout.stripe.com/c/pay/cs_test_x', 3100, 'USD', 'app', 'COMPLETED', 'pi_test_x', now(), now())`,
      [newId(), order.id],
    );
    expect(await handleOrderTransitioned(stack.pool, transitioned(order, "CANCELLED"))).toBe("refund-scheduled");
    expect(await handleOrderTransitioned(stack.pool, transitioned(order, "CANCELLED"))).toBe("refund-exists");
    const { rows } = await stack.pool.query('SELECT status::text, "amountMinor"::int AS amount, "paymentIntentId", "customerId" FROM "PaymentRefund"');
    expect(rows).toEqual([{ status: "PENDING", amount: 3100, paymentIntentId: "pi_test_x", customerId: order.userId }]);
  });
});
```

```ts
// services/worker/test/jobs/L7/index.spec.ts
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { handlers } from "../../../src/jobs/L7/index.js";

describe("L7 outbox handlers", () => {
  it("registers only the order.transitioned consumer", () => {
    expect(Object.keys(handlers)).toEqual(["order.transitioned"]);
  });
  it("ignores non-final transitions without touching the database", async () => {
    const pool = { connect: vi.fn(), query: vi.fn() } as unknown as Pool;
    await handlers["order.transitioned"](
      { id: "e1", type: "order.transitioned", payload: { from: "PENDING", to: "ACCEPTED", order: {} }, createdAt: new Date() },
      pool,
    );
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/finance/order-postings.integration.spec.ts` and `pnpm --filter @fairbite/worker exec vitest run test/jobs/L7/index.spec.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/finance/ledger/index.js'` and `Cannot find module '../../../src/jobs/L7/index.js'`.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/finance/ledger/handlers.ts
import type { Pool } from "pg";
import { newId } from "../../../kernel/ids.js";
import type { OrderSnapshot } from "../../../kernel/ports.js";
import { SETTLEMENT_POLICY, type SettlementPolicy } from "../policy.js";
import { postEntry, withTransaction, type Db } from "./journal.js";
import { orderSettlement } from "./postings.js";

export type OutboxEvent = { id: string; type: string; payload: unknown; createdAt: Date | string };
export type TransitionOutcome = "posted" | "duplicate" | "refund-scheduled" | "refund-exists" | "ignored";
type TransitionedPayload = { from: string; to: string; order: OrderSnapshot };

// R22. Idempotent: settlement by idempotency key, refunds by PaymentRefund.orderId.
export async function handleOrderTransitioned(
  pool: Pool,
  event: OutboxEvent,
  policy: SettlementPolicy = SETTLEMENT_POLICY,
): Promise<TransitionOutcome> {
  const payload = event.payload as TransitionedPayload;
  if (payload.to !== "DELIVERED" && payload.to !== "CANCELLED") return "ignored";
  const order = payload.order;
  if (payload.to === "DELIVERED") {
    const draft = orderSettlement(order, new Date(event.createdAt), policy);
    if (!draft) return "ignored";
    const { created } = await withTransaction(pool, (client) => postEntry(client, draft));
    return created ? "posted" : "duplicate";
  }
  if (order.paymentStatus !== "PAID") return "ignored";
  const scheduled = await withTransaction(pool, (client) =>
    scheduleRefund(client, {
      orderId: order.id,
      orderRef: order.orderId,
      customerId: order.userId,
      amountMinor: order.totalMinor,
      currency: order.currency.code,
      exponent: order.currency.exponent,
    }),
  );
  return scheduled ? "refund-scheduled" : "refund-exists";
}

export type RefundRequest = {
  orderId: string;
  orderRef: string;
  customerId: string;
  amountMinor: number;
  currency: string;
  exponent: number;
};
// P7: the refund itself runs in PaymentsService.runRefunds (R28).
export async function scheduleRefund(db: Db, input: RefundRequest): Promise<boolean> {
  const session = await db.query<{ paymentIntentId: string | null }>(
    `SELECT "paymentIntentId" FROM "PaymentSession"
     WHERE "orderId" = $1 AND status = 'COMPLETED' ORDER BY "completedAt" DESC NULLS LAST LIMIT 1`,
    [input.orderId],
  );
  const inserted = await db.query(
    `INSERT INTO "PaymentRefund"(id, "orderId", "orderRef", "customerId", "amountMinor", currency, exponent, "paymentIntentId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT ("orderId") DO NOTHING`,
    [newId(), input.orderId, input.orderRef, input.customerId, input.amountMinor, input.currency, input.exponent, session.rows[0]?.paymentIntentId ?? null],
  );
  return inserted.rowCount === 1;
}
```

```ts
// services/api/src/modules/finance/ledger/index.ts
// Public surface shared with services/worker (package export "./finance-ledger", D-L7-6).
export * from "./accounts.js";
export * from "./postings.js";
export * from "./journal.js";
export * from "./balances.js";
export * from "./handlers.js";
export { SETTLEMENT_POLICY, type SettlementPolicy } from "../policy.js";
```

```ts
// services/worker/src/jobs/L7/index.ts
import type { Pool } from "pg";
import { handleOrderTransitioned, type OutboxEvent } from "@fairbite/api/finance-ledger";

export type L7Handler = (event: OutboxEvent, db: Pool) => Promise<void>;

// Registered by services/worker/src/jobs/outbox.ts. Errors propagate so the outbox
// retries with backoff and finally dead-letters (R22).
export const handlers: Record<"order.transitioned", L7Handler> = {
  "order.transitioned": async (event, db) => {
    await handleOrderTransitioned(db, event);
  },
};
```

- [ ] **Step 4: Run them**

Run: `pnpm --filter @fairbite/api build && pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/finance/order-postings.integration.spec.ts && pnpm --filter @fairbite/worker exec vitest run test/jobs/L7/index.spec.ts`
Expected: PASS (7 + 2 tests). (The API build produces `dist/modules/finance/ledger/index.js` for the worker import, D-L7-6.)

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/finance/ledger services/api/test/integration/finance/order-postings.integration.spec.ts services/worker/src/jobs/L7 services/worker/test/jobs/L7
git commit -m "feat(L7): post settlements and schedule refunds from order.transitioned"
```

### Task 5: Argument parsing, subject scope, mappers and withdraw transitions (pure)

**Files:**
- Create: `services/api/src/modules/finance/args.ts`
- Create: `services/api/src/modules/finance/scope.ts`
- Create: `services/api/src/modules/finance/mappers.ts`
- Create: `services/api/src/modules/finance/withdraw-transitions.ts`
- Test: `services/api/test/unit/finance/args.spec.ts`, `scope.spec.ts`, `mappers.spec.ts`, `withdraw-transitions.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/api/test/unit/finance/args.spec.ts
import { describe, expect, it } from "vitest";
import { createWithdrawArgs, dateRange, earningsArgs, parseArgs, parseRequestAmount } from "../../../src/modules/finance/args.js";

describe("finance arguments", () => {
  it("maps ALL to no filter, trims text and keeps P4 pagination", () => {
    expect(
      parseArgs(earningsArgs, {
        userType: "ALL", orderType: "ALL", paymentMethod: "COD", search: "  PP- ", userId: "",
        pagination: { pageSize: 40, pageNo: 2 }, dateFilter: { starting_date: "2026-10-01", ending_date: null },
      }),
    ).toEqual({
      userType: null, orderType: null, paymentMethod: "COD", search: "PP-", userId: null,
      pagination: { pageSize: 40, pageNo: 2 }, dateFilter: { starting_date: "2026-10-01", ending_date: null },
    });
    const empty = parseArgs(earningsArgs, {});
    expect(empty.userType ?? null).toBeNull();
    expect(empty.search ?? null).toBeNull();
    expect(empty.userId ?? null).toBeNull();
  });
  it("rejects malformed arguments with BAD_USER_INPUT", () => {
    expect(() => parseArgs(createWithdrawArgs, { requestAmount: "ten" })).toThrow(/Invalid request/);
  });
  it("parses ISO and date-only ranges with an exclusive end", () => {
    expect(dateRange("2026-10-07T18:30:00.000Z", "2026-10-08T18:29:59.999Z")).toEqual({
      from: new Date("2026-10-07T18:30:00.000Z"),
      to: new Date("2026-10-08T18:30:00.000Z"),
    });
    expect(dateRange("2026-10-01", "2026-10-08")).toEqual({
      from: new Date("2026-10-01T00:00:00.000Z"),
      to: new Date("2026-10-09T00:00:00.000Z"),
    });
    expect(dateRange(null, "")).toEqual({ from: null, to: null });
    expect(() => dateRange("nonsense", null)).toThrow(/Invalid date/);
    expect(() => dateRange("2026-10-09", "2026-10-01")).toThrow(/Invalid date range/);
  });
  it("converts request amounts to minor units and rejects extra decimals", () => {
    expect(parseRequestAmount(20, 2)).toBe(2000);
    expect(parseRequestAmount(12.3, 2)).toBe(1230);
    expect(parseRequestAmount(1000, 0)).toBe(1000);
    expect(() => parseRequestAmount(12.345, 2)).toThrow(/Invalid amount/);
    expect(() => parseRequestAmount(0, 2)).toThrow(/Invalid amount/);
    expect(() => parseRequestAmount(-5, 2)).toThrow(/Invalid amount/);
    expect(() => parseRequestAmount(10.5, 0)).toThrow(/Invalid amount/);
  });
});
```

```ts
// services/api/test/unit/finance/scope.spec.ts
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../../src/kernel/auth/guards.js";
import { financeScope, riderSubject, storeSubject } from "../../../src/modules/finance/scope.js";

const S1 = "0190a000-0000-7000-8000-0000000000a1";
const S2 = "0190a000-0000-7000-8000-0000000000a2";
const R1 = "0190a000-0000-7000-8000-0000000000b1";
const auth = (overrides: Partial<AuthContext>): AuthContext => ({
  userId: "0190a000-0000-7000-8000-0000000000c1", type: "ADMIN", sessionId: "s", permissions: [],
  restaurantIds: [], vendorId: null, riderId: null, ...overrides,
});

describe("financeScope (R9)", () => {
  it("lets ADMIN and STAFF(Admin) filter freely", () => {
    expect(financeScope(auth({}), null, null, "Admin")).toEqual({ restaurantIds: null, riderIds: null, requireRider: false, viewer: "PLATFORM", fullBankDetails: true });
    expect(financeScope(auth({ type: "STAFF", permissions: ["Admin"] }), "RIDER", R1, "Admin")).toEqual({ restaurantIds: null, riderIds: [R1], requireRider: true, viewer: "PLATFORM", fullBankDetails: false });
    expect(financeScope(auth({}), "STORE", S1, "Admin")).toMatchObject({ restaurantIds: [S1], riderIds: null });
    expect(() => financeScope(auth({}), null, S1, "Admin")).toThrow(/userType is required with userId/);
  });
  it("scopes stores to their own restaurants", () => {
    const owner = auth({ type: "RESTAURANT", restaurantIds: [S1] });
    expect(financeScope(owner, null, null, "Admin")).toMatchObject({ restaurantIds: [S1], viewer: "STORE", fullBankDetails: true });
    expect(financeScope(owner, "STORE", S1, "Admin")).toMatchObject({ restaurantIds: [S1] });
    expect(() => financeScope(owner, "STORE", S2, "Admin")).toThrow(/Forbidden/);
    expect(() => financeScope(owner, "RIDER", null, "Admin")).toThrow(/Forbidden/);
    expect(() => financeScope(auth({ type: "VENDOR", restaurantIds: [] }), null, null, "Admin")).toThrow(/Forbidden/);
  });
  it("scopes riders to themselves", () => {
    const rider = auth({ type: "RIDER", riderId: R1 });
    expect(financeScope(rider, null, null, "Admin")).toEqual({ restaurantIds: null, riderIds: [R1], requireRider: true, viewer: "RIDER", fullBankDetails: true });
    expect(() => financeScope(rider, "STORE", null, "Admin")).toThrow(/Forbidden/);
    expect(() => financeScope(rider, "RIDER", S1, "Admin")).toThrow(/Forbidden/);
  });
  it("rejects STAFF without the permission and customers", () => {
    expect(() => financeScope(auth({ type: "STAFF", permissions: ["Riders"] }), null, null, "Admin")).toThrow(/Forbidden/);
    expect(() => financeScope(auth({ type: "CUSTOMER" }), null, null, "Admin")).toThrow(/Forbidden/);
  });
});

describe("store and rider subjects (R10)", () => {
  it("accepts own ids, the single own store, staff with permission and admin", () => {
    expect(storeSubject(auth({ type: "RESTAURANT", restaurantIds: [S1] }), S1, "Stores")).toBe(S1);
    expect(storeSubject(auth({ type: "RESTAURANT", restaurantIds: [S1] }), null, "Stores")).toBe(S1);
    expect(storeSubject(auth({ type: "STAFF", permissions: ["Stores"] }), S2, "Stores")).toBe(S2);
    expect(storeSubject(auth({}), S2, "Stores")).toBe(S2);
    expect(riderSubject(auth({ type: "RIDER", riderId: R1 }), null, "Riders")).toBe(R1);
    expect(riderSubject(auth({ type: "RIDER", riderId: R1 }), R1, "Riders")).toBe(R1);
  });
  it("rejects foreign ids, ambiguous stores and malformed ids", () => {
    expect(() => storeSubject(auth({ type: "RESTAURANT", restaurantIds: [S1] }), S2, "Stores")).toThrow(/Forbidden/);
    expect(() => storeSubject(auth({ type: "VENDOR", restaurantIds: [S1, S2] }), null, "Stores")).toThrow(/Select a store/);
    expect(() => storeSubject(auth({ type: "STAFF", permissions: [] }), S1, "Stores")).toThrow(/Forbidden/);
    expect(() => storeSubject(auth({}), "abc", "Stores")).toThrow(/Invalid store id/);
    expect(() => riderSubject(auth({ type: "RIDER", riderId: R1 }), S1, "Riders")).toThrow(/Forbidden/);
    expect(() => riderSubject(auth({}), null, "Riders")).toThrow(/Select a rider/);
  });
});
```

```ts
// services/api/test/unit/finance/mappers.spec.ts
import { describe, expect, it } from "vitest";
import {
  mapEarning,
  mapRiderDay,
  mapStoreDay,
  mapTransaction,
  mapWithdrawRequest,
  maskAccountNumber,
  uniqueIds,
  type EarningRow,
  type GraphEntry,
  type WithdrawRow,
} from "../../../src/modules/finance/mappers.js";

const at = new Date("2026-10-08T03:00:00.000Z");
const parents = {
  riders: new Map([["r1", { _id: "r1", name: "Ali" }]]),
  restaurants: new Map([["s1", { _id: "s1", name: "Pasta Place" }]]),
};
const earning: EarningRow = {
  id: "e1", orderRef: "PP-1", orderType: "DELIVERY", paymentMethod: "COD", postedAt: at, restaurantId: "s1", riderId: "r1",
  exponent: 2, commissionMinor: 0, deliveryMarginMinor: 60, platformFeeMinor: 0, platformTaxMinor: 0,
  riderDeliveryMinor: 240, riderTipMinor: 100, storeFoodMinor: 2500, storeTaxMinor: 200,
};
const request: WithdrawRow = {
  id: "w1", requestRef: "WR000001", payeeType: "RESTAURANT", payeeId: "s1", amountMinor: 2000, currency: "USD", exponent: 2,
  status: "REQUESTED", requestedAt: at, decidedAt: null, transactionRef: null, createdAt: at, version: 1,
};

describe("finance mappers", () => {
  it("maps an earnings row for the platform with major units and ISO times", () => {
    expect(mapEarning(earning, "PLATFORM", parents)).toEqual({
      _id: "e1", orderId: "PP-1", orderType: "DELIVERY", paymentMethod: "COD",
      createdAt: "2026-10-08T03:00:00.000Z", updatedAt: "2026-10-08T03:00:00.000Z",
      platformEarnings: { marketplaceCommission: 0, deliveryCommission: 0.6, tax: 0, platformFee: 0, totalEarnings: 0.6 },
      riderEarnings: { riderId: { _id: "r1", name: "Ali" }, deliveryFee: 2.4, tip: 1, totalEarnings: 3.4 },
      storeEarnings: { storeId: { _id: "s1", name: "Pasta Place" }, orderAmount: 25, totalEarnings: 27 },
    });
  });
  it("hides platform earnings from stores and store earnings from riders; no rider on takeaway", () => {
    expect(mapEarning(earning, "STORE", parents).platformEarnings).toBeNull();
    expect(mapEarning(earning, "RIDER", parents).storeEarnings).toBeNull();
    expect(mapEarning({ ...earning, riderId: null }, "PLATFORM", parents).riderEarnings).toBeNull();
  });
  it("maps withdraw requests with the right parent", () => {
    expect(mapWithdrawRequest(request, parents)).toEqual({
      _id: "w1", requestId: "WR000001", requestAmount: 20, requestTime: "2026-10-08T03:00:00.000Z", status: "REQUESTED",
      createdAt: "2026-10-08T03:00:00.000Z", rider: null, store: { _id: "s1", name: "Pasta Place" },
    });
    expect(mapWithdrawRequest({ ...request, payeeType: "RIDER", payeeId: "r1" }, parents)).toMatchObject({ rider: { _id: "r1" }, store: null });
  });
  it("maps transactions and masks the account number for non-owners", () => {
    const profile = { hasBusinessDetails: true, bankName: "Maybank", accountName: "Pasta", accountCode: "MBB", accountNumber: "5140123456789" };
    const transferred = { ...request, status: "TRANSFERRED" as const, transactionRef: "TXN000001" };
    expect(mapTransaction(transferred, profile, true, parents)).toEqual({
      _id: "w1", amountCurrency: "USD", status: "TRANSFERRED", transactionId: "TXN000001", userType: "STORE", userId: "s1",
      amountTransferred: 20, createdAt: "2026-10-08T03:00:00.000Z",
      toBank: { accountName: "Pasta", bankName: "Maybank", accountCode: "MBB", accountNumber: "5140123456789" },
      rider: null, store: { _id: "s1", name: "Pasta Place" },
    });
    expect(mapTransaction(transferred, profile, false, parents).toBank?.accountNumber).toBe("*********6789");
    expect(mapTransaction(transferred, null, true, parents).toBank).toBeNull();
    expect(maskAccountNumber("123")).toBe("***");
    expect(maskAccountNumber(null)).toBeNull();
  });
  it("maps store and rider day buckets", () => {
    const day = { day: "2026-10-08", key: "08-10-2026", start: new Date("2026-10-07T16:00:00.000Z") };
    const entries: GraphEntry[] = [
      { id: "e1", key: "08-10-2026", orderRef: "PP-1", orderType: "DELIVERY", paymentMethod: "COD", postedAt: at, exponent: 2, grossMinor: 3100, earnedMinor: 2700, deliveryMinor: 300, tipMinor: 100 },
      { id: "e2", key: "08-10-2026", orderRef: "PP-2", orderType: "PICKUP", paymentMethod: "STRIPE", postedAt: at, exponent: 2, grossMinor: 1994, earnedMinor: 1944, deliveryMinor: 0, tipMinor: 0 },
    ];
    expect(mapStoreDay(day, entries, 2)).toEqual({
      _id: "08-10-2026", date: "2026-10-07T16:00:00.000Z", totalEarningsSum: 46.44,
      earningsArray: [
        { totalOrderAmount: 31, totalEarnings: 27, orderDetails: { orderId: "PP-1", orderType: "DELIVERY", paymentMethod: "COD" }, date: "2026-10-08T03:00:00.000Z" },
        { totalOrderAmount: 19.94, totalEarnings: 19.44, orderDetails: { orderId: "PP-2", orderType: "PICKUP", paymentMethod: "STRIPE" }, date: "2026-10-08T03:00:00.000Z" },
      ],
    });
    expect(mapRiderDay(day, entries.slice(0, 1), 2)).toEqual({
      _id: "08-10-2026", date: "2026-10-07T16:00:00.000Z", totalDeliveries: 1, totalEarningsSum: 4, totalTipsSum: 1, totalHours: 0,
      earningsArray: [{ tip: 1, deliveryFee: 3, totalEarnings: 4, orderDetails: { orderId: "PP-1", orderType: "DELIVERY", paymentMethod: "COD" }, date: "2026-10-08T03:00:00.000Z" }],
    });
  });
  it("deduplicates ids", () => {
    expect(uniqueIds(["a", null, "a", undefined, "b", ""])).toEqual(["a", "b"]);
  });
});
```

```ts
// services/api/test/unit/finance/withdraw-transitions.spec.ts
import { describe, expect, it } from "vitest";
import { assertWithdrawTransition, parseWithdrawStatus } from "../../../src/modules/finance/withdraw-transitions.js";

describe("withdraw transitions (R14)", () => {
  it("allows REQUESTED to TRANSFERRED or CANCELLED only", () => {
    expect(() => assertWithdrawTransition("REQUESTED", "TRANSFERRED")).not.toThrow();
    expect(() => assertWithdrawTransition("REQUESTED", "CANCELLED")).not.toThrow();
    expect(() => assertWithdrawTransition("REQUESTED", "REQUESTED")).toThrow("Withdraw request is already REQUESTED");
    expect(() => assertWithdrawTransition("TRANSFERRED", "CANCELLED")).toThrow("Withdraw request cannot change from TRANSFERRED to CANCELLED");
    expect(() => assertWithdrawTransition("CANCELLED", "REQUESTED")).toThrow("Withdraw request cannot change from CANCELLED to REQUESTED");
  });
  it("parses only the three statuses", () => {
    expect(parseWithdrawStatus("TRANSFERRED")).toBe("TRANSFERRED");
    expect(() => parseWithdrawStatus("PAID")).toThrow("Invalid withdraw request status");
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/finance/args.spec.ts test/unit/finance/scope.spec.ts test/unit/finance/mappers.spec.ts test/unit/finance/withdraw-transitions.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/finance/args.ts
import { z } from "zod";
import { appError } from "../../kernel/errors.js";
import { toMinor } from "../../kernel/money.js";
import { parseClientDate } from "../../kernel/time.js";
import { MESSAGES } from "./policy.js";

export function parseArgs<T extends z.ZodType>(schema: T, args: unknown): z.infer<T> {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) throw appError("BAD_USER_INPUT", "Invalid request");
  return parsed.data;
}

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => (value && value.trim() ? value.trim() : null));
// `ALL` is declared by the enums but means "no filter" (reference/04 §5.2).
const userType = z
  .enum(["ALL", "RIDER", "STORE"])
  .nullish()
  .transform((value) => (value && value !== "ALL" ? value : null));
const orderType = z
  .enum(["ALL", "DELIVERY", "PICKUP"])
  .nullish()
  .transform((value) => (value && value !== "ALL" ? value : null));
const paymentMethod = z
  .enum(["ALL", "COD", "PAYPAL", "STRIPE"])
  .nullish()
  .transform((value) => (value && value !== "ALL" ? value : null));
const pagination = z.object({ pageSize: z.number().int(), pageNo: z.number().int() }).nullish();
const dateFilter = z
  .object({ starting_date: z.string().max(40).nullish(), ending_date: z.string().max(40).nullish() })
  .nullish();
const pageNumber = z.number().int().nullish();

export const earningsArgs = z.object({
  userId: text(64),
  userType,
  orderType,
  paymentMethod,
  search: text(100),
  pagination,
  dateFilter,
});
export type EarningsArgs = z.infer<typeof earningsArgs>;
export const transactionHistoryArgs = z.object({ userId: text(64), userType, search: text(100), pagination, dateFilter });
export type TransactionHistoryArgs = z.infer<typeof transactionHistoryArgs>;
export const withdrawRequestsArgs = z.object({ userId: text(64), userType, search: text(100), pagination });
export type WithdrawRequestsArgs = z.infer<typeof withdrawRequestsArgs>;
export const storeGraphArgs = z.object({ storeId: z.string().max(64), page: pageNumber, limit: pageNumber, startDate: text(40), endDate: text(40) });
export type StoreGraphArgs = z.infer<typeof storeGraphArgs>;
export const riderGraphArgs = z.object({ riderId: z.string().max(64), page: pageNumber, limit: pageNumber, startDate: text(40), endDate: text(40) });
export type RiderGraphArgs = z.infer<typeof riderGraphArgs>;
export const storeCurrentArgs = z.object({ storeId: text(64) });
export const riderCurrentArgs = z.object({ riderId: text(64) });
export const createWithdrawArgs = z.object({ requestAmount: z.number(), userId: text(64) });
export type CreateWithdrawArgs = z.infer<typeof createWithdrawArgs>;
export const updateWithdrawArgs = z.object({ id: z.string().max(64), status: z.string().max(32) });
export const commissionRateArgs = z.object({
  page: pageNumber,
  limit: pageNumber,
  search: text(100),
  sortBy: z.enum(["NAME", "COMMISSION_RATE"]).nullish(),
  sortOrder: z.enum(["ASC", "DESC"]).nullish(),
});
export type CommissionRateArgs = z.infer<typeof commissionRateArgs>;
export const updateCommissionArgs = z.object({ id: z.string().max(64), commissionRate: z.number() });

export type DateRange = { from: Date | null; to: Date | null };
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// R8: date-only ends include the whole day; ISO ends are inclusive instants. `to` is exclusive.
export function dateRange(start: string | null | undefined, end: string | null | undefined): DateRange {
  const parse = (value: string | null | undefined, isEnd: boolean): Date | null => {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) return null;
    const date = parseClientDate(trimmed);
    if (!date) throw appError("BAD_USER_INPUT", MESSAGES.invalidDate);
    if (!isEnd) return date;
    return new Date(date.getTime() + (DATE_ONLY.test(trimmed) ? 86_400_000 : 1));
  };
  const range = { from: parse(start, false), to: parse(end, true) };
  if (range.from && range.to && range.from >= range.to) throw appError("BAD_USER_INPUT", MESSAGES.invalidDateRange);
  return range;
}

// R1: Float major units in, integer minor units out; more decimals than the exponent is an error.
export function parseRequestAmount(value: number, exponent: number): number {
  if (!Number.isFinite(value) || value <= 0) throw appError("BAD_USER_INPUT", MESSAGES.invalidAmount);
  const minor = toMinor(value, exponent);
  if (minor <= 0 || Math.abs(minor / 10 ** exponent - value) > 1e-9) throw appError("BAD_USER_INPUT", MESSAGES.invalidAmount);
  return minor;
}
```

```ts
// services/api/src/modules/finance/scope.ts
import { appError } from "../../kernel/errors.js";
import { parseId } from "../../kernel/ids.js";
import { requireOwnership, type AuthContext } from "../../kernel/auth/guards.js";
import { MESSAGES } from "./policy.js";

export const PERMISSIONS = {
  admin: "Admin",
  withdraw: "Withdraw Request",
  commission: "Commission Rate",
  stores: "Stores",
  riders: "Riders",
} as const;

export type FinanceScope = {
  restaurantIds: string[] | null;
  riderIds: string[] | null;
  requireRider: boolean;
  viewer: "PLATFORM" | "STORE" | "RIDER";
  fullBankDetails: boolean;
};

const platformViewer = (auth: AuthContext, permission: string) =>
  auth.type === "ADMIN" || (auth.type === "STAFF" && auth.permissions.includes(permission));

// R9. `platformPermission` is "Admin" (earnings, transactionHistory) or "Withdraw Request" (withdrawRequests).
export function financeScope(
  auth: AuthContext,
  userType: "RIDER" | "STORE" | null,
  userId: string | null,
  platformPermission: string,
): FinanceScope {
  if (platformViewer(auth, platformPermission)) {
    if (userId && !userType) throw appError("BAD_USER_INPUT", MESSAGES.userTypeRequired);
    const id = userId ? parseId(userId, userType === "RIDER" ? "rider" : "store") : null;
    return {
      restaurantIds: userType === "STORE" && id ? [id] : null,
      riderIds: userType === "RIDER" && id ? [id] : null,
      requireRider: userType === "RIDER",
      viewer: "PLATFORM",
      fullBankDetails: auth.type === "ADMIN",
    };
  }
  if (auth.type === "RESTAURANT" || auth.type === "VENDOR") {
    if (userType === "RIDER") throw appError("FORBIDDEN");
    if (userId) {
      const id = parseId(userId, "store");
      requireOwnership(auth, { restaurantId: id });
      return { restaurantIds: [id], riderIds: null, requireRider: false, viewer: "STORE", fullBankDetails: true };
    }
    if (!auth.restaurantIds.length) throw appError("FORBIDDEN");
    return { restaurantIds: [...auth.restaurantIds], riderIds: null, requireRider: false, viewer: "STORE", fullBankDetails: true };
  }
  if (auth.type === "RIDER") {
    if (userType === "STORE" || !auth.riderId) throw appError("FORBIDDEN");
    if (userId && parseId(userId, "rider") !== auth.riderId) throw appError("FORBIDDEN");
    return { restaurantIds: null, riderIds: [auth.riderId], requireRider: true, viewer: "RIDER", fullBankDetails: true };
  }
  throw appError("FORBIDDEN");
}

// R10
export function storeSubject(auth: AuthContext, storeId: string | null, staffPermission: string): string {
  if (storeId) {
    const id = parseId(storeId, "store");
    requireOwnership(auth, { restaurantId: id }, staffPermission);
    return id;
  }
  if ((auth.type === "RESTAURANT" || auth.type === "VENDOR") && auth.restaurantIds.length === 1) return auth.restaurantIds[0];
  throw appError("BAD_USER_INPUT", MESSAGES.selectStore);
}
export function riderSubject(auth: AuthContext, riderId: string | null, staffPermission: string): string {
  if (riderId) {
    const id = parseId(riderId, "rider");
    requireOwnership(auth, { riderId: id }, staffPermission);
    return id;
  }
  if (auth.type === "RIDER" && auth.riderId) return auth.riderId;
  throw appError("BAD_USER_INPUT", MESSAGES.selectRider);
}
```

Note on `requireOwnership` with `{ riderId }`: a STAFF without the permission and a RESTAURANT both fail because `auth.riderId !== riderId`, giving FORBIDDEN, as the scope test expects.

```ts
// services/api/src/modules/finance/mappers.ts
import { toMajor } from "../../kernel/money.js";
import { isoString } from "../../kernel/time.js";
import type { GraphqlParent, PayoutProfile } from "../../kernel/ports.js";
import type { PayeeType, WithdrawStatus } from "./types.js";

export type Viewer = "PLATFORM" | "STORE" | "RIDER";
export type Parents = { riders: Map<string, GraphqlParent>; restaurants: Map<string, GraphqlParent> };
export type EarningRow = {
  id: string;
  orderRef: string;
  orderType: string;
  paymentMethod: string;
  postedAt: Date;
  restaurantId: string;
  riderId: string | null;
  exponent: number;
  commissionMinor: number;
  deliveryMarginMinor: number;
  platformFeeMinor: number;
  platformTaxMinor: number;
  riderDeliveryMinor: number;
  riderTipMinor: number;
  storeFoodMinor: number;
  storeTaxMinor: number;
};
export type WithdrawRow = {
  id: string;
  requestRef: string;
  payeeType: PayeeType;
  payeeId: string;
  amountMinor: number;
  currency: string;
  exponent: number;
  status: WithdrawStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  transactionRef: string | null;
  createdAt: Date;
  version: number;
};
export type GraphDay = { day: string; key: string; start: Date };
export type GraphEntry = {
  id: string;
  key: string;
  orderRef: string;
  orderType: string;
  paymentMethod: string;
  postedAt: Date;
  exponent: number;
  grossMinor: number;
  earnedMinor: number;
  deliveryMinor: number;
  tipMinor: number;
};

const iso = (value: Date): string => isoString(value) as string;
export const uniqueIds = (values: (string | null | undefined)[]): string[] => [
  ...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)),
];

// R7
export function mapEarning(row: EarningRow, viewer: Viewer, parents: Parents) {
  const major = (minor: number) => toMajor(minor, row.exponent);
  return {
    _id: row.id,
    orderId: row.orderRef,
    orderType: row.orderType,
    paymentMethod: row.paymentMethod,
    createdAt: iso(row.postedAt),
    updatedAt: iso(row.postedAt),
    platformEarnings:
      viewer === "PLATFORM"
        ? {
            marketplaceCommission: major(row.commissionMinor),
            deliveryCommission: major(row.deliveryMarginMinor),
            tax: major(row.platformTaxMinor),
            platformFee: major(row.platformFeeMinor),
            totalEarnings: major(row.commissionMinor + row.deliveryMarginMinor + row.platformFeeMinor),
          }
        : null,
    riderEarnings: row.riderId
      ? {
          riderId: parents.riders.get(row.riderId) ?? null,
          deliveryFee: major(row.riderDeliveryMinor),
          tip: major(row.riderTipMinor),
          totalEarnings: major(row.riderDeliveryMinor + row.riderTipMinor),
        }
      : null,
    storeEarnings:
      viewer === "RIDER"
        ? null
        : {
            storeId: parents.restaurants.get(row.restaurantId) ?? null,
            orderAmount: major(row.storeFoodMinor),
            totalEarnings: major(row.storeFoodMinor + row.storeTaxMinor),
          },
  };
}

export function mapWithdrawRequest(row: WithdrawRow, parents: Parents) {
  return {
    _id: row.id,
    requestId: row.requestRef,
    requestAmount: toMajor(row.amountMinor, row.exponent),
    requestTime: iso(row.requestedAt),
    status: row.status,
    createdAt: iso(row.createdAt),
    rider: row.payeeType === "RIDER" ? (parents.riders.get(row.payeeId) ?? null) : null,
    store: row.payeeType === "RESTAURANT" ? (parents.restaurants.get(row.payeeId) ?? null) : null,
  };
}

export function maskAccountNumber(value: string | null): string | null {
  if (!value) return value;
  return value.length <= 4 ? "*".repeat(value.length) : "*".repeat(value.length - 4) + value.slice(-4);
}

// R17
export function mapTransaction(row: WithdrawRow, profile: PayoutProfile | null, fullAccountNumber: boolean, parents: Parents) {
  return {
    _id: row.id,
    amountCurrency: row.currency,
    status: row.status,
    transactionId: row.transactionRef,
    userType: row.payeeType === "RIDER" ? "RIDER" : "STORE",
    userId: row.payeeId,
    amountTransferred: toMajor(row.amountMinor, row.exponent),
    createdAt: iso(row.createdAt),
    toBank: profile
      ? {
          accountName: profile.accountName,
          bankName: profile.bankName,
          accountCode: profile.accountCode,
          accountNumber: fullAccountNumber ? profile.accountNumber : maskAccountNumber(profile.accountNumber),
        }
      : null,
    rider: row.payeeType === "RIDER" ? (parents.riders.get(row.payeeId) ?? null) : null,
    store: row.payeeType === "RESTAURANT" ? (parents.restaurants.get(row.payeeId) ?? null) : null,
  };
}

const orderDetails = (entry: GraphEntry) => ({ orderId: entry.orderRef, orderType: entry.orderType, paymentMethod: entry.paymentMethod });

// R11 (store)
export function mapStoreDay(day: GraphDay, entries: GraphEntry[], exponent: number) {
  const earned = entries.reduce((total, entry) => total + entry.earnedMinor, 0);
  return {
    _id: day.key,
    date: iso(day.start),
    totalEarningsSum: toMajor(earned, exponent),
    earningsArray: entries.map((entry) => ({
      totalOrderAmount: toMajor(entry.grossMinor, entry.exponent),
      totalEarnings: toMajor(entry.earnedMinor, entry.exponent),
      orderDetails: orderDetails(entry),
      date: iso(entry.postedAt),
    })),
  };
}

// R11 (rider), R31
export function mapRiderDay(day: GraphDay, entries: GraphEntry[], exponent: number) {
  const fees = entries.reduce((total, entry) => total + entry.deliveryMinor, 0);
  const tips = entries.reduce((total, entry) => total + entry.tipMinor, 0);
  return {
    _id: day.key,
    date: iso(day.start),
    earningsArray: entries.map((entry) => ({
      tip: toMajor(entry.tipMinor, entry.exponent),
      deliveryFee: toMajor(entry.deliveryMinor, entry.exponent),
      totalEarnings: toMajor(entry.deliveryMinor + entry.tipMinor, entry.exponent),
      orderDetails: orderDetails(entry),
      date: iso(entry.postedAt),
    })),
    totalDeliveries: entries.length,
    totalEarningsSum: toMajor(fees + tips, exponent),
    totalHours: 0,
    totalTipsSum: toMajor(tips, exponent),
  };
}
```

```ts
// services/api/src/modules/finance/withdraw-transitions.ts
import { appError } from "../../kernel/errors.js";
import { MESSAGES } from "./policy.js";
import { WITHDRAW_STATUSES, type WithdrawStatus } from "./types.js";

// Central transition table (AGENTS.md); mirrored by the "WithdrawRequest_guard" trigger.
const ALLOWED: Record<WithdrawStatus, readonly WithdrawStatus[]> = {
  REQUESTED: ["TRANSFERRED", "CANCELLED"],
  TRANSFERRED: [],
  CANCELLED: [],
};

export function parseWithdrawStatus(value: string): WithdrawStatus {
  if (!(WITHDRAW_STATUSES as readonly string[]).includes(value)) throw appError("BAD_USER_INPUT", MESSAGES.invalidStatus);
  return value as WithdrawStatus;
}

export function assertWithdrawTransition(from: WithdrawStatus, to: WithdrawStatus): void {
  if (ALLOWED[from].includes(to)) return;
  throw appError(
    "BAD_USER_INPUT",
    from === to ? `Withdraw request is already ${from}` : `Withdraw request cannot change from ${from} to ${to}`,
  );
}
```

- [ ] **Step 4: Run them**

Run: the Step 2 command.
Expected: PASS (4 files).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/finance/{args,scope,mappers,withdraw-transitions}.ts services/api/test/unit/finance
git commit -m "feat(L7): add finance argument parsing, subject scope, mappers and withdraw transitions"
```

