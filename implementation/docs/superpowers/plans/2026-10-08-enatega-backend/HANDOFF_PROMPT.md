# Handoff prompt for a new session

Paste the block below into a new Codex session opened in the repository root.

```
Continue the Enatega-compatible backend in /Users/premkumarmamidi/Development/Fair on main.

READ FIRST, in order:
1. AGENTS.md and implementation/AGENTS.md. The UI is the unchanged Enatega source in implementation/vendor/enatega-ui/. Only edit it for transport, adapter or configuration changes, and record each edit in SOURCE_PROVENANCE.json under allowedModifications, then run node tools/manifest-enatega-ui.mjs. Never fake success. Never call upstream Enatega hosts.
2. implementation/docs/superpowers/plans/2026-10-08-enatega-backend/00-master-plan.md (decisions D1-D16, conventions, lanes, gates).
3. 01-wave0-foundation.md (three parallel agents: W0-A kernel and transport, W0-B tooling, W0-C test and Playwright harness; full code and tests). Then 02-wave1-contract-and-data-model.md.

STATE:
- Rebased onto main; vendor/enatega-ui is the only Enatega copy and matches upstream d9eb29e except 4 removed Firebase files.
- 334 root GraphQL operations are inventoried in implementation/docs/ENATEGA_OPERATION_INVENTORY.json and assigned to lanes in OPERATION_LANES.json: 264 multivendor, 70 single-vendor (L12, gated).
- The existing backend (NestJS + Apollo, Prisma + PostGIS, Redis, BullMQ) includes verified Enatega configuration and publicConfiguration reads. Complete compatibility is still pending.
- Reference docs are in plans/.../reference/01..04 (client transport and the metricsGeneral handshake, customer flows, store and rider flows, admin flows).
- Verified before the current Wave 0 slice: lint, typecheck, build, 40 unit tests, 35 database/Redis integration tests, codegen, manifest check and contract-tool tests.
- check:enatega correctly reports FAIL until Wave 1.

NEXT: continue Wave 0 in batches of at most three workers plus the lead. Finish every missing lane plan and resolve the 132 dynamic GraphQL sites before Wave 1 lane work. Wave 2 is blocked until L1-L8 and the journey/E2E plans are complete.

BLOCKERS (owner):
- Provider accounts: Stripe, Twilio, SendGrid, Firebase, Google Maps, S3.

OPEN OWNER DECISIONS (defaults in the master plan):
- D1 single-vendor scope: default MULTI only.
- D4 commission: zero on core plan.
- D5 pickup orders skip COMPLETED.
- D6 timeouts.
- D12 and D13: card, email and SMS providers.
- L9: Admin permission for platform dashboards, and sales means delivered orders only.

Run pnpm through implementation/tools/pnpm.sh. Docker and dependency installation are currently working locally; verify rather than repeating stale blocker questions.
```
