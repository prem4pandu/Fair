# Enatega-compatible backend — master implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementation handoff MUST include the "Frontend boundary" section below verbatim.

**Goal:** Build the backend that the six unchanged Enatega apps in `implementation/vendor/enatega-ui/` call — every GraphQL operation, REST route and WebSocket subscription, with the same names, arguments and response shapes — and prove it with unit, database-integration, contract, journey and Playwright tests, with coverage measured from the first commit.

**Architecture:** One NestJS + Apollo API (schema-first) in `implementation/services/api`, one BullMQ worker in `implementation/services/worker`, PostgreSQL 17 + PostGIS and Redis. The schema lives in `implementation/contracts/enatega/*.graphql`. Each domain lane owns a module directory, an SDL file and a Prisma schema file. Cross-lane calls go through TypeScript ports defined once in Wave 1, so all lanes can be built at the same time.

**Tech stack:** Node 24, TypeScript 5.9, NestJS 12, `@nestjs/graphql` 14 + Apollo Server 5, graphql-js 16, Prisma 7 (pg adapter), ioredis, BullMQ 6, `subscriptions-transport-ws` 0.11 + `graphql-ws` 6, zod 4, jose 6, argon2, Vitest 4 (+ `@vitest/coverage-v8`), Testcontainers 11, Playwright 1.63, pnpm 10 + Turborepo 2.11.

---

## 0. How to read this plan

| File | Contents | Who executes |
|---|---|---|
| `00-master-plan.md` (this file) | decisions, architecture, conventions, lanes, waves, gates, file ownership, handoff template | lead |
| `01-wave0-foundation.md` | kernel, transport, auth, subscriptions, test harness, coverage, Playwright harness, app wiring | 3 agents in parallel (W0-A, W0-B, W0-C) |
| `02-wave1-contract-and-data-model.md` | core SDL, per-lane SDL, Prisma schema, ports, `NOT_IMPLEMENTED` baseline, contract gate to PASS | 1 agent, then 9 in parallel |
| `10-lane-L1-identity.md` … `19-lane-L9-analytics.md` | per-lane domain implementation, task by task, with tests | 1 agent per lane, all in parallel in Wave 2 |
| `20-wave3-journeys-and-e2e.md` | cross-lane journeys, Playwright suites, mobile document replays, native device gate | E2E lane + QA |
| `21-wave4-hardening-and-release.md` | providers, security review, performance, observability, release gates | lead + security + QA |
| `22-wave5-single-vendor.md` | the 70 single-vendor operations (gated on owner decision D1) | 2 agents |
| `reference/01..04-*.md` | exact client behaviour, documents, selection sets and rules, with file:line citations | read-only input for everyone |

Machine-readable inputs (generated, committed):

- `implementation/docs/ENATEGA_OPERATION_INVENTORY.json` — all 334 root operations and the apps that call them (`node tools/inventory-operations.mjs …`).
- `implementation/docs/OPERATION_LANES.json` — each operation's lane and wave (`node tools/operation-lanes.mjs …`). **This file is the authority for "who implements what".** 264 operations are multivendor scope; 70 are single-vendor (lane L12).
- `implementation/docs/ENATEGA_COMPATIBILITY_REPORT.json` — static validation of every app document against our SDL (`pnpm check:enatega`).

## 1. Frontend boundary (copy verbatim into every handoff)

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

## 2. Decisions

Decisions marked **OWNER** need the owner's confirmation. Work proceeds on the stated default, and the default is chosen so that changing it later touches one lane only.

| # | Decision | Default | Why | Owner? |
|---|---|---|---|---|
| D1 | Scope | Waves 0–4 deliver the 264 multivendor operations. The 70 single-vendor operations (L12) stay `NOT_IMPLEMENTED` until Wave 5 is approved. All apps run with `VENDOR_MODE=MULTI`. | Single-vendor is a separate product mode; forcing MULTI stops the customer app pre-warming the upstream railway backend (reference/01 §7). | **OWNER** |
| D2 | Primary keys | Keep PostgreSQL `uuid` keys, generated server-side as UUIDv7. Expose them as `_id: ID!` strings. | The only 24-hex check in the apps is in single-vendor tracking and treats such ids as *legacy* (reference/02 §6). UUIDs need no migration. | no |
| D3 | Money | Integer minor units in the database (`*Minor` columns, `BIGINT`). GraphQL `Float` in major units at the API boundary, converted by `kernel/money.ts` with the currency exponent from configuration. Prices and totals are always computed on the server; client-sent amounts are ignored except `tipping`, which is validated. | AGENTS.md. | no |
| D4 | Commission | Every restaurant has `plan` = `CORE` by default. Core-plan food commission is fixed at 0 %. `updateCommission` on a core-plan restaurant fails with `BAD_USER_INPUT` "Commission is fixed at 0% on the core plan". Non-core plans are not offered until the owner defines them. | AGENTS.md zero core-plan commission; reference/04 §5.1. | **OWNER** |
| D5 | Order states | Server emits `PENDING ACCEPTED ASSIGNED PICKED DELIVERED CANCELLED`. Pickup orders go `PENDING → ACCEPTED → DELIVERED` via `orderPickedUp`. The server never emits `COMPLETED`, `ON_ROUTE` or `CANCELLEDBYREST`; store rejection is `CANCELLED` with `reason`. | Every app renders these correctly (reference/02 §10, reference/03 §B). | **OWNER** |
| D6 | Timeouts | Worker job auto-cancels `PENDING` orders after `ORDER_ACCEPT_TIMEOUT_SECONDS` (default 120) with reason `"Not accepted in time"`. Unclaimed `ACCEPTED` delivery orders are flagged to the admin dispatcher after `RIDER_CLAIM_TIMEOUT_SECONDS` (default 120); never auto-cancelled. | Store shows a 120 s auto-decline countdown but never cancels (reference/03 §C). | **OWNER** |
| D7 | Public-access handshake | Implement `metricsGeneral` and enforce `bop-auth`/`nonce` on every HTTP GraphQL operation except `metricsGeneral`, behind `PUBLIC_ACCESS_ENFORCED` (default `true`). Not enforced on WebSocket or REST. Exact spec: reference/01 §2.5. | Every app performs it; rejection format chosen so no app logs the user out. | no |
| D8 | User tokens | HS256 JWT with `sub`, `typ` (`CUSTOMER RIDER RESTAURANT VENDOR ADMIN STAFF`), `sid`, `iat`, `exp` (15 min). Refresh tokens are the existing opaque rotating family tokens (30 days). The JWT payload segment must contain no `-` or `_` (store app decodes with `atob`); the signer adds a random `n` claim until it does. | reference/01 §1.5, §9.5. | no |
| D9 | Subscriptions | Own WebSocket server on `/graphql`: `Sec-WebSocket-Protocol: graphql-ws` → legacy `subscriptions-transport-ws`; `graphql-transport-ws` → `graphql-ws`. Redis pub/sub (`graphql-redis-subscriptions`). Anonymous sockets are accepted; each subscription authorises itself. | `@nestjs/graphql` 14 dropped the legacy protocol; all six apps use it (reference/01 §4). | no |
| D10 | Uploads and media | `uploadImageToS3(image)` accepts a base64 data URL (≤ 5 MB, jpeg/png/webp, magic-byte checked), stores it through `MediaStore` (local disk in development/test, S3 in production) and returns `{ imageUrl }` as `<PUBLIC_BASE_URL>/media/<key>`. `GET /media/:key` serves it. | reference/01 §5.3, reference/03 §2.13. | no |
| D11 | Maps proxy | `GET /maps/{autocomplete,place-details,reverse-geocode}` through a `MapsProvider` port; Google adapter in production. With no key configured the routes return HTTP 503 and the documented envelope with `status: "REQUEST_DENIED"`. | reference/01 §5.1. | no |
| D12 | Payments | COD works end to end. Stripe Checkout behind a `PaymentProvider` port; `paymentMethod: "STRIPE"` is rejected with `BAD_USER_INPUT` "Card payments are not available" until Stripe sandbox keys exist. PayPal is rejected the same way (both clients' PayPal paths are broken upstream; reference/01 §5.2 P4, P7). | No mock success. | **OWNER** (provider accounts) |
| D13 | Email, SMS, push | `EmailSender`, `SmsSender`, `PushSender` ports. Production adapters are SendGrid/SMTP, Twilio and FCM/Expo, blocked on credentials. In `APP_ENV` `development` and `test` only, an `OutboxSender` writes messages to the `DevOutbox` table so tests and local runs can read OTPs; `readConfig` refuses `OutboxSender` in production. | Real delivery needs provider inputs; tests must not fake success. | **OWNER** (provider accounts) |
| D14 | Recorded frontend edits | Exactly the edits in `01-wave0-foundation.md` Task C7, each recorded in `SOURCE_PROVENANCE.json`. | Hard-coded upstream URLs and telemetry (reference/01 §6). | no |
| D15 | Legacy FairBite operations | `serviceInfo`, `registerCustomer`, `loginPassword`, `refreshSession`, `logoutSession`, `logoutAllSessions`, `me`, `catalog*`, `customerAddresses`, `*CustomerAddress` are removed from the served schema at the end of Wave 1. Their services and tests are reused by L1/L3/L4. | No app calls them. | no |
| D16 | Old phase plan | `docs/EXECUTION_PLAN.json` FB05–FB20 and the status JSONs are superseded by this plan. Wave 4 Task R9 rewrites `IMPLEMENTATION_STATUS.json` from the gates in §8. | Avoid two sources of truth. | no |

## 3. Architecture

```
            ┌─────────────── implementation/vendor/enatega-ui (unchanged UI) ───────────────┐
            │ admin (Next)  web (Next)  singlevendor-admin (Next)  app  store  rider (Expo)  │
            └──────┬───────────────┬───────────────────────────────────┬───────────────────┘
          HTTP POST /graphql   WS /graphql (graphql-ws / graphql-transport-ws)   REST /maps /stripe /media
                   │               │                                   │
   ┌───────────────▼───────────────▼───────────────────────────────────▼──────────────────┐
   │ services/api (NestJS)                                                                │
   │  kernel/  public-access gate · auth context · errors · limits · not-implemented     │
   │           ids · money · time · geo · pagination · pubsub · ws server · transitions  │
   │  modules/ identity platform vendors catalog discovery customers support orders      │
   │           pricing dispatch tracking chat finance payments notifications analytics   │
   │  rest/    maps · stripe · media · health                                            │
   └──────┬───────────────────────────┬──────────────────────────────┬────────────────────┘
          │ Prisma / SQL              │ Redis (pub/sub, rate limits) │ BullMQ
   ┌──────▼──────┐             ┌──────▼──────┐               ┌───────▼────────────────────┐
   │ Postgres 17 │             │  Redis 7    │               │ services/worker            │
   │ + PostGIS   │             └─────────────┘               │ timeouts · notifications · │
   └─────────────┘                                           │ ledger postings · cleanup  │
                                                             └────────────────────────────┘
```

### 3.1 Request pipeline (HTTP)

1. `helmet`, CORS (origins from `CORS_ORIGINS`; allowed headers `content-type, authorization, nonce, bop-auth, userid, isauth, x-client-type, x-platform, accept, accept-language, x-skip-public-auth`), JSON body limit `GRAPHQL_BODY_LIMIT` (default `1mb`).
2. `PublicAccessGate` (D7) — runs before Apollo; rejects with HTTP 403 and the exact messages in reference/01 §2.5 S9.
3. Apollo context: `{ requestId, ip, headers, auth: AuthContext | null, loaders }`. `AuthContext` is resolved lazily from `Authorization: Bearer <jwt>`; an invalid or expired token yields HTTP 401 and `INVALID_TOKEN`/`TOKEN_EXPIRED` only when a resolver asks for auth (`requireAuth`).
4. Validation rules: `operationLimits` (depth ≤ 15, fields ≤ 600, definitions ≤ 60, aliases ≤ 30, at most one mutation root unless every root is in the batch allow-list). Limits are measured against the largest app document by the Wave 1 contract test, so they never reject a real app document.
5. Resolvers → module services → repositories (Prisma or SQL for PostGIS).
6. `formatError`: allow-listed codes and messages only (§4.3); everything else becomes `INTERNAL_SERVER_ERROR` "GraphQL request failed". HTTP status mapping in §4.3.

### 3.2 WebSocket pipeline

`kernel/ws/server.ts` listens for `upgrade` on the Nest HTTP server for path `/graphql` and picks the protocol from `Sec-WebSocket-Protocol`. Both protocols run `subscribe()` on the same executable schema obtained from `GraphQLSchemaHost` after `app.init()`. `connection_init` payload (`connectionParams`) supplies `authorization`; it may be `""`. Keep-alive `ka` every 15 s for the legacy protocol (clients drop after 30 s without one).

### 3.3 Module boundaries

Each module directory contains `module.ts`, `resolver.ts` (thin; argument parsing with zod, auth checks, calls service), `service.ts` (business rules), `repository.ts` (database), `mappers.ts` (DB row → GraphQL shape, money/time/geo conversion) and `index.ts` (public port implementation). A module may import another module **only** through `kernel/ports.ts` interfaces resolved by Nest DI tokens. This is what lets all lanes work in parallel.

## 4. Conventions (binding for every lane)

### 4.1 Repository layout

```
implementation/
  contracts/enatega/            # SDL, one file per lane + core.graphql + scalars.graphql
  services/api/
    prisma/schema/              # Prisma multi-file schema: base.prisma + one file per lane
    prisma/migrations/          # one migration per lane per wave, named <timestamp>_<lane>_<topic>
    src/kernel/                 # shared, owned by lead (W0-A)
    src/modules/<module>/       # owned by the lane listed in §6
    src/rest/                   # maps (L2), stripe (L7), media (L2)
    test/support/               # harness, owned by W0-C
    test/unit/<module>/         # *.spec.ts
    test/integration/<module>/  # *.integration.spec.ts (real Postgres + Redis)
    test/journeys/              # cross-lane journeys replaying exact app documents
  services/worker/src/jobs/<lane>/
  e2e/                          # Playwright (W0-C, then E2E lane)
  tools/                        # gates and generators
```

### 4.2 Naming

- GraphQL root fields, arguments, types and enum values: exactly as the apps send/select them, including upstream misspellings (`toggleAvailablity`, `updateRestaurantBussinessDetails`, `bussinessDetails`, `Deactivate`).
- DB tables: PascalCase singular (`Order`, `OrderItem`), columns camelCase, money columns end in `Minor`, timestamps end in `At` and are `timestamptz(3)`.
- Every GraphQL object with an id exposes `_id: ID!`. Where an app also reads `id`, expose both.

### 4.3 Errors

All errors are created with `kernel/errors.ts` helpers. Allowed codes, HTTP status and default message:

| Code | HTTP | Message (default) | Used for |
|---|---|---|---|
| `BAD_USER_INPUT` | 200 | specific, user-facing | validation and business-rule failures |
| `NOT_FOUND` | 200 | "Resource not found" | missing or not-visible entity |
| `UNAUTHENTICATED` | 401 | "Unauthenticated" | protected operation without a user token |
| `TOKEN_EXPIRED` | 401 | "Access token expired" | expired user JWT |
| `INVALID_TOKEN` | 401 | "Invalid token" | bad signature, wrong type, revoked session |
| `FORBIDDEN` | 403 | "Forbidden" | authenticated but not permitted or not owner |
| `PUBLIC_ACCESS_DENIED` | 403 | "Unauthorized: <reason>" (reference/01 §2.5 S9) | handshake failures |
| `RATE_LIMITED` | 200 | "Too many attempts, try again later" | rate limits |
| `CONFLICT` | 200 | specific | optimistic-concurrency and duplicate-claim failures |
| `NOT_IMPLEMENTED` | 200 | "<operation> is not available yet" | operations not yet built (never success) |
| `SERVICE_UNAVAILABLE` | 503 | "Service unavailable" | dependency down |
| `PROVIDER_UNAVAILABLE` | 200 | specific ("Card payments are not available") | provider not configured (D12, D13) |
| `INTERNAL_SERVER_ERROR` | 500 | "GraphQL request failed" | anything else |

Business messages must never contain the words `unauthorized`, `unauthenticated`, `jwt expired`, `invalid token` or `forbidden` (the customer app re-mints its public token on them; reference/02 §0.3). Exact strings the apps match on are owned by the lane that emits them and are listed in that lane's plan (for example, "Sorry! we can't deliver to your address." in L5).

### 4.4 Auth and ownership

- `requireAuth(ctx, ...types)` returns `AuthContext { userId, type, sessionId, permissions, restaurantIds, vendorId, riderId }` or throws.
- `requirePermission(ctx, permission)` for STAFF (18 permission strings, reference/04 §1.6). ADMIN passes every check.
- Ownership is checked in the **service**, never trusted from arguments: any `restaurantId`, `storeId`, `riderId`, `userId`, `vendorId` argument must belong to the caller unless the caller is ADMIN/STAFF with the matching permission (reference/04 §B is the matrix; each lane plan restates its rows).
- Field-level restriction: `Restaurant.bussinessDetails`, wallet fields, `User.notificationToken` and all secret configuration fields resolve to `null` for callers without the right role.

### 4.5 Time, geo, ids

- `kernel/time.ts`: `isoString(date)` for lifecycle timestamps; `epochMillisString(date)` for review and support-ticket timestamps (reference/02 §0.5). Each SDL field documents which one it uses.
- `kernel/geo.ts`: points are GeoJSON `{ type: "Point", coordinates: [lng, lat] }`; polygons `[[[lng, lat], …]]` closed rings; opening times `{ day, times: [{ startTime: ["HH","MM"], endTime: ["HH","MM"] }] }`. Inputs may arrive as numeric strings; parse with `parseCoordinate`.
- `kernel/ids.ts`: `newId()` (UUIDv7), `parseId(value, field)` (throws `BAD_USER_INPUT`), human order ids `orderPrefix + base-36 sequence` via a database sequence.

### 4.6 Pagination

`kernel/pagination.ts` exposes `paginate({ page, limit, maxLimit })` and adapters `p1`…`p6` for the seven shapes in reference/04 §4. Defaults: `page = 1`, `limit = 10`, `maxLimit = 100`. Every paginated resolver uses it.

### 4.7 Testing rules

- TDD: write the failing test first, see it fail for the right reason, then implement.
- Unit tests (`test/unit`) use no network, database or clock (inject `Clock`).
- Integration tests (`test/integration`) start Postgres (`postgis/postgis:17-3.5`) and Redis (`redis:7-alpine`) through `test/support/stack.ts`, apply all migrations, and call the real HTTP/WS API with the **exact app documents** loaded by `test/support/documents.ts` from `vendor/enatega-ui`.
- Every integration test that exercises an operation declares it: `describe(op("mutation.placeOrder"), …)`. The operation-coverage gate (§8) reads these tags.
- Every lane delivers, per operation: happy path, auth failure, ownership failure, validation failure, and every business rule in its lane plan.
- No snapshot tests of whole responses; assert specific fields.
- Coverage: `@vitest/coverage-v8`, thresholds enforced from Wave 0 onward per directory: `src/kernel/**` and `src/modules/**` lines ≥ 90 %, branches ≥ 85 %, functions ≥ 90 %. Coverage is merged from unit + integration runs (`pnpm coverage`).

### 4.8 Commits and branches

- One branch per lane per wave: `wave<N>/<lane>-<topic>`, created from the latest integration branch `enatega-ui-backend`.
- Commit after every green TDD cycle. Messages: `<type>(<lane>): <summary>`, ending with the attribution line required by the session.
- A lane never edits files owned by another lane (§6). Shared-file changes (`core.graphql`, `kernel/**`, `prisma/schema/base.prisma`, `tools/**`) are requested from the lead in the handoff report.

## 5. Lanes

| Lane | Name | Modules | Ops | Plan |
|---|---|---|---|---|
| L0 | Platform kernel | `kernel/**`, `rest/health` | 1 (`metricsGeneral`) + transport | `01-wave0-foundation.md` |
| L1 | Identity & sessions | `identity`, `staff` | 31 | `10-lane-L1-identity.md` |
| L2 | Platform configuration & reference data | `platform` (configuration, versions, geo reference, cuisines, shop types, banners, tips, taxes, zones, audit, uploads, activity), `rest/maps`, `rest/media` | 54 | `11-lane-L2-platform.md` |
| L3 | Vendors, restaurants, catalog & discovery | `vendors`, `catalog`, `discovery`, `reviews`, `coupons` | 75 | `12-lane-L3-vendors-catalog.md` |
| L4 | Customers, addresses, favourites & support | `customers`, `support` | 22 | `13-lane-L4-customers-support.md` |
| L5 | Orders, pricing & lifecycle | `pricing`, `orders` | 24 | `14-lane-L5-orders.md` |
| L6 | Dispatch, riders, tracking & chat | `dispatch`, `tracking`, `chat` | 32 | `15-lane-L6-dispatch.md` |
| L7 | Payments, ledger & finance | `finance`, `payments`, `rest/stripe` | 11 + REST | `16-lane-L7-finance.md` |
| L8 | Notifications & messaging providers | `notifications`, worker `jobs/notifications` | 5 + ports | `17-lane-L8-notifications.md` |
| L9 | Dashboards & analytics | `analytics` | 9 | `18-lane-L9-analytics.md` |
| L10 | E2E & app integration | `e2e/**`, `test/journeys/**`, recorded frontend edits | — | `01` (C-tasks), `20` |
| L11 | QA (independent) | review only | — | `20`, `21` |
| L12 | Single-vendor (gated) | `singlevendor` | 70 | `22-wave5-single-vendor.md` |
| L13 | Security (independent) | review only | — | `21` |

The full operation list per lane is `OPERATION_LANES.json`; each lane plan also lists its operations in a table.

## 6. File ownership

| Path | Owner |
|---|---|
| `contracts/enatega/core.graphql`, `scalars.graphql`, `kernel.graphql` | lead (written in W0-A / W1-0) |
| `contracts/enatega/<lane>.graphql` | that lane |
| `services/api/prisma/schema/base.prisma` | lead |
| `services/api/prisma/schema/<lane>.prisma` | that lane |
| `services/api/prisma/migrations/*_<lane>_*` | that lane |
| `services/api/src/kernel/**` | L0 (lead after Wave 0) |
| `services/api/src/kernel/ports.ts` | lead (W1-0); lanes request changes |
| `services/api/src/modules/<module>/**` | lane in §5 |
| `services/api/src/rest/maps.*`, `rest/media.*` | L2 |
| `services/api/src/rest/stripe.*` | L7 |
| `services/api/test/support/**` | W0-C (lead after Wave 0) |
| `services/api/test/unit/<module>/**`, `test/integration/<module>/**` | lane |
| `services/api/test/journeys/**`, `e2e/**` | L10 |
| `services/worker/src/jobs/<lane>/**` | lane |
| `tools/**`, root configs, `package.json`, `turbo.json`, `pnpm-workspace.yaml` | lead |
| `vendor/enatega-ui/**` | L10 only, only the edits in D14, recorded |
| `docs/**` status files | lead |

## 7. Waves and parallelism

```
Wave 0  Foundation ──────────── W0-A kernel+transport ─┐
                                W0-B contract tooling ──┼─► lead integrates ─► gate G0
                                W0-C test+E2E harness ──┘
Wave 1  Contract & data model ─ W1-0 core SDL+ports+base schema (1 agent)
                               └► W1-L1..L9 lane SDL + Prisma + NOT_IMPLEMENTED (9 agents in parallel) ─► gate G1
Wave 2  Domain build ────────── L1 L2 L3 L4 L5 L6 L7 L8 L9 (9 agents in parallel, against ports + factories)
                                L10 writes Playwright specs as each lane's operations land
                                L11 reviews each lane PR ─► gate G2 (per lane)
Wave 3  Journeys & E2E ──────── L10 full journeys (admin, web, mobile document replays) + fixes by owning lanes ─► gate G3
Wave 4  Hardening & release ─── providers (blocked on inputs) · L13 security · perf · native device gate ─► gate G4
Wave 5  Single-vendor (gated) ─ L12 ─► gate G5
```

Why Wave 2 can be fully parallel: after Wave 1 every SDL type, every table and every cross-module port exists. A lane's integration tests seed other lanes' tables directly through `test/support/factories.ts` (generated in W1 from the Prisma schema) and call other lanes only through ports, which have in-memory fakes in `test/support/fakes/` for unit tests. Real cross-lane behaviour is proven in Wave 3.

Estimated agent count at peak: 9 lane agents + 1 E2E agent + 1 QA reviewer + lead = 12.

## 8. Gates

A gate passes only when every command listed exits 0 on a clean checkout, the evidence is recorded in `docs/GATES.json` (command, commit, timestamp, summary), and an independent reviewer (L11/L13) has approved. No agent approves its own work.

| Gate | Commands and conditions |
|---|---|
| G0 | `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:integration`, `pnpm coverage` (thresholds met), `pnpm check:enatega-ui-source`, `pnpm test:enatega-contracts`, `pnpm e2e:smoke` (admin and web load, `metricsGeneral` handshake succeeds, `configuration` query returns, legacy and new WebSocket protocols both deliver a test subscription). |
| G1 | G0 plus `pnpm check:enatega` reports `staticCompatibility: PASS` for every multivendor document (single-vendor documents may only fail on L12 roots), `pnpm check:operations` shows all 334 roots present in the schema and every unimplemented root returning `NOT_IMPLEMENTED`, all migrations apply on an empty database, `pnpm codegen:check`. |
| G2 (per lane) | G1 plus, for the lane: every operation in `OPERATION_LANES.json` implemented, ≥ 1 tagged integration test per operation covering the cases in §4.7, coverage thresholds met for the lane's directories, lane Playwright specs green, QA approval. |
| G3 | All G2 gates, `pnpm test:journeys` (every journey in plan 20), `pnpm e2e` (full Playwright suites for admin and web), `pnpm check:operations --require-e2e` (every multivendor operation exercised by a journey or Playwright test), API coverage under E2E ≥ 80 % lines. |
| G4 | G3 plus security review closed, dependency audit has no high/critical advisories, load test targets met, provider sandbox tests for every configured provider, native device runs (Android emulator + one physical device per mobile app) recorded, release checklist signed. |
| G5 | G1–G4 for L12 operations and the single-vendor admin. |

## 9. Handoff template (send to every lane agent)

```
You are implementing lane <Lx> (<name>) of the Enatega-compatible backend.

Read first, in order:
1. implementation/AGENTS.md and the root AGENTS.md.
2. implementation/docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md (§1 boundary, §2 decisions, §4 conventions, §6 ownership).
3. Your lane plan: implementation/docs/superpowers/plans/2026-10-08-enatega-backend/<file>.
4. The reference sections your plan cites (reference/01..04).

<paste §1 Frontend boundary verbatim>

Rules:
- Work on branch wave<N>/<lane>-<topic> from enatega-ui-backend.
- Only edit the files your lane owns (§6). Ask the lead for anything else.
- TDD for every task: failing test, run it, implement, run it, commit.
- Use the exact app documents through test/support/documents.ts; never hand-write a document an app already sends.
- Tag every integration test with op("<type>.<name>").
- Never return fake success; unbuilt behaviour returns NOT_IMPLEMENTED or PROVIDER_UNAVAILABLE.
- Do not approve your own work. Finish with: commands run and their output summary, files changed, operations completed, open questions, and blockers.
```

## 10. Blockers known today

| Blocker | Affects | Needed from |
|---|---|---|
| Docker Desktop requires sign-in to the `theaccessgroup` organisation; image pulls fail with HTTP 407 | all integration tests, local stack, E2E | owner (sign in to Docker Desktop) |
| `~/.npmrc` references unset `ADO_NPM_TOKEN`; registry installs hang | adding new dependencies | owner (set token or remove the entry); offline installs work today |
| Stripe sandbox keys, webhook secret, Stripe Connect | L7 card payments, `stripe/account` | owner |
| Twilio, SendGrid/SMTP, Firebase (FCM web + native files), Expo push | L8, OTP delivery in production | owner |
| Google Maps server key | L2 maps proxy, L3/L6 distance and ETA | owner |
| S3 bucket (or approved object store) | L2 media in production | owner |
| Android emulator / physical devices, Apple developer account | native gate G4 | owner |
| Decisions D1, D4, D5, D6, D12, D13 | as listed | owner |

## 11. Self-review checklist (lead, before each gate)

- Every operation in `OPERATION_LANES.json` for the wave has an owner, an SDL entry, a resolver or `NOT_IMPLEMENTED`, tests and a coverage-gate entry.
- `pnpm check:enatega` is green for the wave's scope.
- No file outside `vendor/enatega-ui` edits list changed under `vendor/` (`pnpm check:enatega-ui-source`).
- No error message contains the forbidden words (§4.3) — enforced by `tools/check-error-messages.mjs` (W0-B).
- `docs/GATES.json` updated with real command output.
