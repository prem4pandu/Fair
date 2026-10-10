# Repo-wide tools suite status during the T-026 window

Command: `node --test tools/lib/*.test.mjs tools/*.test.mjs` from `implementation/`
(the same glob the root `pnpm test` script uses for tool tests).

Observed: **112 tests, 108 pass, 4 fail.** The run caused no working-tree changes
(`git status --short` identical before and after), so no test wrote into the tree.

Failing tests (all generated-status consistency tests):

1. `reported resolver coverage matches an independent source scan`
2. `roadmap status is current and internally consistent`
3. `status report is current, self-contained, and accessible`
4. `status reports only derived facts and never claims an unapproved gate`

## A/B control — these are not T-026 failures

The same four tests were run with `tools/lib/operation-state.mjs` restored from
`HEAD` (the retired regex implementation) and with the committed AST implementation.
Both runs fail exactly the same four tests, with the same names:

```
=== HEAD (regex) implementation ===
✖ reported resolver coverage matches an independent source scan
✖ roadmap status is current and internally consistent
✖ status report is current, self-contained, and accessible
✖ status reports only derived facts and never claims an unapproved gate

=== AST implementation ===
✖ reported resolver coverage matches an independent source scan
✖ roadmap status is current and internally consistent
✖ status report is current, self-contained, and accessible
✖ status reports only derived facts and never claims an unapproved gate
```

The file was restored byte-identically afterwards (empty `git diff` against the
committed revision). Conclusion: T-026C changes nothing that these tests observe.

## Cause

The failures are live-source-versus-committed-generated-document drift. The
concurrent W3 lane holds uncommitted resolvers in `services/api/src/identity/**`
(and uncommitted `updateUser` specs) while `docs/ROADMAP_STATUS.md`,
`docs/IMPLEMENTATION_STATUS.*` and `docs/OPERATION_TRACEABILITY.md` are generated
artifacts committed at an earlier source state. Nothing in T-026 regenerates those
documents — deliberately: they are lead-owned files another session is editing
(see `GATE_DECISION.md`).

This is the same class the first review (`5353c9f`) reported: it observed the drift
at 23 live vs 22 recorded, then saw the W3 lane regenerate to 23/334 (7/7 passing)
at commit `768e0bc`, and it is stale again now because that lane has since added more
resolvers without regenerating. Whose problem: the W3 / generated-document owner at a
clean point — not T-026.

Recorded: 2026-10-10, lead-dsh-w25.
