# Backend implementation handoff to local AI

Reviewed: 10 October 2026 (Asia/Kuala_Lumpur). Inspected HEAD: `1514322`.

This is an execution guide for the existing backend, subordinate to `AGENTS.md`,
`ROADMAP.md` and `ROADMAP.json`. It does not create another authoritative roadmap.
Read generated `ROADMAP_STATUS.md` for live status. The snapshot below describes
this review, not a permanent completion claim. `LOCAL_AI_HANDOFF_EVIDENCE.json`
is historical evidence from 8 October and must not be treated as current.

## 1. Product boundary and invariants

The product UI MUST be the complete pinned Enatega frontend in
`implementation/vendor/enatega-ui/`. FairBite owns the backend and integration
layer only. Do not create, redesign, simplify or replace Enatega layouts,
navigation, screens, components, styling, assets or interaction flows.
Source-derived replacement screens are prohibited. Preserve upstream licenses.
Allowed frontend changes are limited to transport/adapters, secure session
handling, validated data mapping, configuration and centralized display-name
imports. Necessary security/accessibility fixes must preserve presentation and
interaction structure. Record every vendor edit in root `SOURCE_PROVENANCE.json`
under `allowedModifications` and regenerate the source manifest. Do not remove
screens/actions to hide missing backend behavior or call upstream production APIs.
Include this boundary in every frontend/mobile handoff.

Backend invariants: integer minor units; server-owned prices; zero core-plan food
commission; immutable balanced journals; centrally validated transitions;
server-enforced tenant/actor ownership; provider-independent delivery routing;
no raw card data or provider secrets in clients. Missing capabilities return
explicit errors. Provider absence is `PROVIDER_UNAVAILABLE`; unfinished roots
remain `NOT_IMPLEMENTED`. Never substitute fabricated success or policy.

## 2. Verified starting position

| Area                 | Repository evidence at review                                            | Meaning for the next agent                                                     |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Inventory            | 334 roots: 263 multivendor, 71 L12                                       | Implement exact pinned operation names, arguments and shapes                   |
| Resolver scan        | 18/334 roots detected                                                    | This is source presence, not functional acceptance                             |
| Operation evidence   | 0/334 recorded                                                           | Existing tests still need exact-root evidence mapping                          |
| Static compatibility | 531/531 scoped; 845/845 full; zero unresolved                            | Preserve these checks; do not restart completed extraction work                |
| Runtime schema       | `kernel/schema.ts` excludes L12 SDL                                      | G1 runtime readiness remains incomplete despite static compatibility           |
| GP0                  | Latest local run: 15/16 commands passed; integration failed              | Repair the actual failing test before collecting approvals                     |
| Integration run      | 75 passed, 1 failed across 13 files                                      | Containers worked in this run; the previous no-runtime diagnosis is historical |
| Approval gates       | 0/7 closed                                                               | No product phase is approved                                                   |
| Web journey tooling  | `e2e`, `e2e:smoke`, `test:journeys`, `coverage:e2e` invoke pending gates | These are missing harnesses, not successful acceptance commands                |
| Lane plans           | L5, L6, L7, L8, L12 remain `.PARTIAL.md`                                 | Review and complete relevant plans before dispatching those lanes              |

Latest GP0 evidence is in the existing uncommitted `GATES.json` and generated
status changes. Run commit: `15143221402b93c55f414f5fe79ef936a49afbd5`; completed
10 October 2026 at 00:14:49 MYT (`2026-10-09T16:14:49.104Z`). Preserve these edits.
The failed case is `addresses.integration.spec.ts` → “enforces the owner cap
atomically under simultaneous requests”; its helper reads
`response.data.createCustomerAddress` when `data` is absent. The root cause is
not established by that exception. Inspect HTTP status, body, auth, middleware,
limits and database outcomes before changing production logic or test setup.

Existing code to extend includes `src/identity`, `src/configuration`,
`src/catalog`, `src/addresses`, `src/orders`, `src/dispatch`, `src/kernel`, and
`services/worker/src/outbox-runtime.ts`. Domain utilities and persistence code
exist even where the corresponding Enatega resolver count is zero. Do not create
parallel replacement implementations just because a runbook proposes
`src/modules/...` paths that do not match the current tree.

### Shared prerequisites discovered in source

- `src/app.ts` authenticates sessions but currently supplies empty `permissions`
  and `restaurantIds`, with null vendor/rider ownership. W1/W3 must hydrate these
  from persisted tenant-scoped records and reconcile permission semantics before
  privileged staff/vendor/rider operations can be accepted. Do not infer ownership
  by treating a user id as a restaurant or rider id.
- `test/support/app.ts::startApi(stack, env)` accepts environment strings, not
  dependency overrides. Lead must define a typed composition seam before copying
  runbook tests that inject provider/port fakes; production defaults must remain
  fail closed and server-owned.
- Worker startup registers zero domain consumers. Its safe no-consumer behavior
  leaves domain events pending. Define versioned event/consumer interfaces,
  event identifiers, transaction boundaries, inbox/provider idempotency, retries,
  leases and shutdown before claiming notification/refund/dispatch delivery.
- Prisma fragments currently cover base and L1–L5. L6–L9/L12 persistence and the
  expanded ports/events assumed in their plans still need design and migrations.
  Treat sensitive OTP payloads and event destinations as a security review item.

## 3. Ordered implementation batches

Dependencies in `ROADMAP.json` win over batch membership: sharing a batch does
not mean every task can start simultaneously. A gated dependency may be explored
in a read-only design pass; implementation ahead of approval requires the
roadmap's deliberate, recorded proceeding-at-risk decision.

| Order | Workstreams                                          | Deliverable                                                                                                   | Exit condition                                                                                                                                      |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | W0                                                   | Repair address concurrency failure; preserve/reconcile latest evidence; establish reproducible local baseline | Clean complete GP0 run passes all declared commands and receives lead, QA and security approvals from distinct valid identities                     |
| 1a    | W1                                                   | Complete kernel transport and implement the real smoke harness                                                | G0 commands pass and lead/QA approvals are recorded after GP0                                                                                       |
| 1b    | W2                                                   | Freeze runtime contracts, canonical models/ports/events and upgrade behavior                                  | G1 commands pass and lead/security approvals are recorded after G0                                                                                  |
| 2     | W3 + W4 + W5a; W6 after W3                           | Identity/session/role scopes, configuration/regions, vendors/outlets, customer/address ownership              | Each slice has real persistence, exact-document positive/negative tests; applicable lane G2 checks and reviews                                      |
| 3     | W5b + W7; W12/W13 integration alongside dependencies | Catalog/discovery then server cart, quote, placement and lifecycle; original web/admin connected              | Server-price and order invariants tested; exact original UI actions reach real backend; frontend smoke harness exists                               |
| 4     | W8 + W9; W14a/W14b                                   | Dispatch/rider/location/chat and payments/ledger/refunds; native adapters                                     | Atomic assignment and transitions, realtime isolation, webhook/idempotency/ledger tests; native build evidence kept distinct from device acceptance |
| 5     | W10 + W11 + W15 + W26                                | Notification jobs, analytics, cross-domain journeys, approved server localization                             | Real worker retries/leases, authorized reports, exact app-document journeys; localization policy resolved                                           |
| 6     | W16 + W17                                            | Original web E2E and coverage closure                                                                         | G3: real stack journeys, operation evidence, per-file coverage and API-under-E2E coverage                                                           |
| 7     | W18 + W19 + W20                                      | Provider sandbox, native devices, security/load/restore/operations                                            | G4 approved using actual provider, device and infrastructure evidence                                                                               |
| 8     | W21 + W22                                            | Owner-approved single-vendor implementation and final release package                                         | G5 and owner acceptance; required L12 business features cannot disappear from scope                                                                 |

W23 QA, W24 security/architecture and W25 evidence upkeep operate throughout.
W21 business activation needs D1/D-S1 approval; retaining its schema with disabled
resolvers for G1 does not authorize implementing its economics or activation.

## 4. First dispatch queue

Create or claim each task in `TASK_BOARD.md` with its owner, exact write scope,
dependencies, acceptance, evidence destination and reviewer. Move it to In progress
and commit the claim before work begins. The following packets are recommendations,
not claims or completion records. Treat every current In-progress row as owned,
including T-003–T-008 and T-019–T-022; coordinate with its owner before work.
Existing work ahead of gate approval remains explicitly proceeding at risk.

### A. Diagnose and repair GP0 address-cap failure — W0

- Start with `services/api/test/addresses.integration.spec.ts`,
  `services/api/src/addresses/service.ts`, request middleware in `src/app.ts`,
  and test configuration. Expand write scope only if diagnosis warrants it.
- Preserve transport status/body in test diagnostics. Determine why the response
  is not GraphQL data; do not count a non-GraphQL error response as success.
- Preserve atomic cap enforcement: from 49 owned addresses, five simultaneous
  creates produce exactly one success, four specified domain rejections, and
  exactly 50 database rows. Preserve ownership and selection invariants.
- Run the focused integration file, then the complete integration suite to expose
  shared state/timing effects. Keep production abuse protections intact.
- On a clean reviewed commit, run the entire GP0 recorder. A focused pass cannot
  replace the full failed gate. Record approvals only after the complete run passes.

### B. Complete W1/G0, then close runtime schema mismatch under W2/G1

- First implement the real G0 smoke harness and complete W1 transport acceptance.
  Run and approve G0 before recording G1, which explicitly depends on G0.
  W2 design can be coordinated in parallel, but its gate cannot bypass G0.
- Lead owns `services/api/src/kernel/schema.ts`, fallback wiring,
  `contracts/enatega/`, code generation, schema tests and shared assembly.
- Include all required L12 declarations without activating single-vendor business
  behavior; ensure all unbuilt query/mutation/subscription roots return the
  agreed `NOT_IMPLEMENTED` contract. Resolve shared types explicitly.
- Test runtime introspection and exact pinned documents, not merely loading SDL
  from disk. Retain both legacy and modern WS protocol behavior.
- Acceptance: `check:operations:schema`, scoped/full compatibility, codegen check,
  schema/transport integration tests, API typecheck/build and independent review.

### C. Freeze canonical persistence, ports and events — W2

- Review `services/api/prisma/schema/`, `prisma/migrations/`, `src/kernel/ports.ts`,
  `events.ts`, `outbox.ts`, and `test/integration/schema/upgrade.integration.spec.ts`.
- Map current source to planned module ownership. Document exact interfaces,
  transaction/actor scope and cross-lane foreign keys before parallel domain edits.
- Prove empty-database migration and populated migration-005 upgrade preservation,
  session continuity/revocation, checksums/drift and outbox lease/replay behavior.
  Never rewrite an already-applied migration to conceal drift.
- Assign an owner for the roadmap's currently unowned migration/rollback gap.
- Exit with G1's actual commands and required independent approvals.

### D. Turn existing roots into evidenced slices — W3/W4/W5a/W6

- Respect the existing T-019 (W3), T-020 (W4), T-021 (W5a), and T-022 (W6)
  claims. Coordinate with their owners; do not create duplicate assignments.
- First map tests to the 18 existing roots in `OPERATION_TRACEABILITY.md`; identify
  missing exact-document, tenant, permission, validation and outage assertions.
- Extend existing services/resolvers rather than copying speculative runbook code.
- Good small candidates after prerequisites: `ownerSession`; country/city/ISO
  reference reads; favourites after identity and restaurant projection contracts.
  Verify each root's authoritative lane before claiming it.
- Record only executed evidence in `OPERATION_TEST_EVIDENCE.json`: exact operation,
  source document, test, command, commit, result artifact and reviewer.

### E. Prepare the commerce slice — W7, after W6 and required catalog inputs

- Complete/review L5 plan against current code; reuse orders pricing, state-machine
  and persistence where correct. Start with one actual checkout flow.
- Deliver quote → idempotent placement → merchant acceptance → terminal transition
  with immutable price/address snapshots, locked authorization, one history/outbox
  event per change, and rollback/race tests. Keep provider work behind ports.
- Do not send an agent the entire order/dispatch/finance backlog as one task.
  Split quote, placement and transition into separately reviewable packets.

## 5. Parallel-agent operating model

Use one lead and up to three workers with this environment's four-slot limit.
Ten task packets can be queued; ten simultaneous agents are not available here.

- Lead alone integrates root scripts/packages, shared contracts, Prisma composition,
  ports/events, migrations coordination, app assembly, docs and evidence registries.
- Assign workers non-overlapping existing backend directories or isolated worktrees.
  Publish cross-lane interface proposals before dependent code changes.
- After baseline/contracts pass, run identity, configuration and vendor work in
  parallel; start customer work after its identity prerequisite. Later run dispatch
  and finance in parallel once order interfaces are stable.
- Rotate a worker slot into independent QA/security review. The author cannot
  approve their own slice. A recorder cannot provide its gate's independent approval.
- A task packet must contain: authoritative roots/doc exports; write paths;
  dependencies; schema/port/event inputs; numbered acceptance cases; exact commands;
  evidence destination; reviewer; unresolved owner/provider inputs.
- The handback must contain: diff/commit, actual test results, evidence locations,
  integration requests and remaining blockers. Never report completion from a plan
  document, a resolver decorator or a successful build alone.

## 6. Validation and evidence commands

Run from `implementation/` with Node 24 and `./tools/pnpm.sh` (pnpm 10.28.2).
Read installed Turbo docs before changing task orchestration. Keep existing locks.
Confirm the local container runtime and its socket; do not assume a developer's
absolute Colima socket path works on another machine.

```sh
# Read-only baseline checks; preserve existing dirty generated evidence.
git status --short
./tools/pnpm.sh roadmap:check
./tools/pnpm.sh traceability:check
./tools/pnpm.sh check:enatega-ui-source
./tools/pnpm.sh approve-gate --list

# First failure investigation, with a working PostGIS/Redis container runtime.
./tools/pnpm.sh --filter @fairbite/api exec vitest run --config vitest.integration.config.ts test/addresses.integration.spec.ts
./tools/pnpm.sh test:integration

# Normal backend slice acceptance.
./tools/pnpm.sh test
./tools/pnpm.sh lint
./tools/pnpm.sh format:check
./tools/pnpm.sh typecheck
./tools/pnpm.sh build
./tools/pnpm.sh codegen:check
./tools/pnpm.sh check:enatega
./tools/pnpm.sh check:operations:schema
./tools/pnpm.sh check:error-messages

# Gate recording only from a clean reviewed commit; recorder identity is explicit.
FAIRBITE_RECORDED_BY="actual-recorder-identity" ./tools/pnpm.sh record-gate --gate GP0
# A different reviewer executes once for each required role after real review.
./tools/pnpm.sh approve-gate --gate GP0 --role reviewer-QA --reviewer "actual-independent-reviewer"
```

`check:enatega:full` is available but rewrites its report; use deliberately and
review the diff. `check:operations` is an inventory/evidence check, while
`check:operations:complete` enforces full acceptance. Do not confuse either with
`check:operations:schema` or silently weaken strict checks.

Use each gate's command list from `ROADMAP.json`; do not invent nonexistent
`pnpm verify`, `check:authz` or lane-specific command options from older plans.
Coverage requirements are 90% lines/functions and 85% branches for authored API
files under the applicable full/lane gates; G3 also requires 80% API lines under
original UI E2E. Worker coverage needs explicit evidence. `coverage:report`
produces a measurement and does not establish all strict thresholds passed.
`e2e:backend` currently exercises five API boundary checks, not product journeys.

## 7. Inputs and work that cannot be silently deferred

| Input/gap                                                          | Owner/action                              | What remains blocked                                                              |
| ------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Provider accounts, sandbox keys, webhook endpoints                 | Owner + W18                               | Real payment, courier, maps, push/email/SMS acceptance                            |
| Tax/refund/retention rules, single-vendor and membership economics | Owner decision; document versioned policy | Production policy-dependent behavior                                              |
| Devices and Apple/Google signing                                   | Owner + W19                               | Native permissions, background tracking, push, deep links and live activity gates |
| Hosting, SLOs, recovery objectives                                 | Owner + W20                               | Load, restore, deployment and operational approval                                |
| CI/container/compose, deployment/secrets/runbooks                  | Lead must schedule U1/U2 from ROADMAP §13 | Reproducible CI and release operations                                            |
| Migration reconciliation/rollback                                  | Lead assigns U3                           | G1 and production data safety                                                     |
| Accessibility harness, load harness, license attribution           | Lead assigns U4/U5/U6                     | G3/G4/G5 evidence                                                                 |
| Existing system migration/decommissioning                          | Owner + lead, U7                          | Final production handover                                                         |
| Server locales                                                     | Owner + W26                               | Server localization acceptance                                                    |

Backend handoff is ready for incremental execution once a packet's dependencies
and contracts are approved. Backend completion requires implemented behavior and
real evidence for its scoped GraphQL, REST, WS, worker and persistence surfaces.
Product release additionally requires original web/native/provider and owner
acceptance. Preserve all FB00–FB20 capabilities and all acceptance workflows;
GraphQL inventory alone does not cover REST callbacks, media, maps or native work.
