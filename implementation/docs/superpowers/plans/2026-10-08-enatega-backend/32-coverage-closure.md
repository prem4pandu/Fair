# Coverage closure — W17

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

> **Precedence notice (2026-10-09).** `implementation/docs/ROADMAP.md` is the single roadmap and outranks this
> file for scope, scheduling, ownership and gates; this file remains authoritative for its own task detail.
> `L10`, `L11` and `L13` are **retired identifiers** — they were never lanes in `OPERATION_LANES.json`. Read
> `L10` as **W15** for journey suites (`test/journeys/**`), **W16** for Playwright (`e2e/**`), and the matching
> frontend workstream **W12/W13/W14a/W14b** for edits inside a `vendor/enatega-ui/` package; `L11` as **W23**
> (independent QA) and `L13` as **W24** (independent security). Operation counts come from
> `docs/OPERATION_LANES.json`, not from prose. See `ROADMAP.md` §4.0.

**Goal:** Close the per-file coverage thresholds (90 % lines, 90 % functions, 85 % branches) across
`services/api/src/kernel/**` and the module directories, reach ≥ 80 % API line coverage under E2E, and make
`pnpm check:operations --require-complete` exit 0 — so G3 rests on measured behaviour rather than on a report
nobody enforced.

**Architecture:** W17 writes **tests only**. It never changes production behaviour. Where a file cannot reach the
threshold without a source change, W17 raises a defect to the owning workstream and records the dependency; it
does not edit the owner's source and it does not lower a threshold.

**Tech stack:** Vitest 4 with `@vitest/coverage-v8` (`vitest.coverage.config.ts` for unit+integration,
`vitest.coverage.full.config.ts` for the strict per-file run), Testcontainers 11, Playwright 1.63 for the E2E
coverage leg.

---

## 1. Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

W17 makes no edit inside `vendor/enatega-ui/` and no edit to production source anywhere.

---

## 2. Rules that make this workstream honest

1. **Tests only.** A coverage number moved by changing production code is not W17's to claim. Raise the defect.
2. **No threshold is ever lowered**, and no file is added to an ignore list, to make a run pass. If a threshold is
   genuinely wrong for a file, that is an owner-visible decision recorded in `ROADMAP.md` §11, not a config edit.
3. **No coverage-only test.** Every test added here asserts behaviour a user or another module depends on. A test
   that executes a line without asserting its effect is forbidden — it converts a real gap into a hidden one.
4. **Branches are the hard part.** Error paths, timeouts, outage handling, authorisation denials and
   `NOT_IMPLEMENTED` fallbacks are where the misses concentrate; they are also where correctness matters most.
5. **Uncovered because unreachable** is a finding. If a branch cannot be reached, either it is dead code (defect
   to the owner) or the test harness lacks a capability (fix the harness).

---

## 3. Inputs

| Input                               | Use                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `pnpm coverage`                     | the strict per-file run; its failure list is the backlog                 |
| `pnpm coverage:report`              | the recorded report produced at GP0                                      |
| `ROADMAP.md` §6.7                   | ownership of the known failing files (dated; re-measure before trusting) |
| `docs/OPERATION_TEST_EVIDENCE.json` | per-operation evidence, the `check:operations` input                     |
| `docs/ROADMAP_STATUS.md`            | which operations exist to be evidenced at all                            |

---

## 4. Tasks

### Task 1: Re-measure and publish the real backlog

- [ ] **Step 1:** Run `pnpm coverage` and capture the full per-file failure list. The §6.7 table is dated and must
      not be trusted as the backlog.
- [ ] **Step 2:** Write `docs/artifacts/w17/backlog.md`: every failing file, its current line/function/branch
      numbers, its owning workstream (from `ROADMAP.md` §5.2), and whether the gap is reachable by tests alone.
- [ ] **Step 3:** For every "not reachable by tests alone" entry, open a defect against the owning workstream and
      record the dependency. These block W17 and are listed, not worked around.
- [ ] **Step 4:** Record the run in `docs/GATES.json`.
- [ ] **Step 5:** Commit `test(w17): record the measured coverage backlog`.

### Task 2: Kernel closure (owned with W1)

- [ ] **Step 1: Write the failing tests** for the kernel files in the backlog — session lifecycle, the WS server
      and the legacy protocol, pub/sub, pagination, the public-access gate, ids, time, geo, tokens, the HTTP
      status plugin and the outbox. Each test asserts an observable behaviour: a frame sequence, a rejection, a
      published message, a boundary value.
- [ ] **Step 2: Run** the per-file coverage for `src/kernel/**` and record the starting numbers.
- [ ] **Step 3: Implement the tests** (no production edit). Where a kernel branch needs a controllable clock,
      socket or Redis, extend `test/support/**` by request to W1.
- [ ] **Step 4: Run** until `src/kernel/**` meets 90/90/85 per file.
- [ ] **Step 5: Commit.**

### Task 3: Module closure (per owning lane, by request)

- [ ] **Step 1: Write the failing tests** per module directory, in the lane's own test tree, covering the error,
      authorisation and validation branches the lane's happy-path tests missed.
- [ ] **Step 2: Run** per-directory coverage; record the starting numbers.
- [ ] **Step 3: Implement**, asking the owning lane for any production defect found.
- [ ] **Step 4: Run** until each module directory meets 90/90/85 per file.
- [ ] **Step 5: Commit**, one commit per module so a lane can review its own.

### Task 4: E2E coverage leg (≥ 80 % API lines)

- [ ] **Step 1: Write the failing gate** behind `pnpm coverage:e2e` — today a `pending-gate` placeholder —
      instrumenting the API process while W16's Playwright suite drives it, and failing below 80 % lines.
- [ ] **Step 2: Run** it and record the real figure.
- [ ] **Step 3: Implement** the instrumentation and the reporting; add journey coverage with W15 where the gap is
      a missing journey rather than a missing unit test.
- [ ] **Step 4: Run** until ≥ 80 %.
- [ ] **Step 5: Commit.**

### Task 5: Per-operation evidence completeness

- [ ] **Step 1: Run** `pnpm check:operations --require-complete` and record the failure list.
- [ ] **Step 2:** For every operation with a resolver but no evidence record, confirm the owning lane's tagged
      integration test exists and names the operation with `op("type.name")`.
- [ ] **Step 3:** Populate `docs/OPERATION_TEST_EVIDENCE.json` **only** from tests that actually ran, each with an
      inspectable artifact path and a reviewer. Never record evidence for a test you did not see pass.
- [ ] **Step 4: Run** until the command exits 0.
- [ ] **Step 5: Commit**, and hand W23 the evidence set for review.

### Task 6: Keep it closed

- [ ] **Step 1:** Confirm `pnpm coverage` is in the G2 and G3 command sets in `docs/ROADMAP.json` so a later lane
      cannot lower coverage unnoticed.
- [ ] **Step 2:** Record the closing run and request W23/W24 approval. No self-approval.

---

## 5. Gate checklist (G3, coverage portion)

- [ ] `pnpm coverage` passes with per-file 90/90/85 across `src/kernel/**` and the module directories.
- [ ] `pnpm coverage:e2e` reports ≥ 80 % API lines under the Playwright suite.
- [ ] `pnpm check:operations --require-complete` exits 0.
- [ ] No threshold was lowered, no file ignored, no coverage-only test added.
- [ ] Every production defect found is filed against its owning workstream.
- [ ] W23 and W24 approvals recorded.

---

## 6. Open blockers

A real database and Redis (Docker/Colima) for the integration leg, W16's Playwright suite for the E2E leg, and
owner-side infrastructure for anything the harness cannot reach locally. There is no CI, so every closing run is a
recorded local run (`ROADMAP.md` §13 U1) — a coverage number that was never recorded in `docs/GATES.json` does not
count.
