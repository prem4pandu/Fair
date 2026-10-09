# Day-0 baseline and early checkpoints (historical)

> Frozen extract from the roadmap as it read on 2026-10-08/09, kept as evidence. **Not current.**
> Live state: run `pnpm roadmap` and read `docs/ROADMAP_STATUS.md`.

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

### 1.6 Continuation checkpoint — 2026-10-09

The day-0 tables above are historical. Current generated status reports 18/334 real resolver operations and 0/334 recorded operation evidence. The scoped multivendor audit passes 439/439 documents; the full six-app audit fails with 800/852 valid, 43 invalid and 9 unresolved. Status and traceability now display both scopes explicitly.

The next eligible W2 packet adds the populated migration-005 fixture, exhaustive baseline inventory and preservation/fresh-deployment checks in `docs/WAVE1_MIGRATION_INVENTORY.md` and `services/api/test/integration/schema/`. Real execution exposed and corrected the L2 bootstrap aggregate guard (`WHERE` → `HAVING`); existing snapshot data and the selected SGD currency remain unchanged. Already-applied migration checksum/drift reconciliation remains a separate deployment prerequisite, documented in the inventory.

W1 follow-up closes modern WebSocket exception masking and GraphQL error serialization, and routes legacy queries/mutations through execution rather than subscription setup. The real transport harness now uses the same GraphQL module instance as Nest, cancellable controlled sources, scoped resolver overrides and a separate irreversibly revoked session. Independent agent review covers these bounded changes; it does not approve G0/G1 or release.

Coverage closure task **W17-WS-TRANSPORT** tracks `src/kernel/ws/server.ts` and `src/kernel/ws/legacy-protocol.ts`; final unit-only lines coverage is 68.33% and 83.33% respectively. The report does not satisfy full integration coverage or the 90/90/85 per-file gate.

Final validation: 181 API unit/HTTP tests, 76 real PostgreSQL/Redis integration tests across 13 files, 52 tooling tests and 5 backend browser boundary checks pass. Lint, typecheck, build, formatting, codegen, source integrity and traceability pass. `docs/GATES.json` records the whole integration command as partial GP0 evidence with no approval; `docs/artifacts/w1-w2-2026-10-09/packet.json` records the bounded packet and prior failures. This is not original UI/native journey acceptance.

Next work remains W2 full-document reconciliation, contract/data-model and ports review, schema replay, migration drift and authenticated historical-session/address continuity. Original UI smoke, per-operation evidence, strict coverage, native/provider and phase approvals remain open. No frontend files were edited in this packet.

---
