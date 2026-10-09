# Wave 4 — Hardening, providers and release

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` first. Gate G3 must have passed.

> **Precedence notice (2026-10-09).** `implementation/docs/ROADMAP.md` is the single roadmap and outranks this
> file for scope, scheduling, ownership and gates; this file remains authoritative for its own task detail.
> `L10`, `L11` and `L13` are **retired identifiers** — they were never lanes in `OPERATION_LANES.json`. Read
> `L10` as **W15** for journey suites (`test/journeys/**`), **W16** for Playwright (`e2e/**`), and the matching
> frontend workstream **W12/W13/W14a/W14b** for edits inside a `vendor/enatega-ui/` package; `L11` as **W23**
> (independent QA) and `L13` as **W24** (independent security). Operation counts come from
> `docs/OPERATION_LANES.json`, not from prose. See `ROADMAP.md` §4.0.

**Goal:** Take the G3-verified system to a releasable state: real providers in sandbox, independent security review closed, dependency advisories resolved, performance and resilience targets met, observability in place, recorded frontend configuration edits for native builds done, native device runs recorded, and status documents rewritten from evidence.

**Architecture:** No new product behaviour. Provider adapters already exist behind ports (L2, L7, L8); this wave configures them, proves them against sandboxes, and hardens operations. Work runs in four parallel tracks: **R-sec** (L13), **R-perf** (lead + one agent), **R-prov** (L7/L8/L2 owners), **R-native** (L10).

**Tech stack:** as master plan, plus k6 for load tests, OpenTelemetry SDK for traces/metrics, pino for structured logs.

## Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

---

## Track R-sec — security review (L13, independent; may not have written any reviewed code)

### Task R1: Threat model and review checklist

**Files:**

- Create: `docs/security/THREAT_MODEL.md`
- Create: `docs/security/REVIEW_2026-W4.md`

- [ ] Write the threat model with these assets and entry points: user/rider/owner credentials and sessions, public-access tokens, payment flows and webhooks, ledger, personal data (addresses, phones, emails, chat), uploads/media, admin configuration secrets, WebSocket subscriptions, maps proxy, worker/outbox. For each: threats (STRIDE), existing controls (file:line), gaps.
- [ ] Review each item below and record pass/fail with evidence (test name or file:line):
  1. Every resolver calls `requireAuth`/`requirePermission`/`requireOwnership` per the lane plan's operation table — verify with `tools/check-authz.mjs` (Task R2).
  2. Every subscription authorises at subscribe time and filters each event by audience (customer owns order, store owns restaurant, rider assigned/zone, admin permission).
  3. No secret configuration field is returned by any query, subscription payload, audit `changes`, log line or error (grep + test `test/integration/security/secrets.integration.spec.ts`).
  4. Prices, totals, delivery fee, tax, commission and ledger postings are server-computed; client amounts other than `tipping` are ignored (tests in L5/L7).
  5. Ledger immutability: database rejects UPDATE/DELETE on journal tables; every entry balances (constraint test).
  6. Rate limits on login, OTP send/verify, password reset, `metricsGeneral`, uploads, maps proxy, location updates, chat.
  7. Upload validation: size, magic bytes, re-encoding or strict content type, no path traversal in media keys, `Content-Disposition` and `X-Content-Type-Options: nosniff` on `/media`.
  8. Webhook signature verification and replay protection (timestamp tolerance, event id idempotency).
  9. JWT: algorithm pinned HS256, `exp` enforced, session revocation honoured, refresh rotation reuse detection revokes the family.
  10. CORS exact origins; no credentials; production rejects `http` origins.
  11. Query limits and body limits prevent resource exhaustion; WebSocket message size limit and per-connection subscription cap (default 50).
  12. SQL: only parameterised queries (`tools/check-sql.mjs` greps for template-literal SQL with interpolations outside an allow-list of identifier helpers).
  13. Logs: no tokens, passwords, OTPs, full card data, full phone/email (masking helper in `kernel/log.ts`).
  14. Dependency audit: `pnpm audit --prod` and the vendored apps' `npm audit --omit=dev`; record advisories (the four high and four moderate from the earlier audit must be resolved or formally accepted with justification).
- [ ] File each failure as a task for the owning lane; re-review fixes; close the review only when all items pass.

### Task R2: Authorization coverage tool

**Files:**

- Create: `tools/check-authz.mjs` + `tools/check-authz.test.mjs`
- Create: `docs/AUTHZ_MATRIX.json` (generated)

- [ ] Write the failing test with a fixture resolver file containing one method that calls `requirePermission(…, "Riders")`, one calling `requireAuth(…, "CUSTOMER")`, and one with no guard; expect the tool to report the third as `UNGUARDED` unless its operation is listed as public in `docs/AUTHZ_MATRIX.json`.
- [ ] Implement: TypeScript AST over `services/api/src/modules/**/resolver.ts`; for each `@Query/@Mutation/@Subscription` method, follow calls into the same file's service methods one level deep and record the guard calls and their arguments; compare with the expected matrix generated from the lane plans' operation tables (each lane plan's table is copied into `docs/AUTHZ_MATRIX.json` by the lead at G2). Fail on any operation whose guard differs from the matrix or is missing.
- [ ] Add `pnpm check:authz` to `tools/verify.mjs`.
- [ ] Commit `feat(tools): verify resolver authorization against the matrix`.

### Task R3: Security regression suite

**Files:**

- Create: `services/api/test/integration/security/*.integration.spec.ts`

- [ ] One spec per checklist item 2, 3, 5, 6, 7, 8, 9, 11 with concrete attacks: subscribe to another customer's `subscriptionOrder(id)` and expect no events; rider calls `updateOrderStatusRider` on an order assigned to another rider → `FORBIDDEN`; restaurant owner calls `acceptOrder` on another restaurant's order → `FORBIDDEN`; replayed refresh token revokes the family; webhook with bad signature → 400 and no state change; 6 MB upload → `BAD_USER_INPUT`; SVG with script → rejected; 51st subscription on one socket → error; `UPDATE "JournalLine"` → database error.
- [ ] Commit `test(security): add regression suite for review findings`.

---

## Track R-perf — performance, resilience and observability

### Task R5: Observability

**Files:**

- Create: `services/api/src/kernel/log.ts`, `services/api/src/kernel/telemetry.ts`
- Modify: `services/api/src/app.ts`, `services/worker/src/main.ts`

- [ ] `kernel/log.ts`: pino logger with redaction paths (`req.headers.authorization`, `req.headers["bop-auth"]`, `*.password`, `*.otp`, `*.token`, `*.secretKey`, `*.clientSecret`, `*.twilioAuthToken`), request id propagation, masking helpers `maskEmail`, `maskPhone`.
- [ ] `kernel/telemetry.ts`: OpenTelemetry tracing for HTTP, GraphQL resolvers (operation name, root field, duration, error code), Prisma/pg, Redis, BullMQ; metrics: request rate/latency per root field, error rate per code, active WebSocket connections and subscriptions, outbox lag (oldest unprocessed `DomainEvent`), job failures. Exporter via `OTEL_EXPORTER_OTLP_ENDPOINT`; disabled when unset.
- [ ] Health: `/health/ready` also checks outbox lag < 60 s and migration state.
- [ ] Tests: unit test that redaction removes each sensitive path; integration test that a resolver error is logged with request id and code but without the token.
- [ ] Commit `feat(L0): add structured logging, tracing and metrics`.

### Task R6: Load and resilience tests

**Files:**

- Create: `perf/k6/*.js`, `perf/README.md`, `perf/seed.ts`

Targets (single API instance, 2 vCPU, Postgres and Redis local): p95 < 250 ms for `nearByRestaurantsPreview`, `restaurant`, `fetchCategoryDetailsByStoreId`, `orders`; p95 < 500 ms for `placeOrder`; 500 concurrent legacy WebSocket subscriptions with event fan-out latency p95 < 500 ms; 50 rider location updates/s sustained; zero errors other than expected rate limits.

- [ ] k6 scenarios: browse (handshake + configuration + discovery + menu), checkout (COD placeOrder from 50 virtual customers), store (subscribePlaceOrder + acceptOrder), rider (location updates + subscriptionZoneOrders + assignOrder race), admin (paginated lists and dashboards).
- [ ] Resilience: kill Redis during the store scenario → API stays up, subscriptions reconnect after Redis returns, no lost outbox events (all delivered once); kill one of two API instances → clients reconnect to the other, events still delivered; Postgres failover simulation (restart) → readiness goes false then true, requests fail with `SERVICE_UNAVAILABLE` not 500.
- [ ] Record results in `docs/PERFORMANCE.md` with commit and hardware; fix regressions in the owning lane.
- [ ] Commit `test(perf): add load and resilience scenarios`.

### Task R7: Data protection and retention

- [ ] Backups: document `pg_dump` schedule and restore drill; run the restore drill and record it.
- [ ] Retention jobs (worker): rider location history older than 30 days deleted; DevOutbox purged after 7 days (development only); chat images retained with orders; anonymised deleted users keep orders.
- [ ] Data export/delete request runbook for customers (GDPR/PDPA-style), using L4 `deleteUser` anonymisation.
- [ ] Commit `feat(ops): add retention jobs and data protection runbook`.

---

## Track R-prov — providers in sandbox (blocked on owner inputs, master §10)

### Task R8: Provider sandbox suites

For each provider with credentials supplied, run the lane's sandbox suite (each lane plan defines it; suites skip when env vars are absent) and record results in `docs/PROVIDERS.md`:

| Provider                                    | Lane  | Env vars                                                                  | Suite                                 |
| ------------------------------------------- | ----- | ------------------------------------------------------------------------- | ------------------------------------- |
| Stripe Checkout + webhooks + Connect        | L7    | `STRIPE_TEST_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID` | `test/sandbox/stripe.sandbox.spec.ts` |
| SendGrid or SMTP                            | L8    | `SENDGRID_API_KEY` or `SMTP_URL`                                          | `test/sandbox/email.sandbox.spec.ts`  |
| Twilio SMS                                  | L8    | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`                  | `test/sandbox/sms.sandbox.spec.ts`    |
| FCM HTTP v1 / Expo push                     | L8    | `FCM_SERVICE_ACCOUNT_JSON`, `EXPO_ACCESS_TOKEN`                           | `test/sandbox/push.sandbox.spec.ts`   |
| Google Maps (Places, Geocoding, Directions) | L2/L6 | `GOOGLE_MAPS_SERVER_KEY`                                                  | `test/sandbox/maps.sandbox.spec.ts`   |
| S3 media                                    | L2    | `MEDIA_S3_BUCKET`, `AWS_*`                                                | `test/sandbox/media.sandbox.spec.ts`  |
| Google / Apple sign-in                      | L1    | `GOOGLE_CLIENT_IDS`, `APPLE_SERVICE_ID`                                   | `test/sandbox/social.sandbox.spec.ts` |

- [ ] Enter provider credentials in the deployment secret store only (never in the repo, never in client config). The admin configuration screens (L2) receive only the values that are public by design.
- [ ] Run the Playwright card-payment scenario from plan 20 with Stripe sandbox and record it.

---

## Track R-native — native builds and device gate (L10)

### Task R4: Recorded configuration edits for native and release builds

- [ ] Perform edits E2–E7 from `01-wave0-foundation.md` Task C7, one commit each, each with its failing check first (grep that the upstream literal is present), the minimal edit, the `allowedModifications` entry, the regenerated manifest and `pnpm check:enatega-ui-source`.
- [ ] Generate Fair's own Firebase application files per environment (`google-services.json`, `GoogleService-Info.plist`) from the owner's Firebase project and place them outside the vendored tree, copied in by the build script `tools/native/prepare.mjs` (never committed under `vendor/`).

### Task R9: Native device runs

- [ ] Build development clients for `enatega-multivendor-app`, `enatega-multivendor-store`, `enatega-multivendor-rider` (EAS local build or `expo run:android`), with `EXPO_PUBLIC_*` pointing at the API (`adb reverse tcp:4100 tcp:4100`).
- [ ] Run the Maestro flows defined in plan 20 on an Android emulator and on one physical Android device; iOS simulator if an Apple developer account is available.
- [ ] Record videos, logs and the GraphQL log from the API in `docs/native/`; any failure is a backend bug for the owning lane or a recorded configuration edit.

---

## Release

### Task R10: Rewrite status documents from evidence

- [ ] Confirm `docs/IMPLEMENTATION_STATUS.json`, `docs/ROADMAP_STATUS.md` and the `README.md` status lines carry only generated values (the former `EXECUTION_PLAN.json` and `FULL_IMPLEMENTATION_REPORT.json` are archived under `docs/history/`), extending them where needed with values generated from `docs/GATES.json`, `docs/OPERATION_COVERAGE.json`, `docs/PERFORMANCE.md`, `docs/PROVIDERS.md` and `docs/security/REVIEW_2026-W4.md` by `tools/status-report.mjs` (write it with a test asserting that every number in the output comes from those inputs).
- [ ] Remove stale claims (six-app shells, 190/30/5/36 test counts, Colima instructions).

### Task R11: Gate G4

- [ ] `pnpm verify --integration --coverage --e2e --record G4` plus `pnpm check:authz`, security suite, perf results within targets, provider suites for every configured provider, native runs recorded.
- [ ] Release checklist signed by lead, QA (L11) and security (L13): versions pinned, migrations reviewed, rollback plan (database migrations are forward-only; app rollback by image tag; feature flags for card payments), runbooks (on-call, incident, provider outage), monitoring dashboards live.
