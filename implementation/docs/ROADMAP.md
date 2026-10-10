# FairBite / Enatega roadmap

**This is the single roadmap.** It replaces `docs/MASTER_END_TO_END_PLAN.md` (renamed to this file),
`docs/MASTER_PLAN.json` and the scheduling content of `docs/EXECUTION_PLAN.json`. Its machine-readable twin is
`docs/ROADMAP.json`; the live position is the generated `docs/ROADMAP_STATUS.md`. It does **not** supersede the
per-lane runbooks in `docs/superpowers/plans/2026-10-08-enatega-backend/`, which remain the task-level detail.

**Never hand-write current state into this file.** Scope, sequence, ownership and rules belong here; counts,
statuses and gate results belong in the generated artifacts.

**Authority and precedence when documents disagree**

1. `AGENTS.md` (root and `implementation/`) — owner directives, frontend boundary, engineering invariants.
2. This roadmap — scope, workstreams, roster, waves, gates, evidence rules.
3. `docs/ROADMAP.json` — the machine-readable twin of §4–§11 (workstreams, batches, gates, dependencies).
4. `docs/superpowers/plans/2026-10-08-enatega-backend/*` — per-lane task detail and reference behaviour.
5. `docs/OPERATION_LANES.json` — which lane owns which operation.
6. `docs/ROADMAP_STATUS.md`, `docs/OPERATION_TRACEABILITY.md`, `docs/IMPLEMENTATION_STATUS.{json,html}` (all
   generated) — the state of record. These are regenerated from real command output and **are** quotable as current;
   if one looks wrong, fix its generator or its input, never the output.
7. `docs/ENATEGA_COMPATIBILITY_REPORT.json`, `docs/ENATEGA_URL_CONTRACT.json`,
   `docs/END_TO_END_ACCEPTANCE.json`, `docs/BACKEND_MODULE_PLAN.json` — machine-readable requirements.
8. Everything else under `docs/` — historical evidence, valid only for the date it carries.

---

## 1. Current state

**Do not read a snapshot out of this file.** Run `pnpm roadmap` and read `docs/ROADMAP_STATUS.md`. It derives, from
real artifacts only:

| Question                                     | Answer comes from                                                  |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Which workstream is open, next or blocked?   | `docs/ROADMAP.json` dependencies + `docs/GATES.json` recorded runs |
| How many operations actually have resolvers? | source scan via `tools/lib/operation-state.mjs`                    |
| How many operations have evidence?           | `docs/OPERATION_TEST_EVIDENCE.json`                                |
| Did a gate pass, and did a reviewer approve? | `docs/GATES.json` (`passed`, `approvals`)                          |
| Per-operation state                          | `docs/OPERATION_TRACEABILITY.md`                                   |
| Contract compatibility, scoped and full      | `docs/ENATEGA_COMPATIBILITY_REPORT{,.full}.json`                   |

### 1.1 What the repository is

| Layer                                    | Location                                                                    | State                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Product UI (pinned upstream, unmodified) | `implementation/vendor/enatega-ui/` — 6 packages, SHA-256 manifest verified | source complete; **not installed, not built, not integrated, not runnable** |
| GraphQL/REST/WS backend                  | `implementation/services/api` (NestJS + Apollo + Prisma)                    | schema-complete-looking, a small fraction of operations implemented         |
| Worker                                   | `implementation/services/worker` (BullMQ outbox)                            | transport-level only; no domain jobs                                        |
| Contracts                                | `implementation/contracts/enatega/*.graphql`                                | scoped multivendor compatibility passes; full six-app mode does not         |
| Tooling/gates                            | `implementation/tools/*`                                                    | gate runners, generators and the approval recorder exist; no gate is closed |

### 1.2 Scope, and where each number lives

| Measure                                          | Source of truth (never restated here)        |
| ------------------------------------------------ | -------------------------------------------- |
| Root operations, by kind and lane                | `docs/OPERATION_LANES.json`                  |
| Operations with a real resolver / with evidence  | `docs/ROADMAP_STATUS.md`                     |
| Roots with no SDL declaration                    | `docs/OPERATION_TRACEABILITY.md`             |
| GraphQL document sites validated (scoped / full) | `docs/ENATEGA_COMPATIBILITY_REPORT*.json`    |
| Handler candidates (upper bound on user actions) | `docs/ACTION_CANDIDATES.json`                |
| Acceptance workflows                             | `docs/END_TO_END_ACCEPTANCE.json`            |
| Customer web routes, REST and WS requirements    | `docs/ENATEGA_URL_CONTRACT.json`             |
| Frontend integration blockers, per package       | `docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md` |

The two facts that do not move: the backend must satisfy **two** WebSocket frame sets on one path
(`graphql-ws` legacy + `graphql-transport-ws`), and a non-GraphQL REST surface (`/maps/*`, `/stripe/*`, `/paypal`,
signed `/media/*`) that a GraphQL-only plan would miss.

### 1.3 History

Dated checkpoints — the day-0 gate scoreboard, the in-flight-work table, the W0 red-gate root causes and the
2026-10-09 continuation note — are in `docs/history/2026-10-08-day0-baseline.md`. They are evidence of what was true
on their date and must not be quoted as current.

---

### 1.7 W2 extraction and continuity checkpoint — 2026-10-09

Bare GraphQL request strings/templates now participate in the same static import/interpolation resolver as gql wrappers. Supplemental exports are deduplicated against actual source sites, retaining their original lines. The resolution artifact records 132 automatically expanded interpolated sites with source/document hashes, plus five manual alias-import resolutions. Verification rejects stale sources or expansions, new/obsolete sites and duplicate manual/automatic entries. Both audit scopes reconcile uncovered lexical sites. Standalone cache fragment libraries skip only the unused-fragment rule; request documents retain all normal GraphQL rules.

The complete reconciled inventory now passes static validation in both scopes: **531/531 multivendor** and **845/845 full six-app**, with zero unresolved documents and zero missing roots. These totals include fragment-library sites; they are not operation implementation counts. The contract adds the canonical source-derived `Order` fragment type and exact single-vendor fields/arguments while retaining explicit `NOT_IMPLEMENTED` behavior for roots without resolvers. Three presentation-preserving integration adapter corrections remove an unreachable scalar `getVersions` document and align the single-vendor existence checks with the Boolean data their unchanged consumers already expect. Those vendor edits are recorded in the root `SOURCE_PROVENANCE.json`, and the source manifest is regenerated.

The populated upgrade test now proves pre-upgrade access/refresh continuity, exact historical address reads, revoked/consumed denial, refresh replay revocation and cross-owner selection rejection. This and static contract closure establish bounded preservation and schema evidence, not G1 approval. Previously applied L2 migration drift, canonical model/ports review, original UI smoke, strict coverage, resolver behavior and all phase approvals remain open. Detailed execution evidence is in `docs/artifacts/w2-reconciliation-2026-10-09/packet.json`; the contract-closure follow-up is recorded separately.

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
2. Every extracted root operation in `docs/OPERATION_LANES.json` is either: implemented with the exact upstream name/arguments/selection shape, or
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

1. **The tree contains a hand-written adapter layer — and it is upstream, not ours (verified 2026-10-08).**
   The env/mode endpoint resolvers, the Next.js maps proxy, the client `nonce`/`bop-auth` token services and the rider
   background-location transport all exist in `upstream/`, and `diff -rq` reports **0 differences across all six
   packages**. There are therefore no unrecorded Fair edits to reconcile; the boundary risk is future drift. The root
   `SOURCE_PROVENANCE.json` now records this as `baselineVerification` (command, result, limit, invariant). The
   package-level `vendor/enatega-ui/SOURCE_PROVENANCE.json` legitimately has no `allowedModifications` key because no
   edits exist; the first real edit must add it and re-run the manifest.
2. **Every request in every app depends on one handshake.** `metricsGeneral` returns the public token in `experience`
   and its ISO expiry in `hehe`, bound to a client `nonce` and replayed as `bop-auth: Bearer`. Verified on 2026-10-08:
   all six clients send it as a **`mutation`**, matching the SDL — but every decoy field the clients select
   (`excellence`, `topgun`, `skydiver`, `rider`, `haha`, `huhu`, `yoyo`, `turu`) must resolve without error or the
   handshake breaks and every app is unusable.
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

### 4.0 One identifier system, and how the old ones map onto it

**`W` identifiers are the only way to assign work.** Four schemes existed and nothing mapped between them, so
"which phase are we in" had no answer. They now mean exactly this:

- **`W…`** — a workstream. The unit of assignment, ownership and scope. Defined here and in `docs/ROADMAP.json`.
- **`L…`** — an operation lane, i.e. a slice of `docs/OPERATION_LANES.json`. A **label on operations**, not an
  assignable unit. `L0–L9` and `L12` are the only lanes; they match the lane field in that file.
- **`G…`** — a gate: the evidence a workstream must produce. Defined in §7, recorded in `docs/GATES.json`.
- **`FB00–FB20`** — business capability names from the original phase plan. Retained so capability language survives,
  but **they no longer schedule anything**. Use the mapping below.

**Retired identifiers.** `L10` (E2E), `L11` (QA) and `L13` (security) appear in
`docs/superpowers/plans/2026-10-08-enatega-backend/*` as if they were lanes. They are not lanes — they hold no
operations in `OPERATION_LANES.json` and they collide with this roadmap's ownership table. Read them as:

| Retired | Means                       | Now owned by                                  |
| ------- | --------------------------- | --------------------------------------------- |
| `L10`   | journeys, Playwright, E2E   | **W15** and **W16**                           |
| `L10`   | recorded vendor UI edits    | **W12/W13/W14a/W14b** (per package, per §5.2) |
| `L11`   | independent QA review       | **W23**                                       |
| `L13`   | independent security review | **W24**                                       |

Where a lane plan says "handed to L10", hand it to W15 (journeys) or W16 (Playwright). Where it claims `L10` owns
`vendor/enatega-ui/**`, §5.2 wins: the matching frontend workstream owns its own package.

**Capability → workstream map.** Every FB phase is delivered by the workstreams below; no capability is dropped.

| FB   | Capability                                                 | Delivered by                           | Lane(s)    |
| ---- | ---------------------------------------------------------- | -------------------------------------- | ---------- |
| FB00 | Source/action/mode inventory and licensing                 | W0, W2                                 | —          |
| FB01 | API/worker, persistence, six-app foundations, harness      | W0, W1                                 | L0         |
| FB02 | Identity, roles, staff scopes, secure sessions             | W3                                     | L1         |
| FB03 | Merchant/outlet/catalog/media/hours                        | W5a, W4 (media)                        | L3, L2     |
| FB04 | Discovery, search, addresses, favourites                   | W5b, W6                                | L3, L4     |
| FB05 | Integer pricing, quotes, cart, immutable orders            | W7                                     | L5         |
| FB06 | Payments, ledger, refunds, signed webhooks                 | W9, W18                                | L7         |
| FB07 | Merchant acceptance/preparation/readiness                  | W7 (transitions), W5a                  | L5, L3     |
| FB08 | Provider-neutral dispatch and reconciliation               | W8                                     | L6         |
| FB09 | Own-fleet rider workflow and native tracking               | W8, W14b, W19                          | L6         |
| FB10 | External courier (Lalamove-style) adapter                  | W18                                    | L6         |
| FB11 | Subscriptions, notifications, chat, media                  | W10, W8 (chat), W4                     | L8, L6, L2 |
| FB12 | History, tracking, reorder, cancellation, ratings          | W7, W5b (reviews)                      | L5, L3     |
| FB13 | Earnings, payables, withdrawals, reconciliation            | W9                                     | L7         |
| FB14 | Support, disputes, risk, privacy lifecycle                 | W6                                     | L4         |
| FB15 | Membership, credits, referrals, deals                      | **W21 only** — see decision D-S1 (§11) | L12        |
| FB16 | Full administrative operations and reporting               | W11, W13                               | L9         |
| FB17 | Public/provider configuration, localization, observability | W4, **W26**, W20                       | L2         |
| FB18 | Full UI/action parity and regression                       | W12–W14b, W15, W16                     | all        |
| FB19 | Load, resilience, retention, restore, security             | W20                                    | —          |
| FB20 | Signed devices, provider readiness, owner release decision | W18, W19, W22                          | —          |

Two consequences the owner should see rather than discover later:

1. **FB15 ships only if W21 (single-vendor) is approved.** Every credits, referral, deal and subscription operation
   sits in lane L12. Decision **D-S1** in §11 records this.
2. **FB17 localization had no owner at all** — there is no localization operation among the extracted roots. It is
   now **W26** (§4.6a).

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

| ID     | Workstream                                                                                                                                                                                                                                                                                                                                                            | Owner role       | Ops    | Scope                                                                                                                                                                                 | Depends |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **W1** | Kernel/transport completion: legacy + modern WS frame sets with a working WS context and masked errors, `mutation metricsGeneral` with `nonce`/`bop-auth` binding, bop-auth verified on WS **when supplied** (the gate itself is HTTP-only, decision D-G1), Redis pub/sub, limits proven against the largest real document, health/readiness, outbox worker hardening | backend-kernel   | 1 (L0) | `services/api/src/kernel/**`, `services/worker/**`, `services/api/src/app.ts` (WS context, error path, CORS only), `test/support/**`                                                  | W0      |
| **W2** | Contract + data-model freeze: L12 SDL gap closed (71 roots have no declaration), migration from the populated 005 baseline, ports interface freeze, dynamic-document reconciliation, full-mode compatibility report                                                                                                                                                   | backend-contract | —      | `contracts/enatega/**`, `prisma/schema/base.prisma`, `prisma/migrations/**`, `kernel/ports.ts` (only), `test/integration/schema/**`, `docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json` | W0      |

W2 exit criteria: `pnpm check:enatega` (multivendor) and `pnpm check:enatega:singlevendor` PASS — with
`pnpm check:enatega:full` covering all six apps; every migration applies both on
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

### 4.6a Localization (W26) — previously unowned

FB17 names localization, no extracted root operation provides it, and no workstream owned it. The six pinned apps
localize their own strings; what the backend must not do is force English through server-owned content.

| ID      | Workstream                                                                                                                                                                                               | Owner role | Scope                                                                                                                          | Depends |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **W26** | Server-side localization: locale negotiation on HTTP/WS, locale-tagged configuration and catalog content, localized notification/email/SMS templates, locale-aware money/date formatting at the boundary | agent-L2   | `src/platform/i18n/**`, `src/notifications/templates/**` (by request to W10), `contracts/enatega/L2-*.graphql`, matching tests | W4, W10 |

W26 deliverables: a resolved request locale (client header → user preference → outlet default → platform default,
with the chosen source recorded); no hard-coded human-readable string in a response that the pinned UI does not
itself translate; one template per channel per supported locale with a tested fallback chain; and an explicit
supported-locale list in configuration that an unsupported request degrades to rather than failing. W26 adds **no**
new UI string and no new screen — if a pinned app has no slot for a translated value, that is an integration
blocker, not a reason to render one.

**Open input (owner):** the supported-locale list. Until it is given, W26 implements the mechanism with a single
configured locale and the fallback chain proven by test; it does not invent a market's language set.

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

The board is **`docs/TASK_BOARD.md`**, in the repository, edited by the claiming agent. It previously existed only as
this paragraph, so `claim` and `complete` had nowhere to happen.

Every unit of work is a board row created **before** its owner starts, containing: id, workstream, subject, write
scope, dependencies, exact acceptance commands, evidence artifact path, owner and reviewer. Workflow:
`list → claim → implement → run acceptance → hand evidence to reviewer → complete`. A task whose acceptance command
did not actually run is never completed, and a task is never completed by the agent that implemented it.

Claiming is a committed edit to `docs/TASK_BOARD.md`; two agents cannot hold the same row because the second claim
conflicts. The board carries tasks; `docs/ROADMAP_STATUS.md` carries derived state. Never record a status in the
board that a recorded command does not support.

The two halves of a gate have two commands, and neither may be hand-edited into `docs/GATES.json`:

```
pnpm record-gate  --gate <id>                                            # run and record the commands
pnpm approve-gate --gate <id> --role <role> --reviewer "<identity>"      # record one reviewer's sign-off
pnpm approve-gate --list                                                 # who still needs to sign what
```

`record-gate` never writes an approval, and `approve-gate` refuses to record one when the reviewer is whoever
recorded the run, when the identity already holds another role on that gate, when the run failed, when it was
recorded over a dirty tree, or when it is not the tree at `HEAD` (`--allow-stale` makes approving an older tree a
deliberate, recorded act). Recording a new complete run clears that gate's approvals, because reviewers signed off
a specific run. A gate is closed only when **every** role in its `approvals` list is recorded — one signature of
three closes nothing.

### 5.4 Handoff template (paste into every agent spawn)

```
You are <ID> (<name>) of the FairBite/Enatega end-to-end build.

Read, in order:
1. AGENTS.md (root) and implementation/AGENTS.md.
2. implementation/docs/ROADMAP.md — §2 definition of done, §4.0 identifiers, §4 your workstream,
   §5.2 your write scope, §5.3 the task board, §7 your gate.
3. implementation/docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md §1–§4 and §6,
   reading L10/L11/L13 through the retirement table in ROADMAP.md §4.0.
4. Your lane plan: <plan file>.
5. implementation/docs/ROADMAP_STATUS.md and docs/OPERATION_TRACEABILITY.md — the operations you own
   and their current state. Never quote a count from a prose document.

<frontend boundary §2.1 verbatim>

Rules:
- Claim your row in docs/TASK_BOARD.md before you start; do not start work that has no row.
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

### 6.7 Coverage debt — who owns which files

**Dated measurement (2026-10-08).** The percentages below are a snapshot kept only to assign ownership; re-run
`pnpm coverage` for current numbers and record them in `docs/GATES.json`. Global at the time: 88.88 % lines,
87.51 % statements, 91.66 % functions, 80.89 % branches — **27 files failing the per-file thresholds (44 failed
checks)**. Closure is required by G3 and planned in `32-coverage-closure.md`.

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

| Gate              | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GP0** (W0)      | `pnpm install --frozen-lockfile`, `lint`, `format:check`, `typecheck`, `build`, `test`, `test:integration`, `coverage:report`, `check:enatega-ui-source`, `test:enatega-contracts`, `test:operation-evidence`, `node --test tools/*.test.mjs`, `traceability:check`, `check:error-messages`, `e2e:backend` — all green on a clean tree; `docs/GATES.json` written; status docs regenerated truthful. **Coverage scope:** GP0 requires the coverage _report_ to be produced and recorded; the strict per-file thresholds (90/90/85) are enforced per lane at G2 and closed by W17 at G3, because the kernel is still being completed in W1 and a day-0 threshold would be measuring unfinished code                       |
| **G0** (W1)       | GP0 + `e2e:smoke` — a **transport-level** smoke against the real stack (PostGIS + Redis + the built API): the exact pinned admin and customer web request documents replay over HTTP and both WebSocket frame sets; the `metricsGeneral`/`bop-auth` handshake mints a token bound to its nonce; the customer web `configuration` query returns the active server-owned version; each pinned subscription reaches its explicit terminal frame on both protocols and real configuration data is delivered over both; limits are proven against the largest real document **with an over-limit negative control**. Loading the admin and customer web _shells_ in a browser is the W16 Playwright gate at G3, not this gate |
| **G1** (W2)       | G0 + `check:enatega` (multivendor), `check:enatega:full` (all six apps, enforced with `--check`) and `check:enatega:singlevendor` (single-vendor scope) validate; every root present with either a resolver or explicit `NOT_IMPLEMENTED`; migrations clean on empty **and** upgrade-from-baseline; dynamic document sites fully classified; codegen matches                                                                                                                                                                                                                                                                                                                                                             |
| **G2** (per lane) | G1 + every operation of the lane implemented, ≥ 1 tagged integration test per operation, negative cases, lane directories meet coverage, lane Playwright specs green, QA + security approved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **G3** (W15–W17)  | All G2 + `test:journeys` + full Playwright web suites + `check:operations:complete` + API E2E coverage ≥ 80 %                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **G4** (W18–W20)  | G3 + provider sandbox evidence, native device runs, security review closed, no high/critical advisories, load/outage/restore results, observability and redaction verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **G5** (W21–W22)  | G1–G4 for L12 and the single-vendor admin; owner release decision recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

`docs/GATES.json` entry schema: `{ gate, commit, dirty, recordedBy, startedAt, finishedAt, passed, partial, commands[],
approvals[], approvalRecords[], reviewer, approved }`, where each `approvalRecords` entry is
`{ role, reviewer, at, runFinishedAt, commit, headAtApproval, approvedStaleTree, note }`. `approvals` holds the roles
signed; `approved` is true only when they cover every role the gate requires in `ROADMAP.json`.

---

## 8. Sequence, effort and exit criteria

| Batch | Parallel writers   | Exit criterion                                            |
| ----- | ------------------ | --------------------------------------------------------- |
| 1     | W0 (lead)          | GP0 green, Colima up, in-flight work committed            |
| 2     | W1, W2             | G1                                                        |
| 3     | W3, W4, W5a, W6    | first four lane G2s                                       |
| 4     | W5b, W7, W12, W13  | L3/L5 G2 + customer and admin web load against real stack |
| 5     | W8, W9, W14a, W14b | L6/L7 G2 + three mobile apps build and run locally        |
| 6     | W10, W11, W15, W26 | L8/L9 G2 + journeys green + locale negotiation tested     |
| 7     | W16, W17           | G3                                                        |
| 8     | W18, W19, W20      | G4                                                        |
| 9     | W21, W22           | G5 + owner acceptance                                     |

**Order-of-magnitude effort** (agent-days, inherently an estimate): W0 ≈ 2; W1+W2 ≈ 12; W3–W11 ≈ 4–8 per lane
(L2/L3/L6/L7 at the top of the range) ≈ 50; W12–W14 ≈ 6–10 per app ≈ 45; W15–W17 ≈ 20; W18–W20 ≈ 25; W21 ≈ 15;
W26 ≈ 5; review overhead ≈ 25 % of build. Total ≈ **215–265 agent-days**; with lead + 4 writers and real review
overhead, roughly **14–20 working sessions/weeks**, dominated by provider, device and review gates that are not
parallelisable away. This excludes the unscheduled work in §13, which has no estimate because it has no owner.

A batch closes only when its reviewer approves in `docs/GATES.json`. `docs/ROADMAP_STATUS.md` prints any workstream
that started before its dependency's gate was approved, so proceeding at risk is visible rather than silent.

---

## 9. Risk register

| #   | Risk                                                                                                                                       | Impact                             | Mitigation                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Implemented operations are a small fraction of the extracted roots (see `docs/ROADMAP_STATUS.md`)                                          | schedule                           | lane batches with per-operation evidence; traceability matrix shows truth continuously                                                                                                |
| R2  | Frontend install/build may not work under pnpm/Node 24 (npm lockfiles, Expo/Metro, duplicate package names)                                | blocks all UI gates                | D-F1 per-app npm in place; verify in W12 first; fallback documented                                                                                                                   |
| R3  | Vendor edits + manifest regeneration collide across frontend agents                                                                        | broken provenance gate             | single serialisation point owned by the lead; batches of ≤ 2 frontend writers                                                                                                         |
| R4  | Real payment/provider/device inputs absent                                                                                                 | G4 unreachable                     | honest `PROVIDER_UNAVAILABLE`/blocked status; build everything up to the boundary                                                                                                     |
| R5  | Schema-complete but behaviour-thin code could be mistaken for progress                                                                     | false status                       | `NOT_IMPLEMENTED` everywhere by default; status docs generated from gates, never narrative                                                                                            |
| R6  | Silent clamping/interpretation in domain code (e.g. discount clamped to items total in `pricing.ts`)                                       | policy drift                       | lane review must confirm each rule against upstream documents; reject vs clamp is an explicit decision                                                                                |
| R7  | Playwright suite against mutable upstream DOM                                                                                              | flakes                             | page objects sourced from pinned markup; `retries: 0`; quarantine is a blocker                                                                                                        |
| R8  | Migration drift across parallel lanes                                                                                                      | data loss                          | migrations authored only by the lead; lanes submit reviewed SQL; upgrade test from populated baseline is a gate                                                                       |
| R9  | Dependency advisories (4 high, 4 moderate per audit)                                                                                       | release blocker                    | bump/quarantine in W20; re-audit at G4                                                                                                                                                |
| R10 | Docs drift (already happened once)                                                                                                         | wrong decisions                    | every status doc generated from gate output; stale-file tests (`tools/*.test.mjs`) enforce                                                                                            |
| R11 | The vendor tree drifts from the pinned snapshot once frontend lanes start editing                                                          | boundary breach                    | baseline verified byte-identical (0 diffs) and recorded in SOURCE_PROVENANCE.json; every future edit must be listed in allowedModifications and re-manifested                         |
| R12 | Vendor web installs fail under Node 24 (`engine-strict=true`)                                                                              | frontend lanes stall               | D-F4 recipe verified in W12 before the other frontend lanes start                                                                                                                     |
| R13 | Upstream credentials/hosts remain live in the tree (Firebase web keys, Sentry DSN, EAS profiles)                                           | security, owner breach             | gated and removed by the owning frontend lane; the Playwright network guard fails any upstream-host request                                                                           |
| R14 | `metricsGeneral`/legacy-WS incompatibility blocks every app, including login                                                               | total UI blockage                  | W1 owns it as the first transport gate; `e2e:smoke` proves both operation types and both WS frame sets                                                                                |
| R15 | Signed media URLs, Live Activity and background-location contracts are easy to miss in a GraphQL-only plan                                 | silent mobile breakage             | capability checklist in `docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md` §5 drives W4/W8/W10                                                                                              |
| R16 | Files failing the per-file coverage thresholds (measured at day 0: 27 files, 44 failed checks)                                             | G3 unreachable                     | GP0 records the report only; W1 and W7 close their own files at G2 and W17 closes the rest by G3 (`32-coverage-closure.md`)                                                           |
| R17 | Observed integration flake: `test/catalog.integration.spec.ts` failed once in three full runs while passing in isolation                   | false red/green                    | the assertion now prints limit, query and response body so the next occurrence is diagnosable; W20 owns flake elimination before G4, and a quarantine is a blocker, not a pass        |
| R18 | Scoped (`--scope multivendor`) audits cover only the supplied resolution set, so lexically present sites stay invisible to the scoped gate | false compatibility PASS           | full mode (`pnpm check:enatega:full`) reconciles every lexical site and is a G1 criterion; remaining dynamic sites are classified in `docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json` |
| R19 | Every gate runs only on a developer machine; there is no CI, container image or pipeline in the repository                                 | unreproducible gates, "works here" | recorded in §13 (U1) as an accepted, unscheduled gap; `docs/GATES.json` records commit + dirty flag so a local run is at least attributable                                           |
| R20 | G3/G4 demand accessibility and load evidence that no installed tool can produce                                                            | gate cannot be closed as written   | recorded in §13 (U4, U5); either tooling is scheduled or the gate wording is changed by owner decision — it must not be waived silently                                               |
| R21 | Lane plans still carry retired `L10`/`L11`/`L13` ids and a stale L12 count                                                                 | mis-assignment                     | §4.0 retirement table is authoritative; `pnpm roadmap:check` fails if a lane count disagrees with `OPERATION_LANES.json`; board task T-009 propagates it                              |

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

## 11. Owner decision register

| #                        | Decision                                                                                                                                                                                                                                                                                                           | Default now                                                                                                                                                                                                                                                           | Reversible cost                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| D-F1                     | Frontend install/run strategy: per-app `npm ci` in place vs workspace membership vs `.toolchain` copies                                                                                                                                                                                                            | per-app npm in place                                                                                                                                                                                                                                                  | one workstream re-run                                                     |
| D-F2                     | Web session bridge: same-origin HttpOnly BFF cookies for all three web apps (already proven for addresses) vs bearer in memory                                                                                                                                                                                     | BFF cookies for web, secure storage for native                                                                                                                                                                                                                        | one adapter layer                                                         |
| D-F3                     | Playwright browser scope: chromium required, firefox/webkit best-effort                                                                                                                                                                                                                                            | chromium                                                                                                                                                                                                                                                              | extra CI time                                                             |
| D-F4                     | Web-package install under Node 24: per-package `.npmrc` relaxing `engine-strict` vs a Node 20 toolchain for vendor builds                                                                                                                                                                                          | per-package `.npmrc`, pinned manifests untouched                                                                                                                                                                                                                      | one install recipe                                                        |
| D-F5                     | Web push: extend the customer-web config query with `vapidKey` (recorded vendor edit) vs a backend field the client already reads                                                                                                                                                                                  | extend the query, recorded in provenance                                                                                                                                                                                                                              | one query + one edit                                                      |
| D-F6                     | Admin client-side AES-GCM config decryption with a public `NEXT_PUBLIC_*` key: keep vs move server-side                                                                                                                                                                                                            | keep, and stop treating it as secrecy                                                                                                                                                                                                                                 | one adapter layer                                                         |
| D-F7                     | Client-owned web tokens (`localStorage`) vs the BFF cookie bridge (D-F2) for the two admin apps                                                                                                                                                                                                                    | BFF cookies for all three web apps                                                                                                                                                                                                                                    | one adapter layer                                                         |
| D-G1                     | Public-access gate scope: HTTP-only (recorded) or enforced on the WebSocket handshake too                                                                                                                                                                                                                          | **HTTP-only.** web/admin/app/single-admin send only `authorization` in connectionParams, so handshake enforcement would break 4 of the 6 pinned clients. bop-auth is verified on WS when a client supplies it, and per-subscription authorisation remains the control | revisit if a client needs WS enforcement                                  |
| D-G2                     | `x-skip-public-auth`: honoured by the server or not                                                                                                                                                                                                                                                                | **Not honoured.** Enforcement is controlled only by `PUBLIC_ACCESS_ENFORCED`; the header is removed from the gate and the CORS allow-list                                                                                                                             | small, one header                                                         |
| D-N1                     | Native harness: Maestro (simpler, Expo-friendly) vs Detox                                                                                                                                                                                                                                                          | Maestro                                                                                                                                                                                                                                                               | one test-suite rewrite                                                    |
| **D-S1**                 | **FB15 — membership, credits, referrals and deals.** Every such operation (`giveUserCredits`, `getMyReferralCode`, `checkReferralCodeExists`, `getAllSubscriptionPlans`, `createSubscription`, `cancelSubscription`, the food-deal roots, single-vendor banners) is in lane **L12**. **OPEN — owner must decide.** | **Not in the release unless W21 is approved.** Approving D1/W21 brings FB15 in; declining means the product ships with coupons (L3) and tips/banners (L2) only, and FB15 is not delivered. No multivendor equivalent is planned.                                      | re-planning a new lane if the owner wants FB15 without single-vendor mode |
| **D-S2**                 | **Supported locales for W26.** No locale set has ever been given.                                                                                                                                                                                                                                                  | One configured locale plus a tested fallback chain; the mechanism is built, the language list is not invented                                                                                                                                                         | configuration only, once the list exists                                  |
| D1, D4, D5, D6, D12, D13 | as recorded in `docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md` §2                                                                                                                                                                                                                            | unchanged                                                                                                                                                                                                                                                             | per-lane                                                                  |

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
./tools/pnpm.sh check:enatega:full
./tools/pnpm.sh check:enatega:singlevendor
./tools/pnpm.sh check:enatega-ui-source
./tools/pnpm.sh test:enatega-contracts
./tools/pnpm.sh test:operation-evidence
./tools/pnpm.sh check:operations
./tools/pnpm.sh e2e:backend
node --test tools/*.test.mjs tools/lib/*.test.mjs
node tools/generate-operation-traceability.mjs [--check]
node tools/manifest-enatega-ui.mjs [--check]
./tools/pnpm.sh roadmap           # regenerate docs/ROADMAP_STATUS.md — run this before asking "where are we"
./tools/pnpm.sh roadmap:check     # fail if the status file is stale or the plan contradicts the lane data
```

### 12.2 Artifact index

| Artifact                                                                       | Role                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `docs/ROADMAP.md`                                                              | this roadmap — the only plan                                                                    |
| `docs/ROADMAP.json`                                                            | machine-readable workstreams, batches, gates, scopes, FB map                                    |
| `docs/ROADMAP_STATUS.md` + `tools/generate-roadmap-status.mjs`                 | generated "you are here": per-workstream state, next claimable, blocked, at-risk                |
| `docs/TASK_BOARD.md`                                                           | claimable task rows (§5.3)                                                                      |
| `docs/history/**`                                                              | frozen dated snapshots; never current                                                           |
| `docs/OPERATION_TRACEABILITY.md` + `tools/generate-operation-traceability.mjs` | per-operation state of record                                                                   |
| `docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md`                                   | full per-package frontend integration surface, 24 blockers, backend capability table            |
| `docs/OPERATION_LANES.json` / `docs/ENATEGA_OPERATION_INVENTORY.json`          | lane ownership and inventory                                                                    |
| `docs/ENATEGA_COMPATIBILITY_REPORT*.json`                                      | static contract compatibility (multivendor, single-vendor, full six-app)                        |
| `docs/ENATEGA_URL_CONTRACT.json`                                               | REST/WS/route/navigation/hardcode requirements                                                  |
| `docs/END_TO_END_ACCEPTANCE.json`                                              | 18 workflows, invariants, evidence fields                                                       |
| `docs/OPERATION_TEST_EVIDENCE.json`                                            | per-operation evidence registry (gate input)                                                    |
| `docs/GATES.json` (W0-9)                                                       | gate run registry                                                                               |
| `docs/superpowers/plans/2026-10-08-enatega-backend/**`                         | per-lane task detail (L5–L8 and L12 are PARTIAL and must be completed before their lanes start) |
| `docs/artifacts/**`                                                            | test artifacts referenced by gates                                                              |

### 12.3 Per-lane plan readiness

| Lane             | Plan file                             | State                                                  |
| ---------------- | ------------------------------------- | ------------------------------------------------------ |
| L0 kernel        | `01-wave0-foundation.md`              | complete (3856 lines)                                  |
| L1               | `10-lane-L1-identity.md`              | complete                                               |
| L2               | `11-lane-L2-configuration.md`         | complete                                               |
| L3               | `12-lane-L3-catalog.md`               | complete                                               |
| L4               | `13-lane-L4-discovery.md`             | complete                                               |
| L5               | `14-lane-L5-orders.PARTIAL.md`        | **PARTIAL — complete before W7 starts**                |
| L6               | `15-lane-L6-dispatch.PARTIAL.md`      | **PARTIAL — complete before W8 starts**                |
| L7               | `16-lane-L7-finance.PARTIAL.md`       | **PARTIAL — complete before W9 starts**                |
| L8               | `17-lane-L8-notifications.PARTIAL.md` | **PARTIAL — complete before W10 starts**               |
| L9               | `18-lane-L9-analytics.md`             | complete-draft                                         |
| journeys/E2E     | `20-wave3-journeys-and-e2e.md`        | complete                                               |
| hardening        | `21-wave4-hardening-and-release.md`   | complete                                               |
| L12              | `22-wave5-single-vendor.PARTIAL.md`   | **PARTIAL — complete before W21 starts**               |
| frontend         | `30-frontend-integration.md`          | written; per-package audits are each lane's first task |
| native E2E       | `31-native-device-e2e.md`             | written; blocked on devices and signing accounts       |
| coverage closure | `32-coverage-closure.md`              | written                                                |

A lane may not start on a PARTIAL plan: completing it is that lane's first task and is reviewed by the lead before
implementation begins. Each PARTIAL file carries a "Remaining sections to author" block naming exactly what is
missing against `_lane-plan-brief.md`, so completing it is itself a scoped task rather than a judgement call.

---

## 13. Known gaps with no owner

These were identified in the 2026-10-09 roadmap audit and the owner **chose not to schedule them**. They are
recorded here because an unscheduled gap must stay visible: none of them is "done", and several are required by
gates this roadmap already demands. Each needs either a workstream or an owner decision to change the gate.

| #   | Gap                                                                                                                                                                                                   | Which gate it undermines                              | What happens meanwhile                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| U1  | **No CI.** There is no pipeline, workflow file, container image or compose file anywhere in the repository. Every gate is a manual local run against a developer's Colima.                            | §7's "all green on a clean tree" for every gate       | `docs/GATES.json` records commit and a `dirty` flag, so a local run is attributable but not reproducible |
| U2  | **No deployment or environment workstream.** W22 produces documents and an owner acceptance run, not a deployment. Nothing owns build artifacts, environments, config/secret management or runbooks.  | G4/G5 release meaning                                 | hosting stays a blocker in §10 rather than work; the product cannot be released from this plan alone     |
| U3  | **Migration drift and rollback are unowned.** Checksum/drift reconciliation for already-applied migrations is called a deployment prerequisite; no workstream owns it and there is no downgrade path. | G1's "migrations clean on empty and upgrade"          | W2 proves forward migration only; drift remains a deployment-time surprise                               |
| U4  | **No accessibility tooling.** No axe/a11y dependency or command exists, yet §2 and `END_TO_END_ACCEPTANCE.json` require keyboard/responsive/accessibility evidence.                                   | G3 (W16), and the acceptance workflows' evidence list | a11y evidence can only be produced by manual inspection, which does not scale to 18 workflows            |
| U5  | **No load/performance tooling or targets.** W20 names load, concurrency and outage work; no harness is installed and no SLO numbers exist.                                                            | G4 (W20)                                              | load results cannot be produced; SLO inputs are not even listed as a requested owner decision            |
| U6  | **No licence/attribution gate.** `manifest-enatega-ui.mjs` verifies bytes, not that upstream licence notices survive, and no third-party attribution artifact is produced for release.                | FB00's licensing scope, G5                            | the boundary rule "preserve upstream licence notices" is enforced by review only                         |
| U7  | **Existing FairBite has no migration or decommissioning plan.** The root README says it "remains preserved"; nothing says what happens to it or its data at release.                                  | G5 owner acceptance                                   | undefined end state for the system this one replaces                                                     |

Rule for all seven: do **not** mark a dependent gate `N/A` because of them. §5.5 already forbids it — missing
infrastructure is a failure or a blocker, never `N/A`. Closing one of these requires either a new `W` workstream
here or a recorded owner decision in §11 that changes what the gate asks for.
