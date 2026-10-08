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
