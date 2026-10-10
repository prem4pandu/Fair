# T-026A evidence — deterministic, non-inheriting smoke environments

Repo task [`TASK_BOARD.md` → T-026](../../../TASK_BOARD.md) (W25), owned by the disjoint DSH lane
(`w25-smoke`). Shared tasks: `task-1` (first revision, `24468a8`) and `task-5` (review fixes, this
round). Board row is the spec of record; the lead committed the original claim in `1ad6580`.

Write scope: `implementation/e2e/smoke/**` (code) and this directory (evidence). Nothing else was
touched in either round.

| round | shared task | code commit | driver | what it proves |
| ----- | ----------- | ----------- | ------ | -------------- |
| 1 | `task-1` | `24468a8` | `run-acceptance.sh` | children no longer inherit ambient secret material |
| 2 | `task-5` | (this round) | `run-acceptance-a1-a2.sh` | review findings A1 (injection/credential passthrough) and A2 (unstable fingerprint) closed |

---

# Round 1 — task-1 (commit `24468a8`)

## Defect

`e2e/smoke/run.mjs` built deterministic secrets for the API child but spawned its other children with
the developer's ambient environment:

| child                     | pre-fix environment                        |
| ------------------------- | ------------------------------------------ |
| API build (`pnpm --filter @fairbite/api build`) | `env: process.env`        |
| `prisma migrate deploy`   | `env: { ...process.env, DATABASE_URL }`    |
| built API (`dist/main.js`) | `env: { ...process.env, ...api config }`  |

So a shell export or `.env`-sourced real secret — `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_PEPPER`,
`PUBLIC_ACCESS_SECRET`, `DATABASE_URL`, `REDIS_URL`, provider keys — reached the run. The smoke
result was a function of the developer's machine: the W24 residual "deterministic smoke secrets".

**Observed pre-fix (not inferred).** Running the harness with a poisoned parent environment and the
child-env probe preloaded (`poisoned-prefix-run.log`, `poisoned-prefix-probe.jsonl`,
`probe-analysis-prefix.log`) shows the poison reaching 7 of the 8 node processes the harness spawned
(build chain: `pnpm --filter`, its `corepack`, `prisma generate`, its prisma child, `tsc`, and
`prisma migrate deploy` + child); only `dist/main.js` was clean because it already overrode those
keys. The same poisoned run still reported `PASS — 12 checks`, i.e. the contamination was silent.
The three processes above the harness (`corepack` → `pnpm e2e:smoke` → `run.mjs`) necessarily keep
the launching shell's environment; the harness cannot filter itself.

## Fix

New module `e2e/smoke/environment.mjs`:

- `buildChildEnvironment(ambient, overrides)` starts from a fixed, reviewable allowlist and takes
  every configuration and secret value from explicit `overrides`.
- `scanAmbientSecrets(ambient)` lists the ambient names that must never reach a child; the harness
  logs this list on every run and records it in the artifact.
- `assertNoInheritedSecrets(ambient, env, overrides)` runs on each constructed environment, so a
  future edit that reintroduces inheritance fails the smoke run instead of silently contaminating it.
- `smokeSecrets()` derives the deterministic canonical 32-byte keys.

`e2e/smoke/run.mjs` builds all three child environments through the builder and records them in the
artifact. The harness remains a real stack run: no mocks, no skipped checks, no reduced assertion
count.

## Round-1 acceptance (executed, verbatim)

Driver: `sh docs/artifacts/w25/t026/smoke/run-acceptance.sh` from `implementation/`.

### 1. `pnpm e2e:smoke` — normal environment

`postfix-normal-run.log`:

```
[e2e:smoke] no ambient secret variables were present to exclude
...
[e2e:smoke] PASS — 12 checks; artifact test-results/e2e-smoke.json
exit=0
```

12 checks, identical to the recorded G0 run in `docs/GATES.json`
(`[e2e:smoke] PASS — 12 checks`, commit `76d8fd2`) and to the pre-change local artifact, so the
count did not drop.

### 2. Poisoned parent environment — non-inheritance

`poisoned-postfix-run.log` (poison values non-canonical on purpose: a leak into the API child would
make `readConfig` reject the config and the API would never start):

```
$ ACCESS_TOKEN_SECRET='poisoned-ambient-access-token-secret-000' \
    REFRESH_TOKEN_PEPPER='poisoned-ambient-refresh-pepper-000000000' \
    PUBLIC_ACCESS_SECRET='poisoned-ambient-public-access-secret-0000' \
    DATABASE_URL='postgresql://poisoned:poisoned@poisoned.invalid:5432/poisoned' \
    REDIS_URL='redis://poisoned.invalid:6379/0' \
    NODE_OPTIONS="--require $PWD/e2e/smoke/fixtures/child-env-probe.cjs" \
    pnpm e2e:smoke          # from implementation/
[e2e:smoke] excluding 5 ambient secret variable(s) from every child process: ACCESS_TOKEN_SECRET, DATABASE_URL, PUBLIC_ACCESS_SECRET, REDIS_URL, REFRESH_TOKEN_PEPPER
...
[e2e:smoke] PASS — 12 checks; artifact test-results/e2e-smoke.json
exit=0
```

`probe-analysis-postfix.log` (probe `poisoned-postfix-probe.jsonl`, independent of the harness's own
scan) reported `harness-spawned processes that received a poisoned ambient value: 0`, with the API
child configured from the deterministic keys and that run's container URLs.

### 3. Unit spec — `node --test e2e/smoke/environment.test.mjs`

`tdd-1-red-module-missing.log` (before implementation) → module absent. `tdd-2b-red-final-spec-vs-prefix.log`
(final spec against the committed pre-fix `run.mjs` from `git show HEAD:…`) → `pass 7 / fail 1`,
failing with `run.mjs still spreads the ambient process.env into a child environment`.
`tdd-3-green-after-fix.log` → `pass 8 / fail 0`, `exit=0`.

---

# Round 2 — task-5: review findings A1 and A2 (commit 5353c9f)

Both findings were reproduced from the round-1 artifacts before any change:

- **A2** — `api` `secretFingerprint` was `8c5e51d6058283b4` in `postfix-normal-artifact.json` but
  `38301b6391eb086b` in `poisoned-postfix-artifact.json`: the digest covered the per-run
  testcontainers `DATABASE_URL`/`REDIS_URL`.
- **A1** — `DOCKER_HOST` appeared in all three child key sets of both artifacts (`build keys: 11`,
  `migrate keys: 12`, `api keys: 23`), i.e. the container transport was passed through untouched, and
  `NODE_OPTIONS` was on the passthrough list, so `NODE_OPTIONS=--require /tmp/evil.cjs` executed in
  every child.

## A1 fix — the choice made

Stated in the `environment.mjs` module comment. Both of the review's first two options are applied,
with the third kept as a backstop:

1. `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS` are **removed from the passthrough set**. The
   first can execute attacker-chosen code in a child, the second can redirect module resolution, the
   third can replace the trust store; the harness controls its own children and needs none of them.
2. `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH` are **removed from the
   passthrough set** — `DOCKER_HOST` can be `tcp://user:password@host` and `DOCKER_CERT_PATH` points
   at client credentials. No child the harness spawns talks to Docker (the harness starts containers
   in-process), so the transport is dropped rather than sanitised.
3. `assertNoInheritedSecrets` now **also fails the run** for any value that still carries URL userinfo
   or a Node injection flag (`--require`/`--import`/`--eval`/`--loader`/`--print`/`-r`) and for any
   blocked name if a future edit puts it back on the list. `scanAmbientHazards()` reports every such
   ambient name with the reason, on every run, and the artifact records it as `ambientHazards`.

`PATH` remains inherited and is documented as the one unavoidable vector: a child cannot be executed
without a lookup path, and `node`/corepack/`prisma`/`tsc` are only findable through it.

## A2 fix — what the fingerprint covers

`fingerprintSecrets` (which hashed everything secret-named, including the ephemeral endpoints) is
replaced by `fingerprintDeterministicSecrets(env)`, which hashes **only** the three values
`smokeSecrets()` derives (`ACCESS_TOKEN_SECRET`, `PUBLIC_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`),
with an explicit `<absent>` marker per name. Per-run endpoints are recorded separately as
`ephemeralContainerPlumbing` (`DATABASE_URL`/`REDIS_URL`, URL credentials redacted), whose name says
it is per-run. The artifact fields are `deterministicSecretsFingerprint` and
`ephemeralContainerPlumbing`.

## Round-2 acceptance (executed, verbatim)

Driver: `sh docs/artifacts/w25/t026/smoke/run-acceptance-a1-a2.sh` from `implementation/`
(three serial Docker runs; poison values non-canonical).

### 1. Unit spec (18 tests, A1 + A2 cases)

`tdd-4-green-a1-a2.log`:

```
ℹ tests 18
ℹ pass 18
ℹ fail 0
exit=0
```

New cases: node-flag/transport names never reach a child; the allowlist holds no blocked or hazardous
name; the guard rejects `DOCKER_HOST` userinfo, `NODE_OPTIONS=--require`, URL userinfo on an ordinary
allowlisted name, and `--import` in an ordinary value; the guard accepts credentialed plumbing the
harness chose itself; the hazard scan names each vector with a reason; the fingerprint is a frozen
constant (`77c151b2309f836b`) and an all-absent child has `60ecfee0ef6bcd2e`; the fingerprint ignores
per-run endpoints and changes when secret material changes; per-run plumbing is separate and
credential-redacted. `run.mjs` is asserted to use the new API and not the superseded fingerprint.

### 2. `pnpm e2e:smoke` — PASS, exit 0, checks ≥ 12 (three runs)

`run1-normal.log`, `run2-normal.log`, `run3-poisoned.log`:

```
[e2e:smoke] no ambient secret variables were present to exclude
[e2e:smoke] excluding 1 ambient value(s) that can inject code or carry credentials: DOCKER_HOST (container transport URL can carry credentials (userinfo))
[e2e:smoke] PASS — 12 checks; artifact test-results/e2e-smoke.json
exit=0
```

(run 3, with the poisoned secrets **and** the reviewer's `NODE_OPTIONS=--require …` vector plus a
poisoned `NODE_PATH`):

```
[e2e:smoke] excluding 5 ambient secret variable(s) from every child process: ACCESS_TOKEN_SECRET, DATABASE_URL, PUBLIC_ACCESS_SECRET, REDIS_URL, REFRESH_TOKEN_PEPPER
[e2e:smoke] excluding 4 ambient value(s) that can inject code or carry credentials: DATABASE_URL (value carries URL credentials (userinfo)); DOCKER_HOST (container transport URL can carry credentials (userinfo)); NODE_OPTIONS (node flags can inject code into a child (--require/--import/--eval/--loader)); NODE_PATH (node module-resolution path can redirect imports)
[e2e:smoke] PASS — 12 checks; artifact test-results/e2e-smoke.json
exit=0
```

Note that `DOCKER_HOST` really is present in the parent environment here: `tools/pnpm.sh` derives and
exports it from the colima context, and the harness now excludes it from every child and says so.

Child key sets before → after (round-1 artifact → round-2 artifact): build `11 → 10`, migrate
`12 → 11`, api `23 → 22`; the removed key is `DOCKER_HOST` in every case.

### 3. A1 — the injection vector never reaches a child

`a1-injection-vector.log` (the probe preloaded through `NODE_OPTIONS` in run 3):

```
node processes observed: 3
  harness bootstrap processes (launched by the shell, before the harness can filter anything): 3
  processes spawned by the harness: 0
...
harness-spawned processes that received a poisoned ambient value: 0
exit=0
```

In round 1 the same probe observed 11 processes with the poison in 7 harness-spawned children; now it
observes only the three bootstrap processes above the harness, because `NODE_OPTIONS` is no longer
inherited. The absence is the canary.

`a1-credential-vector-demo.log` (no Docker; a no-op preload writes its pid to a canary file whenever
it executes):

```
ambient values the harness excludes (name -> reason):
  DOCKER_HOST -> container transport URL can carry credentials (userinfo)
  HTTPS_PROXY -> value carries URL credentials (userinfo)
  NODE_OPTIONS -> node flags can inject code into a child (--require/--import/--eval/--loader)
  NODE_PATH -> node module-resolution path can redirect imports
  (the demo parent itself already executed the preload: canary has 1 entry)
...
  NODE_OPTIONS in child environment: false
  NODE_PATH in child environment: false
  DOCKER_HOST in child environment: false
  HTTPS_PROXY in child environment: false
  child environment carries any credential/injection value: false

old-style child (env: process.env) executed the preload: true
harness-built child executed the preload: false
PASS: the harness-built child did not execute the ambient preload

forcing the vectors into a child environment to show the run-time guard fails the run:
  NODE_OPTIONS: caught -> Child environment inherits ambient material that must not reach a child: NODE_OPTIONS (node flags can inject code into a child (--require/--import/--eval/--loader))
  DOCKER_HOST: caught -> Child environment inherits ambient material that must not reach a child: DOCKER_HOST (container transport URL can carry credentials (userinfo))
  HTTPS_PROXY: caught -> Child environment inherits ambient material that must not reach a child: HTTPS_PROXY (value carries URL credentials (userinfo))
exit=0
```

`a1-poison-fatal-to-config.log` shows the poisoned values are fatal to the API configuration, which is
why the passing run above is itself evidence that the API child did not receive them:

```
REJECTED: Invalid configuration: PUBLIC_ACCESS_SECRET, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_PEPPER
```

### 4. A2 — the two-run (and normal-vs-poisoned) fingerprint equality proof

`a2-fingerprint-proof.log` (`compare-fingerprints.mjs` over three artifacts):

```
EQUAL   api deterministicSecretsFingerprint
          77c151b2309f836b  …/run1-normal-artifact.json
          77c151b2309f836b  …/run2-normal-artifact.json
          77c151b2309f836b  …/run3-poisoned-artifact.json
          ephemeralContainerPlumbing differs between runs: yes (expected)
          {"DATABASE_URL":"postgres://***:***@localhost:32916/test","REDIS_URL":"redis://localhost:32917"}  …/run1-normal-artifact.json
          {"DATABASE_URL":"postgres://***:***@localhost:32920/test","REDIS_URL":"redis://localhost:32921"}  …/run2-normal-artifact.json
          {"DATABASE_URL":"postgres://***:***@localhost:32924/test","REDIS_URL":"redis://localhost:32923"}  …/run3-poisoned-artifact.json

EQUAL   build deterministicSecretsFingerprint
          60ecfee0ef6bcd2e  (×3)
EQUAL   migrate deterministicSecretsFingerprint
          60ecfee0ef6bcd2e  (×3)

result: PASS — 3 child environment(s), 3 artifact(s), 0 mismatch(es)
exit=0
```

---

## Code state these runs were executed against

Round 2 — `code-state-a1-a2.sha256` (committed with this round, verified with `shasum -a 256 -c`):

```
4e15638ace097ac24aadfbfbef6b2bebeff38a7d6167a299b7c94201fc5a3f34  e2e/smoke/run.mjs
5c9f2aec9b082fdede92298f08f3cc98bc331f9b02601643628e93f1c826becb  e2e/smoke/environment.mjs
5dacb27feaf375625c3c6c77eb891e92b4781b27748b88588bfeee8128466121  e2e/smoke/environment.test.mjs
eeda23f2a562b73dbeab6ab51e87d20b4eb8e2da99c050020672e0b22f717703  e2e/smoke/fixtures/child-env-probe.cjs
```

Round 1 — `code-state.sha256` (the files as committed in `24468a8`).

Scoped quality gates: `npx eslint e2e/smoke` clean, `npx prettier --check e2e/smoke` clean. No
repo-wide `pnpm` lint/test/roadmap/record-gate command was run; no `git add -A`, stash, reset,
checkout or clean, and nothing outside this task's two write scopes was staged or committed.

## Files in this directory

| file | what it is |
| ---- | ---------- |
| `run-acceptance.sh` | round-1 acceptance driver (task-1) |
| `run-acceptance-a1-a2.sh` | round-2 acceptance driver (task-5, A1/A2) |
| `analyse-probe.mjs` | reproducible analyser for a probe JSONL |
| `compare-fingerprints.mjs` | A2 fingerprint equality proof over artifacts |
| `baseline-pre-fix.log` | pre-change `pnpm e2e:smoke` (12/12 before any change) |
| `poisoned-prefix-run.log`, `poisoned-prefix-probe.jsonl`, `probe-analysis-prefix.log` | pre-fix poisoned run: the observed 7-of-8 leak |
| `probe-inheritance-demo.log` | round-1 focused two-spawn-style observation |
| `tdd-1-…`, `tdd-2-…`, `tdd-2b-…`, `tdd-3-…` | round-1 RED → GREEN transcripts |
| `postfix-normal-run.log`, `postfix-normal-artifact.json`, `poisoned-postfix-run.log`, `poisoned-postfix-artifact.json`, `poisoned-postfix-probe.jsonl`, `probe-analysis-postfix.log` | round-1 acceptance (contains the A1/A2 evidence the review cited) |
| `tdd-4-green-a1-a2.log` | round-2 unit spec (18 tests) |
| `run1-normal.log`, `run1-normal-artifact.json` | round-2 run 1 |
| `run2-normal.log`, `run2-normal-artifact.json` | round-2 run 2 (consecutive) |
| `run3-poisoned.log`, `run3-poisoned-artifact.json`, `run3-poisoned-probe.jsonl`, `a1-injection-vector.log` | round-2 poisoned run with the reviewer's injection vector |
| `a1-credential-vector-demo.log` | round-2 A1 canary + credential + guard demonstration |
| `a1-poison-fatal-to-config.log` | round-2 proof that a leaked poison would be fatal |
| `a2-fingerprint-proof.log` | round-2 A2 equality proof |
| `code-state.sha256`, `code-state-a1-a2.sha256` | hashes of the code each round's runs used |

## Notes / open items

- The poisoned pre-fix run used the first revision of `fixtures/child-env-probe.cjs` (variable-name
  list supplied by the caller); the fixture is now self-sufficient (own sensitive-name pattern,
  default output path) and its header documents that since the A1 fix a post-fix run preloaded this
  way records only the bootstrap processes — the canary.
- `pnpm test` only globs `tools/*.test.mjs` and `tools/lib/*.test.mjs`, so the spec needs a script
  line (lead-owned `package.json`): suggest
  `"test:e2e-smoke": "node --test e2e/smoke/environment.test.mjs"`.
- Another live session was running integration containers in this working tree throughout; the smoke
  stack allocates its own ephemeral ports, and every Docker run here was serial.
- `scanAmbientSecrets` is name-based and conservative: it also matches benign flags such as
  `PASSWORD_AUTH_ENABLED`. Dropping them is harmless (children that need them get explicit overrides)
  and the exclusion is logged, not silent.
- **Residual, stated rather than hidden:** `PATH` remains inherited, so a poisoned `PATH` could shadow
  `node`/`prisma`/`tsc` in a child. A child cannot be executed without a lookup path and the toolchain
  is only findable through it; the module comment documents this boundary.
