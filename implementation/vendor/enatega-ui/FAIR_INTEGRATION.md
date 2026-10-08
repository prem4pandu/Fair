# Original Enatega UI source baseline

This directory contains the complete pinned frontend source used as Fair's UI
baseline. Fair owns the backend and integration layer; the original Enatega
screens, routes, components, styling, assets and interaction structure must be
preserved.

Source packages:

- `enatega-multivendor-web` — customer web
- `enatega-multivendor-admin` — platform administration plus merchant/vendor web routes
- `enatega-singlevendor-admin` — separate single-vendor administration product
- `enatega-multivendor-app` — customer mobile
- `enatega-multivendor-store` — merchant mobile
- `enatega-multivendor-rider` — rider mobile

The source was copied from the repository-local pinned upstream snapshot. Git
metadata, dependency directories, build outputs, local environment files and
operating-system metadata are excluded. The upstream license and package-level
license notices are retained. `SOURCE_MANIFEST.json` records every tracked
source file and SHA-256 digest and must be regenerated with
`node tools/manifest-enatega-ui.mjs` after an authorized source update.

This source baseline is not runtime acceptance. It must be connected only to
Fair's configured endpoints, and unsupported backend operations remain explicit
integration blockers. Do not restore hard-coded upstream production endpoints.

The upstream Firebase application-binding files are retained in the local audit
source but excluded from the tracked baseline. Fair must generate its own
environment-specific application files during the provider integration packet.
The unchanged browser service-worker sources still contain upstream public
Firebase project identifiers. This baseline is never served directly; the
integration packet must configuration-gate or replace those identifiers before
any original web application can launch.
