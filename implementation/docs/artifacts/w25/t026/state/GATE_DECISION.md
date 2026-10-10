# Lead decision — G1 re-record window (T-026B side effect)

Date: 2026-10-10. Owner: lead-dsh-w25.

## The question

`docs/TASK_BOARD.md` row T-026 says: "no gate command changes without re-recording that
gate". task-2 changes the behaviour of `--check` in
`tools/check-enatega-compatibility.mjs`. The recorded **G1** run
(`docs/GATES.json`, commit `3c1afc2`) has **six** commands, three of which are the
checker commands whose semantics changed:

- `pnpm check:enatega` — changed
- `pnpm check:enatega:full` — changed
- `pnpm check:enatega:singlevendor` — changed
- `pnpm codegen:check` — unaffected
- `pnpm test:integration` — unaffected
- `pnpm check:operations:schema` — unaffected

(Correction recorded after the independent review, `5353c9f`, finding D3: an earlier
revision of this file said G1 "consists of exactly" the three checker commands. It does
not — the run has six, and only the three above are invalidated by T-026B.)

So G1's evidence was produced by a checker that silently rewrote the report it was
verifying. The recorded run is still a true record of what ran at that commit, but the
*checker* has changed, so G1 must be re-recorded before it can be relied on again.

## Decision: do NOT re-record G1 now

Reasons, in order of severity:

1. **Re-recording would un-close G1.** `record-gate` clearing that gate's approvals is
   defined behaviour, and `approve-gate` refuses a run recorded over a dirty tree. The
   shared working tree is continuously dirty — a second, concurrently running session is
   committing W3 identity work (it added migrations `202610100001_l1_phone` and
   `202610100002_l1_audit_actions` and holds uncommitted `changePassword` sources during
   this task). Re-recording now would erase the existing `lead` + `w2-sec-review`
   approvals on G1 and replace them with a run that can never be approved. That is a
   strictly worse repository state than leaving G1 as-is with a recorded follow-up.
2. The dirty-tree condition is not ours to fix: those files belong to another lane, and
   AGENTS.md forbids overwriting another lane's files.
3. Nothing downstream is blocked today: no lane's completion depends on G1's recorded
   run being re-derived, and every command in the old run still reproduces the same
   PASS results (verified by task-2's acceptance).

## Second gate in the same window: G0 (`pnpm e2e:smoke`)

task-1 rewrote how `e2e/smoke/run.mjs` builds the environment of every child process
it spawns, and changed the shape of `test-results/e2e-smoke.json` (it now records the
excluded ambient secret names and each child's key set/fingerprint). The G0 run
recorded in `docs/GATES.json` (commit `76d8fd2`) therefore reflects the pre-T-026
harness.

What did **not** change: the command string, the flag surface, the exit-code
convention (0 pass / 1 fail), the check count and the check list — the post-fix run
reports the same `PASS — 12 checks` as the recorded G0 run. The recorded verdict still
holds; what is stale is the artifact *shape* a re-run would produce.

Decision: **same window as G1.** Re-record G0 together with G1 when the tree is clean
and Batch 3 has settled, so a single re-approval cycle covers both, rather than
re-opening G0 twice. Until then, any handoff that cites G0 must say it was recorded on
the pre-T-026 smoke harness and name this file.

## Conditions the re-record must satisfy (carry into the next session)

- [ ] The shared working tree is clean (`git status --porcelain` empty) because the
      concurrent Batch 3 session has committed or paused.
- [ ] task-2 is merged and independently reviewed (task-4 PASS).
- [ ] `pnpm record-gate --gate G1` is run from that clean tree at the resulting commit.
- [ ] Both G1 roles re-approve: `lead` and the W24 security reviewer
      (`pnpm approve-gate --gate G1 --role <role> --reviewer "<identity>"`), neither of
      whom may be the recording identity for that gate.
- [ ] `pnpm approve-gate --list` shows G1 fully signed again before any document claims
      G1 CLOSED.

Until then, any status document or handoff that references G1 must say it is
**approved on the pre-T-026 checker** and name this file.

## Same class of issue to watch

`package.json` `test` globs `tools/*.test.mjs tools/lib/*.test.mjs`. Adding a new spec
directory to that glob would change what the recorded GP0/G1 `pnpm test` command covers
— the same re-record requirement applies. So task-1's `e2e/smoke/environment.test.mjs`
is deliberately **not** added to the `pnpm test` glob.

It is instead reachable through a standalone script added by the Lead:
`pnpm test:e2e-smoke-env` → `node --test e2e/smoke/environment.test.mjs`. A new script
is additive: no recorded gate command changes, so it needs no re-record. Wiring the spec
into `pnpm test` itself remains deferred to the clean-tree window.

- [ ] Optional, same window: decide whether the smoke env spec joins the `pnpm test`
      glob (it would require re-recording GP0/G1, because that command's coverage
      changes).

Note that repo-wide `pnpm test` is not green at the moment for reasons unrelated to
T-026: `docs/artifacts/w25/t026/state/REPO_TEST_STATUS.md` records 4 generated-status
consistency failures that reproduce identically with the pre-T-026 implementation.
