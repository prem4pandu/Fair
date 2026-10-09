# Fresh application workspace

**Start here**

| Question                        | File                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------- |
| What is the plan?               | [`docs/ROADMAP.md`](docs/ROADMAP.md) — the only plan                          |
| Where is the build right now?   | [`docs/ROADMAP_STATUS.md`](docs/ROADMAP_STATUS.md) — run `pnpm roadmap` first |
| What can I pick up?             | [`docs/TASK_BOARD.md`](docs/TASK_BOARD.md)                                    |
| What did a gate actually prove? | [`docs/GATES.json`](docs/GATES.json)                                          |
| State of one operation?         | [`docs/OPERATION_TRACEABILITY.md`](docs/OPERATION_TRACEABILITY.md)            |

Dated snapshots live in [`docs/history/`](docs/history/README.md) and are never current.

This is the fresh application workspace and independently implemented backend foundation.
The product UI is the unchanged Enatega multivendor source in `vendor/enatega-ui/`; each app keeps its own npm lockfile and is not part of the pnpm workspace.
The prior FairBite application remains preserved in its original directory; it has no migration or decommissioning plan yet (`docs/ROADMAP.md` §13 U7).
The product display name is imported from `@fairbite/brand`.

The product remains in progress and no release gate is approved. Backend Playwright smoke does not establish full
original UI acceptance. Do not infer progress from this README: every count lives in the generated status files.

Latest W2 checkpoint: expanded source extraction covers 845 executable
request/fragment sites with zero unresolved documents. Static compatibility passes
for both scopes (531/531 multivendor and 845/845 full six-app). Populated upgrades
also prove historical session/refresh and address continuity. Static validation does
not establish resolver behavior or original UI acceptance. See the current plan and
`docs/artifacts/w2-reconciliation-2026-10-09/packet.json`; G0/G1 remain unapproved.

Use Node.js 24 and Corepack. Run `./tools/pnpm.sh install --frozen-lockfile`, then `./tools/pnpm.sh build`. The helper creates workspace-local package-manager shims so Turborepo can find pnpm.
Backend settings are explicit; there is no upstream production endpoint fallback.

Verification: `./tools/pnpm.sh lint`, `typecheck`, `test` and `test:integration`. Browser E2E against the Enatega apps returns with the backend contract work.
Real-stack checks need Docker; on this host select the Colima socket through DOCKER_HOST.
There is no CI: every gate is a local run recorded by `node tools/record-gate.mjs` (`docs/ROADMAP.md` §13 U1).

The module backlog is `docs/BACKEND_MODULE_PLAN.json`; static upstream operations and
runtime acceptance are tracked in `docs/ENATEGA_OPERATION_COVERAGE.json`
and `docs/END_TO_END_ACCEPTANCE.json`.

Run the local stack with `python3 tools/local-stack.py start`; verify it with
`python3 tools/local-stack.py status`. Logs and generated local configuration
stay in ignored `.toolchain/local-run`. The tool preserves database contents,
uses isolated named containers and does not seed demo catalog records. Stop
managed processes with `python3 tools/local-stack.py stop` (containers/data remain).
Before aggregate browser testing, stop the managed API and web dev servers:
`python3 tools/local-stack.py stop --only api customer-web merchant-web admin-web`.
Build, run checks, then restore with `python3 tools/local-stack.py start`.
