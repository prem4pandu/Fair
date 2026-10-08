# FairBite / Enatega end-to-end implementation plan

**Status:** planning artifact, owner-reviewable. It supersedes the scheduling portions of
`docs/EXECUTION_PLAN.json` and the narrative status files; it does **not** supersede the
per-lane runbooks in `docs/superpowers/plans/2026-10-08-enatega-backend/`, which remain the
task-level detail.

**Date:** 2026-10-08 · **Baseline commit:** `c814670` (+ uncommitted in-flight work listed in §1.3)

**Authority and precedence when documents disagree**

1. `AGENTS.md` (root and `implementation/`) — owner directives, frontend boundary, engineering invariants.
2. This plan — scope, workstreams, roster, waves, gates, evidence rules.
3. `docs/superpowers/plans/2026-10-08-enatega-backend/*` — per-lane task detail and reference behaviour.
4. `docs/OPERATION_LANES.json` — which lane owns which operation.
5. `docs/OPERATION_TRACEABILITY.md` (generated) — the per-operation state of record.
6. `docs/ENATEGA_COMPATIBILITY_REPORT.json`, `docs/ENATEGA_URL_CONTRACT.json`,
   `docs/END_TO_END_ACCEPTANCE.json`, `docs/BACKEND_MODULE_PLAN.json` — machine-readable requirements.
7. Everything else under `docs/` — historical evidence. **`docs/IMPLEMENTATION_STATUS.json`,
   `docs/FULL_IMPLEMENTATION_REPORT.json` and `docs/IMPLEMENTATION_STATUS.html` are stale and must not be
   quoted as current** until regenerated in W0.

---

## 1. Verified current state (day 0)

### 1.1 What the repository is

| Layer                                    | Location                                                                                          | State                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Product UI (pinned upstream, unmodified) | `implementation/vendor/enatega-ui/` — 6 packages, 4137 files, 118.7 MB, SHA-256 manifest verified | source complete; **not installed, not built, not integrated, not runnable** |
| GraphQL/REST/WS backend                  | `implementation/services/api` (NestJS + Apollo + Prisma)                                          | schema-complete-looking, ~6 % of operations implemented                     |
| Worker                                   | `implementation/services/worker` (BullMQ outbox)                                                  | 6 unit tests green; no domain jobs                                          |
| Contracts                                | `implementation/contracts/enatega/*.graphql` (4327 lines, 448 types, 280 root fields)             | static compatibility PASS                                                   |
| Tooling/gates                            | `implementation/tools/*` (21 scripts)                                                             | strong; 6 gates currently red, 3 blocked                                    |

### 1.2 Gate scoreboard, re-run 2026-10-08 21:38–21:48

| Gate                                  | Command                                       | Result                                                          |
| ------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| API unit/HTTP                         | `./tools/pnpm.sh --filter @fairbite/api test` | ✅ 160 tests / 23 files                                         |
| Worker unit                           | `./tools/pnpm.sh test` (worker leg)           | ✅ 6 tests                                                      |
| Build                                 | `./tools/pnpm.sh build`                       | ✅ 4 tasks                                                      |
| Typecheck                             | `./tools/pnpm.sh typecheck`                   | ✅ 6 tasks                                                      |
| Codegen vs frozen SDL                 | `./tools/pnpm.sh codegen:check`               | ✅                                                              |
| Static Enatega compatibility          | `./tools/pnpm.sh check:enatega`               | ✅ 5 apps, 439/439 documents valid, 0 missing roots             |
| Vendor source integrity               | `./tools/pnpm.sh check:enatega-ui-source`     | ✅ 4137 files, manifest hash verified                           |
| Contract/gate tool tests              | `./tools/pnpm.sh test:enatega-contracts`      | ✅ 14 tests                                                     |
| Evidence-format tool tests            | `./tools/pnpm.sh test:operation-evidence`     | ✅ 12 tests                                                     |
| Workspace test                        | `./tools/pnpm.sh test`                        | ❌ `packages/identity-contracts/src/operations.test.ts`         |
| Lint                                  | `./tools/pnpm.sh lint`                        | ❌ 1 error, `services/api/src/dispatch/routing.ts:17`           |
| Tool tests                            | `node --test tools/*.test.mjs`                | ❌ 36/37 — `docs/IMPLEMENTATION_STATUS.html` stale              |
| Backend browser smoke                 | `./tools/pnpm.sh e2e:backend`                 | ❌ 3/4                                                          |
| Coverage (unit+integration, per-file) | `./tools/pnpm.sh coverage`                    | ❌ 87.68 % lines / 88.01 % funcs / 79.82 % branches vs 90/90/85 |
| Operation evidence gate               | `./tools/pnpm.sh check:operations`            | ❌ 0/334 operations evidenced                                   |
| Integration (PostGIS/Redis)           | `./tools/pnpm.sh test:integration`            | ⛔ blocked — Colima daemon stopped                              |
| Native device E2E                     | —                                             | ⛔ blocked — no devices; CommandLineTools only                  |
| Provider sandbox                      | —                                             | ⛔ blocked — no credentials                                     |

### 1.3 In-flight uncommitted work (do not discard)

| Area                       | Files                                                                                                                                                  | Assessment                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L5 order domain            | `services/api/src/orders/{pricing,state-machine,checkout,persistence}.ts`, `prisma/schema/L5-orders.prisma`, `prisma/migrations/202610090150_L5_init/` | sound domain logic (integer minor units, 0 % core commission, actor-authorised transitions, balanced CHECK constraints); **no resolver/module yet**; 19 unit tests green |
| L6 dispatch domain         | `services/api/src/dispatch/{types,routing,assignment,location,events}.ts`                                                                              | domain-only; provider path fails honestly; 13 unit tests green; `routing.ts` has the lint error                                                                          |
| Address contract alignment | `contracts/enatega/{core,L4-customers-support}.graphql`, `tools/{generate-sdl.mjs,type-map.json}`, `services/api/test/addresses.integration.spec.ts`   | exact `AddressInput!`/`[ID!]!` shapes for the five Enatega address mutations + real-Postgres test that cannot run until Docker is up                                     |

### 1.4 Root causes of the red gates (all small, all fixable in W0)

1. `pnpm test` broke at `0d51466` (19:30) when `contracts/foundation.graphql` changed `type Query` → `extend type Query`
   to avoid duplicate roots in the in-process schema. The codegen-facing `contracts/*.graphql` set now has no base
   `Query`/`Mutation`, so `operations.test.ts` cannot build a schema. This is a **contract packaging defect**, not a
   product defect.
2. `pnpm lint` fails on an unused parameter in a brand-new untracked file.
3. `e2e:backend` broke at `463f2d5` (19:52) when `placeOrder` legitimately entered the SDL; the boundary spec still
   asserts "unknown document". The API's actual behaviour (`data.placeOrder = null` + `NOT_IMPLEMENTED`) is correct.
4. `docs/IMPLEMENTATION_STATUS.html` and the two JSON status files describe a 16:18 checkpoint (190 tests, 36 browser
   tests, "noncompliant shells") that no longer exists.
5. Coverage misses are concentrated in files with **zero** tests: `kernel/auth/sessions.ts`, `main.ts`,
   `kernel/public-access/resolver.ts`, `kernel/ws/server.ts`, plus partial coverage in `legacy-protocol.ts`,
   `pubsub.ts`, `pagination.ts`, `public-access/gate.ts`.
6. `check:operations` is red by design: the evidence file is a template with 334 unverified records.

### 1.5 Real scope, quantified

| Measure                                           | Count                                                                                                                                                                            | Source                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Pinned UI packages / tracked files                | 6 / 4137 (118.7 MB)                                                                                                                                                              | `vendor/enatega-ui/SOURCE_MANIFEST.json` |
| Statically extracted root operations              | **334** (159 query, 164 mutation, 11 subscription)                                                                                                                               | `docs/ENATEGA_OPERATION_INVENTORY.json`  |
| Multivendor operations (runtime scope through G4) | 263                                                                                                                                                                              | `docs/OPERATION_LANES.json`              |
| Single-vendor operations (gated)                  | 71                                                                                                                                                                               | same                                     |
| GraphQL document sites validated                  | 439/439 valid, 0 unresolved                                                                                                                                                      | `docs/ENATEGA_COMPATIBILITY_REPORT.json` |
| Operations with a real resolver                   | **18** (L0 1, L1 8, L2 2, L3 2, L4 5)                                                                                                                                            | `docs/OPERATION_TRACEABILITY.md`         |
| Runtime root fields / bound resolvers             | 280 / 33                                                                                                                                                                         | generated from SDL + source scan         |
| Roots with no SDL declaration                     | 71 (all L12)                                                                                                                                                                     | traceability matrix                      |
| Handler candidates (upper bound on user actions)  | 3405 across 1095 files                                                                                                                                                           | `docs/ACTION_CANDIDATES.json`            |
| Acceptance workflows                              | 18                                                                                                                                                                               | `docs/END_TO_END_ACCEPTANCE.json`        |
| Phase gates FB00–FB20                             | 21 (FB00–FB04 partial)                                                                                                                                                           | `docs/EXECUTION_PLAN.json`               |
| Customer web routes audited                       | 40                                                                                                                                                                               | `docs/ENATEGA_URL_CONTRACT.json`         |
| Non-GraphQL REST requirements                     | 6 (`/maps/autocomplete`, `/maps/place-details`, `/maps/reverse-geocode`, `/stripe/create-checkout-session`, `/stripe/create-web-checkout-session`, `/stripe/account`, `/paypal`) | same                                     |
| WebSocket protocols required                      | 2 on one path (`graphql-ws` legacy + `graphql-transport-ws`)                                                                                                                     | same                                     |
| Per-operation evidence recorded                   | **0/334**                                                                                                                                                                        | `docs/OPERATION_TEST_EVIDENCE.json`      |

---

## 2. Definition of done

### 2.1 Owner boundary (verbatim; must appear in every frontend/mobile handoff)

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns
> the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation,
> screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/
> adapters, secure session handling, validated data mapping, configuration and centralized display-name imports.
> Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under
> `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches.
> An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success,
> never fabricate data, never call the upstream Enatega production backend.

### 2.2 Product definition of done

1. All six pinned apps build and run against our stack with **no active upstream Enatega/Google/Firebase/EmailJS/
   Clarity endpoint**, no provider secret in a client, and no fabricated data anywhere.
2. Every one of the 334 operations is either: implemented with the exact upstream name/arguments/selection shape, or
   returns an explicit `NOT_IMPLEMENTED`/`PROVIDER_UNAVAILABLE` for a documented, owner-visible blocker.
3. All 18 acceptance workflows in `docs/END_TO_END_ACCEPTANCE.json` pass with the positive **and** negative cases listed there.
4. Web workflows are proven by Playwright against the real stack; native workflows by signed device runs. Expo exports
   and browser smoke never satisfy a native gate.
5. Every operation carries traceable evidence (test + artifact + reviewer) in `docs/OPERATION_TEST_EVIDENCE.json`;
   `pnpm check:operations --require-complete` exits 0.
6. Independent QA, architecture and security review are closed; no self-approval.
7. `docs/IMPLEMENTATION_STATUS.json` is regenerated from real gate output and states the truth, including remaining blockers.

### 2.3 Engineering invariants (binding for every workstream)

Integer minor units and server-owned pricing · zero core-plan food commission · immutable balanced financial
journals · central order-state validation · server-side tenant/actor ownership · provider-independent delivery
routing · no card data and no embedded provider secrets in clients · sandbox providers explicitly named and disabled
in production · at-least-once outbox with idempotent consumers · no mock success · no production fallback to upstream.

---

## 3. Target architecture

### 3.1 Runtime topology

```
vendor/enatega-ui (unchanged presentation)
  customer-web · admin-web · singlevendor-admin            (Next.js, build-time NEXT_PUBLIC_* config)
  customer-app · store-app · rider-app                     (Expo/React Native, app.config.js + env)
        │  POST /graphql      WS /graphql (2 protocols)      REST: /maps/* /stripe/* /paypal /media/*
        ▼
services/api  NestJS 12 + Apollo 5 + graphql-js 16 + Prisma 7
  kernel/    public-access gate · auth context · limits · errors · money · ids · time · geo ·
             pagination · pubsub · ws server · outbox · unit-of-work · not-implemented fill
  modules/   identity · staff · platform · vendors · catalog · discovery · reviews · coupons ·
             customers · support · pricing · orders · dispatch · tracking · chat · finance ·
             payments · notifications · analytics
  rest/      maps · stripe · media · health
        │ Prisma/pg                                  │ Redis 7 (pub/sub, limits, BullMQ)
        ▼                                            ▼
  PostgreSQL 17 + PostGIS                      services/worker (timeouts, ledger, notifications, dispatch)
```

### 3.2 Backend structure (already specified; keep it)

`docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md` §3 governs the request pipeline, WebSocket
pipeline, module boundaries (`module/resolver/service/repository/mappers` + ports-only cross-module calls),
conventions (§4), error codes (§4.3), auth/ownership (§4.4), and money/time/geo/pagination helpers.

### 3.3 Frontend integration architecture (the missing half)

The six apps stay byte-identical except for **recorded** integration edits. Integration is layered:

| Layer                       | What changes                                                                                                                                                                                                                                                                 | Where                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-A Origin configuration    | Remove every hard-coded upstream fallback; read one validated origin set per app (`*_SERVER_URL`, `*_WS_SERVER_URL`, REST base, media base) from build-time env with fail-closed validation                                                                                  | customer app `environment.config.js`, store `environment.ts`, rider `app.config.js`, admin `lib/utils/constants/url.ts`, web `environment.ts`, `next.config.mjs` |
| L-B Transport adapters      | Keep Apollo/WebSocketLink; point them at configured origins; fix the PayPal base-URL concatenation defect and trailing-slash handling; keep both WS protocols                                                                                                                | `*/src/apollo/*`, `*/lib/api/*`                                                                                                                                  |
| L-C Session bridge          | Replace client-owned long-lived tokens with the secure session contract: web keeps HttpOnly same-origin BFF cookies (already proven for addresses), native uses platform secure storage + short-lived access tokens; refresh/logout/revocation semantics unchanged in the UI | `lib/context/*`, `src/context/*`, `*/apollo/auth*`                                                                                                               |
| L-D Public bootstrap        | Implement the `metricsGeneral`/`bop-auth` handshake server-side (already exists) and keep the client code path; never contact upstream                                                                                                                                       | server-side; client unchanged                                                                                                                                    |
| L-E Provider gating         | Gate Clarity, EmailJS, Firebase, Google Maps, Stripe/PayPal, push behind configuration; when unconfigured, the UI must show the honest unavailability the backend returns, without new screens                                                                               | `app/layout.tsx`, provider modules, `next.config.mjs` CSP                                                                                                        |
| L-F Data mapping validation | Validate every backend response at the adapter boundary where the upstream code assumes a shape; drop unknown fields safely; never synthesise values                                                                                                                         | adapter files only                                                                                                                                               |

**Hard rules:** no new component, screen, route, style or asset; no removal of upstream screens to hide a missing
backend; any edit is listed in `SOURCE_PROVENANCE.json → allowedModifications` and followed by
`node tools/manifest-enatega-ui.mjs`; the manifest is a **lead-serialised** file.

### 3.4 Frontend run strategy (decision D-F1)

The vendor packages each ship their own `package-lock.json` and three share the npm name `enatega-frontend`, so they
**cannot** be added to the root pnpm workspace (`pnpm-workspace.yaml`: `packages/*`, `services/*`) without renaming
pinned files. Therefore:

- Install and run each package **in place, with npm, from its own lockfile** (`npm ci` inside
  `vendor/enatega-ui/<pkg>`). `node_modules`, `.next`, `.expo`, `dist` are already excluded from
  `SOURCE_MANIFEST.json`, so this does not break `check:enatega-ui-source`.
- Per-app local configuration lives in untracked `.env.local` / `app.config.local.js` files (never committed; the
  manifest skips `.env*`).
- Fallback if in-place install proves unusable: isolated copies under `.toolchain/<pkg>` (as previously prototyped for
  customer web) with a documented sync rule; this is a fallback, not the plan.
- Disk/time cost: 6 × React/Next/Expo dependency trees, roughly 5–8 GB total; install per batch, not all at once.

### 3.5 Frontend integration surface — audited 2026-10-08

The full per-package audit is **`docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md`** (static, read-only, all six packages,
24 numbered blockers, backend capability table). It is the input to W12–W14 and must be amended as edits land.

The findings that change this plan:

1. **The pinned tree is not pristine upstream.** It already contains a hand-written adapter layer (env/mode endpoint
   resolvers, a Next.js maps proxy, client `nonce`/`bop-auth` token services, a background-location transport) with
   internal hardening IDs, and `vendor/enatega-ui/SOURCE_PROVENANCE.json` has **no `allowedModifications` key** while
   the root file records only the four Firebase binding files. **W2 must reconcile the baseline before any frontend
   edit**: classify every adapter artifact as upstream or Fair-authored, record the Fair-authored ones, or restore
   upstream bytes.
2. **Every request in every app depends on one handshake.** `metricsGeneral` returns the public token in `experience`
   and its ISO expiry in `hehe`, bound to a client `nonce` and replayed as `bop-auth: Bearer`. The three web apps call
   it as a **query**, the customer app as a **mutation** — the server must accept both, or login screens fail.
3. **All six clients speak the legacy `subscriptions-transport-ws` frame set** under the `graphql-ws` subprotocol
   name. A `graphql-transport-ws`-only server breaks every dashboard, store subscription and rider tracking flow.
4. **Non-GraphQL surface that a GraphQL-only backend misses:** three `maps/*` REST routes, three `stripe/*` REST
   routes, `/media/<key>` serving **signed** URLs (the mobile client parses CloudFront/S3 signatures and expires its
   disk cache), base64 `uploadImageToS3(image, publicMedia?)`, `saveRestaurantToken`/`saveNotificationTokenWeb`,
   Live Activity session roots, and `updateRiderLocation` posted directly from a native background task.
5. **Upstream endpoints and credentials are still live in the tree:** customer app and store hard-code
   `aws-server-v2.enatega.com` with no env override; all three production EAS profiles bake the upstream railway host;
   upstream Firebase web credentials sit in four public files; a live Sentry DSN is hard-coded in rider source.
6. **Build friction:** the three web packages require Node `>=20` with `.nvmrc v20.16.0`, and both admins set
   `engine-strict=true`, so `npm install` **fails under the repo's Node 24** unless the engine check is relaxed for
   those installs. They also share the npm name `enatega-frontend` and span Next 14/16 and React 18/19.
7. **Security decisions raised by the audit:** the admin client decrypts config fields with a `NEXT_PUBLIC_*` key
   (obfuscation, not secrecy); it reads `secretKey`/`clientSecret`/`twilioAuthToken` that the query deliberately does
   not return and must **not** be made to return; customer web carries password-reset tokens in the URL; single-vendor
   admin bypasses the backend geocoder with a browser-exposed Google key.
8. **Web push cannot work today:** customer web needs `FIREBASE_VAPID_KEY` but the config query does not select
   `vapidKey`.

---

## 4. Workstream map

`Ops` = statically extracted operations owned. `Scope` = files the owner may write; outside it, request the change
from the owner named in §5.4.

### 4.1 Wave 0 — make the baseline green and instrumented

| ID     | Workstream                             | Owner role | Scope                                                                                                                                                        | Depends |
| ------ | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **W0** | Baseline repair + gate instrumentation | lead       | `contracts/*.graphql`, `contracts/enatega/**`, `tools/**`, `services/api/src/dispatch/routing.ts`, `e2e/backend/**`, `docs/**`, `package.json`, `turbo.json` | —       |

W0 task list (each ends with the exact command that proves it):

| #     | Task                                                                                                                                                                             | Proof                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| W0-1  | Introduce an explicit codegen root contract (base `Query`/`Mutation`/`Subscription` for the standalone `contracts/*.graphql` set) so both codegen and `operations.test.ts` build | `pnpm codegen:check`, `pnpm test`                         |
| W0-2  | Fix the unused parameter in `services/api/src/dispatch/routing.ts`                                                                                                               | `pnpm lint`                                               |
| W0-3  | Rewrite `e2e/backend/boundaries.spec.ts`: genuinely unknown root ⇒ no `data`; `placeOrder` ⇒ `NOT_IMPLEMENTED` + null; keep origin/malformed coverage                            | `pnpm e2e:backend` 4/4                                    |
| W0-4  | Regenerate `docs/IMPLEMENTATION_STATUS.html`; rewrite `IMPLEMENTATION_STATUS.json` and `FULL_IMPLEMENTATION_REPORT.json` from real commands (no inherited numbers)               | `node --test tools/*.test.mjs` 37/37                      |
| W0-5  | Add `tools/check-error-messages.mjs` (+ test) enforcing forbidden business-error words                                                                                           | new gate green                                            |
| W0-6  | Add `tools/check-operation-traceability` wiring + `pnpm traceability:check` for the generated matrix                                                                             | `pnpm traceability:check`                                 |
| W0-7  | Fix `OPERATION_LANES.json` self-inconsistency (L1 31/30, L12 70/71) at the generator, then regenerate                                                                            | regenerated file consistent                               |
| W0-8  | Add the missing E2E/coverage gates to `package.json`: `e2e:smoke`, `test:journeys`, `coverage:e2e`                                                                               | commands exist and fail honestly until implemented        |
| W0-9  | `docs/GATES.json` registry + `tools/record-gate.mjs` so every gate records command/commit/timestamp/result                                                                       | file written by real runs                                 |
| W0-10 | Start Colima and re-run the full integration + coverage gate on the day-0 tree                                                                                                   | `pnpm test:integration`, `pnpm coverage` results recorded |
| W0-11 | Commit the in-flight L5/L6 domain work behind green tests (no resolvers yet)                                                                                                     | clean tree, tests green                                   |

### 4.2 Wave 1 — foundation and contract freeze

| ID     | Workstream                                                                                                                                                                                                                                        | Owner role       | Ops    | Scope                                                                                                                                                 | Depends |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **W1** | Kernel/transport completion: legacy + modern WS frame sets, `metricsGeneral` as query **and** mutation with `nonce`/`bop-auth` binding, Redis pub/sub, limits proven against the largest real document, health/readiness, outbox worker hardening | backend-kernel   | 1 (L0) | `services/api/src/kernel/**`, `services/worker/**`, `test/support/**`                                                                                 | W0      |
| **W2** | Contract + data-model freeze: L12 SDL gap closed (71 roots have no declaration), migration from the populated 005 baseline, ports interface freeze, dynamic-document reconciliation, **vendor baseline/provenance reconciliation**                | backend-contract | —      | `contracts/enatega/**`, `prisma/schema/base.prisma`, `prisma/migrations/**`, `kernel/ports.ts`, `vendor/enatega-ui/SOURCE_PROVENANCE.json` (via lead) | W0      |

W2 exit criteria: `pnpm check:enatega` PASS for multivendor **and** single-vendor scope; every migration applies both on
an empty database and as an upgrade from the populated baseline with no data loss; `docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json`
accounts for every previously unresolved site; ports reviewed by the lead; **every Fair-authored artifact in the vendor tree
is either recorded in `SOURCE_PROVENANCE.json → allowedModifications` or reverted to the upstream bytes**, and
`pnpm check:enatega-ui-source` still passes.

### 4.3 Wave 2 — domain lanes (backend)

| ID      | Lane | Workstream                                                                                                                                                                                                     | Owner role | Ops | Write scope                                                                                                                                                  | Depends           |
| ------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **W3**  | L1   | Identity, roles, staff scopes, MFA, recovery, OTP/social                                                                                                                                                       | agent-L1   | 30  | `src/identity/**`, `src/staff/**`, `test/{unit,integration}/identity/**`, `contracts/enatega/L1-*.graphql`, `prisma/schema/L1-*.prisma`                      | W2                |
| **W4**  | L2   | Platform config + 3 `rest/maps` routes + `rest/media` with **signed** URLs + `uploadImageToS3(image, publicMedia?)`; configuration surface that supplies display names/currency/toggles and **never** a secret | agent-L2   | 54  | `src/platform/**`, `src/rest/maps*`, `src/rest/media*`, `test/{unit,integration}/platform/**`, `contracts/enatega/L2-*.graphql`, `prisma/schema/L2-*.prisma` | W2                |
| **W5a** | L3   | Vendors/outlets/onboarding/publication/hours/media                                                                                                                                                             | agent-L3a  | ~38 | `src/vendors/**`, `contracts/enatega/L3-*.graphql`, `prisma/schema/L3-*.prisma`, matching tests                                                              | W2                |
| **W5b** | L3   | Catalog items, variations, addons, discovery, search, reviews, coupons                                                                                                                                         | agent-L3b  | ~37 | `src/catalog/**`, `src/discovery/**`, `src/reviews/**`, `src/coupons/**`, matching tests                                                                     | W2, W3 (identity) |
| **W6**  | L4   | Customers, addresses, favourites, support tickets, messages, privacy lifecycle                                                                                                                                 | agent-L4   | 22  | `src/customers/**`, `src/support/**`, `contracts/enatega/L4-*.graphql`, `prisma/schema/L4-*.prisma`, matching tests                                          | W2, W3            |
| **W7**  | L5   | Cart, quotes, pricing policy versions, immutable orders, lifecycle                                                                                                                                             | agent-L5   | 24  | `src/orders/**`, `src/pricing/**`, `contracts/enatega/L5-*.graphql`, `prisma/schema/L5-*.prisma`, matching tests                                             | W6                |
| **W8**  | L6   | Dispatch, own fleet, assignment, rider state, tracking, chat, realtime; `updateRiderLocation` usable from the rider's native background task with hand-rolled headers                                          | agent-L6   | 32  | `src/dispatch/**`, `src/tracking/**`, `src/chat/**`, `contracts/enatega/L6-*.graphql`, `prisma/schema/L6-*.prisma`, matching tests                           | W7                |
| **W9**  | L7   | Payments, Stripe REST, ledger, refunds, payables, settlements, payout webhooks                                                                                                                                 | agent-L7   | 11  | `src/finance/**`, `src/payments/**`, `src/rest/stripe*`, `contracts/enatega/L7-*.graphql`, `prisma/schema/L7-*.prisma`, matching tests                       | W7                |
| **W10** | L8   | Notifications, push/email/SMS ports, worker jobs, chat media; `saveRestaurantToken`, `saveNotificationTokenWeb`, Live Activity session roots (`registerLiveActivitySession`, `removeLiveActivitySession`)      | agent-L8   | 5   | `src/notifications/**`, `services/worker/src/jobs/notifications/**`, `contracts/enatega/L8-*.graphql`, `prisma/schema/L8-*.prisma`                           | W8                |
| **W11** | L9   | Dashboards, reports, analytics                                                                                                                                                                                 | agent-L9   | 9   | `src/analytics/**`, `contracts/enatega/L9-*.graphql`, `prisma/schema/L9-*.prisma`                                                                            | W9, W7            |

Lane rules: TDD; exact upstream documents via `test/support/documents.ts`; `describe(op("mutation.x"))` tagging on
every integration test; happy path + auth + ownership + validation + every lane business rule; no cross-lane imports
except through `kernel/ports.ts`; migrations are requested from the lead, never authored concurrently.

### 4.4 Wave 2F — frontend integration (parallel with backend lanes)

| ID       | Workstream                                                                                                                       | Owner role       | Scope (vendor packages)                                                                             | Depends                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- | --------------------------------- |
| **W12**  | Customer web integration (39–40 routes): origin config, CSP, session bridge, provider gating, `vapidKey` gap, adapter validation | agent-FE-web     | `vendor/enatega-ui/enatega-multivendor-web/**`                                                      | W2, W3, W4, W6 (contracts frozen) |
| **W13**  | Admin web + single-vendor admin integration: roles/capabilities, config, catalog admin, reports, finance views                   | agent-FE-admin   | `vendor/enatega-ui/enatega-multivendor-admin/**`, `vendor/enatega-ui/enatega-singlevendor-admin/**` | W2, W3, W4, W5a                   |
| **W14a** | Customer mobile integration (Expo): env/origin, secure token storage, deep links, permissions, provider gating                   | agent-FE-app     | `vendor/enatega-ui/enatega-multivendor-app/**`                                                      | W2, W3, W6                        |
| **W14b** | Store mobile + rider mobile integration                                                                                          | agent-FE-mobile2 | `vendor/enatega-ui/enatega-multivendor-store/**`, `vendor/enatega-ui/enatega-multivendor-rider/**`  | W2, W3, W5a, W8 (schema)          |

Frontend lanes may start as soon as W2 freezes contracts (including the §3.5 provenance reconciliation); they do not
wait for every resolver, because an unbuilt operation must already fail honestly (`NOT_IMPLEMENTED`) and the UI must
render that truthfully.

**Every frontend lane's first task is its own package audit** in the shape of
`docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md` §2 (only customer web had one before), followed by
`30-frontend-integration.md`. Lane deliverables always include: no upstream origin reachable from the built bundle,
provider scripts gated, deep links/permissions preserved, and the recorded-edit list handed to the lead.

**Node engine note (D-F4):** the three web packages declare Node `>=20` (`.nvmrc v20.16.0`) and both admins set
`engine-strict=true`, so their installs need either a Node 20 toolchain or a per-package `.npmrc` override; this is an
installation decision, not a licence to edit pinned manifests.

**Serialisation point:** after each frontend batch the lead updates root `SOURCE_PROVENANCE.json` and re-runs
`node tools/manifest-enatega-ui.mjs` + `pnpm check:enatega-ui-source`. Frontend agents never write those two files.

### 4.5 Wave 3 — journeys, Playwright, coverage

| ID      | Workstream                                                                                     | Owner role | Scope                                                           | Depends       |
| ------- | ---------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- | ------------- |
| **W15** | Cross-lane journey suites replaying exact app documents (`test/journeys/**`)                   | agent-E2E  | `services/api/test/journeys/**`, `test/support/**` (by request) | W7–W11        |
| **W16** | Playwright web E2E: customer web, admin web, single-vendor admin against the real stack (§6)   | agent-E2E  | `e2e/**`, `playwright*.config.ts`, `e2e/fixtures/**`            | W12, W13, W15 |
| **W17** | Coverage closure: per-file 90/90/85 for `kernel/**` + `modules/**`, ≥ 80 % API lines under E2E | agent-CQ   | test files only, per owning lane by request                     | W15, W16      |

### 4.6 Wave 4 — providers, native, hardening, release

| ID      | Workstream                                                                                                                                            | Owner role      | Depends                    | Blocking inputs                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------- | ------------------------------ |
| **W18** | Provider adapters + sandbox evidence: Stripe (checkout/webhooks/Connect), Lalamove-style courier adapter, Google Maps, push/email/SMS, object storage | agent-providers | W9, W10                    | credentials                    |
| **W19** | Native device E2E for the three mobile apps (permissions, background location, push, deep links, offline/reconnect, signed builds)                    | agent-native    | W14a, W14b                 | devices, Apple/Google accounts |
| **W20** | Hardening: security review closure, dependency advisories, load/concurrency/outage, backup-restore, retention/SLO, observability/redaction            | agent-hardening | W17                        | SLO/hosting inputs             |
| **W21** | Single-vendor mode (L12, 71 ops) including its SDL, resolvers, admin app                                                                              | agent-L12       | W2, W16, owner decision D1 | owner approval                 |
| **W22** | Release package: regenerated status docs, gate registry, owner acceptance run                                                                         | lead            | all                        | owner approval                 |

### 4.7 Continuous lanes

| ID      | Workstream                               | Owner role   | Rule                                                                            |
| ------- | ---------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| **W23** | Independent QA review                    | reviewer-QA  | Reviews every G2 lane before it is accepted; never reviews own work             |
| **W24** | Independent security/architecture review | reviewer-SEC | Reviews auth, payments, uploads, tenancy, WS, BFF, secrets, and every gate      |
| **W25** | Documentation & traceability upkeep      | lead         | Regenerates matrix + status docs at each gate; keeps `docs/GATES.json` truthful |

---

## 5. Multi-agent operating model

### 5.1 Concurrency

Run **lead + up to 4 writers** concurrently. Batches of 4 are safe because every lane's write scope is disjoint;
larger fan-out is possible for read-only work (reviewers, research) at any time.

```
Batch 1  W0 (lead, serial)                         → GP0
Batch 2  W1 + W2 (2 writers)                       → G0/G1
Batch 3  W3 + W4 + W5a + W6                        → per-lane G2 (first four lanes)
Batch 4  W5b + W7 + W12 + W13                      → G2 + frontend smoke
Batch 5  W8 + W9 + W14a + W14b                     → G2 + native build
Batch 6  W10 + W11 + W15                           → G2 + journeys
Batch 7  W16 + W17                                 → G3
Batch 8  W18 + W19 + W20                           → G4 (provider/device/hardening)
Batch 9  W21 + W22                                 → G5 + release
```

Reviewers (W23/W24) run continuously against the previous batch's output — a batch is not closed until its reviewer
approves, so overlapping review with the next batch's build is expected and required.

### 5.2 Disjoint write scopes (advisory lock, enforced by review)

| Path                                                                                                                                                     | Sole writer                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `contracts/enatega/core.graphql`, `contracts/*.graphql`, `tools/**`, root configs, `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | lead                                                         |
| `contracts/enatega/<lane>.graphql`, `prisma/schema/<lane>.prisma`                                                                                        | that lane                                                    |
| `prisma/migrations/**`                                                                                                                                   | lead (lanes submit reviewed SQL)                             |
| `services/api/src/kernel/**`, `src/rest/**` (except stripe)                                                                                              | W1                                                           |
| `services/api/src/<module>/**`, `test/{unit,integration}/<module>/**`                                                                                    | that lane                                                    |
| `services/api/test/support/**`                                                                                                                           | W1/W15 by request; lane-specific builders stay in lane tests |
| `services/worker/src/jobs/<lane>/**`                                                                                                                     | that lane                                                    |
| `vendor/enatega-ui/<pkg>/**`                                                                                                                             | the matching frontend lane                                   |
| `SOURCE_PROVENANCE.json`, `vendor/enatega-ui/SOURCE_MANIFEST.json`                                                                                       | lead only                                                    |
| `e2e/**`, `playwright*.config.ts`, `test/journeys/**`                                                                                                    | W15/W16                                                      |
| `docs/GATES.json`, `docs/IMPLEMENTATION_STATUS.*`, `docs/OPERATION_TRACEABILITY.md`                                                                      | lead only                                                    |

### 5.3 Task board protocol

Every unit of work is a shared task created **before** its owner starts, containing: subject, deliverable list,
write scope, dependencies, exact acceptance commands, and the evidence artifact path. Workflow: `list → get → claim
(revision) → implement → run acceptance → hand evidence to reviewer → complete`. A task whose acceptance command did
not actually run is never completed.

### 5.4 Handoff template (paste into every agent spawn)

```
You are <ID> (<name>) of the FairBite/Enatega end-to-end build.

Read, in order:
1. AGENTS.md (root) and implementation/AGENTS.md.
2. implementation/docs/MASTER_END_TO_END_PLAN.md — §2 definition of done, §4 your workstream,
   §5.2 your write scope, §7 test rules, §8 your gate.
3. implementation/docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md §1–§4 and §6.
4. Your lane plan: <plan file>.
5. implementation/docs/OPERATION_TRACEABILITY.md — the operations you own and their current state.

<frontend boundary §2.1 verbatim>

Rules:
- Write only inside your declared scope. Ask the lead for anything else; never overwrite another lane's files.
- TDD: failing test → run it → implement → run it → commit.
- Use the exact upstream documents from services/api/test/support/documents.ts. Never hand-write a document an app already sends.
- Tag every integration test with op("<type>.<name>").
- Never return fake success. Unbuilt behaviour returns NOT_IMPLEMENTED; unconfigured providers return PROVIDER_UNAVAILABLE.
- Add unit + integration tests and coverage in the same change as the implementation. A lane may not lower coverage.
- Run and report: typecheck, lint, your tests, coverage for your directories, and your gate command.
- Do not approve your own work. Finish with: commands + result summary, files changed, operations completed,
  per-operation evidence entries, open questions, blockers.
```

### 5.5 Review model

- Every implemented operation needs a reviewer different from its author.
- QA (W23) verifies the operation actually exercised by the named test and that artifacts match the commit.
- Security (W24) verifies: session/refresh/revocation, ownership derivation, tenant isolation, upload validation,
  secret handling, payment/webhook signature checks, WS subscription authorisation, BFF CSRF, log redaction.
- A gate may be marked `N/A` only with item, reason, scope, reviewer and replacement evidence recorded. Missing
  infrastructure is a failure or a blocker, never `N/A`.

---

## 6. Playwright and end-to-end test blueprint

### 6.1 Test layers

| Layer       | Command                                                                    | Coverage of what                                                           | Runtime              |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------- |
| Unit        | `pnpm test`                                                                | pure rules: money, state machines, mappers, validators, guards             | ms, no I/O           |
| Integration | `pnpm test:integration`                                                    | resolvers + Prisma + real PostGIS/Redis, real HTTP/WS, exact app documents | Testcontainers       |
| Contract    | `pnpm check:enatega`, `pnpm check:enatega-ui-source`, `pnpm codegen:check` | schema/document/vendor integrity                                           | seconds              |
| Journeys    | `pnpm test:journeys`                                                       | cross-lane sequences (identity→catalog→order→payment→dispatch→notify)      | real stack           |
| Web E2E     | `pnpm e2e` (Playwright)                                                    | the **original** web UIs against the real stack                            | browser + real stack |
| Native E2E  | device harness                                                             | mobile screens, permissions, background, push, deep links                  | devices              |
| Providers   | sandbox suites                                                             | Stripe/Lalamove/Maps/push/email/SMS adapters                               | sandbox              |

### 6.2 Playwright project layout

```
e2e/
  fixtures/        auth storage states, seeded tenants/catalog/orders, API client, DB reset helper
  customer-web/    public catalog, search, store/menu, cart, checkout, payments, tracking, profile, support
  admin-web/       auth/roles, vendors/outlets, catalog, orders/dispatch, users/staff, zones/config, reports, finance
  single-vendor/   same as admin, run with VENDOR_MODE=SINGLE (gated by D1)
  mobile-web/      Expo web smoke only (explicitly NOT a native gate)
  support/         page objects over the original DOM, selectors sourced from the pinned markup
playwright.config.ts        projects: chromium (required), firefox+webkit (best effort), mobile-web (smoke)
```

### 6.3 Spec-to-workflow mapping (each spec must cite its workflow id)

| Spec                                      | Workflow id(s)                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `customer-web/catalog-discovery.spec.ts`  | `merchant-catalog`, `discovery-address`                                               |
| `customer-web/addresses.spec.ts`          | `discovery-address`                                                                   |
| `customer-web/checkout-order.spec.ts`     | `checkout-order` (incl. concurrent placement, price tampering, stale quote)           |
| `customer-web/payment.spec.ts`            | `payment-webhook` (sandbox; honest unavailability when unconfigured)                  |
| `customer-web/tracking-history.spec.ts`   | `history-ratings`                                                                     |
| `customer-web/promotions-profile.spec.ts` | `promotions`, `identity`                                                              |
| `customer-web/support-privacy.spec.ts`    | `support-privacy`                                                                     |
| `admin-web/identity-roles.spec.ts`        | `identity`, `administration`                                                          |
| `admin-web/catalog.spec.ts`               | `merchant-catalog`                                                                    |
| `admin-web/orders-dispatch.spec.ts`       | `merchant-fulfillment`, `delivery-webhook`, `rider-delivery`                          |
| `admin-web/finance.spec.ts`               | `payables`, `refund`                                                                  |
| `admin-web/config-observability.spec.ts`  | `configuration`                                                                       |
| `parity/operation-reachability.spec.ts`   | `full-parity` — every operation reachable or explicitly reviewed as deferred          |
| `parity/a11y-responsive.spec.ts`          | `full-parity` (keyboard, focus order, responsive breakpoints, no placeholder success) |

### 6.4 Suite rules

1. **Real stack only.** Specs run against API + worker + PostgreSQL/PostGIS + Redis started by the managed stack tool;
   never against mocks or the upstream production backend.
2. **Seeding** is explicit and idempotent: fixtures create their own tenant/outlet/catalog/user/order rows and clean
   up after themselves; no demo seed in the product database.
3. **Data isolation** per worker (one database per Playwright worker, or schema-per-worker) — `fullyParallel` is only
   enabled once isolation is proven.
4. **Auth** uses real sessions captured to Playwright storage state; token storage in the app must already be the
   secure bridge (§3.3 L-C).
5. **Negative cases are mandatory** per workflow (cross-tenant, expired, forged, duplicate, concurrent, provider-down).
6. **Artifacts**: trace on failure, screenshot on failure, video retained for provider/native-adjacent flows;
   stored under `test-results/` and referenced from `docs/GATES.json`.
7. **Flake policy**: any retry must be justified in the spec; a quarantined spec is a blocker, not a pass — the
   upstream `retries: 0` stance is kept.
8. **Network guard**: a test fails if any request leaves for an upstream Enatega/Google/Firebase/EmailJS/Clarity host.
9. **Accessibility/responsive** checks run inside the parity spec, not as a separate optional suite.

### 6.5 Native blueprint

| App          | Harness                                                  | Gate evidence                                                                        |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| customer app | device/emulator + Maestro (or Detox) flows               | signed build, OTP/login, browse, cart, checkout, tracking, push, background location |
| store app    | same                                                     | accept/prepare/ready, hours/availability, order alerts                               |
| rider app    | same                                                     | claim, pickup, location updates, delivered, offline retry                            |
| all          | release-mode builds, deep links, permission denial paths | per-device artifact + recording                                                      |

Expo exports remain non-evidence.

### 6.6 Coverage strategy (added with the code, enforced continuously)

| Scope                                      | Threshold                                 | Measured by                                               |
| ------------------------------------------ | ----------------------------------------- | --------------------------------------------------------- |
| `src/kernel/**`, `src/modules/**` per file | 90 % lines, 90 % functions, 85 % branches | `pnpm coverage` (unit + real integration, merged)         |
| `services/worker/src/**`                   | same thresholds                           | worker coverage config                                    |
| API lines under Playwright E2E             | ≥ 80 %                                    | `pnpm coverage:e2e` (API instrumented during the E2E run) |
| Tools (`tools/**`)                         | 1 test per generator/checker              | `node --test tools/*.test.mjs`                            |
| Generated Prisma client                    | excluded                                  | config                                                    |

### 6.7 Day-0 coverage debt (measured 2026-10-08, `pnpm coverage`)

Global: 88.88 % lines, 87.51 % statements, 91.66 % functions, 80.89 % branches —
**27 files fail the per-file thresholds (44 failed checks)**. GP0 records this report;
closure is required by G3.

| Owner       | Files (worst first)                                                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 kernel   | `auth/sessions.ts` 0 % l, `ports.ts` 0 % l, `main.ts` 0 % l, `ws/server.ts` 51 % l / 47 % f / 0 % b, `ws/legacy-protocol.ts` 59 % b, `pubsub.ts` 70 % b, `ids.ts` 62 % b, `geo.ts` 80 % b, `public-access/gate.ts` 80 % b, `pagination.ts` 87 % l, `tokens.ts` 83 % b, `time.ts` 83 % b, `schema.ts` 75 % b, `http-status.plugin.ts` 75 % b, `outbox.ts` 88 % l |
| W7 orders   | `state-machine.ts` 60 % f / 78 % b, `checkout.ts` 77 % l, `persistence.ts` 87 % l / 79 % b                                                                                                                                                                                                                                                                      |
| W17 closure | final enforcement across `src/kernel/**` and `src/modules/**` at G3                                                                                                                                                                                                                                                                                             |

A lane that touches one of these files must bring it to threshold in the same change.
The instrumented run needs its own time budget: `vitest.coverage.full.config.ts` sets
`testTimeout: 180000` / `hookTimeout: 240000` because v8 instrumentation makes the
real-database suites materially slower than `pnpm test:integration`.

Rules: coverage ships **in the same change** as the implementation — a lane whose diff lowers any covered file's
coverage fails its gate. If a lane must land first, it opens a named coverage task owned by W17 with the exact file
list and the failing threshold; the wave cannot close with it open. "Later" is allowed only as a tracked task, never
as silence.

---

## 7. Gates

| Gate              | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GP0** (W0)      | `pnpm install --frozen-lockfile`, `lint`, `format:check`, `typecheck`, `build`, `test`, `test:integration`, `coverage:report`, `check:enatega-ui-source`, `test:enatega-contracts`, `test:operation-evidence`, `node --test tools/*.test.mjs`, `traceability:check`, `check:error-messages`, `e2e:backend` — all green on a clean tree; `docs/GATES.json` written; status docs regenerated truthful. **Coverage scope:** GP0 requires the coverage _report_ to be produced and recorded; the strict per-file thresholds (90/90/85) are enforced per lane at G2 and closed by W17 at G3, because the kernel is still being completed in W1 and a day-0 threshold would be measuring unfinished code |
| **G0** (W1)       | GP0 + `e2e:smoke` (admin + customer web load against the real stack, `metricsGeneral` handshake succeeds, `configuration` returns, both WS protocols deliver a subscription)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **G1** (W2)       | G0 + single-vendor and multivendor documents validate; every root present with either a resolver or explicit `NOT_IMPLEMENTED`; migrations clean on empty **and** upgrade-from-baseline; dynamic document sites fully classified; codegen matches                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **G2** (per lane) | G1 + every operation of the lane implemented, ≥ 1 tagged integration test per operation, negative cases, lane directories meet coverage, lane Playwright specs green, QA + security approved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **G3** (W15–W17)  | All G2 + `test:journeys` + full Playwright web suites + `check:operations --require-complete` + API E2E coverage ≥ 80 %                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **G4** (W18–W20)  | G3 + provider sandbox evidence, native device runs, security review closed, no high/critical advisories, load/outage/restore results, observability and redaction verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **G5** (W21–W22)  | G1–G4 for L12 and the single-vendor admin; owner release decision recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

`docs/GATES.json` entry schema: `{ gate, command, commit, startedAt, finishedAt, exitCode, summary, artifactPaths, reviewer, approved }`.

---

## 8. Sequence, effort and exit criteria

| Batch | Parallel writers   | Exit criterion                                            |
| ----- | ------------------ | --------------------------------------------------------- |
| 1     | W0 (lead)          | GP0 green, Colima up, in-flight work committed            |
| 2     | W1, W2             | G1                                                        |
| 3     | W3, W4, W5a, W6    | first four lane G2s                                       |
| 4     | W5b, W7, W12, W13  | L3/L5 G2 + customer and admin web load against real stack |
| 5     | W8, W9, W14a, W14b | L6/L7 G2 + three mobile apps build and run locally        |
| 6     | W10, W11, W15      | L8/L9 G2 + journeys green                                 |
| 7     | W16, W17           | G3                                                        |
| 8     | W18, W19, W20      | G4                                                        |
| 9     | W21, W22           | G5 + owner acceptance                                     |

**Order-of-magnitude effort** (agent-days, inherently an estimate): W0 ≈ 2; W1+W2 ≈ 12; W3–W11 ≈ 4–8 per lane
(L2/L3/L6/L7 at the top of the range) ≈ 50; W12–W14 ≈ 6–10 per app ≈ 45; W15–W17 ≈ 20; W18–W20 ≈ 25; W21 ≈ 15;
review overhead ≈ 25 % of build. Total ≈ **210–260 agent-days**; with lead + 4 writers and real review overhead,
roughly **14–20 working sessions/weeks**, dominated by provider, device and review gates that are not parallelisable away.

---

## 9. Risk register

| #   | Risk                                                                                                        | Impact                 | Mitigation                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| R1  | 334 operations vs 18 implemented; scope is 10× the current code                                             | schedule               | lane batches with per-operation evidence; traceability matrix shows truth continuously                          |
| R2  | Frontend install/build may not work under pnpm/Node 24 (npm lockfiles, Expo/Metro, duplicate package names) | blocks all UI gates    | D-F1 per-app npm in place; verify in W12 first; fallback documented                                             |
| R3  | Vendor edits + manifest regeneration collide across frontend agents                                         | broken provenance gate | single serialisation point owned by the lead; batches of ≤ 2 frontend writers                                   |
| R4  | Real payment/provider/device inputs absent                                                                  | G4 unreachable         | honest `PROVIDER_UNAVAILABLE`/blocked status; build everything up to the boundary                               |
| R5  | Schema-complete but behaviour-thin code could be mistaken for progress                                      | false status           | `NOT_IMPLEMENTED` everywhere by default; status docs generated from gates, never narrative                      |
| R6  | Silent clamping/interpretation in domain code (e.g. discount clamped to items total in `pricing.ts`)        | policy drift           | lane review must confirm each rule against upstream documents; reject vs clamp is an explicit decision          |
| R7  | Playwright suite against mutable upstream DOM                                                               | flakes                 | page objects sourced from pinned markup; `retries: 0`; quarantine is a blocker                                  |
| R8  | Migration drift across parallel lanes                                                                       | data loss              | migrations authored only by the lead; lanes submit reviewed SQL; upgrade test from populated baseline is a gate |
| R9  | Dependency advisories (4 high, 4 moderate per audit)                                                        | release blocker        | bump/quarantine in W20; re-audit at G4                                                                          |
| R10 | Docs drift (already happened once)                                                                          | wrong decisions        | every status doc generated from gate output; stale-file tests (`tools/*.test.mjs`) enforce                      |
| R11 | The vendor tree contains unrecorded adapter edits; the provenance gate is currently unprovable              | boundary breach        | W2 reconciles and records every Fair-authored artifact before any frontend edit                                 |
| R12 | Vendor web installs fail under Node 24 (`engine-strict=true`)                                               | frontend lanes stall   | D-F4 recipe verified in W12 before the other frontend lanes start                                               |
| R13 | Upstream credentials/hosts remain live in the tree (Firebase web keys, Sentry DSN, EAS profiles)            | security, owner breach | gated and removed by the owning frontend lane; the Playwright network guard fails any upstream-host request     |
| R14 | `metricsGeneral`/legacy-WS incompatibility blocks every app, including login                                | total UI blockage      | W1 owns it as the first transport gate; `e2e:smoke` proves both operation types and both WS frame sets          |
| R15 | Signed media URLs, Live Activity and background-location contracts are easy to miss in a GraphQL-only plan  | silent mobile breakage | capability checklist in `docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md` §5 drives W4/W8/W10                        |

---

## 10. Blockers and required external inputs

| Blocker                                                                                                                                                                                                                                                         | Affects                              | Needed from            | Work that can proceed without it                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------- | -------------------------------------------------------------- |
| Colima/Docker daemon stopped                                                                                                                                                                                                                                    | integration + coverage + E2E locally | owner (`colima start`) | everything not requiring a live database                       |
| Payment provider account, sandbox keys, webhook secret, Connect                                                                                                                                                                                                 | W9/W18, `payment-webhook`, `refund`  | owner                  | COD path, ledger, order lifecycle                              |
| Courier provider (Lalamove) market/API version/credentials                                                                                                                                                                                                      | W18, `delivery-webhook`              | owner                  | own-fleet dispatch (W8)                                        |
| Google Maps server key                                                                                                                                                                                                                                          | L2 maps REST, distance/ETA           | owner                  | owned text/coordinate addresses                                |
| Push/email/SMS credentials, storage bucket                                                                                                                                                                                                                      | W10, W18                             | owner                  | `DevOutbox` in dev/test only                                   |
| Android/iOS devices, signing accounts, full Xcode                                                                                                                                                                                                               | W19, G4                              | owner                  | web E2E and device-free lanes                                  |
| SLO/hosting/retention/budget/domain inputs                                                                                                                                                                                                                      | W20/W22                              | owner                  | all implementation                                             |
| Owner decisions D1, D4, D5, D6, D12, D13 (existing plan §2) + D-F1…D-F7, D-N1                                                                                                                                                                                   | scheduling                           | owner                  | default chosen in each case so a change touches one lane       |
| FairBite-owned EAS projects, signing identities, Firebase native binding files and provider keys for the three mobile apps (today Enatega's: `ascAppId` 1526488093/1526672537/1526674511, `appleTeamId GDFK7MVY6P`, upstream EAS project IDs and `updates.url`) | W14a/W14b, W19, G4                   | owner                  | all web work, all backend work, device-free mobile integration |

---

## 11. Owner decision register (delta over existing plan §2)

| #                        | Decision                                                                                                                          | Default now                                      | Reversible cost        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------- |
| D-F1                     | Frontend install/run strategy: per-app `npm ci` in place vs workspace membership vs `.toolchain` copies                           | per-app npm in place                             | one workstream re-run  |
| D-F2                     | Web session bridge: same-origin HttpOnly BFF cookies for all three web apps (already proven for addresses) vs bearer in memory    | BFF cookies for web, secure storage for native   | one adapter layer      |
| D-F3                     | Playwright browser scope: chromium required, firefox/webkit best-effort                                                           | chromium                                         | extra CI time          |
| D-F4                     | Web-package install under Node 24: per-package `.npmrc` relaxing `engine-strict` vs a Node 20 toolchain for vendor builds         | per-package `.npmrc`, pinned manifests untouched | one install recipe     |
| D-F5                     | Web push: extend the customer-web config query with `vapidKey` (recorded vendor edit) vs a backend field the client already reads | extend the query, recorded in provenance         | one query + one edit   |
| D-F6                     | Admin client-side AES-GCM config decryption with a public `NEXT_PUBLIC_*` key: keep vs move server-side                           | keep, and stop treating it as secrecy            | one adapter layer      |
| D-F7                     | Client-owned web tokens (`localStorage`) vs the BFF cookie bridge (D-F2) for the two admin apps                                   | BFF cookies for all three web apps               | one adapter layer      |
| D-N1                     | Native harness: Maestro (simpler, Expo-friendly) vs Detox                                                                         | Maestro                                          | one test-suite rewrite |
| D1, D4, D5, D6, D12, D13 | as recorded in the existing master plan §2                                                                                        | unchanged                                        | per-lane               |

---

## 12. Appendix

### 12.1 Commands (run from `implementation/`)

```
./tools/pnpm.sh install --frozen-lockfile
./tools/pnpm.sh lint && ./tools/pnpm.sh format:check && ./tools/pnpm.sh typecheck && ./tools/pnpm.sh build
./tools/pnpm.sh test
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock ./tools/pnpm.sh test:integration
./tools/pnpm.sh coverage
./tools/pnpm.sh codegen:check
./tools/pnpm.sh check:enatega
./tools/pnpm.sh check:enatega-ui-source
./tools/pnpm.sh test:enatega-contracts
./tools/pnpm.sh test:operation-evidence
./tools/pnpm.sh check:operations
./tools/pnpm.sh e2e:backend
node --test tools/*.test.mjs
node tools/generate-operation-traceability.mjs [--check]
node tools/manifest-enatega-ui.mjs [--check]
```

### 12.2 Artifact index

| Artifact                                                                       | Role                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `docs/MASTER_END_TO_END_PLAN.md`                                               | this plan                                                                                       |
| `docs/MASTER_PLAN.json`                                                        | machine-readable workstreams, batches, gates, scopes                                            |
| `docs/OPERATION_TRACEABILITY.md` + `tools/generate-operation-traceability.mjs` | per-operation state of record                                                                   |
| `docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md`                                   | full per-package frontend integration surface, 24 blockers, backend capability table            |
| `docs/OPERATION_LANES.json` / `docs/ENATEGA_OPERATION_INVENTORY.json`          | lane ownership and inventory                                                                    |
| `docs/ENATEGA_COMPATIBILITY_REPORT.json`                                       | static contract compatibility                                                                   |
| `docs/ENATEGA_URL_CONTRACT.json`                                               | REST/WS/route/navigation/hardcode requirements                                                  |
| `docs/END_TO_END_ACCEPTANCE.json`                                              | 18 workflows, invariants, evidence fields                                                       |
| `docs/OPERATION_TEST_EVIDENCE.json`                                            | per-operation evidence registry (gate input)                                                    |
| `docs/GATES.json` (W0-9)                                                       | gate run registry                                                                               |
| `docs/superpowers/plans/2026-10-08-enatega-backend/**`                         | per-lane task detail (L5–L8 and L12 are PARTIAL and must be completed before their lanes start) |
| `docs/artifacts/**`                                                            | test artifacts referenced by gates                                                              |

### 12.3 Per-lane plan readiness

| Lane             | Plan file                             | State                                                                   |
| ---------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| L0 kernel        | `01-wave0-foundation.md`              | complete (3856 lines)                                                   |
| L1               | `10-lane-L1-identity.md`              | complete                                                                |
| L2               | `11-lane-L2-configuration.md`         | complete                                                                |
| L3               | `12-lane-L3-catalog.md`               | complete                                                                |
| L4               | `13-lane-L4-discovery.md`             | complete                                                                |
| L5               | `14-lane-L5-orders.PARTIAL.md`        | **PARTIAL — complete before W7 starts**                                 |
| L6               | `15-lane-L6-dispatch.PARTIAL.md`      | **PARTIAL — complete before W8 starts**                                 |
| L7               | `16-lane-L7-finance.PARTIAL.md`       | **PARTIAL — complete before W9 starts**                                 |
| L8               | `17-lane-L8-notifications.PARTIAL.md` | **PARTIAL — complete before W10 starts**                                |
| L9               | `18-lane-L9-analytics.md`             | complete-draft                                                          |
| journeys/E2E     | `20-wave3-journeys-and-e2e.md`        | complete                                                                |
| hardening        | `21-wave4-hardening-and-release.md`   | complete                                                                |
| L12              | `22-wave5-single-vendor.PARTIAL.md`   | **PARTIAL — complete before W21 starts**                                |
| frontend         | _(none)_                              | **missing — W12/W13/W14 must write `30-frontend-integration.md` first** |
| native E2E       | _(none)_                              | **missing — W19 must write `31-native-device-e2e.md` first**            |
| coverage closure | _(none)_                              | **missing — W17 must write `32-coverage-closure.md` first**             |

A lane may not start on a PARTIAL or missing plan: writing that plan is the lane's first task and is reviewed by the
lead before implementation begins.
