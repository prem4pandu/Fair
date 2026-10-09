# Enatega-compatible backend — design

Date: 2026-10-08. Status: awaiting owner review.

## Goal

Run the five unchanged Enatega multivendor apps in `implementation/vendor/enatega-ui/`
against our own backend. The backend implements the API those apps call, with
the same operation names, arguments, response shapes and transports. The only
edits allowed inside `implementation/vendor/enatega-ui/` are server URL configuration,
each recorded under `allowedModifications` in `SOURCE_PROVENANCE.json`.

Apps in scope (pinned commit `d9eb29e`): `enatega-multivendor-admin`,
`enatega-multivendor-app` (customer), `enatega-multivendor-rider`,
`enatega-multivendor-store`, `enatega-multivendor-web` (customer web).

Out of scope: the single-vendor admin, UI changes, and capabilities the five
apps never call (for example a Lalamove adapter).

## What the apps require

Measured from the pinned source:

- About 308 distinct root operations: 158 queries, 164 mutations, 11
  subscriptions. Step 1 below produces the exact list.
- GraphQL over HTTP at `/graphql`. Auth header `Authorization: Bearer <jwt>`.
- Subscriptions over WebSocket at `/graphql` using the legacy
  `subscriptions-transport-ws` protocol (`WebSocketLink`). The token arrives in
  `connectionParams.authorization`. The store app expects unauthenticated
  sockets to be rejected for restaurant subscriptions.
- REST routes for payments, including `stripe/create-checkout-session`,
  `stripe/account` and a PayPal flow. Step 1 enumerates the full set.
- IDs that look like MongoDB ObjectIds (24 hex characters). The customer web
  order-tracking screen branches on this format.
- Four logins: `login` (customer, including Google/Apple), `riderLogin`,
  `restaurantLogin`, `ownerLogin` (admin and vendor, with `refreshToken`), plus
  email/SMS OTP and password reset.
- Order statuses `PENDING`, `ACCEPTED`, `ASSIGNED`, `PICKED`, `DELIVERED`,
  `COMPLETED`, `CANCELLED`. Payment methods `STRIPE`, `PAYPAL`, `COD`.

## Architecture

Keep the existing foundation: NestJS + Apollo (schema-first), Prisma +
PostgreSQL (PostGIS), Redis, BullMQ worker.

Changes:

1. **One contract.** `contracts/enatega.graphql` replaces the four FairBite
   contract files and becomes the only schema the API loads.
2. **Both WebSocket protocols** on `/graphql`: `subscriptions-transport-ws` for
   the Enatega apps and `graphql-ws`. Redis-backed pub/sub, so several API
   instances share events.
3. **ObjectId-format keys.** All primary keys become 24-hex strings generated
   by the API. Existing UUID tables are migrated; no production data exists.
4. **Money.** Stored as integer minor units, as `AGENTS.md` requires. Converted
   to and from the `Float` fields Enatega uses at the API boundary, rounded to
   the currency's minor unit. Prices and totals are always computed on the
   server.
5. **Unimplemented operations** exist in the schema but return a
   `NOT_IMPLEMENTED` GraphQL error. They never return fake success.

Domain modules, each owning its tables, resolvers and tests:

| Module          | Covers                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| `auth`          | four logins, social sign-in, OTP, password reset, JWT, push tokens      |
| `users`         | customers, addresses, favourites, admin user management                 |
| `vendors`       | vendors, restaurants/stores, hours, delivery areas, banners, cuisines   |
| `catalog`       | categories, foods, variations, add-ons, options                         |
| `orders`        | cart pricing, placing orders, status rules, reviews, tips, coupons, tax |
| `dispatch`      | riders, zones, assignment, live location, earnings, withdrawals         |
| `payments`      | Stripe/PayPal checkout and webhooks, commission, payouts                |
| `notifications` | push, email, SMS, chat                                                  |
| `config`        | admin configuration screens, app versions                               |
| `realtime`      | the 11 subscriptions and their per-role access checks                   |

Every resolver checks both role and ownership. A rider sees only their own
orders; a store only its own.

## Build order

1. **Contract extraction.** A tool parses every GraphQL document in the five
   apps, including fragments and template interpolations, plus the TypeScript
   interfaces in `lib/utils/interfaces`, and generates
   `contracts/enatega.graphql`. Ambiguous types are resolved by reading the
   calling screen. This replaces `tools/inventory-source.py`, which still
   expects the removed apps.
2. **Contract test and coverage report.** Every app document must validate
   against the schema (target: all of them). A generated report lists each
   operation as implemented, tested or missing.
3. **Transport and auth.** Legacy WebSocket protocol, Bearer auth on HTTP and
   WebSocket, ObjectId keys. The existing 15 FairBite operations are rewritten
   to their Enatega equivalents (for example `loginPassword` → `login`,
   `catalogOutlets` → `restaurants`), keeping their tests and security rules.
4. **Modules,** in this order: auth → vendors and catalog → orders → store
   acceptance → dispatch and tracking → payments → notifications and chat →
   admin, config and finance.
5. **App wiring.** Point the apps' environment config at the local API. Run
   the web apps with Playwright and the mobile apps in Expo, then on devices.

A module is done when its operations pass the contract test, have unit and
database integration tests, and work in the real Enatega app.

## Testing

- Contract test: all app documents validate against `enatega.graphql`.
- Unit and HTTP tests per resolver (Vitest).
- Database integration tests with real PostgreSQL and Redis (Testcontainers).
  These need Docker; this Windows machine does not have it yet.
- End-to-end: the real Enatega web and admin apps under Playwright; mobile apps
  in Expo, then on signed devices.

## Open questions for the owner

1. `AGENTS.md` requires zero commission on core-plan food orders, but the
   Enatega admin has commission settings (`updateCommission`). Should the
   backend store and apply commission rates as Enatega does, or accept the
   setting but enforce zero for core-plan orders?
2. The phase plan (FB05–FB20, archived at `docs/history/2026-10-08-EXECUTION_PLAN.json`) was written for a
   FairBite-shaped API. This spec replaces its API shape and order. Should
   those JSON status files be rewritten to match, or retired?
3. Provider accounts (Stripe, PayPal, Twilio, SendGrid, Firebase, Google Maps,
   Cloudinary) are needed for sandbox testing of their modules.
