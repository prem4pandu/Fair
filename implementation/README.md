# Fresh application workspace

This is the fresh application workspace and independently implemented backend foundation.
The product UI is the unchanged Enatega multivendor source in `vendor/enatega-ui/`; each app keeps its own npm lockfile and is not part of the pnpm workspace.
The prior FairBite application remains preserved in its original directory.
The product display name is imported from `@fairbite/brand`.

Current checkpoint: public API/worker and six-app connection foundations, password
identity/session slice, public catalog reads, and customer identity/catalog/address
presentation integration. Full identity,
source UI parity, commerce, delivery, payments and release gates remain open.

Use Node.js 24 and Corepack. Run `./tools/pnpm.sh install --frozen-lockfile`, then `./tools/pnpm.sh build`. The helper creates workspace-local package-manager shims so Turborepo can find pnpm.
Backend settings are explicit; there is no upstream production endpoint fallback.
See `docs/EXECUTION_PLAN.json` for phase gates and external blockers.

Verification: `./tools/pnpm.sh lint`, `typecheck`, `test` and `test:integration`. Browser E2E against the Enatega apps returns with the backend contract work.
Real-stack checks need Docker; on this host select the Colima socket through DOCKER_HOST.
See `docs/FOUNDATION_EVIDENCE.json` for actual results and remaining gates.

Latest full-scope report: `docs/FULL_IMPLEMENTATION_REPORT.json`. It records
implemented slices, actual checks and remaining unimplemented modules. The full
module backlog is `docs/BACKEND_MODULE_PLAN.json`; static upstream operations and
runtime acceptance are tracked separately in `docs/ENATEGA_OPERATION_COVERAGE.json`
and `docs/END_TO_END_ACCEPTANCE.json`.

Run the local stack with `python3 tools/local-stack.py start`; verify it with
`python3 tools/local-stack.py status`. Logs and generated local configuration
stay in ignored `.toolchain/local-run`. The tool preserves database contents,
uses isolated named containers and does not seed demo catalog records. Stop
managed processes with `python3 tools/local-stack.py stop` (containers/data remain).
Before aggregate browser testing, stop the managed API and web dev servers:
`python3 tools/local-stack.py stop --only api customer-web merchant-web admin-web`.
Build, run checks, then restore with `python3 tools/local-stack.py start`.
