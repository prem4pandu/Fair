# Historical artifacts

Nothing in this directory is current. These files are kept as evidence of what was believed or measured on their
date, because deleting them would erase the record of how decisions were made.

**Do not quote any of them as present state.** Current state is generated:

| Want to know                | Read                                                            |
| --------------------------- | --------------------------------------------------------------- |
| The plan                    | [`../ROADMAP.md`](../ROADMAP.md)                                |
| The plan, machine-readable  | [`../ROADMAP.json`](../ROADMAP.json)                            |
| Where the build actually is | [`../ROADMAP_STATUS.md`](../ROADMAP_STATUS.md) (`pnpm roadmap`) |
| Per-operation state         | [`../OPERATION_TRACEABILITY.md`](../OPERATION_TRACEABILITY.md)  |
| What a gate actually proved | [`../GATES.json`](../GATES.json)                                |
| What is claimable now       | [`../TASK_BOARD.md`](../TASK_BOARD.md)                          |

| File                                         | What it was                                                                                      | Replaced by                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `2026-10-08-day0-baseline.md`                | §1 of the former master plan: day-0 gate scoreboard, in-flight work, red-gate causes, 10-09 note | `../ROADMAP_STATUS.md`                                  |
| `2026-10-08-MASTER_PLAN.json`                | machine-readable workstreams, batches, gate commands, risks                                      | `../ROADMAP.json`                                       |
| `2026-10-08-EXECUTION_PLAN.json`             | the FB00–FB20 phase plan and its scheduling                                                      | `../ROADMAP.md` §4.0 capability map                     |
| `2026-10-08-FULL_IMPLEMENTATION_REPORT.json` | a narrative full-scope checkpoint, already self-marked SUPERSEDED                                | `../ROADMAP_STATUS.md`, `../IMPLEMENTATION_STATUS.json` |

The FB capability names in `2026-10-08-EXECUTION_PLAN.json` survive in `../ROADMAP.json` under `capabilityMap`,
which maps every FB phase to the workstreams that deliver it. Its per-phase status fields do not survive and were
wrong by the time they were read: they reported FB02–FB04 as in progress or verified while the lanes behind them
had only a handful of resolvers.
