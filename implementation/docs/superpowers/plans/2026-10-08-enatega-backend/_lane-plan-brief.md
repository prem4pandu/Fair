# Brief for lane-plan authors (not an implementation plan)

You are writing ONE implementation plan file for one lane of the Enatega-compatible backend. You write a plan; you do not implement it. Edit nothing except your output file.

## Read first

1. `implementation/AGENTS.md` and the root `AGENTS.md`.
2. `implementation/docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md` — decisions D1–D16, conventions §4, ownership §6, waves §7, gates §8. These are binding; do not contradict them.
3. `01-wave0-foundation.md` — the kernel and harness APIs you must use: `appError(code, message)`, `requireAuth`, `requirePermission`, `requireOwnership`, `RequestContext` (`ctx.auth()` is async), `toMinor`/`toMajor`/`percentOf`, `isoString`/`epochMillisString`/`parseClientDate`, `point`/`polygon`/`containsPoint`/`openingTimes`/`isOpenAt`/`haversineKm`, `paginate`/`p1`/`p2`/`p4`/`p5`/`p6`, `newId`/`parseId`, `PUBSUB` (`publish`, `subscribe(topic, filter)`), test harness `startStack()`, `startApi(stack)`, `api.http` (`GqlClient`: `query(doc, vars)`, `withUser(token)`), `doc(app, file, exportName)`, `op("type.name")`, `legacySubscribe(api.wsUrl, doc, vars, connectionParams)`, `mobileClient(server, "app"|"store"|"rider")`, `factories(stack.pool)`.
4. `02-wave1-contract-and-data-model.md` — SDL files per lane, Prisma multi-file schema, ports in `kernel/ports.ts` (use these exact interfaces), domain events and the outbox (`enqueue(client, event)`), factories.
5. The reference docs in `implementation/docs/superpowers/plans/2026-10-08-enatega-backend/reference/` that cover your lane. They cite vendored source as file:line. Verify anything you rely on by reading the vendored source in `implementation/vendor/enatega-ui/` yourself.
6. `implementation/docs/OPERATION_LANES.json` — the authoritative list of your lane's operations (filter by `lane`).
7. Existing code you will reuse: `implementation/services/api/src/**` and `implementation/services/api/test/**`.

## What the plan must contain, in this order

1. Header exactly:
   ```
   # Lane <Lx> — <name>

   > **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

   **Goal:** …
   **Architecture:** … (2–3 sentences)
   **Tech stack:** …
   ```
2. **Frontend boundary** — paste master §1 verbatim.
3. **Operations** — a table with EVERY operation of your lane from `OPERATION_LANES.json`: type, name, apps that call it, who may call it (role/permission/ownership, from reference/04 §B and the other references), the exact vendored document location(s) to use in tests (`app`, `file`, `exportName` — verify each export name exists by reading the file), and the reference section. No operation may be missing. State the total count and check it against the JSON.
4. **Contract notes** — for each type your lane owns: fields, types, nullability, timestamp convention, money fields, misspellings that must be kept, and any field-level restriction. Include the SDL for anything the generator in W1-0.3 cannot infer correctly (enums, inputs). This guides W1-L.1.
5. **Data model** — complete Prisma models for the lane (copy-pasteable), plus any raw SQL (PostGIS columns, GIST indexes, check constraints, sequences), and the cross-lane FK list for `docs/CROSS_LANE_FKS.md`. This guides W1-L.2.
6. **Business rules** — numbered (R1, R2, …). Every rule the apps imply, every server-side recomputation, every ownership check, every exact error string the apps match on (quote it), every subscription that must fire and its audience and payload, every timeout. Mark anything not provable from the source as UNVERIFIED with the default you chose.
7. **Tasks** — bite-sized TDD tasks grouped by feature. EVERY task has:
   - **Files:** exact paths (Create/Modify/Test) under the lane's owned directories (master §6).
   - Step 1: the failing test — COMPLETE code. Integration tests use the harness and the exact vendored documents via `doc(...)`, tagged `describe(op("mutation.x"), …)`. Cover per operation: happy path, auth failure, ownership failure, validation failure, and each business rule. Assert specific fields, not snapshots.
   - Step 2: the exact command and the expected failure.
   - Step 3: the implementation — COMPLETE code for services, repositories, resolvers, mappers and jobs. Resolvers stay thin (parse with zod, auth, call service). Use the kernel helpers; never `new GraphQLError` directly.
   - Step 4: the exact command and expected pass.
   - Step 5: commit with message `<type>(<lane>): …`.
   Where many operations share a pattern (CRUD lists, paginated lists, config saves), you may implement them in one task with a shared helper, but every operation still gets its own test case and its own resolver method, and the code must be complete — no "repeat for the others", no "similar to Task N", no TBD/TODO.
8. **Worker jobs and event handlers** the lane owns (outbox consumers, timeouts), with tests.
9. **Playwright and journey specs to hand to L10** — for each user-visible flow your operations power in the admin or customer web apps: spec file path under `implementation/e2e/specs/<admin|web>/`, the route, the user actions (use the real Enatega UI — selectors by role/label/text found in the vendored source, with file:line), the assertions, and the `@op:` tags. For mobile-only flows: the journey test under `services/api/test/journeys/` replaying the mobile app's documents in order.
10. **Coverage and gate checklist** — commands for G2 for this lane (from master §8), and the exact list of operations that must show `implemented: true` and `integrationTested: true` in `docs/OPERATION_COVERAGE.json`.
11. **Open questions / blockers** — anything needing the owner or a provider account.

## Quality bar

- No placeholders of any kind (see the writing-plans rules: no TBD, no "add validation", no "handle edge cases", no "write tests for the above", no "similar to Task N"). If a step changes code, show the code.
- Names, types and signatures must be consistent across your tasks and with the kernel/ports APIs above.
- Exact strings matter: copy error messages, enum values, field names and misspellings from the vendored source.
- Keep resolver argument names and types exactly as the app documents declare them.
- Money: integer minor units internally, `Float` major units on the wire; prices and totals recomputed server-side.
- Never fake success. Missing provider → `PROVIDER_UNAVAILABLE`; not built → `NOT_IMPLEMENTED`.
- After writing, self-review: every operation in your lane appears in the Operations table AND has at least one test case in a task; fix gaps before finishing.

Your final reply: the output path, the operation count covered, the number of tasks, and a list of open questions. Keep the reply under 300 words.
