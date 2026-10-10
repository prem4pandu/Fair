# T-026 (W25 tooling residuals) — independent review

Reviewer: `w25-review` (shared task `task-4`, repo role W24 security/architecture + W23 QA checks).
Date: 2026-10-10. Working directory: `/Users/premkumarmamidi/Development/Fair/implementation`.
I did not write any of the reviewed code and I did not fix it. Reviewed HEAD at the start of the
review: `24468a8`; the concurrent W3 lane and the Lead committed during the review (HEAD at the
end: `6c888eb`).

Commits under review (fixed hashes):

| commit | item | owner |
| --- | --- | --- |
| `24468a8abbe01bf043158fbacf7cfaeedbec3c33` | A — deterministic smoke child environments | `w25-smoke` |
| `8b9c84d60b5d05e7b844f031b835c0b986a9f6e1` | B — `check:enatega --check` diffs instead of rewriting | `w25-checker` |
| `2bbddc404c13855bf5e150a5344ce773ddfa1505` | C — syntax-tree implemented-root detection | `lead` |
| `c6b91bb3df359f81c89e5938ec4dcea37da1d7b8` | D — G1/G0 re-record decision note (plus concurrent `569daf0` adding the G0 section) | `lead` |

Method: read the code and the evidence, then re-run the acceptance myself; try to falsify each
claim with fixtures the owners did not write; audit commit scopes; reproduce evidence that can be
reproduced read-only. No repo file outside `docs/artifacts/w25/t026/review/` was left modified
(the only exception is a deliberate, trap-guarded temporary swap of
`tools/lib/operation-state.mjs` to the parent-commit version for the A/B control, restored and
hash-verified — see §C). I did **not** run `pnpm record-gate`, `pnpm approve-gate`, `pnpm roadmap`
or `pnpm check:operations`, did not stage or commit another lane's files, and did not close T-026.

## Verdicts

| item | verdict | one-line reason |
| --- | --- | --- |
| A — T-026A smoke environments (`w25-smoke`) | **PASS WITH FINDINGS** | Non-inheritance is real and reproduced (12/12 normal and poisoned; 8/8 harness-spawned children clean); two boundary/doc findings (A1, A2). |
| B — T-026B `--check` diffs (`w25-checker`) | **PASS** | Zero write paths in `--check`, drift named precisely, three gate commands PASS with byte-identical reports; pre-fix rewrite defect independently reproduced and shown fixed. |
| C — T-026C syntax-tree detection (`lead`) | **PASS WITH FINDINGS** | Core defect and case contract correct, RED/GREEN and 0-dropped/0-added reproduce; residual false-positive and false-negative classes (C2, C3) and a real `pnpm format:check` break (C1). |
| D — cross-cutting | **PASS WITH FINDINGS** | All four commits are scope-clean and contain no W3 identity/prisma path; evidence reproduces except where the concurrent lane moved the tree; `GATE_DECISION.md` overstates/understates the G1 command set (D3) and the lane introduced two prettier violations (D5). |

No fabricated evidence was found: every command transcript I could re-run reproduced, including
the pre-fix probe analysis and the pre-fix checker defect.

---

## A. T-026A — deterministic, non-inheriting smoke child environments

### A.1 Acceptance re-run: `pnpm e2e:smoke` (normal environment)

Ran serially after `docker ps` (only the other lane's `amazing_bardeen` redis container up),
full transcript in [`02-smoke-normal.log`](./02-smoke-normal.log):

```
$ ./tools/pnpm.sh e2e:smoke          # from implementation/
[e2e:smoke] starting PostGIS and Redis containers
... All migrations have been successfully applied.
[e2e:smoke] starting the built API on 127.0.0.1:51602
[e2e:smoke] health.live: HTTP 200
[e2e:smoke] health.ready: HTTP 200 (Postgres and Redis reachable)
...
[e2e:smoke] PASS — 12 checks; artifact test-results/e2e-smoke.json
exit=0
```

- Check count **12** = the recorded 12/12 in `test-results/e2e-smoke.json` and the recorded G0 run.
  I verified the approved G0 run in `docs/GATES.json` (commit `76d8fd2`, approvals `lead`,
  `reviewer-QA`) also recorded `PASS — 12 checks` in its `outputTail`.
- Real stack: the log shows PostGIS 17 + Redis 7 containers, `prisma migrate deploy`, the built
  API process listening on a real TCP port, real HTTP and both WebSocket subprotocols. There is no
  mock branch in `run.mjs`; the reduced-operation check has a negative control.

Read back from the normal-run artifact before the poisoned run overwrote it:

```
passed=true checks=12 ambientSecretNames=[] children=[build,migrate,api]
build   keys=11 fingerprint e3b0c44298fc1c14
migrate keys=12 fingerprint 279974985cfbfe40
api     keys=23 fingerprint eed2f0d2945dde07
```

### A.2 Independent falsification attempt: poisoned parent environment

I did **not** reuse the owner's probe. I wrote my own
([`child-env-probe.cjs`](./child-env-probe.cjs)) that records a truncated SHA-256 of each
secret-named value plus `ppid`/`argv`, and ran with five poisoned ambient secrets and
`NODE_OPTIONS=--require` pointing at my probe. Full transcript
[`03-smoke-poisoned.log`](./03-smoke-poisoned.log):

```
$ ACCESS_TOKEN_SECRET='poisoned-ambient-access-token-secret-000' \
    REFRESH_TOKEN_PEPPER='poisoned-ambient-refresh-pepper-000000000' \
    PUBLIC_ACCESS_SECRET='poisoned-ambient-public-access-secret-0000' \
    DATABASE_URL='postgresql://poisoned:poisoned@poisoned.invalid:5432/poisoned' \
    REDIS_URL='redis://poisoned.invalid:6379/0' \
    NODE_OPTIONS="--require .../review/child-env-probe.cjs" \
    ./tools/pnpm.sh e2e:smoke
[e2e:smoke] excluding 5 ambient secret variable(s) from every child process: ACCESS_TOKEN_SECRET, DATABASE_URL, PUBLIC_ACCESS_SECRET, REDIS_URL, REFRESH_TOKEN_PEPPER
[e2e:smoke] PASS — 12 checks; artifact test-results/e2e-smoke.json
exit=0
```

My probe observed **11** node processes ([`06-probe-analysis.log`](./06-probe-analysis.log)):

```
3 bootstrap processes above the harness, all carrying the poison:
  corepack enable …            pid 29677
  .toolchain/bin/pnpm e2e:smoke pid 29672
  e2e/smoke/run.mjs            pid 29700
8 processes spawned by the harness, 0 carrying a poisoned value:
  pnpm --filter @fairbite/api build (29801), prisma generate (29833),
  prisma build/child (29845), tsc (29846), prisma migrate deploy (29861),
  prisma build/child (29867), services/api/dist/main.js (29889)
processes that received a poisoned ambient value: 0   (harness-spawned)
```

Exactly the boundary the owner states: the harness cannot filter the shell that launched it
(corepack → pnpm → `run.mjs` keep the ambient environment), and **nothing the harness itself
spawns leaks**. The API child carried the deterministic smoke keys
(`ACCESS_TOKEN_SECRET=AQEBAQ…`, `PUBLIC_ACCESS_SECRET=BwcHBw…`, `REFRESH_TOKEN_PEPPER=AgICAg…`)
and the ephemeral container URLs; `prisma migrate deploy` carried only the overridden
`DATABASE_URL`. This independently confirms the owner's claim.

The owner's own committed probe data also reproduces: re-running
`node docs/artifacts/w25/t026/smoke/analyse-probe.mjs` on
`poisoned-postfix-probe.jsonl` gives byte-for-byte the recorded `probe-analysis-postfix.log`
(11 observed / 3 bootstrap / 8 harness / **0 poisoned**), and on `poisoned-prefix-probe.jsonl`
gives the recorded pre-fix result (**7 of 8 harness-spawned processes leaked**), so the pre-fix
claim is backed by data that is still present and interpreted by a still-present reader.

### A.3 Code-state hashes

`docs/artifacts/w25/t026/smoke/code-state.sha256` matches the committed files exactly
(`run.mjs 7098eac1…`, `environment.mjs 8e6aa0f0…`, `environment.test.mjs 59d3e685…`,
`fixtures/child-env-probe.cjs 298d7418…`). I also reproduced the spec-level RED transcript:
the final `environment.test.mjs` against the pre-fix `run.mjs` (parent `24468a8^`, copied to a
temp dir) fails exactly as recorded with `7 pass / 1 fail` and
`AssertionError: run.mjs still spreads the ambient process.env into a child environment`
([`10-tdd2b-repro.log`](./10-tdd2b-repro.log)).

Pre-fix inheritance lines confirmed in `24468a8^:implementation/e2e/smoke/run.mjs`:
line 339 `env: process.env`, line 348 `env: { ...process.env, DATABASE_URL }`, line 378
`...process.env`.

### A findings

**A1 (low) — the allowlist is name-based, so two allowlisted names are ambient-inheritance
paths that can carry credentials or code and are not caught by the fail-closed assertion.**
Direct probe ([`19-boundary-probes.log`](./19-boundary-probes.log)):

```
child env keys: APP_ENV, DOCKER_CERT_PATH, DOCKER_HOST, NODE_EXTRA_CA_CERTS, NODE_OPTIONS, PATH
DOCKER_HOST carried: true -> tcp://deploy-user:s3cr3t-daemon-password@docker.internal:2376
NODE_OPTIONS carried: true -> --require /tmp/evil-preload.cjs
isSensitiveEnvironmentName("DOCKER_HOST"): false
isSensitiveEnvironmentName("NODE_OPTIONS"): false
assertNoInheritedSecrets: did NOT flag the carried DOCKER_HOST userinfo / NODE_OPTIONS preload
```

`DOCKER_HOST` userinfo is a real credential form and `NODE_OPTIONS=--require` is arbitrary code
injection into every child. The `NODE_OPTIONS` passthrough is load-bearing for the acceptance
probe itself, and `DOCKER_HOST` is passed so the Docker context wrapper works; both are
documented as "process plumbing", so this is a documented trade-off rather than a regression.
It should be named as a residual: the guarantee is "no ambient variable with a secret-looking
**name**", not "no ambient secret material".

**A2 (low) — `fingerprintSecrets()` is not run-stable, so the artifact cannot do what its own
comment says it does.** `environment.mjs:179-183` says the digest exists "so the artifact can
show that the normal and poisoned runs configured the API identically". The digest includes
`DATABASE_URL`/`REDIS_URL`, which are ephemeral per run. The owner's own two committed artifacts
disagree ([`24-fingerprint-stability.log`](./24-fingerprint-stability.log)):

```
postfix-normal-artifact.json    migrate a1de175fbade3cfe   api 8c5e51d6058283b4
poisoned-postfix-artifact.json  migrate 834137e8c4318dd7   api 38301b6391eb086b
```

My two runs also differed (`api eed2f0d2945dde07` normal vs `283311c578bfa0da` poisoned).
`build` is stable (`e3b0c442…`, no sensitive names). Fix: fingerprint only the deterministic
values (or exclude the two connection URLs), or state that the digest is per-run.

**A3 (info) — `.env` residual not fully excluded, but not observed.** A developer
`services/api/.env` would not reach the API process (no dotenv/`ConfigModule` in
`services/api/src`; `main.ts` reads `process.env` only) and the explicit child overrides win.
Whether the Prisma 7 CLI auto-loads a project `.env` into the `prisma generate`/`migrate deploy`
children could not be conclusively tested (see "could not verify"); the impact would be limited
to those children because `prisma.config.ts` reads `process.env.DATABASE_URL` and does not load
dotenv itself.

---

## B. T-026B — `--check` diffs its report instead of rewriting it

### B.1 Static write-safety audit (reading, not trusting)

`grep -n "writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|createWriteStream|renameSync|copyFileSync" tools/check-enatega-compatibility.mjs`
returns exactly two hits: the import and **one** call at line 630, inside the `else` of
`if (check)`. The `--check` branch (lines 618-628) does `existsSync` / `readFileSync`,
`reportDrift(...)` and `console.error` only. Missing file → `reportDrift` returns
`["report file is missing"]`; invalid JSON → caught and returned as a drift line; both set
`process.exitCode = 1` at line 639-643. The non-check path keeps the old
`writeFileSync(output, serialized)`, and the old rule (`exitCode = 1` only when `check`) is
preserved, so the non-check path still exits 0 even on `staticCompatibility: "FAIL"` — that is
pre-existing behaviour, and every gate command uses `--check`.

### B.2 Acceptance re-run

- `node --test tools/check-enatega-compatibility.test.mjs` → **26 tests, 26 pass, 0 fail**.
- Three gate commands ([`04-checker-acceptance.log`](./04-checker-acceptance.log)):
  `./tools/pnpm.sh check:enatega` / `check:enatega:full` / `check:enatega:singlevendor` →
  all `exit=0`; `shasum -a 256 docs/ENATEGA_COMPATIBILITY_REPORT*.json` identical before and
  after (`11819108…`, `2751c5a4…`, `5d13a293…`) and `git status --short -- <the three reports>`
  empty.

### B.3 Independent drift matrix ([`11-checker-independent-matrix.log`](./11-checker-independent-matrix.log))

Against a **copy** in a temp dir, with the real `vendor/enatega-ui` source and `contracts`:

| case | exit | file after | drift text |
| --- | --- | --- | --- |
| non-check, output missing | 0 | created (213 237 bytes) | — |
| `--check`, identical | 0 | byte-identical | none (stderr empty) |
| `--check`, corrupted record + `summary.documents` | **1** | **byte-identical** | `summary: differs (...)`; `apps: 1 of 3 app record(s) differ — enatega-multivendor-web (1 of 39 document record(s) differ)` |
| `--check`, invalid JSON | **1** | **byte-identical** | `report file is not valid JSON (Expected property name …)` |
| `--check`, missing file | **1** | **not created** | `report file is missing` |
| `--check`, output in a non-existent directory | **1** | no directory created | `report file is missing` |

No code path I could construct writes in `--check` mode, including every error path.

### B.4 The defect it fixes is real — independently reproduced

With the pre-fix tool (`8b9c84d^`) copied to a temp dir and run with `--check` against a
deliberately corrupted report copy ([`17-prefix-checker-rewrite.log`](./17-prefix-checker-rewrite.log)):

```
canonical sha: 5d13a2934239cd3cb032c21669324599e08591587198f979e2154b52c6701ee1
corrupted sha: d14f429d89efe68cbe05c654a0aa35952fb583c6d69cf994c16c56e09273959e
exit=0
sha after:     5d13a2934239cd3cb032c21669324599e08591587198f979e2154b52c6701ee1
=> pre-fix --check silently rewrote the drifted report and exited 0 (defect confirmed)
```

The current tool on the same corruption → `exit=1`, sha unchanged,
`check:enatega: DRIFT DETECTED … it was NOT modified`. Defect and fix both verified.

**Verdict: PASS. No findings.** Minor observation only: on drift the tool still prints the
`{"status":"PASS",...}` summary line to stdout before exiting 1; the exit code, not the summary
line, is the gate signal (all three `check:enatega` scripts rely on the exit code).

---

## C. T-026C — implemented-root detection from the syntax tree

### C.1 Owner acceptance re-run

```
$ node --test tools/lib/operation-state.test.mjs         → tests 6, pass 6, fail 0
$ node docs/artifacts/w25/t026/state/compare.mjs         → legacy regex keys: 38
                                                            syntax-tree keys:  38
                                                            dropped: 0, added: 0
```

RED reproduced by swapping in the parent-commit implementation (`2bbddc4^`, guarded with a trap
and hash-verified restored to `0cb1b01e…`): **6 tests, 3 pass, 3 fail**, same three tests as
`red-phase.txt` ([`09-opstate-red-repro.log`](./09-opstate-red-repro.log)). `green-phase.txt`
(6/6) also reproduces. So the TDD record is genuine.

`equivalence.txt` records `37/37`; it is now `38/38` because the concurrent W3 lane added a
resolver after the note was written. The substantive claim (0 dropped / 0 added) still holds.

### C.2 Adversarial fixtures (mine, not the owner's)

[`adversarial-roots.mjs`](./adversarial-roots.mjs) builds one synthetic resolver file and scores
each construct against "is this a root field with a real resolver". Observed keys:

```
mutation.changePassword, query.classDecorated, query.emailExist, query.firstArg,
query.parameterDecorated, query.propertyDecorated, query.templateArg
```

Correct (core defect closed, contract kept):

- decorator-shaped text in a multi-line block comment, a nested-comment region, a template
  literal, a template substitution string, a single-quoted and a double-quoted string → **not
  counted**;
- `@Query("esc\"aped")` → **not counted** (the cooked name is not a valid field name);
- `@Query("emailExist")` → **`query.emailExist`** (camelCase preserved) and
  `@Mutation("changePassword")` → **`mutation.changePassword`** (kind lowercased) — the case
  contract holds;
- genuinely formatted/literal forms that the regex missed (multi-line, inline comment, trailing
  comma in the owner's spec) are counted.

### C findings

**C1 (medium, must fix) — the new spec file still breaks the repo's own formatting gate.**
`pnpm format:check` (= `prettier --check .`) fails; the only remaining file is
`tools/lib/operation-state.test.mjs`, which is new in `2bbddc4` and the **only** file prettier
flags under `tools/` and `e2e/` ([`23-format-attribution.log`](./23-format-attribution.log),
re-checked at HEAD `6c888eb`):

```
Checking formatting...
[warn] tools/lib/operation-state.test.mjs
Code style issues found in the above file. Run Prettier with --write to fix.
ELIFECYCLE Command failed with exit code 1.
```

(The second file that failed when I first ran this, `docs/TASK_BOARD.md`, was fixed by the
concurrent Lead commit `6c888eb` "…format the shared board" during the review.) Required fix
(owner `lead`): `./tools/pnpm.sh exec prettier --write tools/lib/operation-state.test.mjs`
(prettier would rewrite lines 78 and 122, changing the escaped-single-quote strings to
double-quoted strings).
(Prettier-clean before/after is a claim in the smoke README and holds there: `prettier --check e2e/smoke` passes; scoped eslint over the four changed files plus `e2e/smoke` is also clean.)

**C2 (low, latent) — false-positive class not closed: decorators on non-resolver nodes count.**
Exact fixtures and observed output ([`08-adversarial-ast.log`](./08-adversarial-ast.log)):

```ts
export class Adversarial {
  @Query("propertyDecorated")   // class property, not a resolver
  someProperty = 1;
}
@Query("classDecorated")        // class declaration, not a resolver
export class DecoratedClass {}
export class Param {
  method(@Query("parameterDecorated") p: string) {}   // parameter, not a resolver
}
```

Observed: `query.propertyDecorated`, `query.classDecorated` and `query.parameterDecorated` are
all counted as `IMPLEMENTED`. `implementedRoots` walks every node and accepts any genuine
decorator application, so "only genuine *decorator applications*" is true but "only genuine
*resolvers*" is not. This class was **not** introduced by the fix (the old regex also matched
these), and there is currently no such code in the repo (0/0 equivalence), so it is latent — but
it remains a fabricated-progress-claim vector, and the commit message over-claims. Suggested
fix: require the decorated node to be a method (`ts.isMethodDeclaration(node)`), which is how
`@Query`/`@Mutation` actually register a resolver.

**C3 (low, latent) — false-negative class: semantically constant computed arguments are missed.**
Exact fixtures and observed output:

```ts
@Query(("parenthesised"))          // observed: NOT counted
parenthesised() {}
@Query("con" + "catenated")        // observed: NOT counted
concatenated() {}
```

Both register a real resolver at runtime. The regex also missed them, so this is not a
regression; it is a residual of the "single plain string literal" rule. Suggested fix (if the
contract is meant to be "the value the decorator receives"): unwrap
`ts.isParenthesizedExpression` and accept constant-folded `BinaryExpression` `+` of string
literals.

**C4 (info) — documentation vs code.** `EVIDENCE.md`/the function comment say "the single
argument"; the code takes `call.arguments[0]` and ignores extras, so `@Query("firstArg", {name})`
counts (correct for NestJS `@Query(name, options)`, but the comment should say "first argument").
`ts.isStringLiteralLike` also accepts a no-substitution template literal
(`@Query(\`templateArg\`)` is counted); that is semantically right but wider than "plain string
literal".

**C5 (info) — the A/B baseline is named `HEAD` but HEAD now contains the fix.** `EVIDENCE.md`
says "restored from `HEAD`", and `tdd-2b` records `git show HEAD:…`; those were correct when
written (`HEAD` was then `1ad6580`/`a0c9beb`). The reproducible baseline now is the commit's
parent (`2bbddc4^`, respectively `24468a8^`). Cosmetic, but a future reader will be confused.

**C6 — the Lead's pre-existing-failure claim holds (reproduced A/B).** See §D2.

---

## D. Cross-cutting: scope, evidence reproducibility, lane hygiene

### D1. Commit scope — PASS

`git show --pretty=format: --name-only` for `24468a8`, `8b9c84d`, `2bbddc4`, `c6b91bb`
([`12-commit-scope-audit.log`](./12-commit-scope-audit.log)) contains only:

- A: `implementation/e2e/smoke/**` + `implementation/docs/artifacts/w25/t026/smoke/**`;
- B: `implementation/tools/check-enatega-compatibility.{mjs,test.mjs}` +
  `implementation/docs/artifacts/w25/t026/checker/**`;
- C: `implementation/tools/lib/operation-state.{mjs,test.mjs}` +
  `implementation/docs/artifacts/w25/t026/state/**`;
- decision: `implementation/docs/artifacts/w25/t026/state/GATE_DECISION.md`.

These are exactly the declared write scopes of task-1/task-2/task-3. A scan for
`services/api/src/identity/**`, `services/api/src/app.ts`, `services/api/test/**/identity/**`,
`prisma/**` in all four commits returned **nothing**; the index was empty at audit time
(`git diff --cached --name-only` empty). The generated docs that changed between the claim commit
and HEAD (`ROADMAP_STATUS.md`, `IMPLEMENTATION_STATUS.*`, `OPERATION_TEST_EVIDENCE.json`,
`OPERATION_TRACEABILITY.md`, `docs/artifacts/w3/**`) all belong to the W3 lane's commits
(`7702c53`, `05af323`, `4afbd0e`, `cbc676b`, `d8eb417`, `a0c9beb`, …), not to this lane.

### D2. Evidence reproducibility — no fabrication found

Everything re-runnable reproduced. Highlights (logs in this directory):

| claim | my result |
| --- | --- |
| smoke `code-state.sha256` matches the committed code | match (all four hashes) |
| normal `pnpm e2e:smoke` 12/12 | reproduced, exit 0 |
| poisoned run 12/12, 0 harness-spawned leaks | reproduced with my own probe |
| owner's prefix/postfix probe analyses | byte-for-byte reproduced from the committed JSONL |
| checker 26/26, three gates PASS, reports unmodified | reproduced |
| pre-fix `--check` silently rewrote the report | independently reproduced |
| state RED 3/3 and GREEN 6/6 | reproduced |
| `compare.mjs` 0 dropped / 0 added | reproduced (38/38 today) |

**The D2 A/B control (the Lead's pre-existing-failure claim).** `state/EVIDENCE.md` claims
`tools/generate-roadmap-status.test.mjs` is `5 pass / 2 fail` both with the new implementation
and with the `HEAD` implementation, i.e. the two failures are pre-existing and unrelated to
T-026C. I reproduced this with a trap-guarded temporary swap of `tools/lib/operation-state.mjs`
to `2bbddc4^` and back (restored hash verified `0cb1b01e…`) — full transcript
[`05-roadmap-status-AB.log`](./05-roadmap-status-AB.log):

```
--- A: current (AST) implementation ---   tests 7  pass 5  fail 2
✖ roadmap status is current and internally consistent
✖ status reports only derived facts and never claims an unapproved gate
--- B: pre-T-026C (regex) implementation --- tests 7  pass 5  fail 2
✖ roadmap status is current and internally consistent
✖ status reports only derived facts and never claims an unapproved gate
RESTORE OK
```

**The claim holds**: the same two tests fail under both implementations. Test 1 fails because
`generate-roadmap-status.mjs --check` prints
`docs/ROADMAP_STATUS.md is stale; regenerate with node tools/generate-roadmap-status.mjs`;
test 5 fails because the live `totals.implemented` is `23` while the committed status recorded
`22` at the time (`AssertionError: The input did not match /\*\*23\/334\*\* root operations/`).
`generate-roadmap-status.mjs --check` is read-only (the `writeFileSync` is in the `else` branch,
line 351), so neither the owner nor I wrote that document.

**Status staleness — honest present-tense statement.** At the time of my A/B the live generated
status *was* stale: live/HEAD-source = **23/334** in-lane implemented roots vs **22/334**
recorded. That is the W3 lane's problem, not T-026C's: the added resolvers
(`mutation.emailExist`, `mutation.phoneExist`, `mutation.changePassword`, `mutation.Deactivate`)
come from committed W3 work, and this task correctly refused to regenerate a lead-owned document
mid-batch. **Since then the concurrent W3 lane fixed it itself**: commit `768e0bc`
(`feat(W3): implement mutation.Deactivate …`) regenerated `docs/ROADMAP_STATUS.md` to `23/334`,
and `node --test tools/generate-roadmap-status.test.mjs` is now **7 pass / 0 fail** at
HEAD `569daf0`. So the premise "the live generated status is stale" is no longer true at the
present HEAD; it was true throughout the T-026C window and the Lead's note (22 vs 21) was an
accurate snapshot that has since been superseded by one more W3 resolver and the W3
regeneration. The stale-status item must be re-checked at the next clean point, but it is not
a T-026C defect.

### D3 (medium, factual error in `GATE_DECISION.md`) — G1 does not consist of only the three `check:enatega` commands

`GATE_DECISION.md` lines 8-15 (committed in `c6b91bb`) say the recorded G1 run "consists of
exactly: `pnpm check:enatega`, `pnpm check:enatega:full`, `pnpm check:enatega:singlevendor`".
`docs/ROADMAP.json` `gates.G1.commands` and both G1 run records in `docs/GATES.json` list **six**
commands ([`18-g1-detail.log`](./18-g1-detail.log)):

```
pnpm check:enatega          exit 0
pnpm check:enatega:full     exit 0
pnpm check:enatega:singlevendor exit 0
pnpm codegen:check          exit 0
pnpm test:integration       exit 0
pnpm check:operations:schema exit 0
```

The decision itself (defer re-recording G1 until a clean tree) is unaffected and its premises
are otherwise verified — the approved G1 run is `3c1afc290a00` with approvals `lead`,
`reviewer-SEC`; the `ddd3f02` run it cites has the same six commands; `record-gate` resets
approvals (`tools/record-gate.mjs:174-182`) and `approve-gate` refuses a dirty-tree run
(`tools/approve-gate.mjs:90-92`), as the note claims; the G0 approval is on `76d8fd2` with
`lead` + `reviewer-QA`, as the note claims. But the note understates what re-recording G1
covers: it also re-runs `test:integration`, `codegen:check` and `check:operations:schema`, and
the concurrent `569daf0` addition about G0 is consistent with my runs (same command, same flag
surface, same 12 checks; artifact *shape* changed as stated). Required fix (owner `lead`):
correct lines 8-15 to list all six commands.

### D5 (medium, lane hygiene) — the W25 lane introduced a `pnpm format:check` failure

`pnpm format:check` still fails on `tools/lib/operation-state.test.mjs` (§C1). Attribution
([`23-format-attribution.log`](./23-format-attribution.log)): the spec file was introduced by
`2bbddc4`. A second violation, `docs/TASK_BOARD.md`, was introduced by the W25 claim commit
`1ad6580` (the file was prettier-**clean** before it, dirty after it) and has since been fixed by
the Lead in the concurrent commit `6c888eb` ("…format the shared board"). Required fix (owner
`lead`): run `./tools/pnpm.sh exec prettier --write tools/lib/operation-state.test.mjs` and
commit the result before T-026 closes; otherwise the repo-wide formatting gate stays red.

### D6 (info) — naming nits in `GATE_DECISION.md`

The note says the existing G1 approvals are "`lead` + `w2-sec-review`"; `docs/GATES.json`
records `["lead","reviewer-SEC"]`. G0 is correctly cited at `76d8fd2` (approved run), while
`GATES.json` also keeps three earlier superseded G0 runs — the note's "the G0 run recorded …
commit `76d8fd2`" is the approved one, which is what matters.

---

## Consolidated counterexamples

1. `@Query("propertyDecorated")` on a class property, `@Query("classDecorated")` on a class, and
   a parameter decorator are all reported as implemented roots by `implementedRoots`
   (C2, fixture in [`adversarial-roots.mjs`](./adversarial-roots.mjs)).
2. `@Query(("parenthesised"))` and `@Query("con" + "catenated")` are missed although they
   register real resolvers (C3).
3. `fingerprintSecrets` is not run-stable: the owner's own normal and poisoned artifacts give
   different `api`/`migrate` fingerprints (A2).
4. `DOCKER_HOST=tcp://user:password@…` and `NODE_OPTIONS=--require …` pass into every child and
   are not flagged by `assertNoInheritedSecrets` (A1).
5. `pnpm format:check` fails on `tools/lib/operation-state.test.mjs`, a file this lane wrote
   (C1/D5); the companion `docs/TASK_BOARD.md` violation was fixed by `6c888eb` mid-review.
6. `GATE_DECISION.md` says G1 is exactly three commands; it is six (D3).

## Could not verify

- The pre-fix `pnpm e2e:smoke` transcripts as live runs (`baseline-pre-fix.log`,
  `poisoned-prefix-run.log`, `tdd-1`/`tdd-2` logs): reproducing them would require reverting the
  reviewed `run.mjs`, which the review rules forbid. Mitigations actually performed: the
  pre-fix `run.mjs` source lines are as described, the committed pre-fix probe JSONL re-analyses
  to exactly the recorded leak result, and the pre-fix `run.mjs` makes the final spec fail
  exactly as recorded.
- Whether the Prisma 7 CLI auto-loads a project `.env` into `prisma generate`/`migrate deploy`
  children. Prisma 7 rejects `url = env(...)` in schema files (URLs move to
  `prisma.config.ts`), so I could not build a valid minimal schema to test `.env` loading
  without DATABASE_URL in the process environment; no `.env` exists in the tree today. The API
  process itself cannot read a `.env` (no dotenv/`ConfigModule` in `services/api/src`), so the
  practical exposure is limited to the build/migrate children.
- The claim "no `pnpm`/`git` command was run outside this task's scope" and agent/committer
  identities: not verifiable from repository state.
- That `pnpm e2e:smoke` was never run concurrently with another session's Docker work for the
  whole window: I checked `docker ps` before each run and saw only the other lane's redis
  container, and ran my two runs serially; I cannot observe other sessions' scheduling.
- Repo-wide `pnpm test` / `pnpm lint` / `turbo` build: not run (out of scope; `pnpm test` would
  also include the pre-existing roadmap test). I did run the scoped eslint and prettier checks
  and the four changed files' own test files.

## Required fixes before T-026 closes

| # | owner | fix |
| --- | --- | --- |
| C1/D5 | `lead` | `prettier --write tools/lib/operation-state.test.mjs`; re-run `pnpm format:check` → clean (`docs/TASK_BOARD.md` already fixed by `6c888eb`) |
| D3 | `lead` | correct `GATE_DECISION.md` lines 8-15: G1 is six commands, not three |
| A2 | `w25-smoke` | make `fingerprintSecrets` run-stable (exclude `DATABASE_URL`/`REDIS_URL`) or fix the comment/README claim |
| C2 | `lead` | restrict detection to method declarations (or record the non-method false-positive class as accepted residual) |
| C3 | `lead` | either accept the computed-argument false negative explicitly in the contract, or unwrap parentheses/constant string concatenation |
| A1 | `w25-smoke` | record `DOCKER_HOST`/`NODE_OPTIONS` as named residual passthroughs; consider stripping userinfo from `DOCKER_HOST` |
| C5 | `lead` | replace "restored from HEAD" with the parent commit id in `EVIDENCE.md`/`tdd-2b` reproduction command |

## Log index

`02-smoke-normal.log`, `03-smoke-poisoned.log`, `03a-poisoned-artifact.json`,
`04-checker-acceptance.log`, `05-roadmap-status-AB.log`, `06-probe-analysis.log`,
`07-owner-analyser-postfix-rerun.log`, `08-adversarial-ast.log`, `09-opstate-red-repro.log`,
`10-tdd2b-repro.log`, `11-checker-independent-matrix.log`, `12-commit-scope-audit.log`,
`13-status-and-gates.log`, `14-gate-claims.log`, `15-owner-analyser-prefix-rerun.log`,
`16-g1-and-g0.log`, `17-prefix-checker-rewrite.log`, `18-g1-detail.log`,
`19-boundary-probes.log`, `21-prisma-dotenv-decisive.log`, `21-prisma-and-quality.log`,
`22-status-attribution.log`, `23-format-attribution.log`, `24-fingerprint-stability.log`,
plus the reviewer scripts `child-env-probe.cjs`, `analyse-my-probe.mjs`,
`adversarial-roots.mjs`.

I did not approve my own work; T-026 remains open for the Lead to close on this verdict.
