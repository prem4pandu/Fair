# Lane L8 — Notifications & messaging providers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

> **Precedence notice (2026-10-09).** `implementation/docs/ROADMAP.md` is the single roadmap and outranks this
> file for scope, scheduling, ownership and gates; this file remains authoritative for its own task detail.
> `L10`, `L11` and `L13` are **retired identifiers** — they were never lanes in `OPERATION_LANES.json`. Read
> `L10` as **W15** for journey suites (`test/journeys/**`), **W16** for Playwright (`e2e/**`), and the matching
> frontend workstream **W12/W13/W14a/W14b** for edits inside a `vendor/enatega-ui/` package; `L11` as **W23**
> (independent QA) and `L13` as **W24** (independent security). Operation counts come from
> `docs/OPERATION_LANES.json`, not from prose. See `ROADMAP.md` §4.0.

**Goal:** Implement the five L8 operations the Enatega admin calls (`notifications`, `notificationsPaginated`, `sendNotificationUser`, `webNotifications`, `markWebNotificationsAsRead`), implement `NotifyPort` (push, email, SMS) for every other lane, and turn the domain events `user.otp`, `order.placed`, `order.transitioned`, `order.paid`, `withdraw.updated` and `ticket.message` into templated, preference-aware, idempotent deliveries with retries, rate limits and provider adapters (Expo push, FCM HTTP v1, Twilio Messages, SendGrid v3, and the development/test-only DevOutbox).

**Architecture:** The `notifications` module never calls a provider inside a request: every send becomes a `NotificationDelivery` row written in the caller's transaction (idempotent on `(sourceId, channel, address)`), and the worker drains that table with `FOR UPDATE SKIP LOCKED`, exponential backoff, per-provider rate limits and invalid-token cleanup. Admin broadcasts are stored as `Notification` rows and fanned out page by page by the worker; admin app-bar notifications are `WebNotification` rows with a per-user read watermark. Provider adapters sit behind `PushSender`/`EmailSender`/`SmsSender` (D13) and are proven against local HTTP contract fakes in `test/support/providers/`.

**Tech stack:** NestJS 12 (schema-first resolvers), `pg` 8 (raw SQL repositories, as the existing modules do), zod 4, jose 6 (FCM service-account JWT), Node 24 `fetch` with `AbortSignal.timeout`, Vitest 4 + Testcontainers 11, Playwright 1.63 (specs handed to L10).

---

## Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

L8 makes **no** edits under `vendor/enatega-ui/`. Customer-visible product naming in message templates comes only from `@fairbite/brand` (`brand.name`).

---

## Operations

Authoritative source: `implementation/docs/OPERATION_LANES.json` filtered by `"lane": "L8"` → **5 operations** (`perLane.L8 = 5`). All five are listed below; the count matches.

| #   | Type     | Name                         | Apps that call it (multivendor)                 | Who may call it                                                                                                                                  | Vendored documents to use in tests (`app`, `file`, `exportName`)                                                                                                                                                                                                                                               | Reference                                |
| --- | -------- | ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | query    | `notifications`              | admin (also svadmin, L12 app; root owned by L8) | `ADMIN`; `STAFF` with permission `Notification`                                                                                                  | `enatega-multivendor-admin`, `lib/api/graphql/queries/notifications/index.ts`, `GET_NOTIFICATIONS` (line 3); svadmin variant selecting `recipientType`: `enatega-singlevendor-admin`, `lib/api/graphql/queries/notifications/index.ts`, `GET_NOTIFICATIONS` (line 3)                                           | reference/04 §2.15, §B `S(Notification)` |
| 2   | query    | `notificationsPaginated`     | admin                                           | `ADMIN`; `STAFF` with `Notification`                                                                                                             | `enatega-multivendor-admin`, `lib/api/graphql/queries/notifications/index.ts`, `GET_NOTIFICATIONS_PAGINATED` (line 14)                                                                                                                                                                                         | reference/04 §2.15, §4 shape P1          |
| 3   | query    | `webNotifications`           | admin (super-admin app bar)                     | `ADMIN`, `STAFF` (rows filtered by permission), `VENDOR` (own vendor rows), `RESTAURANT` (own restaurant rows); `CUSTOMER`/`RIDER` → `FORBIDDEN` | `enatega-multivendor-admin`, `lib/api/graphql/queries/notifications/index.ts`, `GET_WEB_NOTIFICATIONS` (line 30)                                                                                                                                                                                               | reference/04 §2.15 (app bar)             |
| 4   | mutation | `markWebNotificationsAsRead` | admin (super-admin app bar)                     | same as `webNotifications`                                                                                                                       | `enatega-multivendor-admin`, `lib/api/graphql/mutations/notifications/index.ts`, `MARK_WEB_NOTIFICATIONS_AS_READ` (line 15)                                                                                                                                                                                    | reference/04 §2.15                       |
| 5   | mutation | `sendNotificationUser`       | admin (also svadmin)                            | `ADMIN`; `STAFF` with `Notification`                                                                                                             | `enatega-multivendor-admin`, `lib/api/graphql/mutations/notifications/index.ts`, `SEND_NOTIFICATION_USER` (line 3; no segment argument); `enatega-singlevendor-admin`, `lib/api/graphql/mutations/notifications/index.ts`, `SEND_NOTIFICATION_USER` (line 3; adds `$recipientType: NotificationRecipientType`) | reference/04 §2.15, §B, §C               |

Total: **5 / 5**.

Plus the non-GraphQL surface this lane owns:

- `NotifyPort` (`kernel/ports.ts`, `NOTIFY_PORT`) — implemented by `NotifyService`, consumed by L1, L4, L5, L6, L7.
- Domain-event handlers for `user.otp`, `order.placed`, `order.transitioned`, `order.paid`, `withdraw.updated`, `ticket.message` (worker).
- Provider adapters: Expo push, FCM HTTP v1, Twilio Messages, SendGrid v3, DevOutbox.

Client facts verified in the vendored source (cited by later rules):

| Fact                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multivendor broadcast form sends only `notificationTitle` (Formik `title`) and `notificationBody`; toast "Notification has been sent successfully" on completion; `refetchQueries: 'active'`                                                                                                                                            | `enatega-multivendor-admin/lib/ui/screen-components/protected/super-admin/notifications/form/index.tsx:40-59,73-78`                                                                                                                                                     |
| Resend button re-sends title/body; toast "The notification has been resent successfully"; refetches `GET_NOTIFICATIONS`                                                                                                                                                                                                                 | `enatega-multivendor-admin/lib/ui/useable-components/table/columns/notification-columns.tsx:22-50,74-80`                                                                                                                                                                |
| Client validation: title ≤ 25 ("You have reached the MAX limit of 25 characters", required "Title is required"), body ≤ 1500 ("You have reached the MAX limit of 1500 characters", required "Description is Required"), non-blank ("Name cannot be only spaces")                                                                        | `enatega-multivendor-admin/lib/utils/schema/notification.ts:2-13`                                                                                                                                                                                                       |
| Single-vendor admin segment values `CUSTOMER`, `STORE`, `RIDER`, default `CUSTOMER`; shows the returned string as the toast message                                                                                                                                                                                                     | `enatega-singlevendor-admin/lib/ui/screen-components/protected/super-admin/notifications/form/index.tsx:35-48,99-111`, `lib/utils/schema/notification.ts:3-5`, `lib/utils/interfaces/notification.interface.ts:9`                                                       |
| History table renders `createdAt` raw (multivendor) / parses ISO or epoch (single-vendor)                                                                                                                                                                                                                                               | `notification-columns.tsx:67-71` (mv); `enatega-singlevendor-admin/lib/ui/useable-components/table/columns/notification-columns.tsx:62-69`                                                                                                                              |
| Paginated history sends `page`, `limit` (10 default), `search` (debounced, `undefined` when empty); reads `data`, `totalCount`, `currentPage`                                                                                                                                                                                           | `enatega-multivendor-admin/lib/ui/screen-components/protected/super-admin/notifications/view/main/index.tsx:25-40,50-63`                                                                                                                                                |
| App bar loads `webNotifications` network-only on mount, refetches on `RIDER_UPDATED_SUBSCRIPTION`, calls `markWebNotificationsAsRead` on every bell click and on item click, counts `!read`, renders `body`, links to `navigateTo`, renders `timeAgo(+createdAt)` (epoch milliseconds)                                                  | `enatega-multivendor-admin/lib/ui/screen-components/protected/layout/super-admin-layout/app-bar/index.tsx:117-145,291-359`; `lib/utils/methods/timeAgo.ts:1-8`                                                                                                          |
| Web notifications are rendered only by the super-admin layout                                                                                                                                                                                                                                                                           | `enatega-multivendor-admin/lib/ui/layouts/protected/super-admin/index.tsx:114-117` (only importer of `GET_WEB_NOTIFICATIONS`)                                                                                                                                           |
| Staff permission strings include `Notification`, `Orders`, `Withdraw Request`                                                                                                                                                                                                                                                           | `enatega-multivendor-admin/lib/utils/constants/permissions.ts:1-20`                                                                                                                                                                                                     |
| Customer app push taps: `data.type === 'REVIEW_ORDER'` with `data._id` opens the review modal; `data.type === 'order'` uses `data._id \|\| data.orderId` and `data.appMode`/`mode`/`vendorMode`                                                                                                                                         | `enatega-multivendor-app/App.js:314-366`; `src/mode/orderOrigin.js:71-79`; `src/utils/enums.js:12-14`                                                                                                                                                                   |
| Store app push tap reads `data._id` (string)                                                                                                                                                                                                                                                                                            | `enatega-multivendor-store/lib/hooks/useNotification.ts:78-97`                                                                                                                                                                                                          |
| Rider app push tap: needs `data._id` or `data.orderId`, otherwise ignores; `type === "chat"` opens chat, anything else navigates to `/order-detail?itemId=<_id>`                                                                                                                                                                        | `enatega-multivendor-rider/lib/context/global/chat-notification.context.tsx:270-312`                                                                                                                                                                                    |
| Android channels: store `"default"` (MAX importance, sound), rider `"default"` (HIGH, sound)                                                                                                                                                                                                                                            | `enatega-multivendor-store/lib/hooks/useNotification.ts:42-48`; `enatega-multivendor-rider/lib/context/global/chat-notification.context.tsx:329-333`                                                                                                                    |
| All three mobile apps register **Expo** push tokens (`getExpoPushTokenAsync`); admin web registers an FCM web token through `uploadToken` (L2)                                                                                                                                                                                          | `enatega-multivendor-app/src/screens/Settings/Settings.js:158`, `enatega-multivendor-store/lib/hooks/useLogin.ts:145`, `enatega-multivendor-rider/lib/utils/methods/permission.ts:43`; `enatega-multivendor-admin/lib/ui/layouts/protected/super-admin/index.tsx:73-87` |
| Customer preferences `isOrderNotification`/`isOfferNotification` (`updateNotificationStatus`, L1); restaurant `enableNotification` (`saveRestaurantToken`, L1)                                                                                                                                                                          | `enatega-multivendor-app/src/apollo/mutations.js:385-391`; `enatega-multivendor-store/lib/apollo/mutations/notification.mutation.ts:3-11`                                                                                                                               |
| Admin messaging configuration fields (owned by L2): `twilioAccountSid`, `twilioPhoneNumber`, `twilioEnabled`, write-only `twilioAuthToken`; `sendGridEnabled`, `sendGridEmail`, `sendGridEmailName`; nodemailer `email`, `emailName`, `enableEmail`, write-only `password`; Firebase **web client** config only (no server credentials) | `enatega-multivendor-admin/lib/api/graphql/queries/configuration/index.ts:3-57`; `lib/ui/screen-components/protected/super-admin/configuration/add-form/twilio/index.tsx:60-70`, `nodemailer/index.tsx:49-54`, `firebase-admin/index.tsx:65-74`                         |

---

## Contract notes

File: `contracts/enatega/L8-notifications.graphql` (W1-L.1). The generator cannot infer the enum, the argument nullability that differs between apps, or the timestamp conventions, so the whole file is given here.

```graphql
# contracts/enatega/L8-notifications.graphql — lane L8 (notifications)

# Broadcast segment. Sent only by the single-vendor admin form
# (enatega-singlevendor-admin .../notifications/form/index.tsx:99-111).
# The multivendor admin omits the argument; the server defaults to CUSTOMER.
enum NotificationRecipientType {
  CUSTOMER
  STORE
  RIDER
}

# One admin broadcast (history row). reference/04 §2.15.
type Notification {
  _id: ID!
  # Optional on the wire (`notificationTitle: String`); null when the admin left it blank.
  title: String
  body: String!
  # Selected by the single-vendor admin only.
  recipientType: NotificationRecipientType
  # ISO-8601 (kernel/time.ts isoString). The multivendor table prints it raw;
  # the single-vendor table parses ISO or epoch.
  createdAt: String!
}

# Paginated wrapper, shape P1 (kernel/pagination.ts p1).
type PaginatedNotifications {
  data: [Notification!]!
  totalCount: Int!
  currentPage: Int!
  totalPages: Int!
  nextPage: Int
  prevPage: Int
}

# Admin app-bar notification. reference/04 §2.15.
type WebNotification {
  _id: ID!
  body: String!
  # Admin route the item links to; null renders href="null" upstream, so the server always sets it.
  navigateTo: String
  read: Boolean!
  # Epoch milliseconds as a string (kernel/time.ts epochMillisString):
  # the app bar renders timeAgo(+createdAt) (app-bar/index.tsx:351).
  createdAt: String!
}

extend type Query {
  # admin, svadmin. ADMIN, or STAFF with permission "Notification". Newest first, at most 500 rows.
  notifications: [Notification!]!
  # admin. ADMIN, or STAFF with "Notification". page default 1, limit default 10 (max 100),
  # search matches title or body, case-insensitive, at most 100 characters.
  notificationsPaginated(
    page: Int
    limit: Int
    search: String
  ): PaginatedNotifications!
  # admin, svadmin. ADMIN, STAFF (permission-filtered), VENDOR, RESTAURANT. Newest 50 for the caller's scope.
  webNotifications: [WebNotification!]!
}

extend type Mutation {
  # admin, svadmin. ADMIN, or STAFF with "Notification". Queues a broadcast; returns a status message.
  # Never reports success when no push provider is configured (PROVIDER_UNAVAILABLE).
  sendNotificationUser(
    notificationTitle: String
    notificationBody: String!
    recipientType: NotificationRecipientType
  ): String!
  # admin, svadmin. Same callers as webNotifications. Marks everything visible to the caller as read
  # and returns the same list as webNotifications.
  markWebNotificationsAsRead: [WebNotification!]!
}
```

Field rules:

- No money fields are exposed by L8 types. Amounts inside message texts are formatted from integer minor units with the configured currency (`formatAmount`).
- No upstream misspellings exist in L8 roots or types.
- `sendNotificationUser` returns `String!`; the value is exactly `"Notification queued for delivery"`.
- `Notification.recipientType` is non-null in the database (default `CUSTOMER`) but nullable in SDL because the multivendor admin never selects it and older rows are irrelevant; the resolver always sets it.
- No field-level restriction is needed beyond the root guards: L8 types carry no secrets or personal data. Push tokens, phone numbers and email addresses live only in `NotificationDelivery`, which no GraphQL type exposes.

---

## Data model

File: `services/api/prisma/schema/L8-notifications.prisma` (W1-L.2).

```prisma
// services/api/prisma/schema/L8-notifications.prisma — lane L8

/// One admin broadcast (sendNotificationUser). Immutable except for fan-out progress.
model Notification {
  id             String    @id @db.Uuid
  title          String?   @db.VarChar(25)
  body           String    @db.VarChar(1500)
  /// CUSTOMER | STORE | RIDER (CHECK in SQL)
  recipientType  String    @default("CUSTOMER") @db.VarChar(16)
  /// QUEUED | SENDING | COMPLETED | FAILED (CHECK in SQL)
  status         String    @default("QUEUED") @db.VarChar(16)
  /// L1 user id of the ADMIN/STAFF author (cross-lane FK, see CROSS_LANE_FKS)
  createdById    String    @db.Uuid
  recipientCount Int       @default(0)
  sentCount      Int       @default(0)
  failedCount    Int       @default(0)
  /// Last recipientId expanded into deliveries (keyset cursor into UsersPort.segmentPushTargets)
  expandCursor   String?   @db.VarChar(64)
  createdAt      DateTime  @default(now()) @db.Timestamptz(3)
  expandedAt     DateTime? @db.Timestamptz(3)
  completedAt    DateTime? @db.Timestamptz(3)

  @@index([createdAt(sort: Desc)])
  @@index([status, createdAt])
  @@index([createdById, createdAt])
}

/// One message to one address on one channel. The delivery queue drained by the worker.
model NotificationDelivery {
  id                String    @id @db.Uuid
  /// EVENT | BROADCAST | DIRECT
  sourceType        String    @db.VarChar(16)
  /// Domain event id, Notification id, or a fresh id per direct NotifyPort call
  sourceId          String    @db.VarChar(64)
  /// PUSH | EMAIL | SMS
  channel           String    @db.VarChar(8)
  /// USER | RESTAURANT | EMAIL | PHONE
  recipientType     String    @db.VarChar(16)
  recipientId       String    @db.VarChar(254)
  /// Push token, email address or E.164 phone number
  address           String    @db.VarChar(512)
  /// EXPO | FCM | TWILIO | SENDGRID | OUTBOX, set when a sender is chosen
  provider          String?   @db.VarChar(16)
  template          String    @db.VarChar(64)
  locale            String    @db.VarChar(16)
  title             String?   @db.VarChar(200)
  body              String    @db.VarChar(2000)
  data              Json      @default("{}") @db.JsonB
  /// OTP messages: body and data are replaced by "[redacted]" / {} once final
  sensitive         Boolean   @default(false)
  /// QUEUED | SENDING | SENT | FAILED | SKIPPED
  status            String    @default("QUEUED") @db.VarChar(16)
  attempts          Int       @default(0)
  nextAttemptAt     DateTime  @default(now()) @db.Timestamptz(3)
  lockedUntil       DateTime? @db.Timestamptz(3)
  expiresAt         DateTime  @db.Timestamptz(3)
  lastError         String?   @db.VarChar(500)
  providerMessageId String?   @db.VarChar(200)
  receiptCheckedAt  DateTime? @db.Timestamptz(3)
  createdAt         DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime  @default(now()) @updatedAt @db.Timestamptz(3)
  sentAt            DateTime? @db.Timestamptz(3)

  @@unique([sourceId, channel, address])
  @@index([status, nextAttemptAt])
  @@index([sourceType, sourceId, status])
  @@index([provider, status, receiptCheckedAt])
}

/// Admin/vendor/restaurant app-bar notification.
model WebNotification {
  id         String   @id @db.Uuid
  /// ADMIN | VENDOR | RESTAURANT
  audience   String   @db.VarChar(16)
  /// "" for ADMIN, vendor id for VENDOR, restaurant id for RESTAURANT
  scopeId    String   @default("") @db.VarChar(64)
  /// STAFF permission required to see it (null = every admin/staff)
  permission String?  @db.VarChar(32)
  body       String   @db.VarChar(500)
  navigateTo String?  @db.VarChar(200)
  /// Domain event id that produced it (idempotency)
  sourceId   String   @db.VarChar(64)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)

  @@unique([sourceId, audience, scopeId])
  @@index([audience, scopeId, createdAt(sort: Desc)])
}

/// Per-user read watermark: a web notification is read when createdAt <= readUpTo.
model WebNotificationReadMark {
  userId    String   @id @db.Uuid
  readUpTo  DateTime @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @db.Timestamptz(3)
}
```

Migration `services/api/prisma/migrations/202610090180_L8_init/migration.sql` — generate with `prisma migrate diff`, then append the CHECK constraints by hand. The reviewed result must be exactly:

```sql
-- 202610090180_L8_init — lane L8 notifications
CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "title" VARCHAR(25),
  "body" VARCHAR(1500) NOT NULL,
  "recipientType" VARCHAR(16) NOT NULL DEFAULT 'CUSTOMER',
  "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  "createdById" UUID NOT NULL,
  "recipientCount" INTEGER NOT NULL DEFAULT 0,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "expandCursor" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expandedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt" DESC);
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");
CREATE INDEX "Notification_createdById_createdAt_idx" ON "Notification"("createdById", "createdAt");

CREATE TABLE "NotificationDelivery" (
  "id" UUID NOT NULL,
  "sourceType" VARCHAR(16) NOT NULL,
  "sourceId" VARCHAR(64) NOT NULL,
  "channel" VARCHAR(8) NOT NULL,
  "recipientType" VARCHAR(16) NOT NULL,
  "recipientId" VARCHAR(254) NOT NULL,
  "address" VARCHAR(512) NOT NULL,
  "provider" VARCHAR(16),
  "template" VARCHAR(64) NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "title" VARCHAR(200),
  "body" VARCHAR(2000) NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "sensitive" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastError" VARCHAR(500),
  "providerMessageId" VARCHAR(200),
  "receiptCheckedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(3),
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationDelivery_sourceId_channel_address_key" ON "NotificationDelivery"("sourceId", "channel", "address");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_sourceType_sourceId_status_idx" ON "NotificationDelivery"("sourceType", "sourceId", "status");
CREATE INDEX "NotificationDelivery_provider_status_receiptCheckedAt_idx" ON "NotificationDelivery"("provider", "status", "receiptCheckedAt");

CREATE TABLE "WebNotification" (
  "id" UUID NOT NULL,
  "audience" VARCHAR(16) NOT NULL,
  "scopeId" VARCHAR(64) NOT NULL DEFAULT '',
  "permission" VARCHAR(32),
  "body" VARCHAR(500) NOT NULL,
  "navigateTo" VARCHAR(200),
  "sourceId" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebNotification_sourceId_audience_scopeId_key" ON "WebNotification"("sourceId", "audience", "scopeId");
CREATE INDEX "WebNotification_audience_scopeId_createdAt_idx" ON "WebNotification"("audience", "scopeId", "createdAt" DESC);

CREATE TABLE "WebNotificationReadMark" (
  "userId" UUID NOT NULL,
  "readUpTo" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebNotificationReadMark_pkey" PRIMARY KEY ("userId")
);

-- Hand-written constraints (Prisma cannot express them; drift check ignores CHECKs).
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientType_check" CHECK ("recipientType" IN ('CUSTOMER', 'STORE', 'RIDER')),
  ADD CONSTRAINT "Notification_status_check" CHECK ("status" IN ('QUEUED', 'SENDING', 'COMPLETED', 'FAILED')),
  ADD CONSTRAINT "Notification_body_check" CHECK (length(btrim("body")) > 0),
  ADD CONSTRAINT "Notification_counts_check" CHECK ("recipientCount" >= 0 AND "sentCount" >= 0 AND "failedCount" >= 0);
ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_sourceType_check" CHECK ("sourceType" IN ('EVENT', 'BROADCAST', 'DIRECT')),
  ADD CONSTRAINT "NotificationDelivery_channel_check" CHECK ("channel" IN ('PUSH', 'EMAIL', 'SMS')),
  ADD CONSTRAINT "NotificationDelivery_recipientType_check" CHECK ("recipientType" IN ('USER', 'RESTAURANT', 'EMAIL', 'PHONE')),
  ADD CONSTRAINT "NotificationDelivery_provider_check" CHECK ("provider" IS NULL OR "provider" IN ('EXPO', 'FCM', 'TWILIO', 'SENDGRID', 'OUTBOX')),
  ADD CONSTRAINT "NotificationDelivery_status_check" CHECK ("status" IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  ADD CONSTRAINT "NotificationDelivery_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "WebNotification"
  ADD CONSTRAINT "WebNotification_audience_check" CHECK ("audience" IN ('ADMIN', 'VENDOR', 'RESTAURANT')),
  ADD CONSTRAINT "WebNotification_scope_check" CHECK (("audience" = 'ADMIN') = ("scopeId" = ''));
```

No PostGIS columns, sequences or money columns in this lane.

Cross-lane foreign keys for `docs/CROSS_LANE_FKS.md` (added by the lead in W1-Z.1):

| Column                           | References                                                                       | On delete                                                               |
| -------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `Notification.createdById`       | L1 user table (`User.id`; if L1 stores ADMIN/STAFF elsewhere, that table's `id`) | `RESTRICT` (users are soft-deleted; broadcast authorship is audit data) |
| `WebNotificationReadMark.userId` | L1 user table `id`                                                               | `CASCADE`                                                               |

`NotificationDelivery.recipientId` and `WebNotification.scopeId` are polymorphic (user, restaurant, vendor, email, phone) and deliberately have **no** foreign key.

---

## Business rules

Callers and ownership

- **R1** `notifications`, `notificationsPaginated`, `sendNotificationUser`: `requirePermission(auth, "Notification")` (ADMIN always passes, STAFF needs `Notification`; master §4.4, reference/04 §B `S(Notification)`). Anonymous → `UNAUTHENTICATED` (HTTP 401); any other type → `FORBIDDEN` (HTTP 403). Auth is checked before argument validation.
- **R2** `webNotifications`, `markWebNotificationsAsRead`: `requireAuth(auth, "ADMIN", "STAFF", "VENDOR", "RESTAURANT")`. Scope: ADMIN → all `audience = ADMIN` rows; STAFF → `ADMIN` rows whose `permission` is null or in `auth.permissions`; VENDOR → `audience = VENDOR AND scopeId = auth.vendorId` (no `vendorId` → `FORBIDDEN`); RESTAURANT → `audience = RESTAURANT AND scopeId ∈ auth.restaurantIds` (empty list → `[]`). CUSTOMER and RIDER → `FORBIDDEN`. The scope always comes from `AuthContext`, never from arguments (there are none).

Broadcasts (`sendNotificationUser`)

- **R3** Validation, in this order, with the admin form's own messages (`lib/utils/schema/notification.ts:2-13`): title is optional, trimmed, `BAD_USER_INPUT` "You have reached the MAX limit of 25 characters" when longer than 25; a blank title is stored as `null`. Body is trimmed; blank → `BAD_USER_INPUT` "Description is Required"; longer than 1500 → `BAD_USER_INPUT` "You have reached the MAX limit of 1500 characters". `recipientType` is coerced by GraphQL (unknown enum → `BAD_USER_INPUT` from variable coercion); omitted/null → `CUSTOMER`.
- **R4** Segments: `CUSTOMER` → every active customer with a stored push token whose `offerNotification` is true; `STORE` → every restaurant with a stored token whose `enableNotification` is true (L1 maps it to both flags); `RIDER` → every active rider user with a stored token. The multivendor admin never sends `recipientType`, so its broadcasts always go to customers. **UNVERIFIED** (upstream backend not available): default `CUSTOMER` chosen because it is the single-vendor form's default.
- **R5** Provider check before anything is stored: if no push provider is configured (`NOTIFY_PUSH_PROVIDER=none`), record an audit entry `notification.broadcast.failed` and throw `PROVIDER_UNAVAILABLE` "Push notifications are not available". No history row is written.
- **R6** Throttle: one broadcast per author per `NOTIFY_BROADCAST_INTERVAL_SECONDS` (default 60), enforced under `pg_advisory_xact_lock(hashtextextended('notification-broadcast:<userId>', 0))` so concurrent requests cannot both pass. Violation → `RATE_LIMITED` "Too many attempts, try again later". **UNVERIFIED** default 60 s (the "Resend" button resends immediately, so E2E runs set the interval to 0).
- **R7** Audit: inside the broadcast transaction, `AuditPort.record({ actorId, actorType, action: "notification.broadcast", entity: "Notification", entityId, changes: { recipientType, title, bodyLength } })`; if the audit write throws, the broadcast is rolled back.
- **R8** Return value is exactly `"Notification queued for delivery"`. The broadcast row starts `QUEUED`; the worker expands it in pages of 500 targets (keyset on `recipientId`, at most 5 pages per tick), marks it `SENDING`, and when no delivery is `QUEUED`/`SENDING` sets `recipientCount`, `sentCount`, `failedCount`, `completedAt` and status `COMPLETED`, or `FAILED` when there was at least one recipient and none succeeded.
- **R9** Broadcast push payload: title = admin title (omitted when null), body = admin body, `data = { type: "notification", notificationId: <id> }`. It deliberately has **no** `_id`/`orderId`, because the rider app treats any `_id` as an order id and navigates to `/order-detail` (`chat-notification.context.tsx:275-311`), and the store app records `_id` as a handled notification (`useNotification.ts:88-96`). Broadcast texts are not translated (the admin wrote them).

History

- **R10** `notifications` returns the newest 500 broadcasts, ordered by `createdAt DESC, id DESC`. `notificationsPaginated` uses `paginate({ page, limit })` (defaults 1/10, max 100) and `p1`; `search` is trimmed, at most 100 characters (`BAD_USER_INPUT` "Search is too long"), matched with `ILIKE` against title or body with `%`, `_` and `\` escaped (Postgres' default LIKE escape is `\`). `createdAt` is ISO-8601.

Web notifications

- **R11** `webNotifications` returns the newest 50 rows in the caller's scope (R2), `createdAt DESC, id DESC`, `read = (readUpTo IS NOT NULL AND createdAt <= readUpTo)`, `createdAt` as epoch-milliseconds string, `navigateTo` always set by the producer.
- **R12** `markWebNotificationsAsRead` upserts the caller's `readUpTo = GREATEST(existing, now)` and returns the same list as R11 (now all read). Read state is per user: one admin marking does not change another admin's badge. Notifications created after the mark are unread.
- **R13** Web notifications are produced only by event handlers (R22–R27), idempotent on `(sourceId, audience, scopeId)`.

Delivery

- **R14** Every send is a `NotificationDelivery` row, inserted with `ON CONFLICT ("sourceId", channel, address) DO NOTHING` → idempotency per (event id, recipient address, channel). Event handlers use the outbox event id as `sourceId`, broadcasts their `Notification.id`, direct `NotifyPort` calls a fresh `newId()` per call.
- **R15** Preferences: purpose `ORDER` requires `target.orderNotification`, `OFFER` requires `target.offerNotification`, `ACCOUNT` (OTP, withdrawals, ticket replies, direct calls without a category) ignores both. Direct `NotifyPort.push` calls opt in with `data.category = "order" | "offer"`.
- **R16** Token validity: `ExponentPushToken[...]`/`ExpoPushToken[...]` → Expo; `[A-Za-z0-9_:-]{32,512}` → FCM; anything else is inserted as `SKIPPED` with `lastError` "Invalid push token format" and `UsersPort.clearPushToken(token)` is called. Emails must match `^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$` (lower-cased) else `SKIPPED` "Invalid email address"; phones are stripped of spaces, `-`, `(`, `)` and must be E.164 else `SKIPPED` "Invalid phone number".
- **R17** Worker claim: `status = 'QUEUED' AND nextAttemptAt <= now` or `status = 'SENDING' AND lockedUntil < now` (crash recovery), `ORDER BY nextAttemptAt, id LIMIT NOTIFY_BATCH_SIZE (50) FOR UPDATE SKIP LOCKED`; claiming sets `SENDING`, `attempts + 1`, `lockedUntil = now + 120 s`.
- **R18** Outcomes: `sent` → `SENT`, `provider`, `providerMessageId`, `sentAt`. `retry` (network error, timeout, HTTP 429, HTTP ≥ 500, Expo `MessageRateExceeded`, adapter exception) → `QUEUED` with `nextAttemptAt = now + (Retry-After seconds, if the provider sent one, else min(30·2^(attempts−1), 3600) s)`; when `attempts >= NOTIFY_MAX_ATTEMPTS` (default 6) → `FAILED`. `invalid-recipient` (Expo `DeviceNotRegistered`, FCM `UNREGISTERED`/`SENDER_ID_MISMATCH`, Twilio 21211/21610/21614) → `FAILED` and, for push, `UsersPort.clearPushToken(address)`. `failed` → `FAILED`. `unavailable` or no sender for the channel → `FAILED` with `lastError` starting `PROVIDER_UNAVAILABLE:`. A failure is never recorded as `SENT`.
- **R19** Expiry: each template has a TTL (OTP 600 s, order pushes 3600–7200 s, everything else 86 400 s); a claimed delivery past `expiresAt` → `FAILED` "Expired before delivery".
- **R20** Sensitive templates (all `otp.*`): once final (`SENT`/`FAILED`/`SKIPPED`) the row's `body` becomes `[redacted]` and `data` `{}`. The DevOutbox (development/test only) keeps the text so tests can read OTPs.
- **R21** Rate limit: per provider, at most `NOTIFY_PROVIDER_RATE_PER_SECOND` (default 20) sends per second per worker process (token spacing on the monotonic clock).
- **R21a** Expo receipts: every 15 min the worker asks Expo for receipts of `SENT` Expo deliveries older than 15 min without `receiptCheckedAt` (≤ 1000 per call); an error receipt → `FAILED` "Expo receipt <error>" and, for `DeviceNotRegistered`, `clearPushToken`. Receipts never arriving within 24 h are marked checked.

Event handlers (worker; all idempotent through R13/R14)

- **R22** `user.otp` → email `otp.email.<purpose>` or SMS `otp.sms.<purpose>` with `{code}`, purpose `ACCOUNT`, locale English (the event carries no locale). If the provider is missing the delivery is recorded `FAILED` `PROVIDER_UNAVAILABLE: ...` (R18) — L1 must call `NotifyPort.available(...)` before telling the app an OTP was sent (Lead request LR-1).
- **R23** `order.placed` → push `order.placed.restaurant` to the restaurant's token (purpose `ORDER`, `data = { type: "order", _id: order.id, orderId: order.orderId }`, Android channel `default`, sound `default`); web notifications "New order <orderId> received" for `ADMIN` (permission `Orders`, `navigateTo` `/management/orders`), `RESTAURANT` scope `restaurantId` (`/admin/store/orders`) and, when the restaurant has a vendor, `VENDOR` scope `vendorId` (`/admin/vendor/stores`). Routes verified in `enatega-multivendor-admin/app/(localized)/(protected)/`.
- **R24** `order.transitioned` by target status (customer `data = { type: "order", _id, orderId, appMode: "MULTI", status }`; store/rider `data = { type: "order", _id, orderId }`):
  - `ACCEPTED`: customer `order.accepted.customer` (pickup orders, `isPickedUp = true`: `order.accepted.customer.pickup`) with the restaurant name (fallback "The store"); for delivery orders with a `zoneId` and no rider yet, every active rider returned by `RidersPort.availableInZone(zoneId)` gets `order.accepted.rider`. **UNVERIFIED**: `isPickedUp` is treated as "pickup order" (Enatega naming; D5).
  - `ASSIGNED`: customer `order.assigned.customer`; restaurant `order.assigned.restaurant`; the rider `order.assigned.rider` unless the actor is the rider (self-claim).
  - `PICKED`: customer `order.picked.customer`.
  - `DELIVERED`: customer `order.delivered.customer` (pickup: `order.delivered.customer.pickup`) with `data = { type: "REVIEW_ORDER", _id, orderId, appMode: "MULTI" }` so the app opens its review prompt (`App.js:324-331`).
  - `CANCELLED`: customer unless the actor is `CUSTOMER`; restaurant unless the actor is `RESTAURANT`; the assigned rider unless the actor is `RIDER`.
  - `PENDING`: nothing. All customer/store/rider order pushes use purpose `ORDER`. **UNVERIFIED**: actor types are the `USER_TYPES` strings plus `SYSTEM` (L5 confirms).
- **R25** `order.paid` → customer `order.paid.customer` with `{amount}` = `formatAmount(paidMinor, order.currency)` (e.g. `$12.50`), purpose `ORDER`; unknown order → nothing.
- **R26** `withdraw.updated`: `REQUESTED` → web notification for `ADMIN` (permission `Withdraw Request`, `/wallet/withdraw-requests`) "New withdrawal request of <amount>"; `TRANSFERRED` → `withdraw.transferred`, `CANCELLED` → `withdraw.cancelled` to the requesting restaurant (audience `RESTAURANT`) or rider (rider's user), purpose `ACCOUNT`, `data = { type: "withdraw", requestId }` (no `_id`, R9 reasoning). Status values `REQUESTED`, `TRANSFERRED`, `CANCELLED` verified in `enatega-multivendor-admin/lib/ui/screen-components/protected/super-admin/withdraw-requests/`. Needs the payload extension in LR-2.
- **R27** `ticket.message`: `senderType = ADMIN` → customer push `ticket.reply.customer` with the ticket title (first 100 characters), purpose `ACCOUNT`, `data = { type: "ticket", ticketId }`; `senderType = USER` → web notification for `ADMIN` (no permission; the CustomerSupport menu has none) `New message on support ticket "<title>"`, `/customerSupport`. Needs LR-2.

`NotifyPort`

- **R28** `NotifyPort.push/email/sms` first check `available(channel)`; when false they throw `PROVIDER_UNAVAILABLE` with "Push notifications are not available" / "Email delivery is not available" / "SMS delivery is not available". They resolve once the delivery is queued (not delivered). `email()` accepts only `EMAIL` templates (`otp.email.*`); any other template id is a programming error (`Error`, surfaces as `INTERNAL_SERVER_ERROR`). `sms(to, text)` sends `text` verbatim through template `direct.sms`.
- **R29** `available("push")` is true unless `NOTIFY_PUSH_PROVIDER=none`; `available("email")` is true for `outbox`, or for `sendgrid` when L2's messaging config has SendGrid enabled with an API key and a from address; `available("sms")` is true for `outbox`, or for `twilio` when enabled with account SID, auth token and from number.

Configuration and providers (D13)

- **R30** `NOTIFY_PUSH_PROVIDER` ∈ `native | outbox | none`, `NOTIFY_EMAIL_PROVIDER` ∈ `sendgrid | outbox | none`, `NOTIFY_SMS_PROVIDER` ∈ `twilio | outbox | none`. Defaults: `outbox` when `APP_ENV` is `development` or `test`, `none` in production. `outbox` in production fails startup with "<KEY>: OutboxSender is not allowed in production"; the `OutboxSender` constructor refuses production as a second guard. Provider base URLs must be `https` in production. Configuration errors list only key names, never values.
- **R31** Credentials: Twilio SID/auth token/from number and SendGrid API key/from address are write-only configuration owned by L2's SecretStore and read through `ConfigPort.messaging()` (LR-1), cached 30 s. The FCM service account (`FCM_SERVICE_ACCOUNT_JSON`, raw JSON or base64) and the optional `EXPO_ACCESS_TOKEN` are deployment secrets (the admin UI has no field for them). Native push with no FCM service account sends Expo tokens and records FCM tokens as `PROVIDER_UNAVAILABLE: FCM is not configured`.
- **R32** No provider is ever called from a request thread; no provider secret, token or OTP is logged. Worker logs carry only `{ event, job, error: <Error.name> }`.
- **R33** SMTP (the admin's "NodeMailer" form) is **not** implemented in this lane: `NOTIFY_EMAIL_PROVIDER` has no `smtp` value. Saving the nodemailer form (L2) has no delivery effect until the owner approves the extra dependency (Open question Q2).

Exact strings emitted by L8 (no forbidden words; master §4.3):

| Code                            | Message                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BAD_USER_INPUT`                | "You have reached the MAX limit of 25 characters" · "Description is Required" · "You have reached the MAX limit of 1500 characters" · "Search is too long" |
| `RATE_LIMITED`                  | "Too many attempts, try again later" (default)                                                                                                             |
| `PROVIDER_UNAVAILABLE`          | "Push notifications are not available" · "Email delivery is not available" · "SMS delivery is not available"                                               |
| `FORBIDDEN` / `UNAUTHENTICATED` | kernel defaults                                                                                                                                            |

Subscriptions: L8 publishes none. The app bar refetches `webNotifications` on mount and whenever L6's `riderUpdated` subscription fires (`RIDER_UPDATED_SUBSCRIPTION`, `enatega-multivendor-admin/lib/api/graphql/subscription/rider-subscription/index.ts:3`); no new subscription is introduced because the UI has none to consume.

Message templates (exact texts, `en`; `{x}` = variable; `brand.name` from `@fairbite/brand`, today "FairBite"):

| Template id                       | Channel | TTL     | Title / subject                   | Body                                                                                                         |
| --------------------------------- | ------- | ------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `otp.email.signup`                | EMAIL   | 600 s   | `Your FairBite verification code` | `Your FairBite verification code is {code}. Do not share this code with anyone.`                             |
| `otp.email.login`                 | EMAIL   | 600 s   | `Your FairBite sign-in code`      | `Your FairBite sign-in code is {code}. Do not share this code with anyone.`                                  |
| `otp.email.reset`                 | EMAIL   | 600 s   | `Reset your FairBite password`    | `Your FairBite password reset code is {code}. If you did not ask to reset your password, ignore this email.` |
| `otp.sms.signup`                  | SMS     | 600 s   | —                                 | `Your FairBite verification code is {code}.`                                                                 |
| `otp.sms.login`                   | SMS     | 600 s   | —                                 | `Your FairBite sign-in code is {code}.`                                                                      |
| `otp.sms.reset`                   | SMS     | 600 s   | —                                 | `Your FairBite password reset code is {code}.`                                                               |
| `order.placed.restaurant`         | PUSH    | 7200 s  | `New order`                       | `You have a new order {orderId}.`                                                                            |
| `order.accepted.customer`         | PUSH    | 3600 s  | `Order accepted`                  | `{restaurant} accepted your order {orderId}.`                                                                |
| `order.accepted.customer.pickup`  | PUSH    | 3600 s  | `Order accepted`                  | `{restaurant} accepted your pickup order {orderId}.`                                                         |
| `order.accepted.rider`            | PUSH    | 3600 s  | `New order available`             | `Order {orderId} from {restaurant} is waiting for a rider.`                                                  |
| `order.assigned.customer`         | PUSH    | 3600 s  | `Rider assigned`                  | `A rider is on the way to collect your order {orderId}.`                                                     |
| `order.assigned.restaurant`       | PUSH    | 3600 s  | `Rider assigned`                  | `A rider has been assigned to order {orderId}.`                                                              |
| `order.assigned.rider`            | PUSH    | 3600 s  | `New order assigned`              | `Order {orderId} from {restaurant} has been assigned to you.`                                                |
| `order.picked.customer`           | PUSH    | 3600 s  | `Order on the way`                | `Your order {orderId} has been picked up and is on its way.`                                                 |
| `order.delivered.customer`        | PUSH    | 86400 s | `Order delivered`                 | `Your order {orderId} has been delivered. Enjoy your meal!`                                                  |
| `order.delivered.customer.pickup` | PUSH    | 86400 s | `Order collected`                 | `Your order {orderId} has been collected. Enjoy your meal!`                                                  |
| `order.cancelled.customer`        | PUSH    | 86400 s | `Order cancelled`                 | `Your order {orderId} was cancelled.`                                                                        |
| `order.cancelled.restaurant`      | PUSH    | 86400 s | `Order cancelled`                 | `Order {orderId} was cancelled.`                                                                             |
| `order.cancelled.rider`           | PUSH    | 86400 s | `Order cancelled`                 | `Order {orderId} was cancelled.`                                                                             |
| `order.paid.customer`             | PUSH    | 86400 s | `Payment received`                | `We received your payment of {amount} for order {orderId}.`                                                  |
| `withdraw.transferred`            | PUSH    | 86400 s | `Withdrawal transferred`          | `Your withdrawal request of {amount} has been transferred.`                                                  |
| `withdraw.cancelled`              | PUSH    | 86400 s | `Withdrawal cancelled`            | `Your withdrawal request of {amount} was cancelled.`                                                         |
| `ticket.reply.customer`           | PUSH    | 86400 s | `New reply from support`          | `You have a new reply on your support ticket "{ticket}".`                                                    |
| `broadcast`                       | PUSH    | 86400 s | `{title}` (none when empty)       | `{body}`                                                                                                     |
| `direct.push`                     | PUSH    | 86400 s | `{title}`                         | `{body}`                                                                                                     |
| `direct.sms`                      | SMS     | 86400 s | —                                 | `{body}`                                                                                                     |
| `web.order.placed`                | WEB     | —       | —                                 | `New order {orderId} received`                                                                               |
| `web.withdraw.requested`          | WEB     | —       | —                                 | `New withdrawal request of {amount}`                                                                         |
| `web.ticket.message`              | WEB     | —       | —                                 | `New message on support ticket "{ticket}"`                                                                   |

i18n: each template stores texts per locale; lookup tries the exact locale (`pt-br`), then the language (`pt`), then `en`. Only `en` texts exist today; recipients' locales come from `PushTarget.locale` (L1, nullable). Adding a language means adding entries, never changing code. Substitution is single-pass, so admin text containing `{...}` is sent literally; a missing variable throws (never sends a half-filled message).

---

## Tasks

Owned paths (master §6): `contracts/enatega/L8-notifications.graphql`, `services/api/prisma/schema/L8-notifications.prisma`, `services/api/prisma/migrations/*_L8_*`, `services/api/src/modules/notifications/**`, `services/api/test/unit/notifications/**`, `services/api/test/integration/notifications/**`, `services/worker/src/jobs/notifications/**`, `services/worker/test/jobs/notifications.spec.ts`, the `// L8` section of `services/api/test/support/factories.ts`, and — assigned to L8 by the lane brief — `services/api/test/support/providers/**` (provider contract fakes; the lead confirms this sub-directory, LR-7).

Branch: `wave2/L8-notifications` from `enatega-ui-backend`. Commands run from `implementation/`.

Shared test conventions in this plan:

- Unit specs: `pnpm --filter @fairbite/api exec vitest run <file>`. Integration specs: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts <file>` (Docker required for files that call `startStack`, master §10).
- HTTP tests use the exact vendored documents through `doc(...)` and are tagged with `op(...)`.
- Service-level integration tests build the lane graph with `buildLane` (Task 7) on the real database and use small inline fakes for other lanes' ports, so they do not depend on other lanes' Wave 2 progress. Cross-lane behaviour is proven by the Wave 3 journeys handed to L10 below.

### Task 0: Prerequisites requested from the lead (shared files)

L8 cannot edit these files (master §4.8, §6). Send this exact request at the Wave 2 kickoff. Tasks 1–6 have no dependency on it; Tasks 7–16 compile only after LR-1 and LR-2 are merged.

- [ ] **LR-1 `services/api/src/kernel/ports.ts`** — add push-target lookups to `UsersPort` (implemented by L1, which owns every token-writing mutation: `pushToken`, `saveNotificationTokenWeb`, `saveRestaurantToken`, and the `notificationToken` argument of `login`/`restaurantLogin`/`riderLogin`), messaging credentials to `ConfigPort` (L2 SecretStore, reference/04 §C) and `available` to `NotifyPort`:

```ts
// services/api/src/kernel/ports.ts — additions requested by L8
export type PushAudience = "USER" | "RESTAURANT";
export type PushSegment = "CUSTOMER" | "RESTAURANT" | "RIDER";
// One row per recipient that has a stored token (Enatega stores a single notificationToken per
// user and per restaurant). USER ids are user ids (customers, riders); RESTAURANT ids are
// restaurant ids. For restaurants both flags equal `enableNotification`; for riders both are true.
export type PushTarget = {
  recipientId: string;
  token: string;
  orderNotification: boolean;
  offerNotification: boolean;
  locale: string | null;
};
export interface UsersPort {
  customer(id: string): Promise<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
  } | null>;
  pushTokens(userId: string): Promise<string[]>;
  pushTargets(
    audience: PushAudience,
    recipientIds: string[],
  ): Promise<PushTarget[]>;
  // Active recipients of the segment that have a token, ordered by recipientId ascending,
  // strictly after `afterRecipientId` (null = from the start), at most `limit` rows.
  segmentPushTargets(
    segment: PushSegment,
    afterRecipientId: string | null,
    limit: number,
  ): Promise<PushTarget[]>;
  // Removes a token a provider reported as invalid from every place it is stored; returns rows changed.
  clearPushToken(token: string): Promise<number>;
}

// Server-side only; never exposed through GraphQL.
export type MessagingConfig = {
  twilio: {
    enabled: boolean;
    accountSid: string | null;
    authToken: string | null;
    fromNumber: string | null;
  };
  sendGrid: {
    enabled: boolean;
    apiKey: string | null;
    fromEmail: string | null;
    fromName: string | null;
  };
};
export interface ConfigPort {
  currency(): Promise<Currency>;
  delivery(): Promise<{ costType: "fixed" | "perKm"; rateMinor: number }>;
  tipOptions(): Promise<{ enabled: boolean; percentages: number[] }>;
  verification(): Promise<{ skipEmail: boolean; skipMobile: boolean }>;
  messaging(): Promise<MessagingConfig>;
}

export interface NotifyPort {
  push(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void>;
  email(to: string, message: Message): Promise<void>;
  sms(to: string, text: string): Promise<void>;
  // L1 calls this before answering sendOtpToEmail/sendOtpToPhoneNumber so the app is never told
  // an OTP was sent when no provider exists (D13: no fake success).
  available(channel: "push" | "email" | "sms"): Promise<boolean>;
}
```

- [ ] **LR-2 `services/api/src/kernel/events.ts` and the outbox worker** — handlers receive the event id (W1-0.5 requires idempotency by event id, but `EventHandler` has no id), and two payloads gain the recipient data L8 cannot obtain through a port:

```ts
// services/api/src/kernel/events.ts — changed members only
  | { type: "withdraw.updated"; payload: { requestId: string; status: "REQUESTED" | "TRANSFERRED" | "CANCELLED"; account: { type: "RESTAURANT" | "RIDER"; id: string }; amountMinor: number } }
  | { type: "ticket.message"; payload: { ticketId: string; senderType: "USER" | "ADMIN"; userId: string; ticketTitle: string } };
export type EventMeta = { id: string; attempt: number };
export type EventHandler<T extends DomainEvent["type"]> = (event: Extract<DomainEvent, { type: T }>, meta: EventMeta) => Promise<void>;
```

The outbox worker (`services/worker/src/jobs/outbox.ts`) calls `handler(event, { id: row.id, attempt: row.attempts + 1 })` and exposes `registry.on(type, handler)`. L7 (`withdraw.updated`) and L4 (`ticket.message`) fill the new fields.

- [ ] **LR-3 `services/api/src/config.ts`** — accept the L8 keys and validate them at startup (D13: `readConfig` refuses the OutboxSender in production):

```ts
import { notifyConfigShape, readNotifyConfig } from "./modules/notifications/config.js";
// inside the existing z.object({ ... }):
    ...notifyConfigShape,
// in readConfig, right after parsing succeeded and before returning:
  readNotifyConfig(parsed.data);
```

and append to `services/api/.env.example`:

```dotenv
# Notifications (lane L8). Defaults: outbox in development/test, none in production.
# NOTIFY_PUSH_PROVIDER=native        # native = Expo push + FCM HTTP v1
# NOTIFY_EMAIL_PROVIDER=sendgrid
# NOTIFY_SMS_PROVIDER=twilio
# FCM_SERVICE_ACCOUNT_JSON=          # deployment secret; JSON or base64 JSON
# EXPO_ACCESS_TOKEN=                 # optional Expo enhanced push security token
NOTIFY_BROADCAST_INTERVAL_SECONDS=60
```

Without LR-3, `startApi(stack, { NOTIFY_PUSH_PROVIDER: "none" })` cannot reach the module (zod strips unknown keys); the one HTTP test that needs it (Task 12, "without a push provider") stays red until LR-3 lands.

- [ ] **LR-4 `services/api/src/app.ts`** — add `NotificationsModule.register(config)` (Task 12) to `imports` and drop the Wave 1 `NOT_IMPLEMENTED` provider for `NOTIFY_PORT` (the module is `global` and exports `NOTIFY_PORT`).
- [ ] **LR-5 packages and worker bootstrap** — `services/api/package.json` adds `"exports": { ".": "./dist/main.js", "./notifications-worker": "./dist/modules/notifications/worker.js" }`; `services/worker/package.json` adds `"@fairbite/api": "workspace:*"` and `"@nestjs/common": "12.1.2"`; the worker boots the API module graph headlessly (`NestFactory.createApplicationContext`) and calls `registerNotificationJobs(registry, app)` (Task 15) at startup and `close()` on shutdown.
- [ ] **LR-6 `e2e/playwright.config.ts`** — add a `webServer` entry running the worker (`pnpm --filter @fairbite/worker build && node services/worker/dist/main.js`) with the same `DATABASE_URL`/`REDIS_URL`, and set `NOTIFY_BROADCAST_INTERVAL_SECONDS: "0"` in the API env so the admin "Resend" button works in E2E.
- [ ] **LR-7** confirm `services/api/test/support/providers/**` is owned by L8.

### Task 1: Lane schema — SDL, Prisma, migration, row types, mappers, factories (W1-L.1–L.3)

**Files:**

- Create/replace: `contracts/enatega/L8-notifications.graphql` (exact text in "Contract notes")
- Create: `services/api/prisma/schema/L8-notifications.prisma` (exact text in "Data model")
- Create: `services/api/prisma/migrations/202610090180_L8_init/migration.sql` (exact text in "Data model")
- Create: `services/api/src/modules/notifications/types.ts`
- Create: `services/api/src/modules/notifications/mappers.ts`
- Modify: `services/api/test/support/factories.ts` (append the `// L8` section)
- Test: `services/api/test/unit/notifications/mappers.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/notifications/mappers.spec.ts
import { describe, expect, it } from "vitest";
import {
  toNotification,
  toWebNotification,
} from "../../../src/modules/notifications/mappers.js";

const at = new Date("2026-10-08T10:15:30.123Z");

describe("notification mappers", () => {
  it("maps a broadcast row with an ISO createdAt and keeps a null title", () => {
    expect(
      toNotification({
        id: "0199c3c4-0000-7000-8000-000000000001",
        title: null,
        body: "Free delivery",
        recipientType: "STORE",
        createdAt: at,
      }),
    ).toEqual({
      _id: "0199c3c4-0000-7000-8000-000000000001",
      title: null,
      body: "Free delivery",
      recipientType: "STORE",
      createdAt: "2026-10-08T10:15:30.123Z",
    });
  });
  it("maps a web notification with an epoch-millisecond createdAt the app bar parses with +value", () => {
    const mapped = toWebNotification({
      id: "w1",
      body: "New order PAS-1 received",
      navigateTo: "/management/orders",
      createdAt: at,
      read: false,
    });
    expect(mapped).toEqual({
      _id: "w1",
      body: "New order PAS-1 received",
      navigateTo: "/management/orders",
      read: false,
      createdAt: String(at.getTime()),
    });
    expect(Number.isNaN(+mapped.createdAt)).toBe(false);
  });
  it("preserves a null navigateTo and coerces read to a boolean", () => {
    expect(
      toWebNotification({
        id: "w2",
        body: "x",
        navigateTo: null,
        createdAt: at,
        read: null as unknown as boolean,
      }),
    ).toMatchObject({
      navigateTo: null,
      read: false,
    });
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/notifications/mappers.spec.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/notifications/mappers.js'`.

- [ ] **Step 3: Implement**

Write the SDL, Prisma file and migration exactly as given in "Contract notes" and "Data model". Then:

```ts
// services/api/src/modules/notifications/types.ts
export type Channel = "PUSH" | "EMAIL" | "SMS";
export type DeliveryStatus =
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED";
export type SourceType = "EVENT" | "BROADCAST" | "DIRECT";
export type Source = { type: SourceType; id: string };
export type RecipientType = "USER" | "RESTAURANT" | "EMAIL" | "PHONE";
export type BroadcastRecipientType = "CUSTOMER" | "STORE" | "RIDER";
export type BroadcastStatus = "QUEUED" | "SENDING" | "COMPLETED" | "FAILED";
export type PushPurpose = "ORDER" | "OFFER" | "ACCOUNT";
export type WebAudience = "ADMIN" | "VENDOR" | "RESTAURANT";

export type NotificationRow = {
  id: string;
  title: string | null;
  body: string;
  recipientType: BroadcastRecipientType;
  status: BroadcastStatus;
  createdById: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  expandCursor: string | null;
  createdAt: Date;
  expandedAt: Date | null;
  completedAt: Date | null;
};

export type DeliveryRow = {
  id: string;
  sourceType: SourceType;
  sourceId: string;
  channel: Channel;
  recipientType: RecipientType;
  recipientId: string;
  address: string;
  provider: string | null;
  template: string;
  locale: string;
  title: string | null;
  body: string;
  data: Record<string, string>;
  sensitive: boolean;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  expiresAt: Date;
  lastError: string | null;
  providerMessageId: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

export type NewDelivery = {
  sourceType: SourceType;
  sourceId: string;
  channel: Channel;
  recipientType: RecipientType;
  recipientId: string;
  address: string;
  template: string;
  locale: string;
  title: string | null;
  body: string;
  data: Record<string, string>;
  sensitive: boolean;
  expiresAt: Date;
  status?: "QUEUED" | "SKIPPED";
  lastError?: string | null;
};

export type WebRow = {
  id: string;
  body: string;
  navigateTo: string | null;
  createdAt: Date;
  read: boolean;
};
export type NewWebNotification = {
  audience: WebAudience;
  scopeId: string;
  permission: string | null;
  body: string;
  navigateTo: string | null;
  sourceId: string;
};
export type WebScope = {
  pairs: [WebAudience, string][];
  permissions: string[] | null;
};
```

```ts
// services/api/src/modules/notifications/mappers.ts
import { epochMillisString, isoString } from "../../kernel/time.js";
import type { NotificationRow, WebRow } from "./types.js";

// Notification.createdAt is ISO-8601 (master §4.5); both admin tables accept it.
export function toNotification(
  row: Pick<
    NotificationRow,
    "id" | "title" | "body" | "recipientType" | "createdAt"
  >,
) {
  return {
    _id: row.id,
    title: row.title,
    body: row.body,
    recipientType: row.recipientType,
    createdAt: isoString(row.createdAt) as string,
  };
}

// WebNotification.createdAt is epoch milliseconds: the app bar renders timeAgo(+createdAt).
export function toWebNotification(row: WebRow) {
  return {
    _id: row.id,
    body: row.body,
    navigateTo: row.navigateTo,
    read: row.read === true,
    createdAt: epochMillisString(row.createdAt) as string,
  };
}
```

Append inside the object returned by `factories(pool)` in `services/api/test/support/factories.ts` (`newId` is already imported there by W1-0.7):

```ts
    // L8
    async notification(
      overrides: { createdById: string } & Partial<{
        id: string;
        title: string | null;
        body: string;
        recipientType: "CUSTOMER" | "STORE" | "RIDER";
        status: "QUEUED" | "SENDING" | "COMPLETED" | "FAILED";
        createdAt: Date;
      }>,
    ) {
      const row = {
        id: newId(),
        title: "Weekend offer" as string | null,
        body: "Free delivery all weekend",
        recipientType: "CUSTOMER" as "CUSTOMER" | "STORE" | "RIDER",
        status: "COMPLETED" as "QUEUED" | "SENDING" | "COMPLETED" | "FAILED",
        createdAt: new Date(),
        ...overrides,
      };
      await pool.query(
        'INSERT INTO "Notification"(id, title, body, "recipientType", status, "createdById", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [row.id, row.title, row.body, row.recipientType, row.status, row.createdById, row.createdAt],
      );
      return row;
    },
    async webNotification(
      overrides: Partial<{
        id: string;
        audience: "ADMIN" | "VENDOR" | "RESTAURANT";
        scopeId: string;
        permission: string | null;
        body: string;
        navigateTo: string | null;
        sourceId: string;
        createdAt: Date;
      }> = {},
    ) {
      const row = {
        id: newId(),
        audience: "ADMIN" as "ADMIN" | "VENDOR" | "RESTAURANT",
        scopeId: "",
        permission: null as string | null,
        body: "New order PAS-1001 received",
        navigateTo: "/management/orders" as string | null,
        sourceId: newId(),
        createdAt: new Date(),
        ...overrides,
      };
      await pool.query(
        'INSERT INTO "WebNotification"(id, audience, "scopeId", permission, body, "navigateTo", "sourceId", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [row.id, row.audience, row.scopeId, row.permission, row.body, row.navigateTo, row.sourceId, row.createdAt],
      );
      return row;
    },
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/notifications/mappers.spec.ts && pnpm --filter @fairbite/api exec prisma validate && pnpm check:enatega`
Expected: PASS (3 tests); `The schemas at prisma/schema are valid`; `staticCompatibility: PASS` (admin `GET_NOTIFICATIONS`, `GET_NOTIFICATIONS_PAGINATED`, `GET_WEB_NOTIFICATIONS`, `SEND_NOTIFICATION_USER`, `MARK_WEB_NOTIFICATIONS_AS_READ`, and the single-vendor `SEND_NOTIFICATION_USER` with `$recipientType: NotificationRecipientType` and `GET_NOTIFICATIONS` with `recipientType`, all validate). Then `pnpm stack:up && pnpm --filter @fairbite/api db:migrate && pnpm --filter @fairbite/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code` reports no drift for the four L8 tables, and `pnpm --filter @fairbite/api test:integration -- contract/all-operations` stays green.

- [ ] **Step 5: Commit**

```bash
git add contracts/enatega/L8-notifications.graphql services/api/prisma/schema/L8-notifications.prisma services/api/prisma/migrations/202610090180_L8_init services/api/src/modules/notifications/types.ts services/api/src/modules/notifications/mappers.ts services/api/test/support/factories.ts services/api/test/unit/notifications/mappers.spec.ts
git commit -m "feat(L8): add notification contract, tables, mappers and factories"
```

### Task 2: Notification configuration (D13)

**Files:**

- Create: `services/api/src/modules/notifications/config.ts`
- Test: `services/api/test/unit/notifications/config.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// services/api/test/unit/notifications/config.spec.ts
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readNotifyConfig } from "../../../src/modules/notifications/config.js";

function serviceAccountJson() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    project_id: "fairbite-test",
    client_email: "push@fairbite-test.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
}

describe("notification configuration", () => {
  it("uses the DevOutbox for every channel in test and development", () => {
    for (const APP_ENV of ["test", "development"]) {
      const config = readNotifyConfig({ APP_ENV });
      expect([config.push, config.email, config.sms]).toEqual([
        "outbox",
        "outbox",
        "outbox",
      ]);
    }
  });
  it("defaults to no provider in production and refuses the DevOutbox there", () => {
    const config = readNotifyConfig({ APP_ENV: "production" });
    expect([config.push, config.email, config.sms]).toEqual([
      "none",
      "none",
      "none",
    ]);
    expect(() =>
      readNotifyConfig({
        APP_ENV: "production",
        NOTIFY_EMAIL_PROVIDER: "outbox",
      }),
    ).toThrow(
      /NOTIFY_EMAIL_PROVIDER: OutboxSender is not allowed in production/,
    );
  });
  it("requires https provider endpoints in production but allows loopback fakes in test", () => {
    expect(() =>
      readNotifyConfig({
        APP_ENV: "production",
        TWILIO_API_BASE_URL: "http://127.0.0.1:9999",
      }),
    ).toThrow(/TWILIO_API_BASE_URL: https required/);
    expect(
      readNotifyConfig({
        APP_ENV: "test",
        TWILIO_API_BASE_URL: "http://127.0.0.1:9999/",
      }).twilio.baseUrl,
    ).toBe("http://127.0.0.1:9999");
  });
  it("parses an FCM service account given as JSON or base64 and never echoes its contents", () => {
    const json = serviceAccountJson();
    expect(
      readNotifyConfig({ APP_ENV: "test", FCM_SERVICE_ACCOUNT_JSON: json }).fcm
        .serviceAccount?.projectId,
    ).toBe("fairbite-test");
    expect(
      readNotifyConfig({
        APP_ENV: "test",
        FCM_SERVICE_ACCOUNT_JSON: Buffer.from(json).toString("base64"),
      }).fcm.serviceAccount?.clientEmail,
    ).toBe("push@fairbite-test.iam.gserviceaccount.com");
    let message = "";
    try {
      readNotifyConfig({
        APP_ENV: "test",
        FCM_SERVICE_ACCOUNT_JSON: '{"private_key":"secret-value"}',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(
      /FCM_SERVICE_ACCOUNT_JSON: invalid service account/,
    );
    expect(message).not.toContain("secret-value");
  });
  it("applies defaults and rejects out-of-range or unknown values by key name", () => {
    expect(readNotifyConfig({ APP_ENV: "test" })).toMatchObject({
      maxAttempts: 6,
      batchSize: 50,
      ratePerSecond: 20,
      broadcastIntervalSeconds: 60,
      httpTimeoutMs: 5000,
      expo: { baseUrl: "https://exp.host", accessToken: null },
      fcm: {
        apiBaseUrl: "https://fcm.googleapis.com",
        tokenUrl: "https://oauth2.googleapis.com/token",
        serviceAccount: null,
      },
      twilio: { baseUrl: "https://api.twilio.com" },
      sendGrid: { baseUrl: "https://api.sendgrid.com" },
    });
    expect(() =>
      readNotifyConfig({ APP_ENV: "test", NOTIFY_MAX_ATTEMPTS: "0" }),
    ).toThrow(/NOTIFY_MAX_ATTEMPTS/);
    expect(() =>
      readNotifyConfig({ APP_ENV: "test", NOTIFY_EMAIL_PROVIDER: "smtp" }),
    ).toThrow(/NOTIFY_EMAIL_PROVIDER/);
  });
  it("accepts already-parsed values from readConfig", () => {
    expect(
      readNotifyConfig({
        APP_ENV: "test",
        NOTIFY_BATCH_SIZE: 10,
        NOTIFY_BROADCAST_INTERVAL_SECONDS: 0,
      }),
    ).toMatchObject({
      batchSize: 10,
      broadcastIntervalSeconds: 0,
    });
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/notifications/config.spec.ts`
Expected: FAIL — module `config.js` not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/notifications/config.ts
import { z } from "zod";

// Keys merged into services/api/src/config.ts by the lead (LR-3).
export const notifyConfigShape = {
  NOTIFY_PUSH_PROVIDER: z.enum(["native", "outbox", "none"]).optional(),
  NOTIFY_EMAIL_PROVIDER: z.enum(["sendgrid", "outbox", "none"]).optional(),
  NOTIFY_SMS_PROVIDER: z.enum(["twilio", "outbox", "none"]).optional(),
  EXPO_PUSH_BASE_URL: z.url().default("https://exp.host"),
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  FCM_API_BASE_URL: z.url().default("https://fcm.googleapis.com"),
  FCM_TOKEN_URL: z.url().default("https://oauth2.googleapis.com/token"),
  FCM_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  TWILIO_API_BASE_URL: z.url().default("https://api.twilio.com"),
  SENDGRID_API_BASE_URL: z.url().default("https://api.sendgrid.com"),
  NOTIFY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  NOTIFY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  NOTIFY_PROVIDER_RATE_PER_SECOND: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(20),
  NOTIFY_BROADCAST_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(86400)
    .default(60),
  NOTIFY_HTTP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30000)
    .default(5000),
};

const URL_KEYS = [
  "EXPO_PUSH_BASE_URL",
  "FCM_API_BASE_URL",
  "FCM_TOKEN_URL",
  "TWILIO_API_BASE_URL",
  "SENDGRID_API_BASE_URL",
] as const;

export type AppEnv = "development" | "test" | "production";
export type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};
export type NotifyConfig = {
  appEnv: AppEnv;
  push: "native" | "outbox" | "none";
  email: "sendgrid" | "outbox" | "none";
  sms: "twilio" | "outbox" | "none";
  expo: { baseUrl: string; accessToken: string | null };
  fcm: {
    apiBaseUrl: string;
    tokenUrl: string;
    serviceAccount: ServiceAccount | null;
  };
  twilio: { baseUrl: string };
  sendGrid: { baseUrl: string };
  maxAttempts: number;
  batchSize: number;
  ratePerSecond: number;
  broadcastIntervalSeconds: number;
  httpTimeoutMs: number;
};

function parseServiceAccount(value: string): ServiceAccount | null {
  const attempt = (text: string) => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const json =
    attempt(value) ?? attempt(Buffer.from(value, "base64").toString("utf8"));
  if (!json || typeof json !== "object") return null;
  const { project_id, client_email, private_key } = json;
  if (
    typeof project_id !== "string" ||
    typeof client_email !== "string" ||
    typeof private_key !== "string"
  )
    return null;
  if (!private_key.includes("BEGIN PRIVATE KEY")) return null;
  return {
    projectId: project_id,
    clientEmail: client_email,
    privateKey: private_key,
  };
}

// Accepts process.env-style strings or the already-parsed object from readConfig.
// Error messages name keys only, never values (secrets).
export function readNotifyConfig(
  source: Record<string, unknown>,
): NotifyConfig {
  const appEnv = z
    .enum(["development", "test", "production"])
    .default("development")
    .parse(source.APP_ENV);
  const parsed = z.object(notifyConfigShape).safeParse(source);
  if (!parsed.success)
    throw new Error(
      `Invalid notification configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const value = parsed.data;
  const fallback = appEnv === "production" ? "none" : "outbox";
  const push = value.NOTIFY_PUSH_PROVIDER ?? fallback;
  const email = value.NOTIFY_EMAIL_PROVIDER ?? fallback;
  const sms = value.NOTIFY_SMS_PROVIDER ?? fallback;
  const problems: string[] = [];
  if (appEnv === "production") {
    const providers: [string, string][] = [
      ["NOTIFY_PUSH_PROVIDER", push],
      ["NOTIFY_EMAIL_PROVIDER", email],
      ["NOTIFY_SMS_PROVIDER", sms],
    ];
    for (const [key, provider] of providers)
      if (provider === "outbox")
        problems.push(`${key}: OutboxSender is not allowed in production`);
    for (const key of URL_KEYS)
      if (new URL(value[key]).protocol !== "https:")
        problems.push(`${key}: https required`);
  }
  let serviceAccount: ServiceAccount | null = null;
  if (value.FCM_SERVICE_ACCOUNT_JSON) {
    serviceAccount = parseServiceAccount(value.FCM_SERVICE_ACCOUNT_JSON);
    if (!serviceAccount)
      problems.push("FCM_SERVICE_ACCOUNT_JSON: invalid service account");
  }
  if (problems.length)
    throw new Error(
      `Invalid notification configuration: ${problems.join("; ")}`,
    );
  const trim = (url: string) => url.replace(/\/+$/, "");
  return {
    appEnv,
    push,
    email,
    sms,
    expo: {
      baseUrl: trim(value.EXPO_PUSH_BASE_URL),
      accessToken: value.EXPO_ACCESS_TOKEN ?? null,
    },
    fcm: {
      apiBaseUrl: trim(value.FCM_API_BASE_URL),
      tokenUrl: value.FCM_TOKEN_URL,
      serviceAccount,
    },
    twilio: { baseUrl: trim(value.TWILIO_API_BASE_URL) },
    sendGrid: { baseUrl: trim(value.SENDGRID_API_BASE_URL) },
    maxAttempts: value.NOTIFY_MAX_ATTEMPTS,
    batchSize: value.NOTIFY_BATCH_SIZE,
    ratePerSecond: value.NOTIFY_PROVIDER_RATE_PER_SECOND,
    broadcastIntervalSeconds: value.NOTIFY_BROADCAST_INTERVAL_SECONDS,
    httpTimeoutMs: value.NOTIFY_HTTP_TIMEOUT_MS,
  };
}
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/notifications/config.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/notifications/config.ts services/api/test/unit/notifications/config.spec.ts
git commit -m "feat(L8): validate notification provider configuration and refuse the DevOutbox in production"
```

### Task 3: Templates, token classification, amount formatting, rate limiter

**Files:**

- Create: `services/api/src/modules/notifications/templates.ts`
- Create: `services/api/src/modules/notifications/tokens.ts`
- Create: `services/api/src/modules/notifications/format.ts`
- Create: `services/api/src/modules/notifications/limiter.ts`
- Test: `services/api/test/unit/notifications/templates.spec.ts`, `services/api/test/unit/notifications/tokens.spec.ts`, `services/api/test/unit/notifications/limiter.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// services/api/test/unit/notifications/templates.spec.ts
import { describe, expect, it } from "vitest";
import { brand } from "@fairbite/brand";
import {
  TEMPLATES,
  isTemplateId,
  renderTemplate,
  type TemplateId,
} from "../../../src/modules/notifications/templates.js";

const vars = {
  code: "482913",
  orderId: "PAS-1001",
  restaurant: "Pasta Place",
  amount: "$12.50",
  ticket: "Late order",
  title: "Weekend",
  body: "Free delivery",
};

describe("notification templates", () => {
  it("renders every template in English without leftover placeholders", () => {
    for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
      const rendered = renderTemplate(id, "en", vars);
      expect(rendered.locale).toBe("en");
      expect(rendered.body).not.toMatch(/\{\w+\}/);
      if (rendered.title) expect(rendered.title).not.toMatch(/\{\w+\}/);
    }
  });
  it("uses the exact OTP texts with the central brand name, marked sensitive and short-lived", () => {
    expect(
      renderTemplate("otp.email.signup", null, { code: "482913" }),
    ).toEqual({
      locale: "en",
      channel: "EMAIL",
      title: `Your ${brand.name} verification code`,
      body: `Your ${brand.name} verification code is 482913. Do not share this code with anyone.`,
      sensitive: true,
      ttlSeconds: 600,
    });
    expect(
      renderTemplate("otp.email.login", null, { code: "1" }),
    ).toMatchObject({
      title: `Your ${brand.name} sign-in code`,
      body: `Your ${brand.name} sign-in code is 1. Do not share this code with anyone.`,
    });
    expect(
      renderTemplate("otp.email.reset", null, { code: "1" }),
    ).toMatchObject({
      title: `Reset your ${brand.name} password`,
      body: `Your ${brand.name} password reset code is 1. If you did not ask to reset your password, ignore this email.`,
    });
    expect(renderTemplate("otp.sms.signup", null, { code: "77" }).body).toBe(
      `Your ${brand.name} verification code is 77.`,
    );
    expect(renderTemplate("otp.sms.login", null, { code: "77" })).toMatchObject(
      {
        channel: "SMS",
        title: null,
        body: `Your ${brand.name} sign-in code is 77.`,
      },
    );
    expect(renderTemplate("otp.sms.reset", null, { code: "77" }).body).toBe(
      `Your ${brand.name} password reset code is 77.`,
    );
  });
  it("uses the exact order, withdrawal, ticket and web texts", () => {
    expect(renderTemplate("order.placed.restaurant", "en", vars)).toMatchObject(
      {
        title: "New order",
        body: "You have a new order PAS-1001.",
        ttlSeconds: 7200,
      },
    );
    expect(renderTemplate("order.accepted.customer", "en", vars)).toMatchObject(
      {
        title: "Order accepted",
        body: "Pasta Place accepted your order PAS-1001.",
      },
    );
    expect(
      renderTemplate("order.accepted.customer.pickup", "en", vars).body,
    ).toBe("Pasta Place accepted your pickup order PAS-1001.");
    expect(renderTemplate("order.accepted.rider", "en", vars)).toMatchObject({
      title: "New order available",
      body: "Order PAS-1001 from Pasta Place is waiting for a rider.",
    });
    expect(renderTemplate("order.assigned.customer", "en", vars)).toMatchObject(
      {
        title: "Rider assigned",
        body: "A rider is on the way to collect your order PAS-1001.",
      },
    );
    expect(
      renderTemplate("order.assigned.restaurant", "en", vars),
    ).toMatchObject({
      title: "Rider assigned",
      body: "A rider has been assigned to order PAS-1001.",
    });
    expect(renderTemplate("order.assigned.rider", "en", vars)).toMatchObject({
      title: "New order assigned",
      body: "Order PAS-1001 from Pasta Place has been assigned to you.",
    });
    expect(renderTemplate("order.picked.customer", "en", vars)).toMatchObject({
      title: "Order on the way",
      body: "Your order PAS-1001 has been picked up and is on its way.",
    });
    expect(
      renderTemplate("order.delivered.customer", "en", vars),
    ).toMatchObject({
      title: "Order delivered",
      body: "Your order PAS-1001 has been delivered. Enjoy your meal!",
    });
    expect(
      renderTemplate("order.delivered.customer.pickup", "en", vars),
    ).toMatchObject({
      title: "Order collected",
      body: "Your order PAS-1001 has been collected. Enjoy your meal!",
    });
    expect(
      renderTemplate("order.cancelled.customer", "en", vars),
    ).toMatchObject({
      title: "Order cancelled",
      body: "Your order PAS-1001 was cancelled.",
    });
    expect(renderTemplate("order.cancelled.restaurant", "en", vars).body).toBe(
      "Order PAS-1001 was cancelled.",
    );
    expect(renderTemplate("order.cancelled.rider", "en", vars).body).toBe(
      "Order PAS-1001 was cancelled.",
    );
    expect(renderTemplate("order.paid.customer", "en", vars)).toMatchObject({
      title: "Payment received",
      body: "We received your payment of $12.50 for order PAS-1001.",
    });
    expect(renderTemplate("withdraw.transferred", "en", vars)).toMatchObject({
      title: "Withdrawal transferred",
      body: "Your withdrawal request of $12.50 has been transferred.",
    });
    expect(renderTemplate("withdraw.cancelled", "en", vars)).toMatchObject({
      title: "Withdrawal cancelled",
      body: "Your withdrawal request of $12.50 was cancelled.",
    });
    expect(renderTemplate("ticket.reply.customer", "en", vars)).toMatchObject({
      title: "New reply from support",
      body: 'You have a new reply on your support ticket "Late order".',
    });
    expect(renderTemplate("web.order.placed", null, vars)).toMatchObject({
      channel: "WEB",
      title: null,
      body: "New order PAS-1001 received",
    });
    expect(renderTemplate("web.withdraw.requested", null, vars).body).toBe(
      "New withdrawal request of $12.50",
    );
    expect(renderTemplate("web.ticket.message", null, vars).body).toBe(
      'New message on support ticket "Late order"',
    );
  });
  it("falls back from regional, malformed or unknown locales to English", () => {
    expect(renderTemplate("order.picked.customer", "fr-FR", vars).locale).toBe(
      "en",
    );
    expect(renderTemplate("order.picked.customer", "EN_us", vars).locale).toBe(
      "en",
    );
    expect(renderTemplate("order.picked.customer", "", vars).locale).toBe("en");
    expect(
      renderTemplate("order.picked.customer", undefined, vars).locale,
    ).toBe("en");
  });
  it("throws on a missing variable instead of sending a half-filled message", () => {
    expect(() => renderTemplate("order.picked.customer", "en", {})).toThrow(
      "Missing template variable orderId for order.picked.customer",
    );
  });
  it("substitutes once so admin text containing braces is sent literally, and an empty title becomes no title", () => {
    expect(
      renderTemplate("broadcast", "en", {
        title: "{code}",
        body: "Use {orderId}",
      }),
    ).toMatchObject({ title: "{code}", body: "Use {orderId}" });
    expect(
      renderTemplate("broadcast", "en", { title: "", body: "Hello" }).title,
    ).toBeNull();
  });
  it("recognises only real template ids", () => {
    expect(isTemplateId("otp.email.signup")).toBe(true);
    expect(isTemplateId("toString")).toBe(false);
  });
});
```

```ts
// services/api/test/unit/notifications/tokens.spec.ts
import { describe, expect, it } from "vitest";
import {
  E164,
  EMAIL,
  classifyToken,
} from "../../../src/modules/notifications/tokens.js";
import { formatAmount } from "../../../src/modules/notifications/format.js";

describe("push token classification", () => {
  it("recognises Expo tokens with both prefixes", () => {
    expect(classifyToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(
      "EXPO",
    );
    expect(classifyToken("ExpoPushToken[yyyyyyyyyyyyyyyyyyyy]")).toBe("EXPO");
  });
  it("recognises FCM registration tokens", () => {
    expect(classifyToken(`d1Xn2AbC:APA91b${"x".repeat(140)}`)).toBe("FCM");
  });
  it("rejects empty, short, spaced, malformed or non-string tokens", () => {
    for (const value of [
      "",
      "short",
      `has spaces ${"x".repeat(40)}`,
      null,
      undefined,
      "ExponentPushToken[]",
    ])
      expect(classifyToken(value as string)).toBeNull();
  });
});

describe("address formats", () => {
  it("validates emails and E.164 phone numbers", () => {
    expect(EMAIL.test("ada@example.com")).toBe(true);
    expect(EMAIL.test("ada@example")).toBe(false);
    expect(E164.test("+447700900123")).toBe(true);
    expect(E164.test("07700900123")).toBe(false);
  });
});

describe("amount formatting", () => {
  it("formats integer minor units with the currency symbol and exponent", () => {
    expect(formatAmount(1250, { code: "USD", symbol: "$", exponent: 2 })).toBe(
      "$12.50",
    );
    expect(formatAmount(1500, { code: "JPY", symbol: "¥", exponent: 0 })).toBe(
      "¥1500",
    );
    expect(formatAmount(1234, { code: "KWD", symbol: "KD", exponent: 3 })).toBe(
      "KD1.234",
    );
  });
});
```

```ts
// services/api/test/unit/notifications/limiter.spec.ts
import { describe, expect, it } from "vitest";
import {
  RateLimiter,
  backoffSeconds,
} from "../../../src/modules/notifications/limiter.js";

describe("provider rate limiter", () => {
  it("spaces calls per provider at the configured rate and keeps providers independent", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(
      10,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    await limiter.take("EXPO");
    await limiter.take("EXPO");
    await limiter.take("TWILIO");
    await limiter.take("EXPO");
    expect(waits).toEqual([100, 100]);
  });
});

describe("retry backoff", () => {
  it("doubles from 30 seconds and caps at one hour", () => {
    expect([1, 2, 3, 4, 8, 20].map(backoffSeconds)).toEqual([
      30, 60, 120, 240, 3600, 3600,
    ]);
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/notifications/templates.spec.ts test/unit/notifications/tokens.spec.ts test/unit/notifications/limiter.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/notifications/templates.ts
import { brand } from "@fairbite/brand";
import type { Channel } from "./types.js";

export type TemplateChannel = Channel | "WEB";
type Text = { title: string | null; body: string };
export type TemplateDefinition = {
  channel: TemplateChannel;
  sensitive: boolean;
  ttlSeconds: number;
  // Locale → texts. "en" is mandatory and is the fallback for every other locale.
  text: { en: Text } & Record<string, Text>;
};

const HOUR = 3600;
const DAY = 86400;
const push = (
  title: string,
  body: string,
  ttlSeconds = HOUR,
): TemplateDefinition => ({
  channel: "PUSH",
  sensitive: false,
  ttlSeconds,
  text: { en: { title, body } },
});
const otpEmail = (title: string, body: string): TemplateDefinition => ({
  channel: "EMAIL",
  sensitive: true,
  ttlSeconds: 600,
  text: { en: { title, body } },
});
const otpSms = (body: string): TemplateDefinition => ({
  channel: "SMS",
  sensitive: true,
  ttlSeconds: 600,
  text: { en: { title: null, body } },
});
const web = (body: string): TemplateDefinition => ({
  channel: "WEB",
  sensitive: false,
  ttlSeconds: DAY,
  text: { en: { title: null, body } },
});

export const TEMPLATES = {
  "otp.email.signup": otpEmail(
    `Your ${brand.name} verification code`,
    `Your ${brand.name} verification code is {code}. Do not share this code with anyone.`,
  ),
  "otp.email.login": otpEmail(
    `Your ${brand.name} sign-in code`,
    `Your ${brand.name} sign-in code is {code}. Do not share this code with anyone.`,
  ),
  "otp.email.reset": otpEmail(
    `Reset your ${brand.name} password`,
    `Your ${brand.name} password reset code is {code}. If you did not ask to reset your password, ignore this email.`,
  ),
  "otp.sms.signup": otpSms(`Your ${brand.name} verification code is {code}.`),
  "otp.sms.login": otpSms(`Your ${brand.name} sign-in code is {code}.`),
  "otp.sms.reset": otpSms(`Your ${brand.name} password reset code is {code}.`),
  "order.placed.restaurant": push(
    "New order",
    "You have a new order {orderId}.",
    2 * HOUR,
  ),
  "order.accepted.customer": push(
    "Order accepted",
    "{restaurant} accepted your order {orderId}.",
  ),
  "order.accepted.customer.pickup": push(
    "Order accepted",
    "{restaurant} accepted your pickup order {orderId}.",
  ),
  "order.accepted.rider": push(
    "New order available",
    "Order {orderId} from {restaurant} is waiting for a rider.",
  ),
  "order.assigned.customer": push(
    "Rider assigned",
    "A rider is on the way to collect your order {orderId}.",
  ),
  "order.assigned.restaurant": push(
    "Rider assigned",
    "A rider has been assigned to order {orderId}.",
  ),
  "order.assigned.rider": push(
    "New order assigned",
    "Order {orderId} from {restaurant} has been assigned to you.",
  ),
  "order.picked.customer": push(
    "Order on the way",
    "Your order {orderId} has been picked up and is on its way.",
  ),
  "order.delivered.customer": push(
    "Order delivered",
    "Your order {orderId} has been delivered. Enjoy your meal!",
    DAY,
  ),
  "order.delivered.customer.pickup": push(
    "Order collected",
    "Your order {orderId} has been collected. Enjoy your meal!",
    DAY,
  ),
  "order.cancelled.customer": push(
    "Order cancelled",
    "Your order {orderId} was cancelled.",
    DAY,
  ),
  "order.cancelled.restaurant": push(
    "Order cancelled",
    "Order {orderId} was cancelled.",
    DAY,
  ),
  "order.cancelled.rider": push(
    "Order cancelled",
    "Order {orderId} was cancelled.",
    DAY,
  ),
  "order.paid.customer": push(
    "Payment received",
    "We received your payment of {amount} for order {orderId}.",
    DAY,
  ),
  "withdraw.transferred": push(
    "Withdrawal transferred",
    "Your withdrawal request of {amount} has been transferred.",
    DAY,
  ),
  "withdraw.cancelled": push(
    "Withdrawal cancelled",
    "Your withdrawal request of {amount} was cancelled.",
    DAY,
  ),
  "ticket.reply.customer": push(
    "New reply from support",
    'You have a new reply on your support ticket "{ticket}".',
    DAY,
  ),
  broadcast: push("{title}", "{body}", DAY),
  "direct.push": push("{title}", "{body}", DAY),
  "direct.sms": {
    channel: "SMS",
    sensitive: false,
    ttlSeconds: DAY,
    text: { en: { title: null, body: "{body}" } },
  },
  "web.order.placed": web("New order {orderId} received"),
  "web.withdraw.requested": web("New withdrawal request of {amount}"),
  "web.ticket.message": web('New message on support ticket "{ticket}"'),
} satisfies Record<string, TemplateDefinition>;

export type TemplateId = keyof typeof TEMPLATES;
export type Rendered = {
  locale: string;
  channel: TemplateChannel;
  title: string | null;
  body: string;
  sensitive: boolean;
  ttlSeconds: number;
};

export function isTemplateId(value: string): value is TemplateId {
  return Object.hasOwn(TEMPLATES, value);
}

export function templateChannel(id: TemplateId): TemplateChannel {
  return (TEMPLATES[id] as TemplateDefinition).channel;
}

export function resolveLocale(
  definition: TemplateDefinition,
  requested: string | null | undefined,
): string {
  const wanted = (requested ?? "").trim().toLowerCase().replace("_", "-");
  if (wanted && Object.hasOwn(definition.text, wanted)) return wanted;
  const language = wanted.split("-")[0];
  if (language && Object.hasOwn(definition.text, language)) return language;
  return "en";
}

export function renderTemplate(
  id: TemplateId,
  locale: string | null | undefined,
  vars: Record<string, string | number>,
): Rendered {
  const definition: TemplateDefinition = TEMPLATES[id];
  const chosen = resolveLocale(definition, locale);
  const text = definition.text[chosen];
  // Single pass: substituted values are never re-scanned, so user text with braces stays literal.
  const fill = (value: string) =>
    value.replace(/\{(\w+)\}/g, (_match, name: string) => {
      if (!Object.hasOwn(vars, name))
        throw new Error(`Missing template variable ${name} for ${id}`);
      return String(vars[name]);
    });
  const title = text.title === null ? null : fill(text.title);
  return {
    locale: chosen,
    channel: definition.channel,
    title: title ? title : null,
    body: fill(text.body),
    sensitive: definition.sensitive,
    ttlSeconds: definition.ttlSeconds,
  };
}
```

```ts
// services/api/src/modules/notifications/tokens.ts
export type PushKind = "EXPO" | "FCM";
// Expo push tokens from getExpoPushTokenAsync (customer, store and rider apps).
const EXPO = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
// FCM registration tokens (customer web saveNotificationTokenWeb, native FCM).
const FCM = /^[A-Za-z0-9_:-]{32,512}$/;

export function classifyToken(
  token: string | null | undefined,
): PushKind | null {
  if (typeof token !== "string") return null;
  const value = token.trim();
  if (EXPO.test(value)) return "EXPO";
  if (FCM.test(value)) return "FCM";
  return null;
}

export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/;
export const E164 = /^\+[1-9]\d{6,14}$/;
```

```ts
// services/api/src/modules/notifications/format.ts
import { toMajor } from "../../kernel/money.js";
import type { Currency } from "../../kernel/ports.js";

export function formatAmount(minor: number, currency: Currency): string {
  return `${currency.symbol}${toMajor(minor, currency.exponent).toFixed(currency.exponent)}`;
}
```

```ts
// services/api/src/modules/notifications/limiter.ts
// Spaces provider calls per key. Uses a monotonic clock, not the business Clock, because it
// throttles real wall time inside one worker process.
export class RateLimiter {
  private readonly next = new Map<string, number>();
  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = () => performance.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  async take(key: string): Promise<void> {
    const interval = 1000 / this.perSecond;
    const now = this.now();
    const slot = Math.max(now, this.next.get(key) ?? 0);
    this.next.set(key, slot + interval);
    if (slot > now) await this.sleep(slot - now);
  }
}

export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 3600);
}
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @fairbite/api exec vitest run test/unit/notifications/templates.spec.ts test/unit/notifications/tokens.spec.ts test/unit/notifications/limiter.spec.ts`
Expected: PASS (7 + 5 + 2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/notifications/templates.ts services/api/src/modules/notifications/tokens.ts services/api/src/modules/notifications/format.ts services/api/src/modules/notifications/limiter.ts services/api/test/unit/notifications/templates.spec.ts services/api/test/unit/notifications/tokens.spec.ts services/api/test/unit/notifications/limiter.spec.ts
git commit -m "feat(L8): add message templates with English fallback, token checks and provider rate limiting"
```

### Task 4: Provider contract fakes, HTTP helper and the Expo push adapter

**Files:**

- Create: `services/api/src/modules/notifications/providers/types.ts`
- Create: `services/api/src/modules/notifications/providers/http.ts`
- Create: `services/api/src/modules/notifications/providers/expo.ts`
- Create: `services/api/test/support/providers/http.ts`
- Create: `services/api/test/support/providers/expo.ts`
- Test: `services/api/test/integration/notifications/providers/expo.integration.spec.ts`

The fakes emulate the documented request/response contracts (Expo `POST /--/api/v2/push/send` with an array body returning `{ data: [ticket] }`, `POST /--/api/v2/push/getReceipts`; error tickets carry `details.error`). They are test code only; product code reaches them solely through the configurable base URL.

- [ ] **Step 1: Write the fakes and the failing test**

```ts
// services/api/test/support/providers/http.ts
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};
export type FakeReply = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};
export type FakeHandler = (
  request: RecordedRequest,
) => FakeReply | Promise<FakeReply>;

// Loopback HTTP server that records every request; the provider fakes build on it.
export async function startFakeHttp(handler: FakeHandler) {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);
      Promise.resolve()
        .then(() => handler(recorded))
        .catch(
          () =>
            ({
              status: 500,
              body: { error: "fake handler failed" },
            }) as FakeReply,
        )
        .then((reply) => {
          res.writeHead(reply.status, {
            "content-type": "application/json",
            ...(reply.headers ?? {}),
          });
          res.end(
            reply.body === undefined
              ? ""
              : typeof reply.body === "string"
                ? reply.body
                : JSON.stringify(reply.body),
          );
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
```

```ts
// services/api/test/support/providers/expo.ts
import { startFakeHttp } from "./http.js";

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

// Contract fake of the Expo push service (https://exp.host/--/api/v2/push/*).
export async function startFakeExpo(options: { accessToken?: string } = {}) {
  const unregistered = new Set<string>();
  const rateLimited = new Set<string>();
  const receiptErrors = new Map<string, string>();
  const tickets = new Map<string, string>();
  let failNext: number | null = null;
  let counter = 0;
  const http = await startFakeHttp((request) => {
    if (
      options.accessToken &&
      request.headers.authorization !== `Bearer ${options.accessToken}`
    )
      return {
        status: 401,
        body: {
          errors: [{ code: "UNAUTHORIZED", message: "Invalid access token" }],
        },
      };
    if (request.method === "POST" && request.path === "/--/api/v2/push/send") {
      if (failNext !== null) {
        const status = failNext;
        failNext = null;
        return {
          status,
          headers: status === 429 ? { "retry-after": "7" } : {},
          body: {
            errors: [
              {
                code:
                  status === 429
                    ? "TOO_MANY_REQUESTS"
                    : "INTERNAL_SERVER_ERROR",
                message: "fake failure",
              },
            ],
          },
        };
      }
      const messages = JSON.parse(request.body) as { to?: unknown }[];
      if (
        !Array.isArray(messages) ||
        messages.some((m) => typeof m.to !== "string" || !EXPO_TOKEN.test(m.to))
      )
        return {
          status: 400,
          body: {
            errors: [
              {
                code: "VALIDATION_ERROR",
                message: '"to" must be an Expo push token',
              },
            ],
          },
        };
      return {
        status: 200,
        body: {
          data: messages.map((message) => {
            const to = message.to as string;
            if (unregistered.has(to))
              return {
                status: "error",
                message: `"${to}" is not a registered push notification recipient`,
                details: { error: "DeviceNotRegistered", expoPushToken: to },
              };
            if (rateLimited.has(to))
              return {
                status: "error",
                message: "Rate exceeded",
                details: { error: "MessageRateExceeded" },
              };
            const id = `ticket-${++counter}`;
            tickets.set(id, to);
            return { status: "ok", id };
          }),
        },
      };
    }
    if (
      request.method === "POST" &&
      request.path === "/--/api/v2/push/getReceipts"
    ) {
      const { ids } = JSON.parse(request.body) as { ids: string[] };
      return {
        status: 200,
        body: {
          data: Object.fromEntries(
            ids
              .filter((id) => tickets.has(id))
              .map((id) => [
                id,
                receiptErrors.has(id)
                  ? {
                      status: "error",
                      message: "receipt error",
                      details: { error: receiptErrors.get(id) },
                    }
                  : { status: "ok" },
              ]),
          ),
        },
      };
    }
    return {
      status: 404,
      body: { errors: [{ code: "NOT_FOUND", message: "Unknown route" }] },
    };
  });
  return {
    ...http,
    unregistered,
    rateLimited,
    receiptErrors,
    tickets,
    failNextWith(status: number) {
      failNext = status;
    },
  };
}
```

```ts
// services/api/test/integration/notifications/providers/expo.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExpoPushSender } from "../../../../src/modules/notifications/providers/expo.js";
import { startFakeExpo } from "../../../support/providers/expo.js";

const TOKEN = "ExponentPushToken[abcdefghijklmnop]";
let fake: Awaited<ReturnType<typeof startFakeExpo>>;
let sender: ExpoPushSender;
beforeAll(async () => {
  fake = await startFakeExpo({ accessToken: "expo-secret" });
  sender = new ExpoPushSender({
    baseUrl: fake.url,
    accessToken: "expo-secret",
    timeoutMs: 2000,
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.unregistered.clear();
  fake.rateLimited.clear();
  fake.receiptErrors.clear();
});

describe("Expo push adapter against the contract fake", () => {
  it("sends one message with sound, priority, the default Android channel and string data", async () => {
    const result = await sender.send({
      token: TOKEN,
      title: "Order accepted",
      body: "Pasta Place accepted your order PAS-1.",
      data: { type: "order", _id: "o1" },
    });
    expect(result).toEqual({
      kind: "sent",
      providerMessageId: expect.stringMatching(/^ticket-\d+$/),
    });
    const last = fake.requests.at(-1)!;
    expect(last.headers.authorization).toBe("Bearer expo-secret");
    expect(JSON.parse(last.body)).toEqual([
      {
        to: TOKEN,
        title: "Order accepted",
        body: "Pasta Place accepted your order PAS-1.",
        data: { type: "order", _id: "o1" },
        sound: "default",
        priority: "high",
        channelId: "default",
      },
    ]);
  });
  it("omits a null title", async () => {
    await sender.send({ token: TOKEN, title: null, body: "Hello", data: {} });
    expect(JSON.parse(fake.requests.at(-1)!.body)[0]).not.toHaveProperty(
      "title",
    );
  });
  it("maps DeviceNotRegistered to an invalid recipient", async () => {
    fake.unregistered.add(TOKEN);
    expect(
      await sender.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "invalid-recipient", error: "Expo DeviceNotRegistered" });
  });
  it("maps MessageRateExceeded, HTTP 429 with Retry-After and HTTP 5xx to retry", async () => {
    fake.rateLimited.add(TOKEN);
    expect(
      await sender.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "retry", error: "Expo MessageRateExceeded" });
    fake.rateLimited.clear();
    fake.failNextWith(429);
    expect(
      await sender.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "retry", error: "Expo HTTP 429", retryAfterSeconds: 7 });
    fake.failNextWith(503);
    expect(
      await sender.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "retry", error: "Expo HTTP 503" });
  });
  it("maps a request validation error and bad credentials to permanent failures", async () => {
    expect(
      await sender.send({
        token: "not-an-expo-token",
        title: null,
        body: "x",
        data: {},
      }),
    ).toEqual({ kind: "failed", error: "Expo HTTP 400" });
    const wrongKey = new ExpoPushSender({
      baseUrl: fake.url,
      accessToken: "wrong",
      timeoutMs: 2000,
    });
    expect(
      await wrongKey.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "failed", error: "Expo HTTP 401" });
  });
  it("treats a refused connection as retryable", async () => {
    const offline = new ExpoPushSender({
      baseUrl: "http://127.0.0.1:1",
      accessToken: null,
      timeoutMs: 500,
    });
    expect(
      await offline.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toMatchObject({
      kind: "retry",
      error: expect.stringMatching(/^Expo request failed: /),
    });
  });
  it("reads receipts and reports per-ticket errors", async () => {
    const ok = await sender.send({
      token: TOKEN,
      title: null,
      body: "a",
      data: {},
    });
    const bad = await sender.send({
      token: TOKEN,
      title: null,
      body: "b",
      data: {},
    });
    const okId = (ok as { providerMessageId: string }).providerMessageId;
    const badId = (bad as { providerMessageId: string }).providerMessageId;
    fake.receiptErrors.set(badId, "DeviceNotRegistered");
    const receipts = await sender.receipts([okId, badId, "ticket-unknown"]);
    expect(receipts?.get(okId)).toEqual({ ok: true, error: null });
    expect(receipts?.get(badId)).toEqual({
      ok: false,
      error: "DeviceNotRegistered",
    });
    expect(receipts?.has("ticket-unknown")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/notifications/providers/expo.integration.spec.ts`
Expected: FAIL — module `providers/expo.js` not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/notifications/providers/types.ts
// D13 ports. Production adapters: Expo + FCM HTTP v1 (push), SendGrid (email), Twilio (SMS);
// the OutboxSender implements all three in development/test only.
export type SendResult =
  | { kind: "sent"; providerMessageId: string | null }
  | { kind: "retry"; error: string; retryAfterSeconds?: number }
  | { kind: "failed"; error: string }
  | { kind: "invalid-recipient"; error: string }
  | { kind: "unavailable"; error: string };
export type ProviderName = "EXPO" | "FCM" | "TWILIO" | "SENDGRID" | "OUTBOX";
export type PushMessage = {
  token: string;
  title: string | null;
  body: string;
  data: Record<string, string>;
};
export type EmailMessage = { to: string; subject: string; text: string };
export type SmsMessage = { to: string; text: string };
export interface PushSender {
  readonly provider: ProviderName;
  available(): Promise<boolean>;
  send(message: PushMessage): Promise<SendResult>;
}
export interface EmailSender {
  readonly provider: ProviderName;
  available(): Promise<boolean>;
  send(message: EmailMessage): Promise<SendResult>;
}
export interface SmsSender {
  readonly provider: ProviderName;
  available(): Promise<boolean>;
  send(message: SmsMessage): Promise<SendResult>;
}
```

```ts
// services/api/src/modules/notifications/providers/http.ts
export type HttpResponse = { status: number; headers: Headers; body: unknown };

// One provider HTTP call with a hard timeout. Network errors and timeouts are returned, never thrown,
// and are reported by error name only (no URLs, tokens or bodies in error strings).
export async function postProvider(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<HttpResponse | { error: string }> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, headers: response.headers, body: parsed };
  } catch (error) {
    return { error: error instanceof Error ? error.name : "NetworkError" };
  }
}

export function retryAfterSeconds(headers: Headers): number | undefined {
  const value = Number(headers.get("retry-after"));
  return headers.has("retry-after") && Number.isFinite(value) && value >= 0
    ? Math.min(Math.ceil(value), 3600)
    : undefined;
}

export function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}
```

```ts
// services/api/src/modules/notifications/providers/expo.ts
import { postProvider, retryable, retryAfterSeconds } from "./http.js";
import type { PushMessage, PushSender, SendResult } from "./types.js";

type Ticket = { status?: string; id?: string; details?: { error?: string } };

export class ExpoPushSender implements PushSender {
  readonly provider = "EXPO" as const;
  constructor(
    private readonly options: {
      baseUrl: string;
      accessToken: string | null;
      timeoutMs: number;
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async available(): Promise<boolean> {
    return true;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json",
      ...(this.options.accessToken
        ? { authorization: `Bearer ${this.options.accessToken}` }
        : {}),
    };
  }

  async send(message: PushMessage): Promise<SendResult> {
    const payload = [
      {
        to: message.token,
        ...(message.title ? { title: message.title } : {}),
        body: message.body,
        data: message.data,
        sound: "default",
        priority: "high",
        // Store and rider apps create the "default" Android channel with sound (useNotification.ts:42-48).
        channelId: "default",
      },
    ];
    const response = await postProvider(
      this.fetchImpl,
      `${this.options.baseUrl}/--/api/v2/push/send`,
      this.headers(),
      JSON.stringify(payload),
      this.options.timeoutMs,
    );
    if ("error" in response)
      return { kind: "retry", error: `Expo request failed: ${response.error}` };
    if (retryable(response.status)) {
      const after = retryAfterSeconds(response.headers);
      return after === undefined
        ? { kind: "retry", error: `Expo HTTP ${response.status}` }
        : {
            kind: "retry",
            error: `Expo HTTP ${response.status}`,
            retryAfterSeconds: after,
          };
    }
    if (response.status !== 200)
      return { kind: "failed", error: `Expo HTTP ${response.status}` };
    const ticket = (response.body as { data?: Ticket[] } | null)?.data?.[0];
    if (ticket?.status === "ok")
      return { kind: "sent", providerMessageId: ticket.id ?? null };
    const code = ticket?.details?.error ?? "UnknownError";
    if (code === "DeviceNotRegistered")
      return { kind: "invalid-recipient", error: "Expo DeviceNotRegistered" };
    if (code === "MessageRateExceeded")
      return { kind: "retry", error: "Expo MessageRateExceeded" };
    return { kind: "failed", error: `Expo ${code}` };
  }

  // Returns null when the receipts call itself failed; missing ids are not ready yet.
  async receipts(
    ids: string[],
  ): Promise<Map<string, { ok: boolean; error: string | null }> | null> {
    const response = await postProvider(
      this.fetchImpl,
      `${this.options.baseUrl}/--/api/v2/push/getReceipts`,
      this.headers(),
      JSON.stringify({ ids }),
      this.options.timeoutMs,
    );
    if ("error" in response || response.status !== 200) return null;
    const data = ((response.body as { data?: Record<string, Ticket> } | null)
      ?.data ?? {}) as Record<string, Ticket>;
    const result = new Map<string, { ok: boolean; error: string | null }>();
    for (const [id, receipt] of Object.entries(data))
      result.set(
        id,
        receipt.status === "ok"
          ? { ok: true, error: null }
          : { ok: false, error: receipt.details?.error ?? "UnknownError" },
      );
    return result;
  }
}
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/notifications/providers/expo.integration.spec.ts`
Expected: PASS (7 tests; no Docker needed).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/notifications/providers/types.ts services/api/src/modules/notifications/providers/http.ts services/api/src/modules/notifications/providers/expo.ts services/api/test/support/providers/http.ts services/api/test/support/providers/expo.ts services/api/test/integration/notifications/providers/expo.integration.spec.ts
git commit -m "feat(L8): add Expo push adapter proven against a local contract fake"
```

### Task 5: FCM HTTP v1 adapter

**Files:**

- Create: `services/api/src/modules/notifications/providers/fcm.ts`
- Create: `services/api/test/support/providers/fcm.ts`
- Test: `services/api/test/integration/notifications/providers/fcm.integration.spec.ts`

Contract emulated: OAuth 2.0 JWT-bearer grant (`POST <token url>`, form `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<RS256 JWT>`, `aud` = token URL, `scope` = `https://www.googleapis.com/auth/firebase.messaging`) and `POST /v1/projects/{projectId}/messages:send` with `{ message: { token, notification, data, android, apns } }`; errors are `{ error: { code, status, details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] } }`.

- [ ] **Step 1: Write the fake and the failing test**

```ts
// services/api/test/support/providers/fcm.ts
import { generateKeyPairSync } from "node:crypto";
import { jwtVerify } from "jose";
import { startFakeHttp } from "./http.js";

const fcmError = (code: number, status: string, errorCode: string) => ({
  error: {
    code,
    status,
    message: errorCode,
    details: [
      {
        "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
        errorCode,
      },
    ],
  },
});

// Contract fake of Google OAuth token exchange + FCM HTTP v1 messages:send.
export async function startFakeFcm(projectId = "fairbite-test") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const clientEmail = `push@${projectId}.iam.gserviceaccount.com`;
  const issued = new Set<string>();
  const unregistered = new Set<string>();
  const mismatched = new Set<string>();
  const unavailable = new Set<string>();
  const state = { tokenRequests: 0, counter: 0, tokenUrl: "" };
  const http = await startFakeHttp(async (request) => {
    if (request.method === "POST" && request.path === "/token") {
      state.tokenRequests++;
      const form = new URLSearchParams(request.body);
      if (
        form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer"
      )
        return { status: 400, body: { error: "unsupported_grant_type" } };
      try {
        const { payload } = await jwtVerify(
          form.get("assertion") ?? "",
          publicKey,
          {
            audience: state.tokenUrl,
            issuer: clientEmail,
            algorithms: ["RS256"],
          },
        );
        if (
          payload.scope !== "https://www.googleapis.com/auth/firebase.messaging"
        )
          return { status: 400, body: { error: "invalid_scope" } };
      } catch {
        return {
          status: 400,
          body: {
            error: "invalid_grant",
            error_description: "Invalid JWT Signature.",
          },
        };
      }
      const token = `fake-access-${++state.counter}`;
      issued.add(token);
      return {
        status: 200,
        body: { access_token: token, expires_in: 3599, token_type: "Bearer" },
      };
    }
    const match = /^\/v1\/projects\/([^/]+)\/messages:send$/.exec(request.path);
    if (request.method === "POST" && match) {
      const bearer = (request.headers.authorization ?? "").replace(
        /^Bearer /,
        "",
      );
      if (!issued.has(bearer))
        return {
          status: 401,
          body: {
            error: {
              code: 401,
              status: "UNAUTHENTICATED",
              message: "Request had invalid authentication credentials.",
            },
          },
        };
      if (match[1] !== projectId)
        return {
          status: 403,
          body: {
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              message: "Wrong project",
            },
          },
        };
      const { message } = JSON.parse(request.body) as {
        message?: {
          token?: string;
          data?: Record<string, unknown>;
          notification?: { body?: string };
        };
      };
      if (
        !message?.token ||
        Object.values(message.data ?? {}).some(
          (value) => typeof value !== "string",
        )
      )
        return {
          status: 400,
          body: fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"),
        };
      if (unregistered.has(message.token))
        return {
          status: 404,
          body: fcmError(404, "NOT_FOUND", "UNREGISTERED"),
        };
      if (mismatched.has(message.token))
        return {
          status: 403,
          body: fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"),
        };
      if (unavailable.has(message.token))
        return {
          status: 503,
          body: fcmError(503, "UNAVAILABLE", "UNAVAILABLE"),
        };
      return {
        status: 200,
        body: { name: `projects/${projectId}/messages/${++state.counter}` },
      };
    }
    return {
      status: 404,
      body: {
        error: { code: 404, status: "NOT_FOUND", message: "Unknown route" },
      },
    };
  });
  state.tokenUrl = `${http.url}/token`;
  const serviceAccount = {
    projectId,
    clientEmail,
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  return {
    ...http,
    tokenUrl: state.tokenUrl,
    serviceAccount,
    serviceAccountJson: JSON.stringify({
      project_id: projectId,
      client_email: clientEmail,
      private_key: serviceAccount.privateKey,
    }),
    unregistered,
    mismatched,
    unavailable,
    revokeAccessTokens() {
      issued.clear();
    },
    tokenRequests: () => state.tokenRequests,
  };
}
```

```ts
// services/api/test/integration/notifications/providers/fcm.integration.spec.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FcmPushSender } from "../../../../src/modules/notifications/providers/fcm.js";
import { startFakeFcm } from "../../../support/providers/fcm.js";

const TOKEN = `fcmToken01:APA91b${"a".repeat(140)}`;
// Real time: the fake verifies the assertion's exp against the current time.
const clock = { now: () => new Date() };
let fake: Awaited<ReturnType<typeof startFakeFcm>>;
let sender: FcmPushSender;
beforeAll(async () => {
  fake = await startFakeFcm();
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.unregistered.clear();
  fake.mismatched.clear();
  fake.unavailable.clear();
  sender = new FcmPushSender(
    {
      apiBaseUrl: fake.url,
      tokenUrl: fake.tokenUrl,
      serviceAccount: fake.serviceAccount,
      timeoutMs: 2000,
    },
    fetch,
    clock,
  );
});

describe("FCM HTTP v1 adapter against the contract fake", () => {
  it("exchanges a signed service-account JWT for an access token, caches it, and sends a v1 message", async () => {
    const before = fake.tokenRequests();
    const first = await sender.send({
      token: TOKEN,
      title: "Order accepted",
      body: "Accepted",
      data: { type: "order", _id: "o1" },
    });
    const second = await sender.send({
      token: TOKEN,
      title: null,
      body: "Again",
      data: {},
    });
    expect(first).toEqual({
      kind: "sent",
      providerMessageId: expect.stringMatching(
        /^projects\/fairbite-test\/messages\/\d+$/,
      ),
    });
    expect(second.kind).toBe("sent");
    expect(fake.tokenRequests() - before).toBe(1);
    const sent = fake.requests.filter((r) => r.path.endsWith("messages:send"));
    expect(JSON.parse(sent.at(-2)!.body)).toEqual({
      message: {
        token: TOKEN,
        notification: { title: "Order accepted", body: "Accepted" },
        data: { type: "order", _id: "o1" },
        android: {
          priority: "HIGH",
          notification: { sound: "default", channel_id: "default" },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { sound: "default" } },
        },
      },
    });
    expect(JSON.parse(sent.at(-1)!.body).message.notification).toEqual({
      body: "Again",
    });
  });
  it("re-authenticates once when the access token is rejected", async () => {
    await sender.send({ token: TOKEN, title: null, body: "x", data: {} });
    fake.revokeAccessTokens();
    const before = fake.tokenRequests();
    expect(
      (await sender.send({ token: TOKEN, title: null, body: "x", data: {} }))
        .kind,
    ).toBe("sent");
    expect(fake.tokenRequests() - before).toBe(1);
  });
  it("maps UNREGISTERED and SENDER_ID_MISMATCH to invalid recipients", async () => {
    fake.unregistered.add(TOKEN);
    expect(
      await sender.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "invalid-recipient", error: "FCM UNREGISTERED" });
    fake.unregistered.clear();
    fake.mismatched.add(TOKEN);
    expect(
      await sender.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "invalid-recipient", error: "FCM SENDER_ID_MISMATCH" });
  });
  it("maps UNAVAILABLE to retry and INVALID_ARGUMENT to a permanent failure", async () => {
    fake.unavailable.add(TOKEN);
    expect(
      await sender.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "retry", error: "FCM UNAVAILABLE" });
    expect(
      await sender.send({ token: "", title: null, body: "x", data: {} }),
    ).toEqual({ kind: "failed", error: "FCM INVALID_ARGUMENT" });
  });
  it("reports PROVIDER_UNAVAILABLE without a service account and fails on a rejected key", async () => {
    const unconfigured = new FcmPushSender(
      {
        apiBaseUrl: fake.url,
        tokenUrl: fake.tokenUrl,
        serviceAccount: null,
        timeoutMs: 2000,
      },
      fetch,
      clock,
    );
    expect(await unconfigured.available()).toBe(false);
    expect(
      await unconfigured.send({
        token: TOKEN,
        title: null,
        body: "x",
        data: {},
      }),
    ).toEqual({ kind: "unavailable", error: "FCM is not configured" });
    const other = await startFakeFcm();
    const wrongKey = new FcmPushSender(
      {
        apiBaseUrl: fake.url,
        tokenUrl: fake.tokenUrl,
        serviceAccount: {
          ...fake.serviceAccount,
          privateKey: other.serviceAccount.privateKey,
        },
        timeoutMs: 2000,
      },
      fetch,
      clock,
    );
    expect(
      await wrongKey.send({ token: TOKEN, title: null, body: "x", data: {} }),
    ).toEqual({ kind: "failed", error: "FCM token HTTP 400" });
    await other.close();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/notifications/providers/fcm.integration.spec.ts`
Expected: FAIL — module `providers/fcm.js` not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/notifications/providers/fcm.ts
import { SignJWT, importPKCS8 } from "jose";
import { systemClock, type Clock } from "../../../kernel/time.js";
import type { ServiceAccount } from "../config.js";
import { postProvider, retryable } from "./http.js";
import type { PushMessage, PushSender, SendResult } from "./types.js";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
type FcmErrorBody = {
  error?: { status?: string; details?: { errorCode?: string }[] };
} | null;

function fcmCode(body: unknown): string | null {
  const error = (body as FcmErrorBody)?.error;
  return (
    error?.details?.find((detail) => typeof detail.errorCode === "string")
      ?.errorCode ??
    error?.status ??
    null
  );
}

export class FcmPushSender implements PushSender {
  readonly provider = "FCM" as const;
  private cached: { token: string; expiresAt: number } | null = null;
  constructor(
    private readonly options: {
      apiBaseUrl: string;
      tokenUrl: string;
      serviceAccount: ServiceAccount | null;
      timeoutMs: number;
    },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: Clock = systemClock,
  ) {}

  async available(): Promise<boolean> {
    return this.options.serviceAccount !== null;
  }

  private async accessToken(
    account: ServiceAccount,
  ): Promise<string | SendResult> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    if (this.cached && this.cached.expiresAt - 60 > now)
      return this.cached.token;
    const key = await importPKCS8(account.privateKey, "RS256");
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.clientEmail)
      .setSubject(account.clientEmail)
      .setAudience(this.options.tokenUrl)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const response = await postProvider(
      this.fetchImpl,
      this.options.tokenUrl,
      { "content-type": "application/x-www-form-urlencoded" },
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      this.options.timeoutMs,
    );
    if ("error" in response)
      return {
        kind: "retry",
        error: `FCM token request failed: ${response.error}`,
      };
    if (retryable(response.status))
      return { kind: "retry", error: `FCM token HTTP ${response.status}` };
    if (response.status !== 200)
      return { kind: "failed", error: `FCM token HTTP ${response.status}` };
    const body = response.body as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (typeof body?.access_token !== "string")
      return { kind: "failed", error: "FCM token response invalid" };
    this.cached = {
      token: body.access_token,
      expiresAt:
        now + (typeof body.expires_in === "number" ? body.expires_in : 3600),
    };
    return body.access_token;
  }

  async send(message: PushMessage): Promise<SendResult> {
    const account = this.options.serviceAccount;
    if (!account)
      return { kind: "unavailable", error: "FCM is not configured" };
    const payload = JSON.stringify({
      message: {
        token: message.token,
        notification: {
          ...(message.title ? { title: message.title } : {}),
          body: message.body,
        },
        data: message.data,
        android: {
          priority: "HIGH",
          notification: { sound: "default", channel_id: "default" },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { sound: "default" } },
        },
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(account);
      if (typeof token !== "string") return token;
      const response = await postProvider(
        this.fetchImpl,
        `${this.options.apiBaseUrl}/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
        {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload,
        this.options.timeoutMs,
      );
      if ("error" in response)
        return {
          kind: "retry",
          error: `FCM request failed: ${response.error}`,
        };
      if (response.status === 200) {
        const name = (response.body as { name?: unknown } | null)?.name;
        return {
          kind: "sent",
          providerMessageId: typeof name === "string" ? name : null,
        };
      }
      if (response.status === 401 && attempt === 0) {
        this.cached = null;
        continue;
      }
      const code = fcmCode(response.body);
      if (code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH")
        return { kind: "invalid-recipient", error: `FCM ${code}` };
      if (retryable(response.status))
        return {
          kind: "retry",
          error: `FCM ${code ?? `HTTP ${response.status}`}`,
        };
      return {
        kind: "failed",
        error: `FCM ${code ?? `HTTP ${response.status}`}`,
      };
    }
    return { kind: "failed", error: "FCM authentication failed" };
  }
}
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/notifications/providers/fcm.integration.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/notifications/providers/fcm.ts services/api/test/support/providers/fcm.ts services/api/test/integration/notifications/providers/fcm.integration.spec.ts
git commit -m "feat(L8): add FCM HTTP v1 adapter with service-account OAuth, proven against a contract fake"
```

### Task 6: Twilio SMS and SendGrid email adapters

**Files:**

- Create: `services/api/src/modules/notifications/providers/twilio.ts`
- Create: `services/api/src/modules/notifications/providers/sendgrid.ts`
- Create: `services/api/test/support/providers/twilio.ts`
- Create: `services/api/test/support/providers/sendgrid.ts`
- Test: `services/api/test/integration/notifications/providers/twilio.integration.spec.ts`, `services/api/test/integration/notifications/providers/sendgrid.integration.spec.ts`

Contracts emulated: Twilio `POST /2010-04-01/Accounts/{AccountSid}/Messages.json`, HTTP Basic `AccountSid:AuthToken`, form fields `To`, `From`, `Body`, `201` `{ sid, status }`, errors `{ code, message, status }` (21211 invalid To, 20003 authentication, 20429 too many requests). SendGrid `POST /v3/mail/send`, `Authorization: Bearer <key>`, JSON `{ personalizations: [{ to: [{ email }] }], from: { email, name }, subject, content: [{ type: "text/plain", value }] }`, `202` with `X-Message-Id`, errors `{ errors: [{ message, field }] }`.

- [ ] **Step 1: Write the fakes and the failing tests**

```ts
// services/api/test/support/providers/twilio.ts
import { startFakeHttp } from "./http.js";

// Contract fake of the Twilio Programmable Messaging REST API.
export async function startFakeTwilio(
  credentials = {
    accountSid: `AC${"0".repeat(32)}`,
    authToken: "twilio-test-token",
  },
) {
  const invalidNumbers = new Set<string>();
  const rateLimited = new Set<string>();
  let counter = 0;
  const http = await startFakeHttp((request) => {
    const match = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(
      request.path,
    );
    if (request.method !== "POST" || !match)
      return {
        status: 404,
        body: {
          code: 20404,
          message: "The requested resource was not found",
          status: 404,
        },
      };
    const expected = `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`;
    if (
      match[1] !== credentials.accountSid ||
      request.headers.authorization !== expected
    )
      return {
        status: 401,
        body: { code: 20003, message: "Authenticate", status: 401 },
      };
    if (
      !String(request.headers["content-type"]).startsWith(
        "application/x-www-form-urlencoded",
      )
    )
      return {
        status: 400,
        body: { code: 20001, message: "Unsupported content type", status: 400 },
      };
    const form = new URLSearchParams(request.body);
    const to = form.get("To") ?? "";
    const from = form.get("From") ?? "";
    const body = form.get("Body") ?? "";
    if (!from)
      return {
        status: 400,
        body: {
          code: 21603,
          message: "A 'From' phone number is required.",
          status: 400,
        },
      };
    if (!body)
      return {
        status: 400,
        body: {
          code: 21602,
          message: "Message body is required.",
          status: 400,
        },
      };
    if (invalidNumbers.has(to) || !/^\+[1-9]\d{6,14}$/.test(to))
      return {
        status: 400,
        body: {
          code: 21211,
          message: `The 'To' number ${to} is not a valid phone number.`,
          status: 400,
        },
      };
    if (rateLimited.has(to))
      return {
        status: 429,
        headers: { "retry-after": "5" },
        body: { code: 20429, message: "Too Many Requests", status: 429 },
      };
    return {
      status: 201,
      body: {
        sid: `SM${(++counter).toString(16).padStart(32, "0")}`,
        status: "queued",
        to,
        from,
        body,
      },
    };
  });
  return { ...http, credentials, invalidNumbers, rateLimited };
}
```

```ts
// services/api/test/support/providers/sendgrid.ts
import { startFakeHttp } from "./http.js";

// Contract fake of the SendGrid v3 Mail Send API.
export async function startFakeSendGrid(apiKey = "SG.test-key") {
  const failing = new Set<string>();
  let counter = 0;
  const http = await startFakeHttp((request) => {
    if (request.method !== "POST" || request.path !== "/v3/mail/send")
      return {
        status: 404,
        body: { errors: [{ message: "Not found", field: null }] },
      };
    if (request.headers.authorization !== `Bearer ${apiKey}`)
      return {
        status: 401,
        body: {
          errors: [
            {
              message:
                "The provided authorization grant is invalid, expired, or revoked",
              field: null,
            },
          ],
        },
      };
    const mail = JSON.parse(request.body) as {
      personalizations?: { to?: { email?: string }[] }[];
      from?: { email?: string };
      subject?: string;
      content?: { type?: string; value?: string }[];
    };
    const to = mail.personalizations?.[0]?.to?.[0]?.email;
    if (!to)
      return {
        status: 400,
        body: {
          errors: [
            {
              message: "The to field is required",
              field: "personalizations.0.to",
            },
          ],
        },
      };
    if (!mail.from?.email)
      return {
        status: 400,
        body: {
          errors: [
            { message: "The from email is required", field: "from.email" },
          ],
        },
      };
    if (!mail.subject)
      return {
        status: 400,
        body: {
          errors: [{ message: "The subject is required", field: "subject" }],
        },
      };
    if (!mail.content?.[0]?.value)
      return {
        status: 400,
        body: {
          errors: [{ message: "Content is required", field: "content" }],
        },
      };
    if (failing.has(to))
      return {
        status: 503,
        body: { errors: [{ message: "Service unavailable", field: null }] },
      };
    return { status: 202, headers: { "x-message-id": `sg-${++counter}` } };
  });
  return { ...http, apiKey, failing };
}
```

```ts
// services/api/test/integration/notifications/providers/twilio.integration.spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TwilioSmsSender,
  type TwilioCredentials,
} from "../../../../src/modules/notifications/providers/twilio.js";
import { startFakeTwilio } from "../../../support/providers/twilio.js";

let fake: Awaited<ReturnType<typeof startFakeTwilio>>;
let credentials: TwilioCredentials;
const sender = () =>
  new TwilioSmsSender(
    { baseUrl: fake.url, timeoutMs: 2000 },
    async () => credentials,
  );
beforeAll(async () => {
  fake = await startFakeTwilio();
});
afterAll(() => fake.close());

describe("Twilio SMS adapter against the contract fake", () => {
  it("posts To, From and Body with HTTP Basic auth and returns the message SID", async () => {
    credentials = {
      enabled: true,
      accountSid: fake.credentials.accountSid,
      authToken: fake.credentials.authToken,
      fromNumber: "+15005550006",
    };
    expect(await sender().available()).toBe(true);
    expect(
      await sender().send({ to: "+447700900123", text: "Your code is 1" }),
    ).toEqual({
      kind: "sent",
      providerMessageId: expect.stringMatching(/^SM[0-9a-f]{32}$/),
    });
    const form = new URLSearchParams(fake.requests.at(-1)!.body);
    expect(Object.fromEntries(form)).toEqual({
      To: "+447700900123",
      From: "+15005550006",
      Body: "Your code is 1",
    });
  });
  it("maps an invalid To number to an invalid recipient and 429 to retry", async () => {
    fake.invalidNumbers.add("+15005550001");
    expect(await sender().send({ to: "+15005550001", text: "x" })).toEqual({
      kind: "invalid-recipient",
      error: "Twilio error 21211",
    });
    fake.rateLimited.add("+447700900124");
    expect(await sender().send({ to: "+447700900124", text: "x" })).toEqual({
      kind: "retry",
      error: "Twilio HTTP 429",
      retryAfterSeconds: 5,
    });
  });
  it("fails permanently on rejected credentials", async () => {
    credentials = { ...credentials, authToken: "wrong" };
    expect(await sender().send({ to: "+447700900123", text: "x" })).toEqual({
      kind: "failed",
      error: "Twilio authentication failed",
    });
  });
  it("is unavailable when disabled or incomplete in configuration", async () => {
    credentials = {
      enabled: false,
      accountSid: fake.credentials.accountSid,
      authToken: fake.credentials.authToken,
      fromNumber: "+15005550006",
    };
    expect(await sender().available()).toBe(false);
    expect(await sender().send({ to: "+447700900123", text: "x" })).toEqual({
      kind: "unavailable",
      error: "Twilio is not configured",
    });
    credentials = {
      enabled: true,
      accountSid: fake.credentials.accountSid,
      authToken: null,
      fromNumber: "+15005550006",
    };
    expect(await sender().available()).toBe(false);
  });
});
```

```ts
// services/api/test/integration/notifications/providers/sendgrid.integration.spec.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SendGridEmailSender,
  type SendGridCredentials,
} from "../../../../src/modules/notifications/providers/sendgrid.js";
import { startFakeSendGrid } from "../../../support/providers/sendgrid.js";

let fake: Awaited<ReturnType<typeof startFakeSendGrid>>;
let credentials: SendGridCredentials;
const sender = () =>
  new SendGridEmailSender(
    { baseUrl: fake.url, timeoutMs: 2000 },
    async () => credentials,
  );
beforeAll(async () => {
  fake = await startFakeSendGrid();
});
afterAll(() => fake.close());

describe("SendGrid email adapter against the contract fake", () => {
  it("sends a plain-text v3 mail with the configured sender and returns X-Message-Id", async () => {
    credentials = {
      enabled: true,
      apiKey: fake.apiKey,
      fromEmail: "no-reply@fairbite.test",
      fromName: "FairBite",
    };
    expect(
      await sender().send({
        to: "ada@example.com",
        subject: "Your code",
        text: "Code 1",
      }),
    ).toEqual({ kind: "sent", providerMessageId: "sg-1" });
    expect(JSON.parse(fake.requests.at(-1)!.body)).toEqual({
      personalizations: [{ to: [{ email: "ada@example.com" }] }],
      from: { email: "no-reply@fairbite.test", name: "FairBite" },
      subject: "Your code",
      content: [{ type: "text/plain", value: "Code 1" }],
    });
  });
  it("omits an empty sender name", async () => {
    credentials = {
      enabled: true,
      apiKey: fake.apiKey,
      fromEmail: "no-reply@fairbite.test",
      fromName: null,
    };
    await sender().send({ to: "ada@example.com", subject: "s", text: "t" });
    expect(JSON.parse(fake.requests.at(-1)!.body).from).toEqual({
      email: "no-reply@fairbite.test",
    });
  });
  it("maps 5xx to retry, a rejected key to a permanent failure and a 400 to a permanent failure", async () => {
    fake.failing.add("down@example.com");
    expect(
      await sender().send({ to: "down@example.com", subject: "s", text: "t" }),
    ).toEqual({ kind: "retry", error: "SendGrid HTTP 503" });
    credentials = { ...credentials, apiKey: "SG.wrong" };
    expect(
      await sender().send({ to: "ada@example.com", subject: "s", text: "t" }),
    ).toEqual({ kind: "failed", error: "SendGrid authentication failed" });
    credentials = { ...credentials, apiKey: fake.apiKey };
    expect(
      await sender().send({ to: "ada@example.com", subject: "", text: "t" }),
    ).toEqual({ kind: "failed", error: "SendGrid HTTP 400" });
  });
  it("is unavailable when disabled or missing a key or sender", async () => {
    credentials = {
      enabled: true,
      apiKey: null,
      fromEmail: "no-reply@fairbite.test",
      fromName: null,
    };
    expect(await sender().available()).toBe(false);
    expect(
      await sender().send({ to: "ada@example.com", subject: "s", text: "t" }),
    ).toEqual({ kind: "unavailable", error: "SendGrid is not configured" });
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/notifications/providers/twilio.integration.spec.ts test/integration/notifications/providers/sendgrid.integration.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// services/api/src/modules/notifications/providers/twilio.ts
import { postProvider, retryable, retryAfterSeconds } from "./http.js";
import type { SendResult, SmsMessage, SmsSender } from "./types.js";

export type TwilioCredentials = {
  enabled: boolean;
  accountSid: string | null;
  authToken: string | null;
  fromNumber: string | null;
};
const INVALID_RECIPIENT = new Set([21211, 21610, 21614]);

export class TwilioSmsSender implements SmsSender {
  readonly provider = "TWILIO" as const;
  constructor(
    private readonly options: { baseUrl: string; timeoutMs: number },
    // Write-only configuration owned by L2 (ConfigPort.messaging()).
    private readonly credentials: () => Promise<TwilioCredentials>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async available(): Promise<boolean> {
    const c = await this.credentials();
    return c.enabled && !!c.accountSid && !!c.authToken && !!c.fromNumber;
  }

  async send(message: SmsMessage): Promise<SendResult> {
    const c = await this.credentials();
    const { accountSid, authToken, fromNumber } = c;
    if (!c.enabled || !accountSid || !authToken || !fromNumber)
      return { kind: "unavailable", error: "Twilio is not configured" };
    const response = await postProvider(
      this.fetchImpl,
      `${this.options.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      new URLSearchParams({
        To: message.to,
        From: fromNumber,
        Body: message.text,
      }).toString(),
      this.options.timeoutMs,
    );
    if ("error" in response)
      return {
        kind: "retry",
        error: `Twilio request failed: ${response.error}`,
      };
    if (response.status === 200 || response.status === 201) {
      const sid = (response.body as { sid?: unknown } | null)?.sid;
      return {
        kind: "sent",
        providerMessageId: typeof sid === "string" ? sid : null,
      };
    }
    if (retryable(response.status)) {
      const after = retryAfterSeconds(response.headers);
      return after === undefined
        ? { kind: "retry", error: `Twilio HTTP ${response.status}` }
        : {
            kind: "retry",
            error: `Twilio HTTP ${response.status}`,
            retryAfterSeconds: after,
          };
    }
    if (response.status === 401)
      return { kind: "failed", error: "Twilio authentication failed" };
    const code = (response.body as { code?: unknown } | null)?.code;
    if (typeof code === "number" && INVALID_RECIPIENT.has(code))
      return { kind: "invalid-recipient", error: `Twilio error ${code}` };
    return {
      kind: "failed",
      error: `Twilio error ${typeof code === "number" ? code : response.status}`,
    };
  }
}
```

```ts
// services/api/src/modules/notifications/providers/sendgrid.ts
import { postProvider, retryable, retryAfterSeconds } from "./http.js";
import type { EmailMessage, EmailSender, SendResult } from "./types.js";

export type SendGridCredentials = {
  enabled: boolean;
  apiKey: string | null;
  fromEmail: string | null;
  fromName: string | null;
};

export class SendGridEmailSender implements EmailSender {
  readonly provider = "SENDGRID" as const;
  constructor(
    private readonly options: { baseUrl: string; timeoutMs: number },
    // Write-only configuration owned by L2 (ConfigPort.messaging()).
    private readonly credentials: () => Promise<SendGridCredentials>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async available(): Promise<boolean> {
    const c = await this.credentials();
    return c.enabled && !!c.apiKey && !!c.fromEmail;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const c = await this.credentials();
    const { apiKey, fromEmail } = c;
    if (!c.enabled || !apiKey || !fromEmail)
      return { kind: "unavailable", error: "SendGrid is not configured" };
    const response = await postProvider(
      this.fetchImpl,
      `${this.options.baseUrl}/v3/mail/send`,
      { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: fromEmail, ...(c.fromName ? { name: c.fromName } : {}) },
        subject: message.subject,
        content: [{ type: "text/plain", value: message.text }],
      }),
      this.options.timeoutMs,
    );
    if ("error" in response)
      return {
        kind: "retry",
        error: `SendGrid request failed: ${response.error}`,
      };
    if (response.status === 202 || response.status === 200)
      return {
        kind: "sent",
        providerMessageId: response.headers.get("x-message-id"),
      };
    if (retryable(response.status)) {
      const after = retryAfterSeconds(response.headers);
      return after === undefined
        ? { kind: "retry", error: `SendGrid HTTP ${response.status}` }
        : {
            kind: "retry",
            error: `SendGrid HTTP ${response.status}`,
            retryAfterSeconds: after,
          };
    }
    if (response.status === 401 || response.status === 403)
      return { kind: "failed", error: "SendGrid authentication failed" };
    return { kind: "failed", error: `SendGrid HTTP ${response.status}` };
  }
}
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/integration/notifications/providers/twilio.integration.spec.ts test/integration/notifications/providers/sendgrid.integration.spec.ts`
Expected: PASS (4 + 4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/modules/notifications/providers/twilio.ts services/api/src/modules/notifications/providers/sendgrid.ts services/api/test/support/providers/twilio.ts services/api/test/support/providers/sendgrid.ts services/api/test/integration/notifications/providers/twilio.integration.spec.ts services/api/test/integration/notifications/providers/sendgrid.integration.spec.ts
git commit -m "feat(L8): add Twilio SMS and SendGrid email adapters proven against contract fakes"
```

---

## Remaining sections to author (this plan is PARTIAL)

**Status:** PARTIAL. `W10` may not begin implementation on this plan. Completing it is the first task of
`W10` (see `docs/TASK_BOARD.md`), reviewed by the lead before any code is written — `ROADMAP.md` §12.3.

**What exists:** §1 boundary, §2 all 5 operations plus the port and event surface, §3 contract notes and SDL, §4 data model, §5 business rules, Task 0 (requests to the lead) and Tasks 1–6 (lane schema, configuration, templates and rate limiting, Expo push, FCM, Twilio and SendGrid adapters).

**What is missing**, measured against `_lane-plan-brief.md`:

1. **Tasks 7+ — the GraphQL layer.** The five admin operations (`notifications`, `notificationsPaginated`, `webNotifications`, `markWebNotificationsAsRead`, `sendNotificationUser`) have no resolver, service or tagged integration test. Include the per-role row filtering for `webNotifications` and the single-vendor `recipientType` argument.
2. **The delivery drain job** — the `FOR UPDATE SKIP LOCKED` worker loop with exponential backoff, per-provider rate limits and invalid-token cleanup is in the architecture but has no task.
3. **The broadcast fan-out job** — admin broadcasts stored as `Notification` rows and fanned out page by page, including the `NOTIFY_BROADCAST_INTERVAL_SECONDS` behaviour the E2E recipe depends on.
4. **The six domain-event handlers** (`user.otp`, `order.placed`, `order.transitioned`, `order.paid`, `withdraw.updated`, `ticket.message`), each idempotent by event id.
5. **`NotifyPort` conformance tests** for the consuming lanes (L1, L4, L5, L6, L7), proving a missing provider never fails the business action.
6. **§9 Playwright and journey handover** to W16 for the admin notification screens and app-bar behaviour.
7. **§10 Coverage and gate checklist.**
8. **§11 Open questions and blockers** — provider credentials, and the D13 rule that the DevOutbox is refused in production.

The quality bar in `_lane-plan-brief.md` applies to every added section: complete code in every step, no TBD,
no "similar to Task N", exact upstream strings and misspellings preserved, and every operation of the lane
present in both the operations table and in at least one task's tests.
