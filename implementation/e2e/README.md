# End-to-end harnesses

Two different harnesses live here, and they are not substitutes for each other.

## `e2e/backend` — API boundary smoke (`pnpm e2e:backend`)

Playwright project (`playwright.backend.config.ts`) that boots the built API and
checks HTTP boundaries. It does not run the product UI.

## `e2e/smoke` — G0 smoke (`pnpm e2e:smoke`)

The W1 gate harness from `ROADMAP.md` §7 (`ROADMAP.json` → `gates.G0`). It boots
the **real stack** — PostGIS 17 and Redis 7 containers, the complete migration
history, and the built API as a separate process over a real TCP socket — and
loads the exact pinned documents the admin and customer web apps send:

| Check               | Pinned source                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Handshake           | admin and customer web `METRICS_GENERAL`, with the real `nonce`, minting a public-access token  |
| Authorised read     | customer web `GET_CONFIG` (`query Configuration`) using the minted `bop-auth` token             |
| Subscription frames | admin `SUBSCRIPTION_PLACE_ORDER` and customer web `orderStatusChanged` on both WS protocol sets |
| WS data delivery    | the same `configuration` document executed over `graphql-ws` and `graphql-transport-ws`         |
| Readiness           | `/health/live` and `/health/ready`                                                              |
| Limits              | the bounded-operation rule measured against the largest real pinned document                    |

Nothing is mocked and no value is fabricated: the configuration read must return
the active server-owned version, and a subscription whose domain behaviour is not
built yet must reach its explicit `NOT_IMPLEMENTED` terminal frame on both
protocols. The run writes `test-results/e2e-smoke.json` (gitignored).

Scope note: this is the transport-level G0 smoke. The browser suites that load
the admin, customer web and single-vendor admin shells against the real stack are
`pnpm e2e` (W16, gate G3) and stay pending until the frontend integration lanes
land. `e2e/smoke` therefore never claims to prove UI behaviour.

## `pnpm e2e` / `test:journeys` / `coverage:e2e`

Still honest pending gates (`tools/pending-gate.mjs`): they fail with their
requirement and blocker rather than passing silently.
