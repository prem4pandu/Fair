# Task board

The claim medium required by [`ROADMAP.md`](./ROADMAP.md) §5.3. Before this file existed the protocol said
"claim a shared task" with nowhere to do it, so work started without a row and finished without a reviewer.

**Rules**

1. No work without a row. Create the row **before** starting, in the right section.
2. Claiming is a committed edit: set `Owner` and move the row to **In progress**. A second claimant will conflict,
   which is the lock.
3. `Acceptance` is the exact command(s) that prove the task. A task whose acceptance command did not actually run
   is never completed.
4. `Reviewer` must be someone other than the owner (W23 for QA, W24 for security). No self-approval.
5. Completing a row means: acceptance ran, evidence path recorded, reviewer named. Move it to **Done** with the
   commit.
6. This board holds _tasks_. It never holds status — `pnpm roadmap` generates
   [`ROADMAP_STATUS.md`](./ROADMAP_STATUS.md) from recorded evidence. Never write a progress claim here that a
   recorded command does not support.
7. Write scope comes from `ROADMAP.md` §5.2. A row may not name a path another workstream owns.

**Identifiers** — `W…` workstreams only. `L10`, `L11` and `L13` are retired; see `ROADMAP.md` §4.0 for what they
map to.

---

## Ready to claim

| Task | Workstream | Subject | Write scope | Depends | Acceptance | Evidence path | Owner | Reviewer |
| ---- | ---------- | ------- | ----------- | ------- | ---------- | ------------- | ----- | -------- |

## In progress

| Task  | Workstream | Subject                                                                                 | Owner        | Started    | Acceptance                                                      | Reviewer |
| ----- | ---------- | --------------------------------------------------------------------------------------- | ------------ | ---------- | --------------------------------------------------------------- | -------- |
| T-003 | W7         | Complete `14-lane-L5-orders.PARTIAL.md` against `_lane-plan-brief.md`.                  | agent-l5     | 2026-10-09 | lead review of the completed plan                               | lead     |
| T-004 | W8         | Complete `15-lane-L6-dispatch.PARTIAL.md` against `_lane-plan-brief.md`.                | agent-l6     | 2026-10-09 | lead review of the completed plan                               | lead     |
| T-005 | W9         | Complete `16-lane-L7-finance.PARTIAL.md` against `_lane-plan-brief.md`.                 | agent-l7     | 2026-10-09 | lead review of the completed plan                               | lead     |
| T-006 | W10        | Complete `17-lane-L8-notifications.PARTIAL.md` against `_lane-plan-brief.md`.           | agent-l8     | 2026-10-09 | lead review of the completed plan                               | lead     |
| T-007 | W21        | Complete `22-wave5-single-vendor.PARTIAL.md` and correct its L12 inventory.             | agent-l12    | 2026-10-09 | lead review; `pnpm roadmap:check`                               | lead     |
| T-008 | W12        | Audit and integrate the pinned customer-web package without presentation changes.       | agent-fe-web | 2026-10-09 | package lint/typecheck and evidence under `docs/artifacts/w12/` | W24      |
| T-019 | W3         | Continue L1 identity implementation (8/30 resolvers) per `10-lane-L1-identity.md`.      | agent-l1     | 2026-10-09 | scoped unit + typecheck green; integration run serially by lead | W23      |
| T-020 | W4         | Continue L2 platform configuration + maps/media REST per `11-lane-L2-configuration.md`. | agent-l2     | 2026-10-09 | scoped unit + typecheck green; integration run serially by lead | W23      |
| T-021 | W5a        | Continue L3 vendors/outlets implementation per `12-lane-L3-catalog.md` (vendors half).  | agent-l3a    | 2026-10-09 | scoped unit + typecheck green; integration run serially by lead | W23      |
| T-022 | W6         | Continue L4 customers/addresses/support implementation per `13-lane-L4-discovery.md`.   | agent-l4     | 2026-10-09 | scoped unit + typecheck green; integration run serially by lead | W23      |

## Blocked

| Task  | Workstream | Subject                                                                                                    | Blocked on                                                                               | Owner       | Reviewer |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- | -------- |
| T-010 | W18        | Provider adapters and sandbox evidence                                                                     | payment/courier/maps credentials (owner)                                                 | _unclaimed_ | W24      |
| T-011 | W19        | Native device E2E                                                                                          | devices, Apple/Google signing accounts, full Xcode (owner)                               | _unclaimed_ | W23      |
| T-012 | W20        | Load, restore and retention evidence                                                                       | SLO/hosting/retention inputs (owner); no load harness is installed — `ROADMAP.md` §13 U5 | _unclaimed_ | W24      |
| T-013 | W26        | Server-side localization                                                                                   | supported-locale list (owner decision D-S2)                                              | _unclaimed_ | W23      |
| T-014 | W21        | Single-vendor implementation, and with it every FB15 capability (credits, referrals, deals, subscriptions) | owner decision D1/D-S1                                                                   | _unclaimed_ | W23      |

## Done

| Task  | Workstream | Subject                                                                                                                                          | Commit    | Acceptance result                                                                                                                          | Reviewer                                                 |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| T-002 | W2         | Close the full six-app compatibility failure and reconcile every dynamic document site.                                                          | `7c30aa8` | `pnpm check:enatega:full`: PASS, 845/845 documents, 0 invalid, 0 unresolved                                                                | W24 (`/root/final_review`)                               |
| T-016 | W2         | Add a truthful G1 schema-readiness check while retaining complete evidence enforcement at G3.                                                    | `18d4a2c` | Tool tests passed; runtime check reports exactly 71 excluded L12 roots instead of a false pass                                             | W24 (`/root/w2_gate_audit`)                              |
| T-017 | W1         | Wire the PostgreSQL outbox dispatcher into the worker with serial polling, bounded outage recovery, safe consumer filtering, and clean shutdown. | `619e59e` | Worker tests 14/14, typecheck and build passed                                                                                             | W23 (`/root/roadmap_reconcile`)                          |
| T-015 | W25        | Make gate approval recording and derived release status fail closed on incomplete, forged, stale, self-approved or inconsistent evidence.        | `f4723bc` | Clean-worktree acceptance: 94 tool tests, lint, format, roadmap check and approval listing pass                                            | W24 (`/root/roadmap_reconcile`)                          |
| T-009 | W25        | Replace retired lane ownership and reconcile L12/multivendor counts while retaining honest partial-plan status.                                  | `70ff025` | `pnpm roadmap:check`; active ownership uses W workstreams; counts are 71 L12 and 263 multivendor                                           | lead (`/root/roadmap_reconcile`)                         |
| T-001 | W0         | Re-run GP0 on a clean tree and record the truthful result; approvals apply only to a passing run.                                                | `0bb65a1` | 16/16 commands recorded cleanly: 14 passed, typecheck and no-container integration failed                                                  | W23 (`/root/roadmap_reconcile`)                          |
| T-018 | W0         | Pass the real test Postgres URL to the foundation worker integration runtime.                                                                    | `2b9a339` | API typecheck and worker tests 14/14 pass; container integration remains externally blocked                                                | W23 (`/root/w2_gate_audit`)                              |
| T-023 | W0         | Stabilize address integration HTTP lifecycle and record reviewed GP0 baseline.                                                                   | `08a702b` | Focused 8/8; full integration 76/76; all 16 GP0 commands pass; lead/QA/SEC approvals in `docs/GATES.json`; evidence `docs/artifacts/t023/` | W23 `/root/w2_gate_audit`; W24 `/root/roadmap_reconcile` |
