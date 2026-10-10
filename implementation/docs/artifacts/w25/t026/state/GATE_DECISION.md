# Lead decision — G1 re-record window (T-026B side effect)

Date: 2026-10-10. Owner: lead-dsh-w25.

## The question

`docs/TASK_BOARD.md` row T-026 says: "no gate command changes without re-recording that
gate". task-2 changes the behaviour of `--check` in
`tools/check-enatega-compatibility.mjs`, and the recorded **G1** run
(`docs/GATES.json`, commit `ddd3f02`, closed at `3c1afc2`) consists of exactly:

- `pnpm check:enatega`
- `pnpm check:enatega:full`
- `pnpm check:enatega:singlevendor`

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

`package.json` `test` currently globs `tools/*.test.mjs tools/lib/*.test.mjs`. Adding a
new spec directory to that glob would change what the recorded GP0/G1 `pnpm test`
command covers — the same re-record requirement applies. So task-1's
`e2e/smoke/environment.test.mjs` is deliberately **not** wired into `pnpm test` in this
round; it runs explicitly as `node --test e2e/smoke/environment.test.mjs` and the wiring
is deferred to the same clean-tree window.
