# Public foundation E2E

`pnpm test:e2e` starts actual disposable PostGIS/PostgreSQL 17 and Redis 7 containers, applies the real Prisma migration, and starts the built API plus configured and unconfigured production servers for all three web applications. Build applications before execution; Chromium must be installed. No business records or provider stubs are seeded.

The PostGIS image is explicitly AMD64 because the selected image has no ARM manifest; local ARM hosts need container emulation. On this Mac the working Docker endpoint is Colima, requiring `DOCKER_HOST=unix:///Users/premkumarmamidi/.colima/default/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. These variables contain socket paths, not credentials.

The bounded suite verifies public home/status readiness, unconfigured behavior, real API-stop outage, keyboard skip navigation, accessible navigation/link names and horizontal fit at 375px and 1280px. Screenshots are retained under Playwright test-results. This is foundation coverage only; authentication, tenant ownership, commerce, delivery/provider workflows and signed native device E2E are not implemented or verified by this suite.

2026-10-08 execution: seven tests passed in 59.3 seconds. Initial attempts failed Docker auto-discovery and unsupported ARM image; after using active Colima endpoint and explicit AMD64, the actual suite passed. All six screenshots were visually inspected; no clipping/overlap was observed.
