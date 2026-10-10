# T-026A evidence — deterministic, non-inheriting smoke environments

Repo task [`TASK_BOARD.md` → T-026](../../../TASK_BOARD.md) (W25), owned here by the disjoint DSH
lane (`w25-smoke`, shared task `task-1`). Board row is the spec of record; the lead committed the
claim in `1ad6580`.

Write scope: `implementation/e2e/smoke/**` (code) and this directory (evidence). Nothing else was
touched.

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

- `buildChildEnvironment(ambient, overrides)` starts from a fixed, reviewable allowlist
  (`PATH`, `HOME`, tmp/locale, Node runtime plumbing, toolchain caches, Docker-host plumbing) and
  takes every configuration and secret value from explicit `overrides`. Ambient proxy/registry
  configuration is deliberately not inherited (it can carry credentials).
- `scanAmbientSecrets(ambient)` lists the ambient names that must never reach a child; the harness
  logs this list on every run and records it in the artifact.
- `assertNoInheritedSecrets(ambient, env, overrides)` runs on each constructed environment, so a
  future edit that reintroduces inheritance fails the smoke run instead of silently contaminating it.
- `smokeSecrets()` derives the deterministic canonical 32-byte keys; the artifact records a
  fingerprint of each child's secret configuration.

`e2e/smoke/run.mjs` now builds all three child environments through the builder and records
`environment.ambientSecretNames` plus the exact key set and secret fingerprint of each child in
`test-results/e2e-smoke.json`. The harness remains a real stack run: no mocks, no skipped checks, no
reduced assertion count.

## Acceptance (executed, verbatim)

Driver: `sh docs/artifacts/w25/t026/smoke/run-acceptance.sh` from `implementation/` (runs serially on
purpose; `pnpm e2e:smoke` uses testcontainers/Docker).

### 1. `pnpm e2e:smoke` — normal environment

`postfix-normal-run.log`:

```
[e2e:smoke] no ambient secret variables were present to exclude
...
[e2e:smoke] PASS — 12 checks; artifact test-results/e2e-smoke.json
exit=0
```

12 checks, identical to the recorded G0 run in `docs/GATES.json`
(`[e2e:smoke] PASS — 12 checks`, commit `76d8fd2`, and to the pre-change local artifact), so the
count did not drop.

### 2. Poisoned parent environment — non-inheritance

`poisoned-postfix-run.log`:

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

The poison values are non-canonical on purpose: had any of them reached the API child,
`readConfig` would have rejected the config and the API would not have started.

`probe-analysis-postfix.log` (probe `poisoned-postfix-probe.jsonl`, independent of the harness's own
scan):

```
node processes observed: 11
  harness bootstrap processes (launched by the shell, before the harness can filter anything): 3
  processes spawned by the harness: 8
...
harness-spawned processes that received a poisoned ambient value: 0

API child configuration (must be the deterministic set):
  ACCESS_TOKEN_SECRET = AQEBAQEBAQ…  [deterministic smoke key]
  DATABASE_URL = postgres://test:test@localhost:32866/test
  PASSWORD_AUTH_ENABLED = true
  PUBLIC_ACCESS_SECRET = BwcHBwcHBw…  [deterministic smoke key]
  REDIS_URL = redis://localhost:32867
  REFRESH_TOKEN_PEPPER = AgICAgICA…  [deterministic smoke key]
```

The `DATABASE_URL`/`REDIS_URL` the API received are the ephemeral container URLs of that run, not
the poisoned ones; `prisma migrate deploy` received only the overridden `DATABASE_URL`.

### 3. Unit spec — `node --test e2e/smoke/environment.test.mjs`

`tdd-1-red-module-missing.log` (spec before implementation) → module absent, 1 fail.
`tdd-2b-red-final-spec-vs-prefix.log` (final spec against the committed pre-fix `run.mjs` from
`git show HEAD:…`) → `pass 7 / fail 1`, failing with
`run.mjs still spreads the ambient process.env into a child environment`.
`tdd-3-green-after-fix.log` → `pass 8 / fail 0`, `exit=0`.

`probe-inheritance-demo.log` is the focused one-fixture observation: the pre-fix spawn style carries
both poisoned values into the child, the builder-based style carries only the explicit override.

## Code state these runs were executed against

`code-state.sha256` (also see the commit that contains this directory):

```
7098eac11e582fab7270cb9c8fcfc55bffe2ab3bc80186f18ef76f1087b42dd7  e2e/smoke/run.mjs
8e6aa0f0bc61048c1734cb24e9cb97876420539e8c126fdad23e27f5e32ff421  e2e/smoke/environment.mjs
59d3e6858b916c050180d225fb9a2a162fdf89618acdec328d0938dbc4d34e20  e2e/smoke/environment.test.mjs
298d741873037524ed7ecda455ae0a52636345b8084c3301a1a32e3836c62626  e2e/smoke/fixtures/child-env-probe.cjs
```

Scoped quality gates: `npx eslint e2e/smoke` clean, `npx prettier --check e2e/smoke` clean, and no
`pnpm`/`git` command was run outside this task's scope (no repo-wide lint/test/roadmap/record-gate,
no `git add -A`/`stash`/`reset`/`checkout`/`clean`).

## Files in this directory

| file | what it is |
| ---- | ---------- |
| `run-acceptance.sh` | the acceptance driver (the exact commands in order) |
| `analyse-probe.mjs` | reproducible analyser for a probe JSONL |
| `baseline-pre-fix.log` | pre-change `pnpm e2e:smoke` (context: 12/12 before the change) |
| `poisoned-prefix-run.log`, `poisoned-prefix-probe.jsonl`, `probe-analysis-prefix.log` | pre-fix poisoned run and the observed leak |
| `probe-inheritance-demo.log` | focused two-spawn-style observation |
| `tdd-1-…`, `tdd-2b-…`, `tdd-3-…` | RED → GREEN spec transcripts |
| `postfix-normal-run.log`, `postfix-normal-artifact.json` | acceptance 1 |
| `poisoned-postfix-run.log`, `poisoned-postfix-artifact.json`, `poisoned-postfix-probe.jsonl`, `probe-analysis-postfix.log` | acceptance 2 |
| `code-state.sha256` | hashes of the code the acceptance runs used |

## Notes / open items

- The poisoned pre-fix run used the first revision of `fixtures/child-env-probe.cjs` (variable-name
  list supplied by the caller); it was then made self-sufficient (own sensitive-name pattern, default
  output path) so it can still observe children whose environment the harness now filters. The
  post-fix observation above uses the final revision.
- `pnpm test` only globs `tools/*.test.mjs` and `tools/lib/*.test.mjs`, so the new spec needs a
  script line (lead-owned `package.json`): suggest
  `"test:e2e-smoke": "node --test e2e/smoke/environment.test.mjs"`.
- Another live session was running integration containers in this working tree throughout; the smoke
  stack allocates its own ephemeral ports, and acceptance was run serially, never concurrently with a
  smoke run.
- `scanAmbientSecrets` is name-based and conservative: it also matches benign flags such as
  `PASSWORD_AUTH_ENABLED`. Dropping them is harmless (children that need them get explicit
  overrides) and the exclusion is logged, not silent.
