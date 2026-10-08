# Handoff prompt for a new session

Paste the block below into a new Claude Code session opened in the repository root.

```
Continue the Enatega-compatible backend in C:\Users\PREMKUMAR.MAMIDI\source\Fair on branch enatega-ui-backend.

READ FIRST, in order:
1. AGENTS.md and implementation/AGENTS.md. The UI is the unchanged Enatega source in implementation/vendor/enatega-ui/. Only edit it for transport, adapter or configuration changes, and record each edit in SOURCE_PROVENANCE.json under allowedModifications, then run node tools/manifest-enatega-ui.mjs. Never fake success. Never call upstream Enatega hosts.
2. implementation/docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md (decisions D1-D16, conventions, lanes, gates).
3. 01-wave0-foundation.md (three parallel agents: W0-A kernel and transport, W0-B tooling, W0-C test and Playwright harness; full code and tests). Then 02-wave1-contract-and-data-model.md.

STATE:
- Rebased onto main; vendor/enatega-ui is the only Enatega copy and matches upstream d9eb29e except 4 removed Firebase files.
- 334 root GraphQL operations are inventoried in implementation/docs/ENATEGA_OPERATION_INVENTORY.json and assigned to lanes in OPERATION_LANES.json: 264 multivendor, 70 single-vendor (L12, gated).
- The existing backend (NestJS + Apollo, Prisma + PostGIS, Redis, BullMQ) serves 15 FairBite-named operations; none of the Enatega apps' operations work yet.
- Reference docs are in plans/.../reference/01..04 (client transport and the metricsGeneral handshake, customer flows, store and rider flows, admin flows).
- Verified clean: lint, typecheck, build, 40 unit tests, codegen, manifest check, contract-tool tests.
- check:enatega correctly reports FAIL until Wave 1.

NEXT: execute Wave 0 with parallel subagents (superpowers:subagent-driven-development), then Wave 1. Write each lane's plan (L1-L8, journeys and E2E) just before its wave, from _lane-plan-brief.md. Unfinished drafts are the *.PARTIAL.md files (L5-L8, single-vendor); L9 and Wave 4 are complete.

BLOCKERS (owner):
- Docker Desktop needs sign-in to the theaccessgroup org (image pulls return HTTP 407). Without it the 30 DB integration tests and all E2E can't run.
- ~/.npmrc references an unset ADO_NPM_TOKEN, so registry installs hang; use pnpm --offline or fix it.
- Provider accounts: Stripe, Twilio, SendGrid, Firebase, Google Maps, S3.

OPEN OWNER DECISIONS (defaults in the master plan):
- D1 single-vendor scope: default MULTI only.
- D4 commission: zero on core plan.
- D5 pickup orders skip COMPLETED.
- D6 timeouts.
- D12 and D13: card, email and SMS providers.
- L9: Admin permission for platform dashboards, and sales means delivered orders only.

Run pnpm via implementation/.toolchain/bin. Windows: use POSIX paths in tools. Start by asking whether Docker is signed in.
```
