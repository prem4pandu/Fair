# Handoff — W25 T-026 (DSH multi-agent session, 2026-10-10)

Written by the Lead of the DSH session (`lead-dsh-w25`) so a **different session** can
continue without re-deriving anything. Read this together with
[`TASK_BOARD.md`](../../TASK_BOARD.md) row T-026 (now in **Done**) and
[`GATE_DECISION.md`](./state/GATE_DECISION.md).

## What was delivered

Row T-026 closed the three W24 residuals. Verdict from the independent reviewer:
**fit to close**.

| Item                           | Commit(s)          | Owner        | Verified result                                                                                                                                                                                                             |
| ------------------------------ | ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-026A smoke child environments | `24468a8` `0defd61` | w25-smoke    | Pre-fix, 7 of 8 harness-spawned children received poisoned ambient secrets while the run still printed PASS. Now an allowlist builder + `assertNoInheritedSecrets` + `scanAmbientHazards`; `pnpm e2e:smoke` 12/12 PASS exit 0 (normal ×2, poisoned ×1); spec 18/18; deterministic fingerprint identical across three runs. |
| T-026B `--check` must diff      | `8b9c84d`          | w25-checker  | Pre-fix, `--check` silently rewrote a corrupted report and exited 0. Now it never writes, names every difference, exits 1 on drift/missing/invalid JSON; 26/26 tests; the three reports hash-identical after all three gate commands. |
| T-026C implemented-root detection | `2bbddc4` `88c075b` | lead       | Raw-text regex → TypeScript syntax tree, restricted to method declarations. Spec 8/8; real-repo equivalence vs the retired regex `39/39`, **0 dropped / 0 added**.                                                                 |
| Review                          | `5353c9f` `5cbe3da` | w25-review   | First review found real defects (see below); delta review confirmed every fix.                                                                                                                                               |

Supporting commits: `1ad6580` board claim, `c6b91bb` + `569daf0` + `e16d326` gate decision
and script, `bb7434a` repo test status, `2076689` board closure.

### Defects the process actually caught

Worth keeping, because they are the reason the review existed:

1. **The `--check` gate command was silently repairing the report it verified** — the
   strongest finding; a gate that cannot detect drift is not a gate.
2. **The smoke harness leaked real ambient secrets into 7 of 8 children** and still
   reported PASS — no test failed, only the probe found it.
3. **My own first T-026C fix over-claimed** roots decorated on a class, a property or a
   parameter, and the new spec failed `pnpm format:check` even though its tests passed.

## Resuming in a new session — verify before you trust

```bash
cd implementation
./tools/pnpm.sh test:e2e-smoke-env          # 18/18 — NOTE: bare `pnpm` is not on PATH here
node --test tools/lib/operation-state.test.mjs        # 8/8
node --test tools/check-enatega-compatibility.test.mjs # 26/26
node docs/artifacts/w25/t026/state/compare.mjs         # expect 0 dropped / 0 added
npx prettier --check .                                 # clean
./tools/pnpm.sh e2e:smoke                              # 12/12 PASS (needs the Docker slot, serialise)
git log --oneline -14                                  # the commits above
```

Known non-green, **not** caused by T-026: `node --test tools/lib/*.test.mjs tools/*.test.mjs`
is 108/112 with 4 generated-status tests failing. The four reproduce identically with the
pre-T-026 implementation — see [`REPO_TEST_STATUS.md`](./state/REPO_TEST_STATUS.md). Cause:
live source ahead of committed generated documents (`ROADMAP_STATUS.md`,
`IMPLEMENTATION_STATUS.*`, `OPERATION_TRACEABILITY.md`) while the concurrent W3 lane adds
resolvers. Those documents are lead-owned; regenerating them mid-batch is what T-026
deliberately refused to do.

## Parked work — do not lose these

1. **G0 + G1 re-record** (the only real T-026 consequence left). Both gates were recorded
   against the pre-T-026 tooling: G1's `check:enatega*` commands and G0's `e2e:smoke`
   internals. Preconditions and exact steps are in
   [`GATE_DECISION.md`](./state/GATE_DECISION.md). The critical hazard: re-recording on a
   dirty tree **erases that gate's existing approvals** and the new run can never be
   approved, so it must happen in a clean-tree window when the concurrent Batch 3 session
   has settled. Do not run `record-gate` opportunistically.
2. **T-030** (new board row, unclaimed): redact username-only URL userinfo and treat a
   query-string credential as a hazard in the smoke guard. Both are non-blocking leftovers
   named by the delta review; `e2e/smoke/**`, reviewer W24.
3. **`pnpm test` glob decision (optional)**: the smoke env spec runs via the standalone
   `test:e2e-smoke-env` script. Moving it into the `pnpm test` glob changes a recorded gate
   command's coverage and therefore needs the same re-record — decide in that window.

## Working in this repository — hard-won rules

- **The working tree is shared with another live session.** During this task it was
  running the Batch 3 W3 identity push (it added `mutation.emailExist`, `phoneExist`,
  `changePassword`, `Deactivate`, `updateUser`, three migrations, and was mid-`updateUser`
  at the end). It commits every few minutes.
- Therefore: **never** `git add -A`/`git add .`/`git stash`/`git reset`/`git clean`/
  `git checkout --`. Commit with an explicit pathspec naming only your files. Several
  times in this task, a narrower pathspec was the only thing that prevented another
  lane's uncommitted work from being swept into a commit.
- Write scope discipline is not ceremony: `tools/**`, root configs, `docs/GATES.json` and
  the generated status documents are lead-only; `services/api/src/identity/**` belongs to
  W3; `e2e/**` to W15/W16. Overlap causes a lost update, not a merge conflict.
- Docker: the other session restarts postgis/redis testcontainers constantly. Run the
  smoke harness serially, never kill their containers, and treat container churn as
  normal noise.
- `pnpm` is not on `PATH` in this shell; use `./tools/pnpm.sh <script>`.

## Multi-agent map (this session's DSH team tasks)

`task-1` T-026A (w25-smoke) · `task-2` T-026B (w25-checker) · `task-3` T-026C (lead) ·
`task-4` first independent review (w25-review) · `task-5` A1/A2 fixes (w25-smoke) ·
`task-6` delta re-review (w25-review). Every writer claimed its task before starting and
committed under its own pathspec; the reviewer wrote nothing outside the review directory
and never approved its own work. If a later session re-uses this pattern, keep the rule
that **the agent that implemented a row never marks it complete** — the reviewer's verdict
closed T-026, not the implementers.

## Evidence index

- [`state/EVIDENCE.md`](./state/EVIDENCE.md) — T-026C: defect classes, red/green, equivalence,
  post-review hardening.
- [`state/REPO_TEST_STATUS.md`](./state/REPO_TEST_STATUS.md) — repo-wide suite status with the
  A/B control.
- [`state/GATE_DECISION.md`](./state/GATE_DECISION.md) — G0/G1 re-record decision and preconditions.
- [`checker/README.md`](./checker/README.md) — T-026B baseline defect, TDD, acceptance, drift demo.
- [`smoke/README.md`](./smoke/README.md) — T-026A round 1 and round 2, verbatim transcripts.
- [`review/REVIEW.md`](./review/REVIEW.md) — first independent review, all findings and counterexamples.
- [`review/DELTA_REVIEW.md`](./review/DELTA_REVIEW.md) — delta re-review, fit-to-close statement.
