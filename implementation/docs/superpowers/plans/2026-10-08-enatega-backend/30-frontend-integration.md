# Frontend integration — W12, W13, W14a, W14b

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

> **Precedence notice (2026-10-09).** `implementation/docs/ROADMAP.md` is the single roadmap and outranks this
> file for scope, scheduling, ownership and gates; this file remains authoritative for its own task detail.
> `L10`, `L11` and `L13` are **retired identifiers** — they were never lanes in `OPERATION_LANES.json`. Read
> `L10` as **W15** for journey suites (`test/journeys/**`), **W16** for Playwright (`e2e/**`), and the matching
> frontend workstream **W12/W13/W14a/W14b** for edits inside a `vendor/enatega-ui/` package; `L11` as **W23**
> (independent QA) and `L13` as **W24** (independent security). Operation counts come from
> `docs/OPERATION_LANES.json`, not from prose. See `ROADMAP.md` §4.0.

**Goal:** Make all six pinned Enatega applications install, build and run against the Fair backend with no reachable
upstream Enatega/Google/Firebase/EmailJS/Clarity endpoint, no provider secret in a client bundle, and no fabricated
data — while the presentation layer stays byte-identical to the pinned source apart from edits recorded in
`SOURCE_PROVENANCE.json`.

**Architecture:** Integration is confined to six layers (`ROADMAP.md` §3.3): origin configuration (L-A), transport
adapters (L-B), session bridge (L-C), public bootstrap (L-D), provider gating (L-E) and response validation at the
adapter boundary (L-F). No layer may add a screen, component, route, style or asset. Each workstream owns whole
vendor packages and nothing else; the lead owns the manifest and provenance serialisation point.

**Tech stack:** The pinned packages' own stacks — Next.js 14/16 + React 18/19 for the three web apps, Expo/React
Native for the three mobile apps, Apollo Client with `subscriptions-transport-ws`, each installed in place with npm
from its own lockfile (decision D-F1).

**This file is shared by four workstreams.** Each owns its own packages and writes nowhere else:

| Workstream | Packages owned                                                              | Depends         |
| ---------- | --------------------------------------------------------------------------- | --------------- |
| **W12**    | `vendor/enatega-ui/enatega-multivendor-web`                                 | W2, W3, W4, W6  |
| **W13**    | `vendor/enatega-ui/enatega-multivendor-admin`, `enatega-singlevendor-admin` | W2, W3, W4, W5a |
| **W14a**   | `vendor/enatega-ui/enatega-multivendor-app`                                 | W2, W3, W6      |
| **W14b**   | `vendor/enatega-ui/enatega-multivendor-store`, `enatega-multivendor-rider`  | W2, W3, W5a, W8 |

---

## 1. Frontend boundary

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

Three rules decide every judgement call in this plan:

1. **A missing backend capability is a blocker, not a UI change.** If a screen calls an unimplemented operation, the
   screen stays and shows whatever the pinned code shows for an error. Do not hide the control, do not stub data.
2. **An edit that is not recorded is a gate failure.** `pnpm check:enatega-ui-source` compares bytes against
   `SOURCE_MANIFEST.json`. Every intentional edit is listed in the root `SOURCE_PROVENANCE.json` under
   `allowedModifications` with file, reason and layer (L-A…L-F), and the lead re-runs the manifest.
3. **Never write the manifest or provenance yourself.** They are the lead's serialisation point (`ROADMAP.md` §5.2).
   Hand the lead a list of edits at the end of each task.

---

## 2. Inputs you must read before editing a package

| Input                                                       | Why                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/ENATEGA_FRONTEND_INTEGRATION_AUDIT.md`                | per-package integration surface and the numbered blockers; §2 is the audit template |
| `docs/ENATEGA_URL_CONTRACT.json`                            | every route, REST path, WS path, callback and hard-coded host the apps use          |
| `docs/ROADMAP_STATUS.md`                                    | which operations actually resolve today, so you know what will legitimately fail    |
| `docs/OPERATION_TRACEABILITY.md`                            | per-operation state for the screens you touch                                       |
| `reference/01-client-transport-and-launch.md`               | the handshake, transport and launch behaviour of each client                        |
| `reference/02`, `03`, `04`                                  | customer, store/rider and admin flows with file:line citations                      |
| the package's own `README.md`, `.nvmrc`, `.npmrc`, lockfile | the install contract you must not change                                            |

---

## 3. Known integration facts (verified 2026-10-08, re-verify before relying on one)

1. **Every app depends on one handshake.** `mutation metricsGeneral` returns the public token in `experience` and
   its ISO expiry in `hehe`, bound to a client `nonce` and replayed as `bop-auth: Bearer`. All six clients send it
   as a mutation. Every decoy field the clients select (`excellence`, `topgun`, `skydiver`, `rider`, `haha`, `huhu`,
   `yoyo`, `turu`) must resolve without error or the app is unusable before login.
2. **All six clients speak the legacy `subscriptions-transport-ws` frame set** under the `graphql-ws` subprotocol
   name. A modern-only server breaks every dashboard, store subscription and rider tracking flow.
3. **Non-GraphQL surface:** three `maps/*` routes, three `stripe/*` routes, `/paypal`, `/media/<key>` returning
   **signed** URLs whose signature the mobile client parses to expire its disk cache, base64
   `uploadImageToS3(image, publicMedia?)`, `saveRestaurantToken` / `saveNotificationTokenWeb`, Live Activity
   session roots, and `updateRiderLocation` posted from a native background task with hand-rolled headers.
4. **Upstream endpoints and credentials are live in the pinned tree:** customer app and store hard-code
   `aws-server-v2.enatega.com` with no env override; the production EAS profiles bake the upstream railway host;
   upstream Firebase web credentials sit in four public files; a live Sentry DSN is hard-coded in rider source.
   Removing or gating these is integration work (L-A/L-E), and each removal is a recorded edit.
5. **Node engines (D-F4):** the three web packages declare Node `>=20` with `.nvmrc v20.16.0`, and both admins set
   `engine-strict=true`, so installs fail under the repository's Node 24 unless the engine check is relaxed **for
   the install only**, via a per-package `.npmrc`. Pinned manifests are never edited to make an install work.
6. **Package names collide:** three web packages share the npm name `enatega-frontend`, which is why they cannot
   join the pnpm workspace and are installed in place (D-F1).
7. **Customer web push needs `vapidKey`**, which the pinned config query does not select (decision D-F5: extend the
   query as a recorded edit).

---

## 4. Per-package audit — every workstream's first task

Before any edit, produce `docs/artifacts/<workstream>/audit.md` in the shape of
`ENATEGA_FRONTEND_INTEGRATION_AUDIT.md` §2, covering for each package:

- [ ] **A1 Origins.** Every file that resolves an API, WS, REST, media or callback URL, with file:line, the default
      it falls back to today, and the configured value that replaces it. Any upstream host that survives this list
      is a blocker, not a note.
- [ ] **A2 Operations.** Every GraphQL document the package sends (use `tools/lib/documents.mjs`, never a
      hand-written copy), cross-referenced against `docs/ROADMAP_STATUS.md`: implemented, `NOT_IMPLEMENTED`, or
      absent from the SDL. Absent-from-SDL is a W2 defect — raise it, do not patch the client.
- [ ] **A3 Session.** Where the package stores and sends credentials today, and what changes under D-F2/D-F7
      (web: same-origin HttpOnly BFF cookies; native: platform secure storage with short-lived access tokens).
- [ ] **A4 Providers.** Every third-party script, SDK, key and DSN, whether it is required for the package to boot,
      and how it is gated when unconfigured.
- [ ] **A5 Routes and deep links.** Every route and deep link in `ENATEGA_URL_CONTRACT.json` for this package, and
      the evidence it still resolves after integration.
- [ ] **A6 Install recipe.** The exact commands that install and run the package on this machine, including the
      D-F4 engine workaround, with the measured install size and time.
- [ ] **A7 Edit list.** Every file you will edit, its layer (L-A…L-F) and its justification. Anything outside
      L-A…L-F is forbidden; if the work seems to need it, stop and raise it with the lead.

**Acceptance:** the lead reviews the audit before any package file is edited. Record it on the board.

---

## 5. Tasks (identical shape for each workstream; run per package)

### Task 1: Install and boot the pinned package unchanged

- [ ] **Step 1: Prove the failure.** Run `npm ci` in the package directory and record the exact failure (expected
      for the admins: `engine-strict` under Node 24).
- [ ] **Step 2: Apply the D-F4 recipe.** Add a per-package `.npmrc` relaxing the engine check _only_. Do not edit
      `package.json`, the lockfile, `.nvmrc` or any pinned manifest.
- [ ] **Step 3: Install and boot** against no backend. Record what the package does with an unreachable API — this
      is the honest-failure baseline the UI must keep showing.
- [ ] **Step 4: Record** install command, time, disk size and the boot result in the audit artifact.
- [ ] **Step 5: Commit** `chore(<workstream>): install recipe for <package>`, listing the `.npmrc` as a recorded edit.

### Task 2: Origin configuration (L-A)

- [ ] **Step 1: Write the failing check.** A Playwright/Jest network guard for this package that **fails** on any
      request to a non-configured host (`*.enatega.com`, railway, Google, Firebase, EmailJS, Clarity, Sentry).
      Hand the Playwright form to W16; keep a package-local unit form here.
- [ ] **Step 2: Run it** against the unmodified package and record the upstream hosts it catches.
- [ ] **Step 3: Replace every hard-coded origin** with a validated, fail-closed read of build-time configuration,
      in the files the audit's A1 listed. No fallback value may be an upstream host; an unset origin is a startup
      error, never a silent default.
- [ ] **Step 4: Re-run the guard.** Zero non-configured hosts.
- [ ] **Step 5: Commit** and hand the lead the edit list for provenance.

### Task 3: Transport adapters (L-B)

- [ ] **Step 1: Write the failing test** that the package's Apollo client reaches the configured HTTP and WS
      endpoints, completes the `metricsGeneral` handshake, replays `bop-auth`, and opens a legacy-protocol
      subscription.
- [ ] **Step 2: Run it** and record the failure.
- [ ] **Step 3: Point the existing links** at the configured origins; fix the PayPal base-URL concatenation defect
      and trailing-slash handling; keep both WS protocols and the existing link order. Do not replace Apollo, do
      not change cache policies, do not alter the components that consume the hooks.
- [ ] **Step 4: Run it.** Handshake and subscription succeed against the local stack.
- [ ] **Step 5: Commit.**

### Task 4: Session bridge (L-C)

- [ ] **Step 1: Write the failing test** for the package's session contract: sign in, authorised request, refresh,
      revocation, sign out, restart persistence — and the negative cases (revoked token refused, cross-app token
      refused, expired access token refreshed once).
- [ ] **Step 2: Run it** and record the failure.
- [ ] **Step 3: Implement the bridge.** Web (D-F2/D-F7): same-origin HttpOnly BFF cookies with CSRF protection, as
      already proven for addresses; no long-lived token in `localStorage`. Native: platform secure storage plus
      short-lived access tokens. The pinned context providers keep their shape and their exported API — only the
      storage and transport behind them change.
- [ ] **Step 4: Run it.** All positive and negative cases pass.
- [ ] **Step 5: Commit**, and hand W24 the diff for security review.

### Task 5: Provider gating (L-E)

- [ ] **Step 1: Write the failing test** that with every provider unconfigured, the package boots, renders its
      pinned screens, and surfaces the backend's honest unavailability — with no request to a provider host and no
      provider key in the built bundle.
- [ ] **Step 2: Run it** and record which providers break the boot today.
- [ ] **Step 3: Gate each provider** behind configuration: Clarity, EmailJS, Firebase, Google Maps, Stripe/PayPal,
      push, Sentry. Remove the hard-coded upstream credentials found in audit A4. Where the pinned UI has no
      "unavailable" affordance, the backend's error surfaces through the pinned error path — you do not add one.
- [ ] **Step 4: Run it**, and grep the built bundle for every known key/DSN to prove absence.
- [ ] **Step 5: Commit**, hand W24 the diff.

### Task 6: Response validation at the adapter boundary (L-F)

- [ ] **Step 1: Write the failing test** for each response shape the pinned code assumes without checking (the
      audit's A2 list): missing field, null where non-null is assumed, unexpected enum value.
- [ ] **Step 2: Run it** and record which of them crash a screen.
- [ ] **Step 3: Validate at the adapter**, dropping unknown fields safely and surfacing a typed error the pinned
      code already handles. Never synthesise a value to satisfy a component.
- [ ] **Step 4: Run it.**
- [ ] **Step 5: Commit.**

### Task 7: Route and deep-link preservation (L-A/L-B)

- [ ] **Step 1: Write the failing check** that every route and deep link for this package in
      `ENATEGA_URL_CONTRACT.json` resolves after integration.
- [ ] **Step 2: Run it** and record failures.
- [ ] **Step 3: Fix configuration** (base paths, callback URLs, deep-link schemes) without renaming a route.
- [ ] **Step 4: Run it.**
- [ ] **Step 5: Commit**, and update `ENATEGA_URL_CONTRACT.json` only through the lead.

### Task 8: Hand over and serialise

- [ ] **Step 1:** Hand the lead the complete recorded-edit list (file, layer, reason) for provenance.
- [ ] **Step 2:** Lead updates root `SOURCE_PROVENANCE.json` and runs `node tools/manifest-enatega-ui.mjs`.
- [ ] **Step 3:** `pnpm check:enatega-ui-source` passes.
- [ ] **Step 4:** Hand W16 the package's Playwright selectors (by role/label/text, cited file:line from the pinned
      source) and W15 any mobile-only document-replay sequence.
- [ ] **Step 5:** Request W23 (QA) and W24 (security) review. Do not self-approve.

---

## 6. Package-specific obligations

| Package                      | Owner | Must also do                                                                                                                                                                 |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enatega-multivendor-web`    | W12   | Verify the D-F4/D-F1 recipe **first** — the other frontend workstreams wait on the answer (risk R12). Resolve the `vapidKey` gap per D-F5. Set the CSP that gating implies.  |
| `enatega-multivendor-admin`  | W13   | Keep the client-side AES-GCM config decryption (D-F6) and stop treating it as secrecy; ensure `secretKey`/`clientSecret`/`twilioAuthToken` are never returned by the server. |
| `enatega-singlevendor-admin` | W13   | Single-vendor roots stay `NOT_IMPLEMENTED` until W21 is approved (D1); the app must display that honestly rather than appearing broken-by-accident.                          |
| `enatega-multivendor-app`    | W14a  | Expo secure storage, deep links, permissions, the Stripe WebView allowed-host list, and the signed-media cache expiry behaviour.                                             |
| `enatega-multivendor-store`  | W14b  | Remove the hard-coded `aws-server-v2.enatega.com`; keep the legacy WS order subscriptions working.                                                                           |
| `enatega-multivendor-rider`  | W14b  | Background-location transport with hand-rolled headers must keep working; remove the hard-coded Sentry DSN; Live Activity session roots depend on W10.                       |

---

## 7. Gate checklist (G2 for each frontend workstream)

- [ ] `npm ci` and a production build succeed for every owned package, by the recorded recipe.
- [ ] Network guard: zero requests to any non-configured host, in dev and in the built bundle.
- [ ] Bundle grep: no provider secret, no upstream credential, no Sentry DSN.
- [ ] Handshake plus one legacy-protocol subscription succeed against the local stack.
- [ ] Session positive and negative cases pass.
- [ ] Every route and deep link in `ENATEGA_URL_CONTRACT.json` for the package resolves.
- [ ] `pnpm check:enatega-ui-source` passes with every edit recorded in `SOURCE_PROVENANCE.json`.
- [ ] `pnpm check:enatega` still passes; no document was edited to make the backend's life easier.
- [ ] W23 and W24 approvals recorded. No self-approval.

---

## 8. Open blockers

| Blocker                                                                                                 | Affects   | Needed from |
| ------------------------------------------------------------------------------------------------------- | --------- | ----------- |
| FairBite-owned EAS projects, signing identities, Firebase native binding files and provider keys        | W14a/W14b | owner       |
| Google Maps server key (the apps degrade to owned text/coordinate addresses without it)                 | W12, W14a | owner       |
| Payment provider sandbox keys (card paths stay `PROVIDER_UNAVAILABLE` until then)                       | W12, W14a | owner       |
| Push credentials for web (`vapidKey`) and native                                                        | all       | owner       |
| Disk and time: six React/Next/Expo dependency trees, roughly 5–8 GB; install per batch, not all at once | all       | —           |
