# T-026C — implemented-root detection is now syntax-based

Owner: lead-dsh-w25 (Lead). Repo board: `docs/TASK_BOARD.md` row **T-026** (W25).
Team task: `task-3`. Date: 2026-10-10.

## Defect

`tools/lib/operation-state.mjs` `implementedRoots()` scanned raw file text with
`/@(Query|Mutation|Subscription)\(\s*"([A-Za-z0-9_]+)"\s*\)/g`. This set is what the
derived roadmap/implementation artifacts report as "root operations with a real
resolver", so an over-count is a fabricated progress claim.

Demonstrated by failing tests (`red-phase.txt`):

| Case                                             | Regex result                 | Correct result |
| ------------------------------------------------ | ---------------------------- | -------------- |
| `// @Query("lineComment")`                       | counted (false positive)     | not a resolver |
| `/* @Mutation("blockComment") */`                | counted (false positive)     | not a resolver |
| `@Query("jsdocComment")` in a JSDoc block        | counted (false positive)     | not a resolver |
| `'@Query("inSingleQuotes")'` in a string literal | counted (false positive)     | not a resolver |
| `` `@Mutation("inTemplate")` ``                  | counted (false positive)     | not a resolver |
| `@Query(\n  "multiLine",\n)`                     | **missed** (false negative)  | counted        |
| `@Query("trailingComma",)`                       | **missed** (false negative)  | counted        |
| `@Mutation( /* inline */ "spaced" )`             | **missed** (false negative)  | counted        |

`red-phase.txt`: 6 tests, 3 pass, 3 fail against the regex implementation.

## Change

`implementedRoots()` now parses each file with `ts.createSourceFile` and walks the
syntax tree, reading real decorator applications via `ts.canHaveDecorators` /
`ts.getDecorators`. Only decorators named `Query`/`Mutation`/`Subscription` whose
single argument is a plain string literal matching `[A-Za-z0-9_]+` are counted.

Contract preserved exactly: the key is the lowercased kind plus the field name
**as declared** (`query.emailExist`, `mutation.changePassword`) — field-name case is
still not folded, because the generated artifacts compare against SDL field names.
Non-root decorators (`@Resolver`, `@Field`), non-literal arguments (`@Query(NAME)`)
and names containing `.` stay uncounted.

`green-phase.txt`: 6 tests, 6 pass.

## No-miscount proof on the real repository

`compare.mjs` reimplements the retired regex and diffs it against the new tree
implementation over `services/api/src/**/*.ts` (`equivalence.txt`):

```
legacy regex keys: 37
syntax-tree keys:  37
dropped (regex said implemented, tree disagrees): 0
added (tree found, regex missed): 0
```

So on today's tree this is **hardening, not a live miscount**: the 37 detected roots
are unchanged. The false-positive and false-negative classes above are latent — the
regex would have miscounted the moment any lane wrote decorator-shaped text in a
comment or reformatted a decorator.

## Test suite impact (honest, with A/B control)

`tools/generate-roadmap-status.test.mjs` reports **5 pass / 2 fail** with the new
implementation. The same file reports **5 pass / 2 fail** (same two tests) with the
implementation restored from `HEAD` — verified directly, not assumed:

```
roadmap status is current and internally consistent     ✖ (both)
status reports only derived facts ...                   ✖ (both)
```

The failures are pre-existing and belong to the concurrent W3 lane in this shared
working tree: the live source now has more resolvers (22) than the committed
generated status records (21), so `generate-roadmap-status` cannot reproduce the
committed document. This task did **not** regenerate any generated document — those
are lead-owned files another session is actively editing, and regenerating them
mid-batch would overwrite that lane's work.

Follow-up for the Lead: the stale-status drift (22 live vs 21 recorded) must be
resolved by whoever owns `docs/ROADMAP_STATUS.md` at a clean point, not by this task.

## Files

- `tools/lib/operation-state.mjs` — AST detection (added `typescript` import).
- `tools/lib/operation-state.test.mjs` — new spec, 6 tests.
- `docs/artifacts/w25/t026/state/{EVIDENCE.md,compare.mjs,red-phase.txt,green-phase.txt,equivalence.txt}`.

## Post-review hardening (independent review `5353c9f`, findings C1/C2/C3/D3)

The independent reviewer's adversarial fixtures found three residual classes and a
formatting gate failure. Resolution:

| Finding                                                                                    | Resolution                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C2 — `@Query(...)` on a class, a property or a parameter was counted as an implemented root | **Fixed.** Detection is now restricted to `ts.isMethodDeclaration`: `@Query`/`@Mutation`/`@Subscription` only register a resolver on a method. New spec `counts only method roots, not class, property or parameter decorations`. |
| C3 — `@Query(("parenthesised"))` and `@Query("con" + "catenated")` are not detected         | **Accepted limitation, now explicit.** Pinned by the spec `documents the argument shapes that are deliberately not resolved`. A static inventory must not evaluate expressions; under-counting falls back to `NOT_IMPLEMENTED`, over-counting would fabricate progress. |
| C1 — the new spec was not Prettier-formatted, failing `pnpm format:check`                   | **Fixed.** `npx prettier --check tools/lib/operation-state.{mjs,test.mjs}` is clean.                                                                                                                                            |
| D3 — this lane's `GATE_DECISION.md` said G1 "consists of exactly" three commands            | **Fixed.** G1 has six; only the three `check:enatega*` commands are invalidated by T-026B. The correction is recorded in the file itself.                                                                                      |

Re-verified after the restriction (`equivalence-post-review.txt`, taken on a tree that has
since gained a resolver from the concurrent W3 lane):

```
legacy regex keys: 38
syntax-tree keys:  38
dropped (regex said implemented, tree disagrees): 0
added (tree found, regex missed): 0
```

All 38 roots on the real repository are method-decorated, so tightening to methods lost
nothing. Spec is **8 tests, 8 pass**.

## Reproduce

```
cd implementation
node --test tools/lib/operation-state.test.mjs        # 8/8 pass
node docs/artifacts/w25/t026/state/compare.mjs        # 0 dropped / 0 added
npx prettier --check tools/lib/operation-state.mjs tools/lib/operation-state.test.mjs
```


