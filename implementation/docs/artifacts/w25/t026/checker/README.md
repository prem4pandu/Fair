# T-026B — `check:enatega --check` must diff its report, not rewrite it

Owner: `w25-checker` (shared task `task-2`, repo row T-026 in
`docs/TASK_BOARD.md`). Write scope: `tools/check-enatega-compatibility.mjs`,
`tools/check-enatega-compatibility.test.mjs`, this evidence directory.

## Defect (observed at baseline, `1ad6580`)

`--check` called `writeFileSync(output, ...)` unconditionally *before*
evaluating `report.staticCompatibility !== "PASS"`. Proof on a temp copy (no
repo file touched): a corrupted
copy of `docs/ENATEGA_COMPATIBILITY_REPORT.full.json` was silently overwritten
with the freshly generated report and the command exited 0.

```
$ sha256sum /tmp/t026-checker-baseline/corrupt.json   # before
199ad3eb8a77fb83ba40c78bd0f858252b8a5c3fc371985b346bccb98d84dfaf
$ node tools/check-enatega-compatibility.mjs vendor/enatega-ui contracts /tmp/t026-checker-baseline/corrupt.json --check
{"status":"PASS","apps":6,"documents":845,...}
EXIT=0
$ sha256sum /tmp/t026-checker-baseline/corrupt.json   # after — now identical to the committed report
11819108d017f5c41a8cda0a9cf9c312f78dfaeb4e2dab4e4bc2facad90dddcb
```

Baseline of the three gate commands (`1ad6580`): all PASS/exit 0, and the three
committed reports were already byte-identical to the generated output
(hashes unchanged before/after), so the silent rewrite was hiding no drift at
that moment — the defect is that it *cannot detect* drift.

## Change

* `--check` never writes `OUTPUT`. It parses the on-disk report, deep-compares
  it with the freshly computed report via the new exported `reportDrift()`,
  prints every difference to stderr (`DRIFT DETECTED ... ; it was NOT
  modified`), and exits nonzero on any drift, a missing file, invalid JSON or
  a byte-level formatting mismatch. Exit 0 only when byte-identical.
* Without `--check` behaviour is unchanged: the prettier-formatted report is
  written, and the process still exits 0 even when `staticCompatibility` is
  `FAIL` (the old check-mode-only `process.exitCode = 1` rule is preserved).
* Usage text now documents both semantics.
* Diff detail names every differing top-level key with both values, and counts
  differing app/document records (`apps: 1 of 6 app record(s) differ — ...
  (1 of 111 document record(s) differ)`).

## Evidence files

| file | contents |
| --- | --- |
| `00-baseline-and-red.txt` | pre-change hashes, defect proof on temp copy, baseline `pnpm check:enatega` |
| `01-tdd-red.txt` | failing tests before the fix (3 red; drift + missing-report + usage) |
| `02-acceptance-pnpm.txt` | post-change `pnpm check:enatega{,full,singlevendor}` + before/after report hashes + clean `git status` |
| `03-drift-demo.txt` | corrupted temp copy: EXIT=1, unchanged hash, precise diff; non-check path still writes byte-identical output; temp files deleted |
| `04-tdd-green.txt` | `node --test tools/check-enatega-compatibility.test.mjs` → 26/26 pass, plus post-prettier re-verification |
| `README.md` | this summary |

## Result

* `node --test tools/check-enatega-compatibility.test.mjs` → 26 tests, 26 pass, 0 fail.
* `pnpm check:enatega` / `check:enatega:full` / `check:enatega:singlevendor`
  → all `{"status":"PASS",...}` exit 0, and `git status --short` shows the three
  report JSON files unmodified (hashes identical before/after).
* Drift: corrupted temp copy → exit 1, file hash unchanged, precise diff printed.

## Notes / observations

* `--check` semantics changed, so the G1 gate needs re-recording — that decision
  is the Lead's; `pnpm record-gate` / `docs/GATES.json` were not touched.
* Shared live tree: while this task ran, another session held uncommitted
  changes in `services/api/src/identity/{enatega,resolver,service}.ts` and
  untracked `services/api/test/**/changePassword*.spec.ts`,
  `services/api/prisma/migrations/202610100002_l1_audit_actions/`; the smoke lane
  added untracked `e2e/smoke/{environment.mjs,environment.test.mjs,fixtures/}`
  and `docs/artifacts/w25/t026/smoke/`. None were staged, committed or modified
  by this task; the commit uses an explicit pathspec limited to the two tool
  files plus `docs/artifacts/w25/t026/checker`.
* The first baseline `pnpm check:enatega` run took ~199s under heavy concurrent
  load; all later runs took 2–3s. Not a tool property.
* No blocker.
