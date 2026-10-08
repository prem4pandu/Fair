# Worker foundation

Separate BullMQ worker process for the explicit synthetic `foundation-probe` queue only. It accepts jobs named `probe` containing exactly `{ "probeId": "<UUID>" }`, returns that identifier and `status: "ok"`, and rejects other job names or payload fields. It implements no payment, order, delivery, notification or provider jobs. Production business capability is pending.

Use Node 24 and the pinned pnpm. Install from the workspace root with `pnpm install --frozen-lockfile` and run `pnpm build`; start using `pnpm --filter @fairbite/worker start`. The API does not start this worker. It has no HTTP listener. Shutdown signals close the BullMQ worker and Redis connection.

Supply `APP_ENV`, `DATABASE_URL` and `REDIS_URL` through process environment. `.env.example` contains synthetic local documentation only and is not automatically loaded. Production configuration requires verified PostgreSQL TLS and Redis TLS; hostless URLs, fragments and Redis query overrides are rejected. `DATABASE_URL` is validated for foundation configuration consistency; this synthetic worker does not query the database. Never use example credentials as deployment credentials.

Run package `typecheck`, `build`, and `test`. Real worker queue execution and API/worker separation are exercised through `pnpm --filter @fairbite/api test:integration` with actual PostgreSQL/PostGIS and Redis containers. There is no signed device, provider or business-flow verification in this foundation.
