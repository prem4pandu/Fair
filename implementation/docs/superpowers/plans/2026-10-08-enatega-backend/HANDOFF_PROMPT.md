# Local AI backend continuation prompt

Paste into the local AI at `/Users/premkumarmamidi/Development/Fair`.
The detailed execution guide is `implementation/docs/LOCAL_AI_HANDOFF.md`.

```text
Implement the existing FairBite backend incrementally against the complete pinned
Enatega UI. Read root and implementation AGENTS.md, docs/ROADMAP.md, ROADMAP.json,
ROADMAP_STATUS.md, TASK_BOARD.md and LOCAL_AI_HANDOFF.md before editing. These
paths are relative to implementation/ except root AGENTS.md. Use current source
and contracts to verify each runbook API; several lane plans remain PARTIAL.

Inspect git status and preserve existing work. There are generated GP0 evidence
changes from a newer run; do not overwrite them or assume the old container
blocker still applies. At the 10 October review, 15/16 GP0 commands passed and
integration failed in addresses.integration.spec.ts at the owner-cap concurrency
case. Diagnose actual HTTP status/body and database outcomes, repair the cause,
run focused and full integration, then record GP0 on a clean reviewed commit.
Do not weaken production protections or the atomic 50-address cap to pass tests.

Static compatibility already passes: 531 scoped documents, 845 full, zero
unresolved. Inventory is 334 roots (263 multi, 71 L12), with 18 detected resolvers
and zero recorded operation evidence. Preserve completed extraction work.
Next close W1/G0, then W2/G1 (G1 requires approved G0): real smoke harness, runtime L12 declarations with
explicit NOT_IMPLEMENTED behavior, canonical models/ports/events, fresh and
populated upgrades, both WebSocket protocols, scoped authorization and outbox
semantics. Do not equate static compatibility with runtime or business completion.

Before dependent domain work, define the typed app/test injection seam and load
permissions and restaurant/vendor/rider ownership from persisted server data.
The outbox currently registers no domain consumers. Reuse existing orders and
dispatch domain code; do not create a parallel architecture from stale snippets.
Respect T-003 through T-008 and T-019 through T-022 owners; every current
In-progress row is owned. Coordinate before editing or reassigning. Claim bounded tasks,
commit claims, isolate write paths, and use multiple agents within available
slots: one lead, up to three workers, rotating independent QA/security review.
Lead owns shared contracts, schema assembly, tooling, docs and integration.

Follow ROADMAP.json dependencies: identity/config/vendor -> customers/catalog ->
orders -> dispatch and finance -> notifications/analytics -> real journeys and
coverage -> provider/device/hardening -> owner-approved single-vendor/release.
Complete and review relevant PARTIAL plans before their implementation. Resolve
unowned CI/deployment/migration/accessibility/load/license/cutover work explicitly.
Do not enable single-vendor business behavior without the required owner decision.

The product UI MUST remain the complete pinned Enatega frontend. FairBite owns
backend and integration only. No original or source-derived replacement screens,
layouts, navigation, styling, assets or flows; no hiding unsupported actions.
Frontend edits are limited to transport, secure sessions, validated mapping,
configuration and centralized display names, plus presentation-preserving
security/accessibility fixes. Record every vendor edit in SOURCE_PROVENANCE.json
and regenerate the manifest. Preserve licenses. Never call upstream production
APIs, fabricate data/success, or invent unapproved economic policy.

Use integer minor units, server-owned prices, zero core food commission,
immutable balanced journals, atomic authorized transitions, tenant ownership,
provider-independent dispatch and idempotent outbox/consumers. Use actual pinned
GraphQL documents, REST callbacks and both WS protocols in real integration tests.
Keep provider secrets and raw card data out of clients.

For each task return commit/diff, exact commands/results, artifact paths, named
independent reviewer and remaining blockers. Populate operation evidence only
from executed tests. Use ./tools/pnpm.sh and existing scripts; pending-gate
commands are missing work, not acceptance. e2e:backend is API boundary smoke,
not original UI journeys. Native exports do not count as device acceptance.
Close gates only with a passing complete run and all independent approvals.
Preserve failed evidence. Continue independent authorized work while explicit
provider/device/policy inputs remain blocked; never claim product completion
until the declared backend, UI, native, provider and release gates pass.
```
