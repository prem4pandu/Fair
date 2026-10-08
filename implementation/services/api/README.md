# API backend

GraphQL foundations and password sessions are implemented. Public catalog storage/reads and customer-owned addresses are implemented as bounded slices. Full identity, business workflows, subscriptions and provider integrations remain open. `/health/live` reports process availability; `/health/ready` probes actual PostgreSQL and Redis. `/graphql` exposes the root `contracts/foundation.graphql` schema and reports `ready` only when both dependencies respond.

Use Node 24 and the repository-pinned pnpm. From the workspace root, install dependencies with `pnpm install --frozen-lockfile`, then `pnpm build`. The shared brand package must be built before direct API checks. Configuration is read from process environment; `.env.example` documents synthetic local values and is not automatically loaded. Inject deployment secrets through an approved secret source; keep actual environment files out of version control.

Set `APP_ENV`, `DATABASE_URL`, `REDIS_URL` and optionally `PORT` (default 4100) and `CORS_ORIGINS`. Origins are exact comma-separated HTTP(S) origins; empty allows no cross-origin browser access. Production requires HTTPS origins, verified PostgreSQL TLS (`sslmode=verify-full`) and Redis TLS (`rediss:`). Database URLs require a host and database name. Redis URL query overrides and fragments are rejected. Production introspection is disabled and errors are masked.

With configuration available, run `pnpm --filter @fairbite/api db:validate`, `db:generate`, and `db:migrate`. The Prisma migration requires PostgreSQL with PostGIS available; schema generation creates ignored files under `src/generated/prisma`. Migration tooling reads `DATABASE_URL`; configuration alone does not provision infrastructure. Run `pnpm --filter @fairbite/api start` after building; the API binds loopback. Production exposure requires separately reviewed deployment routing.

Verify with package `typecheck`, `build`, and `test`. `test:integration` starts disposable real PostGIS/PostgreSQL and Redis containers, applies the SQL migration, checks dependency outages and proves worker separation. Docker/socket and local HTTP access are required. The selected PostGIS image uses AMD64; ARM hosts require supported container emulation. Root `test:e2e` additionally requires built web applications and installed Playwright Chromium. No foundation check demonstrates authentication, commerce or provider capability.

## Password identity candidate

Password identity is disabled by default (`PASSWORD_AUTH_ENABLED=false`). Explicitly enabling it requires distinct canonical base64url 32-byte `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_PEPPER` values injected securely; no keys or privileged accounts are provisioned by examples. Customer registration creates an unverified CUSTOMER only. Password login is bound to the requested application and current server-side role/grant eligibility. Privileged password login remains denied in production until a separately reviewed MFA/provisioning packet exists. Development/test privileged grants are synthetic fixtures, not merchant/rider onboarding or tenant permissions.

Refresh credentials are stored only as HMAC digests. Access tokens last 300 seconds; session families expire absolutely 30 days from creation. Rotation cannot extend this expiry. Reuse revokes the whole family, including the newest access authority; logging out with an old presented token also revokes its family. Every access checks current account, role, grant and session state. Redis counters are shared across API instances and fail closed during Redis outages; Argon2 work is limited to two concurrent operations per process. Forwarded client IP headers are not trusted. A GraphQL request may execute at most one mutation root field, and repeated `me` aliases share one authorization read.

Identity migration models are owned by the identity module. Composite foreign keys bind refresh sessions to their family's user; family bindings/expiry, refresh bindings and audit records have database mutation guards. Recovery, email verification delivery, social/OTP login, MFA, account provisioning and domain tenant capabilities are unimplemented. The real integration suite verifies password flows, refresh concurrency/replay/revocation, privilege denial, persistence constraints, distributed rate limits and actual Redis outage. This does not close signed device, provider, independent security/QA or release gates.

## Public catalog reads

`contracts/catalog.graphql` adds `catalogOutlets`, `catalogOutlet` and
`catalogItems`. Catalog owns its database records and connection lifecycle.
Publication defaults to false on every level; queries include only published
merchants, outlets, categories and items. An unavailable item remains visible
with `available: false`. List queries default to 20 records and allow 1–50,
ordered by UUID with an optional UUID `after` cursor. Prices are integer minor
units; these reads do not produce checkout quotes or calculate fees/taxes.

For example:

```graphql
query {
  catalogOutlets(limit: 20) {
    nodes {
      id
      name
      merchantName
      currency
    }
    endCursor
    hasNextPage
  }
}
```

The local database has no demo catalog seed. Empty catalog pages are expected
until real catalog administration is implemented. Onboarding, authorization for
staff editing/publication, hours, media and full Enatega operation adapters remain
separate work. No public catalog write mutation is provided by this slice.

## Customer-owned saved addresses

`contracts/addresses.graphql` provides list/create/update/delete/select operations.
Every operation uses the current CUSTOMER application/session authority; owner
IDs are never accepted in client input. Address SQL is owner-scoped and uses a
bounded module pool. Declared identity foreign keys prevent orphan owners without
address code querying identity tables. Per-owner transaction locks serialize the
50-record technical limit and selected-address changes; a database partial unique
index permits at most one selected address. Creation does not select implicitly,
and deleting a selected address does not choose a replacement.

Coordinates are manually supplied and bounded, without geocoding, serviceability
or delivery claims. Text bounds and coordinate checks are enforced in input and
database storage. PostgreSQL client query deadlines also bound identity lookups
when the server is paused; lookup failures produce redacted unavailable errors.
Customer web integrates the canonical API through a CSRF-protected cookie BFF at
`/api/customer/addresses` and a source-derived `/profile/addresses` screen. Native
and complete upstream client migration remain open. Production privacy and
retention rules require review; no new policy or provider success is claimed.
