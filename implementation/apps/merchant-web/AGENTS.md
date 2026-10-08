## Mandatory frontend boundary — owner directive 2026-10-08

The product UI MUST be the complete pinned Enatega frontend. FairBite owns the
backend and integration layer only. Do not create, redesign, simplify or replace
Enatega layouts, navigation, screens, components, styling, assets or interaction
flows with original FairBite UI. Source-derived replacement screens are also
prohibited. Preserve upstream license notices.

Allowed frontend changes are limited to connecting the original Enatega UI to
our backend: transport/adapters, secure session handling, validated data mapping,
configuration and centralized display-name imports. Necessary accessibility or
security fixes must preserve the Enatega presentation and interaction structure.
An unsupported backend capability is an integration blocker, never permission
to substitute another UI, fabricate data or call the upstream production backend.
Do not remove original screens or actions to hide missing backend implementation.

Current lightweight shells and rewritten identity/catalog/address screens are
NONCOMPLIANT product presentation. Their backend/test evidence remains useful,
but they cannot satisfy Enatega UI parity or product completion. Migrate the
original source in isolated candidates, preserve existing changes and integrate
only after independent review plus actual build/E2E and visual parity checks.
This rule must be included in every frontend/mobile implementation handoff.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
