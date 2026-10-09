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

| Task  | Workstream | Subject                                                                                                                                                                                                                     | Write scope                                                              | Depends | Acceptance                                                               | Evidence path                                 | Owner       | Reviewer |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------ | --------------------------------------------- | ----------- | -------- |
| T-001 | W0         | Record an independent approval for GP0, or re-run it and record the failure. GP0's commands passed on 2026-10-08 with zero approvals, so Batch 1 is not closed and every later workstream is formally "proceeding at risk". | `docs/GATES.json`                                                        | —       | `pnpm record-gate --gate GP0` then a reviewer entry in `docs/GATES.json` | `docs/GATES.json`                             | _unclaimed_ | W23      |
| T-002 | W2         | Close the full six-app compatibility failure (invalid and unresolved documents reported by `check:enatega:full`).                                                                                                           | `contracts/enatega/**`, `docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json` | T-001   | `pnpm check:enatega:full`                                                | `docs/ENATEGA_COMPATIBILITY_REPORT.full.json` | _unclaimed_ | W24      |
| T-003 | W7         | Complete `14-lane-L5-orders.PARTIAL.md` against `_lane-plan-brief.md` (see its "Remaining sections to author" block). Plan only; no implementation.                                                                         | that file only                                                           | T-002   | lead review of the completed plan                                        | the plan file                                 | _unclaimed_ | lead     |
| T-004 | W8         | Complete `15-lane-L6-dispatch.PARTIAL.md` against `_lane-plan-brief.md`. Plan only.                                                                                                                                         | that file only                                                           | T-002   | lead review of the completed plan                                        | the plan file                                 | _unclaimed_ | lead     |
| T-005 | W9         | Complete `16-lane-L7-finance.PARTIAL.md` against `_lane-plan-brief.md`. Plan only.                                                                                                                                          | that file only                                                           | T-002   | lead review of the completed plan                                        | the plan file                                 | _unclaimed_ | lead     |
| T-006 | W10        | Complete `17-lane-L8-notifications.PARTIAL.md` against `_lane-plan-brief.md`. Plan only.                                                                                                                                    | that file only                                                           | T-002   | lead review of the completed plan                                        | the plan file                                 | _unclaimed_ | lead     |
| T-007 | W21        | Complete `22-wave5-single-vendor.PARTIAL.md` against `_lane-plan-brief.md`, and correct its L12 count to match `OPERATION_LANES.json`. Plan only; blocked on owner decision D1 before any implementation.                   | that file only                                                           | T-002   | lead review; `pnpm roadmap:check`                                        | the plan file                                 | _unclaimed_ | lead     |
| T-008 | W12        | Customer-web package audit in the shape of `ENATEGA_FRONTEND_INTEGRATION_AUDIT.md` §2, then integration per `30-frontend-integration.md`.                                                                                   | `vendor/enatega-ui/enatega-multivendor-web/**`                           | T-002   | `pnpm e2e:smoke`                                                         | `docs/artifacts/w12/`                         | _unclaimed_ | W24      |
| T-009 | W25        | Propagate the retired `L10`/`L11`/`L13` identifiers and the corrected L12 count through the lane plans under `docs/superpowers/plans/`.                                                                                     | `docs/superpowers/plans/**`                                              | —       | `pnpm roadmap:check`; grep shows no unexplained `L10`/`L11`/`L13`        | the edited plans                              | _unclaimed_ | lead     |

## In progress

| Task | Workstream | Subject | Owner | Started | Acceptance | Reviewer |
| ---- | ---------- | ------- | ----- | ------- | ---------- | -------- |

## Blocked

| Task  | Workstream | Subject                                                                                                    | Blocked on                                                                               | Owner       | Reviewer |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------- | -------- |
| T-010 | W18        | Provider adapters and sandbox evidence                                                                     | payment/courier/maps credentials (owner)                                                 | _unclaimed_ | W24      |
| T-011 | W19        | Native device E2E                                                                                          | devices, Apple/Google signing accounts, full Xcode (owner)                               | _unclaimed_ | W23      |
| T-012 | W20        | Load, restore and retention evidence                                                                       | SLO/hosting/retention inputs (owner); no load harness is installed — `ROADMAP.md` §13 U5 | _unclaimed_ | W24      |
| T-013 | W26        | Server-side localization                                                                                   | supported-locale list (owner decision D-S2)                                              | _unclaimed_ | W23      |
| T-014 | W21        | Single-vendor implementation, and with it every FB15 capability (credits, referrals, deals, subscriptions) | owner decision D1/D-S1                                                                   | _unclaimed_ | W23      |

## Done

| Task | Workstream | Subject | Commit | Acceptance result | Reviewer |
| ---- | ---------- | ------- | ------ | ----------------- | -------- |
