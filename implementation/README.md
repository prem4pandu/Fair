# Fresh application workspace

This is the fresh application workspace and independently implemented backend foundation.
Enatega presentation adoption is planned after the source/action audit; the current apps are original public connection shells.
The prior FairBite application remains preserved in its original directory.
The product display name is imported from `@fairbite/brand`.

Current packet: public API/worker and six-app connection foundations. No identity,
commerce, real delivery, payment or release completeness is claimed.

Use Node.js 24 and Corepack. Run `./tools/pnpm.sh install --frozen-lockfile`, then `./tools/pnpm.sh build`. The helper creates workspace-local package-manager shims so Turborepo can find pnpm.
Backend settings are explicit; there is no upstream production endpoint fallback.
See `docs/EXECUTION_PLAN.json` for phase gates and external blockers.

Verification: `./tools/pnpm.sh lint`, `typecheck`, `test`, `test:integration`, and `test:e2e`.
Real-stack checks need Docker; on this host select the Colima socket through DOCKER_HOST.
See `docs/FOUNDATION_EVIDENCE.json` for actual results and remaining gates.
