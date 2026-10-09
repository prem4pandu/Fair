# W12 customer-web integration audit

Date: 2026-10-09. Package: `vendor/enatega-ui/enatega-multivendor-web` at the pinned Enatega source revision.
This audit preserves every Enatega screen, route, layout, asset and interaction. It assesses only origin,
transport, session, provider and mapping boundaries. Static compatibility is 531/531 for multivendor documents;
that is not runtime acceptance. The repository currently proves only 18/334 resolvers and 0/334 operation evidence,
so most customer-web actions legitimately return `NOT_IMPLEMENTED` until their backend lanes close.

## Required local documentation read

The package-local installed Next.js **16.2.10** documentation was read from
`vendor/enatega-ui/enatega-multivendor-web/node_modules/next/dist/docs`: environment variables, authentication,
Content Security Policy and production checklist. Relevant constraints applied here: `NEXT_PUBLIC_*` values are
build-time public values; provider secrets cannot use them; runtime secrets belong on the server; session checks
must occur at the route/data boundary; CSP origins must match configured providers; nonce CSP would force dynamic
rendering and is therefore deferred rather than imposed across the unchanged Enatega rendering model.

## A1 — origins

| Surface                    | Source                                                  | Current rule                                                       | Result                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL HTTP               | `lib/mode/environment.ts`, `lib/hooks/useSetApollo.tsx` | `NEXT_PUBLIC_SERVER_URL` → `/graphql`; single-vendor equivalent    | No upstream fallback. Missing value currently becomes relative `/graphql`; acceptable only after the same-origin BFF exists, otherwise configuration blocker. |
| GraphQL WS                 | same                                                    | `NEXT_PUBLIC_WS_SERVER_URL` → `/graphql`; single-vendor equivalent | No upstream fallback. Legacy `subscriptions-transport-ws` retained.                                                                                           |
| REST/media                 | `lib/mode/environment.ts`, configuration context        | server base with trailing slash                                    | Multivendor uses configured server; single-vendor uses explicit REST value or configured server.                                                              |
| Reverse geocode            | `app/api/maps/reverse-geocode/route.ts`                 | same configured REST base, `no-store`, 10 s timeout                | Preserved; W4 maps implementation/credentials remain blockers.                                                                                                |
| Stripe                     | checkout screens                                        | configured REST base                                               | No upstream fallback; server-owned order pricing remains required.                                                                                            |
| Single-vendor schema check | `scripts/check-single-vendor-schema.js`                 | previously fell back to upstream Railway                           | Fixed to require `SINGLE_VENDOR_SCHEMA_URL`; no production fallback survives.                                                                                 |

Repository search after edits finds no active `aws-server-v2.enatega.com`, Railway GraphQL fallback, embedded
Firebase project or Clarity project id in this package. External image/app-store links remain Enatega presentation
assets and user navigation, not API fallbacks.

## A2 — operations

`OPERATION_LANES.json` associates **91 roots** with the customer web app: 51 queries, 34 mutations and 6
subscriptions. `OPERATION_TRACEABILITY.md` is authoritative for each row. Current product-wide resolver counts are
18 implemented and 316 explicit `NOT_IMPLEMENTED`; no operation has recorded evidence. All 91 web roots have SDL
declarations because the current scoped compatibility report has zero missing roots. This package does not alter a
document to hide missing backend behavior.

The high-impact runtime blockers are identity recovery/session refresh (W3), public configuration/maps/media (W4),
catalog/discovery (W5), customer/support/favourites (W6), cart/order/payment (W7/W9), tracking/chat (W8),
notifications (W10), and every single-vendor root (W21 decision). Exact operation state is intentionally referenced
from the generated traceability file instead of copied into a second stale list.

The one document correction allowed by this work is `configuration.vapidKey`: the existing configuration context
already reads it, but `GET_CONFIG` did not select it. The query now selects the backend-owned public VAPID key.

## A3 — session

Current Enatega behavior stores access token, user id/type and expiry in mode-scoped `localStorage`
(`lib/utils/methods/auth.ts`, `lib/mode/storage.ts`) and sends bearer authorization from the Apollo request link and
WS connection parameters. Metrics nonce/token are also browser storage. Invalid-session codes clear the selected
mode and route to the existing login screen.

This does **not** meet the roadmap's HttpOnly BFF-cookie target. No FairBite same-origin login/refresh/logout/session
route contract exists in the repository, and W3 is incomplete. Implementing a client-only cookie or inventing BFF
routes would create a false security boundary. W12 therefore records the session bridge as a blocker. Until W3 and
the lead freeze those routes, production customer-web authentication is not approved. The current token path was
left unchanged rather than pretending local storage is secure.

## A4 — providers

| Provider                      | Before                                                     | Integration result                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft Clarity             | hard-coded id and unconditional script                     | Loads only when `NEXT_PUBLIC_CLARITY_PROJECT_ID` is configured; hard-coded id removed.                                                                                                                                                                         |
| EmailJS CDN                   | unconditional script                                       | Loads only with `NEXT_PUBLIC_EMAILJS_ENABLED=true`. Service/public ids remain public configuration; no private key is introduced.                                                                                                                              |
| Firebase foreground/web token | initialized after login even with incomplete configuration | Requires explicit `NEXT_PUBLIC_WEB_PUSH_ENABLED=true`, every public Firebase field and `vapidKey`. Provider notification redirects are accepted only when they resolve to an HTTP(S) URL on the current origin, then stored and assigned as a path/query/hash. |
| Firebase background worker    | upstream Firebase project/key embedded in two public files | Embedded credentials and provider imports removed. Registration is disabled by default. Background web push remains blocked pending a reviewed configured worker.                                                                                              |
| Google Maps                   | key comes from `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`           | Existing empty-key behavior avoids the manual loader but the library loader still needs package-level follow-up; provider credential and W4 maps API are blockers.                                                                                             |
| Stripe/PayPal                 | public keys/config and server session endpoints            | Screens preserved; provider sandbox and backend endpoints are blockers. No client secret added.                                                                                                                                                                |
| Sentry                        | backend public configuration                               | No hard-coded DSN found in customer web.                                                                                                                                                                                                                       |

The current CSP remains too broad (`https:`/`wss:`) to prove a zero-unconfigured-host network gate. Tightening it
requires a reviewed list of Enatega presentation/CDN hosts and configured providers; a blanket removal would break
the pinned assets. This remains a W12/W24 blocker.

## A5 — routes and callbacks

All **40** routes listed for customer web in `ENATEGA_URL_CONTRACT.json` still have their original page files,
including browse/category/discovery/search/store/restaurant, auth/reset, tracking/checkout, all profile routes and
the three Stripe result pages. No route was renamed or removed. The source still navigates to `/paypal?id=…`, while
no `/paypal` page exists; this is a backend/provider integration blocker and cannot be hidden with a replacement UI.
Password-reset tokens remain URL inputs to the original screen and require W3 validation/one-time consumption.

## A6 — install and verification recipe

- Package contract: Node `>=20`, `.nvmrc` `v20.16.0`, npm lockfile, `legacy-peer-deps=true` already recorded in the
  package `.npmrc` for its React 19/chat peer mismatch.
- Exact install: `cd vendor/enatega-ui/enatega-multivendor-web && npm ci --ignore-scripts`. The session used the
  available Node 24 runtime with the package's existing relaxed engine setting; 984 packages installed in 39
  seconds. The directory measured 1.8 GB and `node_modules` 1.0 GB. Re-run under pinned Node 20.16.0 before gate
  approval because that remains the package contract.
- Package-local lint, TypeScript, 75 tests and the production build pass. npm reports 46 dependency advisories
  (21 moderate, 22 high, 3 critical); W20 must assess them without casual lockfile churn in W12.
- Build-time required values for a multivendor check: owned local HTTP/WS origins plus provider flags false. A build
  is not evidence that backend journeys work.

## A7 — edit list and boundaries

All vendor edits are L-D/L-E configuration or provider gating. No component structure, screen, route, styles,
assets or interaction flow changed. Exact entries for lead serialization are in `provenance-handoff.json`.

## Remaining blockers and acceptance state

- HttpOnly BFF session bridge and CSRF contract: blocked on W3/lead route contract.
- Background web push: blocked on provider credentials and a reviewed generated worker.
- Google Maps, payment providers and notifications: blocked on W4/W9/W10/W18 plus owner credentials.
- Network allow-list CSP: blocked on reviewed presentation/provider host inventory.
- Runtime operation journeys and legacy WS acceptance: blocked on backend lane completion and W16 real-stack tests.
- `/paypal` route mismatch remains visible and unresolved; the original action was not removed.

W12 is **not complete**. This change removes active embedded provider credentials, closes the VAPID selection gap,
and makes unconfigured analytics/email/push fail closed while preserving the original Enatega UI.
