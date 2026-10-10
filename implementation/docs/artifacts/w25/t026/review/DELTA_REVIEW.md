# T-026 delta re-review — post-review fixes

Reviewer: `w25-review` (shared task `task-6`; independent, did not write any reviewed code).
Date: 2026-10-10. HEAD at review: `0defd61` (with `88c075b` and `bb7434a` in the window).
This verifies **only what changed since the first review `5353c9f`**; the first review
([`REVIEW.md`](./REVIEW.md)) remains the record for the original commits.

Delta commits:

| commit | owner | scope |
| --- | --- | --- |
| `88c075b` | `lead` | T-026C C1/C2/C3 fix + D3 correction (`tools/lib/operation-state.{mjs,test.mjs}`, `docs/artifacts/w25/t026/state/**`) |
| `0defd61` | `w25-smoke` | T-026A A1/A2 fix (`e2e/smoke/**`, `docs/artifacts/w25/t026/smoke/**`) |
| `bb7434a` | `lead` | `docs/artifacts/w25/t026/state/REPO_TEST_STATUS.md` (context for the `pnpm test` judgement call) |

## Verdicts

| delta item | verdict | reason |
| --- | --- | --- |
| 1. T-026C post-review fix (`88c075b`) | **PASS** | My adversarial fixtures confirm class/property/parameter decorations are no longer counted, real method roots still are, comments/strings ignored, case contract intact; 8/8 spec, 39/39 compare with 0 dropped/0 added, `format:check` clean repo-wide, the under-count limitation is pinned by a test and fails safe. |
| 2. `GATE_DECISION.md` D3 correction | **PASS** | G1 now lists all six commands with three changed / three unaffected, matching `GATES.json`/`ROADMAP.json`; deferral reasoning still holds. One naming nit remains (D-n1). |
| 3. Smoke A1/A2 fix (`0defd61`) | **PASS WITH FINDINGS** | Every vector the first review named is out of the passthrough set and the guard rejects re-added ones; the probe now observes only the 3 bootstrap processes (was 11); three consecutive runs give identical fingerprints `77c151b2309f836b` (api) / `60ecfee0ef6bcd2e` (build, migrate) with 12/12 PASS. Two minor residuals (A-d1, A-d2). |
| 4. Scope hygiene of the delta commits | **PASS** | Both commits contain only their declared scopes, no W3 identity/`app.ts`/test/prisma path, index empty, no reviewed file dirty relative to its commit. |
| 5. `package.json` `test:e2e-smoke` judgement call | **reasoning SOUND, script not yet present** | `pnpm test` is a recorded gate command, so extending its glob would change a recorded command's coverage; a standalone script is the correct alternative. As of this review `test:e2e-smoke` does not exist (D-p1). |

**Is T-026 fit to close from the reviewer's standpoint? Yes.** Every finding from the first
review that was fixable in this lane is verified closed (A1, A2, C1, C2, C3, D3); no new
blocking counterexample was found. The remaining items are minor and named below, and the
deferred G0/G1 re-record remains a deliberate, documented follow-up rather than a T-026 defect.

---

## 1. T-026C post-review fix (`88c075b`) — PASS

`implementedRoots` now guards the decorator loop with `if (ts.isMethodDeclaration(node))`
(`tools/lib/operation-state.mjs:101`), so a root decorator is only counted on a method.

**My own adversarial fixtures** ([`adversarial-roots.mjs`](./adversarial-roots.mjs), unchanged
from the first review so the before/after is directly comparable;
[`30-delta-C-verification.log`](./30-delta-C-verification.log)) now report:

```
observed keys: mutation.changePassword, query.emailExist, query.firstArg, query.templateArg
OK  absent  query.propertyDecorated      (was a COUNTEREXAMPLE in 5353c9f)
OK  absent  query.classDecorated         (was a COUNTEREXAMPLE in 5353c9f)
OK  absent  query.parameterDecorated     (was a COUNTEREXAMPLE in 5353c9f)
OK  counted query.emailExist             (camelCase preserved)
OK  counted mutation.changePassword      (kind lowercased)
OK  absent  query.blockCommentMultiLine / mutation.nestedCommentText
OK  absent  query.inTemplateText / mutation.inSubstitution / query.inSingle / mutation.inDouble
OK  absent  query.esc"aped
MISMATCH absent query.parenthesised, query.concatenated   <- accepted, test-pinned limitation
```

The two remaining `MISMATCH` lines are exactly the C3 limitation: the fix deliberately does not
evaluate expressions. It is pinned by a test rather than prose —
`documents the argument shapes that are deliberately not resolved` asserts the result is
`["query.plain"]` only — and the direction fails safe: an uncounted root falls back to the
`NOT_IMPLEMENTED` kernel, whereas an invented root would be a fabricated progress claim.

Gates re-run by me:

```
$ node --test tools/lib/operation-state.test.mjs    → tests 8, pass 8, fail 0
$ node docs/artifacts/w25/t026/state/compare.mjs    → legacy 39 / tree 39, dropped 0, added 0
$ ./tools/pnpm.sh exec prettier --check tools/lib/operation-state.{mjs,test.mjs}  → clean
$ ./tools/pnpm.sh format:check                      → "All matched files use Prettier code style!"
```

The recorded `equivalence-post-review.txt` (38/38 at its time) is now 39/39 because the
concurrent W3 lane added another resolver; the substantive claim (0 dropped / 0 added) holds and
no genuine root was lost by tightening to methods.

## 2. `GATE_DECISION.md` D3 correction — PASS

The corrected lines 9-22 now say G1 has **six** commands and mark each:

```
- pnpm check:enatega — changed
- pnpm check:enatega:full — changed
- pnpm check:enatega:singlevendor — changed
- pnpm codegen:check — unaffected
- pnpm test:integration — unaffected
- pnpm check:operations:schema — unaffected
```

This matches `docs/GATES.json` (approved run `3c1afc290a00`, approvals `lead`, `reviewer-SEC`) and
`ROADMAP.json` `gates.G1.commands` exactly, and the file now cites the approved run `3c1afc2`
rather than the superseded `ddd3f02` record — an improvement over the first review.

The deferral reasoning still holds and I re-verified its two mechanisms in code:
`tools/record-gate.mjs` resets `approvals: []` on a new run (lines 153, 182) and
`tools/approve-gate.mjs:90-92` refuses a run whose latest record is `dirty`. The G0 section is
consistent with my acceptance runs (same command, same flag surface, same 12 checks; artifact
shape changed).

**D-n1 (info, cosmetic):** line 37 still calls the G1 approvals "`lead` + `w2-sec-review`";
`GATES.json` records `["lead","reviewer-SEC"]`. Same nit as the first review's D6.

## 3. Smoke A1/A2 fix (`0defd61`) — PASS WITH FINDINGS

### A1 — code-injection and credential vectors

Every name the first review named is gone from `PASSTHROUGH_ENVIRONMENT_NAMES`:
`NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `DOCKER_HOST`, `DOCKER_CONTEXT`,
`DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH` now live in `BLOCKED_ENVIRONMENT_HAZARDS` with a reason,
and `assertNoInheritedSecrets` checks every env entry both by name (blocked/secret) and by value
(URL userinfo, Node injection flags).

My own evasion suite ([`adversarial-env-delta.mjs`](./adversarial-env-delta.mjs),
[`31-adversarial-env-delta.log`](./31-adversarial-env-delta.log)):

- all seven vectors are dropped by the builder (`keys=APP_ENV` only) and each forced re-add makes
  the guard throw — a future edit cannot silently reopen them;
- a credential URL on a name that is neither allowlisted nor secret-named (`HTTP_PROXY`) is
  dropped, and the guard catches it if forced;
- `scanAmbientHazards` reports `NODE_OPTIONS`, `DOCKER_HOST`, `HTTP_PROXY` with reasons and leaves
  `PATH` alone — exactly the documented behaviour.

**The strongest independent observation:** because `NODE_OPTIONS` no longer reaches children, the
reviewer probe can only instrument the processes *above* the harness. Re-running the poisoned
acceptance with my own probe produced **3 lines** — `corepack`, `pnpm e2e:smoke`, `run.mjs`
(bootstrap, carrying the poison) — versus **11** in the first review. Zero harness-spawned
processes were instrumented, which is direct evidence the injection vector is closed, not merely
that a list changed ([`35-delta-smoke-results.log`](./35-delta-smoke-results.log)):

```
run3 probe lines: 3
  corepack enable / .toolchain/bin/pnpm e2e:smoke / e2e/smoke/run.mjs  (bootstrap only)
```

The poisoned run still PASSes 12/12, and I reproduced the support claim that the poison is fatal
to the API config (`readConfig` rejects the poisoned `PUBLIC_ACCESS_SECRET`; the deterministic
keys are accepted) — [`38-poison-fatal-repro.log`](./38-poison-fatal-repro.log). The run's
`ambientHazards` also caught a value-based vector on a non-allowlisted name
(`SMTP_URL=smtp://user:pass@…`).

### A2 — run-stable deterministic fingerprint

`fingerprintSecrets` (which hashed every secret-named variable) is replaced by
`fingerprintDeterministicSecrets`, which hashes only the three values `smokeSecrets()` derives
with an explicit `<absent>` marker; per-run endpoints are recorded separately and
credential-redacted by `describeEphemeralContainerPlumbing`. I ran the acceptance **three times
myself** (two normal + one poisoned, serialised, [`32-run*.log`](./35-delta-smoke-results.log)):

| run | check count | build fp | migrate fp | api fp |
| --- | --- | --- | --- | --- |
| 1 normal | 12 PASS exit 0 | `60ecfee0ef6bcd2e` | `60ecfee0ef6bcd2e` | `77c151b2309f836b` |
| 2 normal | 12 PASS exit 0 | `60ecfee0ef6bcd2e` | `60ecfee0ef6bcd2e` | `77c151b2309f836b` |
| 3 poisoned | 12 PASS exit 0 | `60ecfee0ef6bcd2e` | `60ecfee0ef6bcd2e` | `77c151b2309f836b` |

The ephemeral plumbing differed every run (`localhost:32925/32927/32929` vs `32926/32928/32930`)
while the fingerprints stayed fixed, which is exactly the separation the finding asked for. The
numbers match the owner's committed artifacts and the Lead's claim
(`77c151b2309f836b` api, `60ecfee0ef6bcd2e` build/migrate).

### A findings

**A-d1 (low) — `redactCredentials` does not redact a username-only userinfo.** Exact fixture:

```
redactCredentials("redis://user@host:6379")  ->  "redis://user@host:6379"   (unchanged)
redactCredentials("redis://user:secret@host:6379")        -> redis://***:***@host:6379   OK
redactCredentials("redis://:onlypassword@host:6379")      -> redis://***:***@host:6379   OK
redactCredentials("redis://user:p%40ss@host:6379")        -> redis://***:***@host:6379   OK (encoded handled)
```

Cause: the replace string is built as `${username}:${password}@`, which never matches
`user@host`. Impact is low — no password is leaked, the recorded testcontainers URLs have no
userinfo, and the exposed value is the username of an ephemeral local container — but the
function's stated job is to redact credentials. Owner `w25-smoke`; fix by rebuilding the URL
from `url.username`/`url.password` (or replacing the userinfo span) instead of a literal
`user:pass@` match.

**A-d2 (low, documented residual) — a password in a URL query string is not a hazard, and on an
allowlisted name it would pass.** Exact fixtures:

```
describeAmbientHazard("WEBHOOK_ENDPOINT", "https://hooks.invalid/x?password=hunter2")  -> null
buildChildEnvironment({WEBHOOK_ENDPOINT: "...?password=hunter2"}, {})                 -> dropped (name not allowlisted)
assertNoInheritedSecrets({XDG_CACHE_HOME: "https://h/?password=x"}, {XDG_CACHE_HOME: "https://h/?password=x"}, {}) -> does NOT throw
```

So the guard detects userinfo but not query-string credentials, and it would not catch one if a
future edit both allowlisted a URL-valued name and put a query-string credential there. Today no
allowlisted name is URL-valued (the hazard test asserts the allowlist is non-hazardous by name),
so this is not reachable through the current builder; it is worth one line in the module comment
so the boundary is as explicit as the `PATH` one.

**A-d3 (confirmed, not a finding) — the `PATH` boundary is accurate.** `PATH` is still inherited
(`buildChildEnvironment({PATH:"/tmp/evil-bin:/usr/bin"}, {})` keeps it) and
`assertNoInheritedSecrets` does not and cannot flag it; the module comment says exactly this and
explains why no other inherited name can shadow an executable. I found nothing wider: every other
passthrough name is non-URL, non-flag plumbing.

## 4. Scope hygiene — PASS

`git show --pretty=format: --name-only` for both commits ([`34-delta-scope.log`](./34-delta-scope.log)):

- `88c075b`: `tools/lib/operation-state.{mjs,test.mjs}` + `docs/artifacts/w25/t026/state/{EVIDENCE.md,GATE_DECISION.md,equivalence-post-review.txt}`;
- `0defd61`: `e2e/smoke/{environment.mjs,environment.test.mjs,run.mjs,fixtures/child-env-probe.cjs}` + `docs/artifacts/w25/t026/smoke/**`.

No path matching `services/api/src/identity/**`, `services/api/src/app.ts`,
`services/api/test/**/identity/**` or `prisma/**` in either commit. `git diff --cached --name-only`
was empty. All six reviewed files were `git diff`-clean against their commits, and
`docs/artifacts/w25/t026/smoke/code-state-a1-a2.sha256` matches the four committed smoke files
byte-for-byte. Both `node --test` suites and all acceptance runs wrote nothing into the tracked
tree (focused no-write check in [`37-suite-no-write.log`](./37-suite-no-write.log): the suite of
112 tests leaves `docs/*` and `tools/` byte-identical).

## 5. The `package.json` judgement call — reasoning sound, script not yet present

**D-p1 (info): `test:e2e-smoke` is not in `package.json` yet** — I read it directly:
`test => "turbo run test && node --test tools/*.test.mjs tools/lib/*.test.mjs"` and
`test:e2e-smoke => undefined`. So the new spec currently runs only when invoked by hand and is not
wired into any script.

On the reasoning itself: **it is correct.** `pnpm test` is a recorded gate command — it appears in
GP0 and G2 in `docs/GATES.json` and in `ROADMAP.json` `gates.GP0.commands` (which also lists the
explicit `node --test tools/*.test.mjs`). Extending its glob would change what a recorded
"`pnpm test` passed" run covered at that commit, which is the same class of change as the G1
`--check` change and would carry the same re-record obligation. Adding a standalone
`test:e2e-smoke` script changes no existing command's coverage, so it needs no re-record — and
`test:operation-evidence` (`node --test tools/check-operation-evidence.test.mjs`) is the exact
precedent. Two things to keep in mind:

1. Add the script in this round (it is the only thing that keeps the new regression spec from
   rotting silently); `pnpm format:check` already covers the file, which is partial protection.
2. Do **not** add `e2e/smoke/environment.test.mjs` to the `tools/*.test.mjs` glob for the same
   reason — that glob is itself a recorded GP0 command string.

## Could not verify

- Whether the smoke runs were free of concurrent Docker work for their whole duration: I checked
  `docker ps` before starting and ran the three runs serially in one job; I cannot observe other
  sessions' scheduling.
- That the committers' identities and "no out-of-scope command was run" statements are accurate —
  not derivable from repository state.
- The pre-fix (round-1) transcripts as live runs — unchanged from the first review; reverting
  `run.mjs` is forbidden. The round-2 claims that matter were all re-run live.
- Whether `pnpm test` (the full turbo suite) passes repo-wide: I ran the tools-suite portion only
  (`node --test tools/lib/*.test.mjs tools/*.test.mjs`, 112 tests / 108 pass / 4 fail, all four
  pre-existing generated-status drift, A/B identical under the regex implementation — this also
  reproduces `REPO_TEST_STATUS.md`'s claim).

## Log index (delta)

`30-delta-C-verification.log`, `31-adversarial-env-delta.log`, `32-run1-normal.log`,
`32-run1-artifact.json`, `32-run2-normal.log`, `32-run2-artifact.json`, `32-run3-poisoned.log`,
`32-run3-poisoned-artifact.json`, `32-run3-poisoned-probe.jsonl`, `33-code-state-and-package.log`,
`34-delta-scope.log`, `35-delta-smoke-results.log`, `36-repo-tools-suite-AB.log`,
`37-suite-no-write.log`, `38-poison-fatal-repro.log`, `adversarial-env-delta.mjs`.

I did not approve my own work; the Lead closes T-026.
