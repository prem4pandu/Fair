# Enatega frontend integration audit

**Date:** 2026-10-08 · **Method:** static read-only inspection of the pinned tree (no file modified, nothing executed)
· **Scope:** `implementation/vendor/enatega-ui/` — all six packages
· **Evidence convention:** every path below is relative to `implementation/vendor/enatega-ui/` unless it starts with
`implementation/`.

This document is the durable record of the frontend integration surface. It is the input to workstreams W12–W14
(see `MASTER_END_TO_END_PLAN.md` §4.4) and must be updated whenever an integration edit is made.

---

## 0. Two findings that must be understood before any frontend work

### 0.1 The pinned tree is not pristine upstream source

Besides upstream code, the tree already contains a hand-written integration/adapter layer:

| Artifact                                                                          | Location                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Env-driven endpoint + vendor-mode switching                                       | `enatega-multivendor-web/lib/mode/environment.ts`, `enatega-multivendor-web/environment.ts`, `enatega-multivendor-admin/lib/hooks/useSetApollo.tsx`, `enatega-multivendor-store/environment.ts`, `enatega-multivendor-rider/environment.ts`, `enatega-multivendor-app/environment.config.js` |
| Next.js server-side maps proxy                                                    | `enatega-multivendor-web/app/api/maps/reverse-geocode/route.ts`                                                                                                                                                                                                                              |
| Client public-access (`nonce`/`bop-auth`) token services                          | `enatega-multivendor-store/lib/services/public-access-token.service.ts`, `enatega-multivendor-rider/lib/services/public-access-token.service.ts`, `enatega-multivendor-app/src/services/publicAcccessService.js`, `enatega-multivendor-web/lib/hooks/useSetApollo.tsx`                       |
| Background-location transport                                                     | `enatega-multivendor-rider/lib/services/background-location.ts`                                                                                                                                                                                                                              |
| Security hardening comments referencing internal IDs (SEC-003, SEC-010, PERF-012) | `enatega-multivendor-app/src/utils/secureToken.js`, `src/utils/publicAccessToken.js`, `environment.js`                                                                                                                                                                                       |

**Provenance gap:** `implementation/SOURCE_PROVENANCE.json` records only **4** allowed modifications (the four
Firebase application-binding files: app `GoogleService-Info.plist`, app/store/rider `google-services.json`).
The package-level `vendor/enatega-ui/SOURCE_PROVENANCE.json` has **no `allowedModifications` key at all**, and
`commitIndependentlyVerified` is `false`. Per `implementation/AGENTS.md` every edit inside the vendor tree must be
recorded there. **W2 must first reconcile the baseline**: determine which of the artifacts above are upstream and
which are Fair-authored, then record every Fair-authored change (or restore the upstream bytes) before any frontend
lane edits a file.

### 0.2 Everything depends on one unusual handshake

`metricsGeneral` is not analytics; it is the public-access token mint. Every app calls it before its real traffic,
mostly by raw `fetch` outside the Apollo cache, and replays the result as `bop-auth: Bearer <token>`, bound to a
`nonce` header generated client-side:

- `experience` = the bearer token string, `hehe` = the ISO expiry timestamp.
- Requested decoy fields that must at least resolve without error: `excellence`, `topgun`, `skydiver`, `rider`,
  `haha`, `huhu`, `yoyo`, `turu`.
- **Verified 2026-10-08: every client sends it as a `mutation`.** `enatega-multivendor-web/lib/api/graphql/mutations/metrics/index.ts`,
  admin and single-admin `METRICS_GENERAL` (imported at `lib/hooks/useSetApollo.tsx:21`), customer app
  `src/apollo/publicAccess.js`, store/rider `lib/services/public-access-token.service.ts`, and the rider background
  task (`lib/services/background-location.ts:90-104`) all declare `mutation MetricsGeneral`. The SDL declares the root
  under `type Mutation` (`contracts/enatega/core.graphql:23`), which matches. No query form is required.
- Call sites: web `lib/hooks/useSetApollo.tsx:55-92`; admin `lib/hooks/useSetApollo.tsx:146-201` (+ refresh
  `:203-278`); single-admin `:153-201` (+ refresh `:210-278`); store
  `lib/services/public-access-token.service.ts:9-24,151-214`; rider `lib/services/public-access-token.service.ts:18-27`
  and `lib/utils/session.ts:54`; app `src/apollo/publicAccess.js`, `src/services/publicAcccessService.js:44-95`.
- Rider background task mints/refreshes it too: `enatega-multivendor-rider/lib/services/background-location.ts:90-104`.
- Escape hatch: the `x-skip-public-auth` header (store `lib/apollo/index.ts:127-128,144`; rider
  `lib/apollo/index.ts:197-198`).
- Failure semantics matched by clients: `bop-auth` message text (rider `lib/utils/session.ts:54`, admin
  `isMetricsAuthError`). Business error messages must never contain the forbidden words
  (`unauthorized`, `unauthenticated`, `jwt expired`, `invalid token`, `forbidden`).

---

## 1. Cross-package matrix

| Concern                                    | multivendor-web                                                   | mv-admin                                                      | sv-admin                                                       | customer app                                                 | store                                            | rider                                    |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| Endpoint source                            | `NEXT_PUBLIC_SERVER_URL` / `_WS_` (+ single-vendor trio)          | `NEXT_PUBLIC_SERVER_URL` / `_WS_`                             | `NEXT_PUBLIC_SERVER_URL` / `_WS_` (validated, throws if unset) | `environment.config.js` — **no env override**                | `environment.ts` — **no env override for MULTI** | `EXPO_PUBLIC_GRAPHQL_URL` / `_WS_`       |
| Hard-coded upstream host                   | no (CDN allow-list only `next.config.mjs:91-173`)                 | **yes** `lib/utils/constants/url.ts:3-10`                     | **yes** `lib/utils/constants/url.ts:3-12`                      | **yes, all 3 envs** `environment.config.js:8-11,23-26,38-41` | **yes** `environment.ts:9-15`                    | fallback `environment.ts:12,16`          |
| WS protocol                                | `subscriptions-transport-ws`                                      | same                                                          | same (`graphql-ws` declared, unused)                           | same                                                         | same (`graphql-ws` declared, unused)             | same                                     |
| WS URL form                                | `withGraphql()` normalises                                        | `` `${WS_SERVER_URL}graphql` `` — **no trailing-slash guard** | `requireBaseUrl()` + `graphql`                                 | full URL                                                     | full URL                                         | full URL                                 |
| Access-token refresh                       | **none** (re-login)                                               | yes (`refreshToken` mutation)                                 | yes                                                            | none                                                         | none                                             | none                                     |
| Token storage                              | `localStorage` `@enatega/<mode>/token`                            | `localStorage` `token`                                        | `localStorage` `token`                                         | SecureStore `customer-token-<mode>`                          | SecureStore `enatega-store-<mode>-token`         | SecureStore `enatega-rider-<mode>-token` |
| Public token                               | `bop-auth` via **query**                                          | query                                                         | query                                                          | **mutation** + `nonce`                                       | service + `nonce`                                | service + `nonce`                        |
| Framework                                  | Next `^16.2.10`, React 19                                         | Next `^14.2.35`, React 18                                     | Next `14.2.5` (exact), React 18                                | Expo 53.0.22 / RN 0.79.5                                     | Expo `^54.0.35` / RN 0.81.5                      | Expo `^53.0.22` / RN 0.79.5              |
| Package name                               | `enatega-frontend`                                                | `enatega-frontend`                                            | `enatega-frontend`                                             | `enatega-full-app`                                           | `enatega-store-app`                              | `mobile-architecture`                    |
| Node engine                                | `>=20`, `.nvmrc v20.16.0`, `legacy-peer-deps=true`                | `>=20`, `.nvmrc v20.16.0`, **`engine-strict=true`**           | **`engine-strict=true`**                                       | none                                                         | none                                             | none                                     |
| Lockfile                                   | `package-lock.json` ×1 each; **no `node_modules` in any package** |                                                               |                                                                |                                                              |                                                  |                                          |
| Route surface                              | 39 `page.tsx`                                                     | 59                                                            | 63                                                             | 40 screen dirs / 121 files + 26 single-vendor dirs           | 21 route dirs / 38 files                         | 21 dirs / 43 files                       |
| GraphQL docs                               | 30 q / 27 m / 8 s (+39-op single-vendor module)                   | 77 q / 93 m / 5 s                                             | 71 q / 108 m / 5 s                                             | 44 q / 29 m / 5 s                                            | 11 q / 3 s                                       | 15 q / 26 m / 7 s                        |
| Batching / persisted queries / upload link | none anywhere                                                     |                                                               |                                                                |                                                              |                                                  |                                          |

Subscription operation names the server must expose (wire contract): `SubscribePlaceOrder`,
`SubscriptionDispatcher`, `SubscriptionOrder`, `SubscriptionOrderTracking`, `SubscriptionRiderLocation`,
`SubscriptionAssignRider`, `SubscriptionZoneOrders`, `SubscriptionNewMessage`, `OrderStatusChanged`, `RiderUpdated`,
plus the single-vendor variants (`SingleVendorSubscriptionZoneOrders`, `SingleVendorSubscriptionAssignRider`,
`SingleVendorPaymentSuccess`, `SingleVendorOrderTrackingUpdated`, `SingleVendorOrderStatusChanged`).

---

## 2. Per-package integration surface

### 2.1 enatega-multivendor-web (customer web)

- **Env:** `NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_WS_SERVER_URL`, `NEXT_PUBLIC_SINGLE_VENDOR_SERVER_URL`,
  `NEXT_PUBLIC_SINGLE_VENDOR_WS_SERVER_URL`, `NEXT_PUBLIC_SINGLE_VENDOR_REST_URL`,
  `NEXT_PUBLIC_SINGLE_VENDOR_ENABLED`, `NEXT_PUBLIC_VENDOR_MODE`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`,
  `NEXT_PUBLIC_EMAILJS_SERVICE_ID`, `NEXT_PUBLIC_EMAILJS_PUBLIC_KEY`, `SINGLE_VENDOR_SCHEMA_URL`,
  `SINGLE_VENDOR_SCHEMA_MODULE`, `NODE_ENV` (`environment.ts:7-8`, `lib/mode/environment.ts:11-39`,
  `lib/context/configuration/configuration.context.tsx:55`).
- **Transport:** `lib/hooks/useSetApollo.tsx` — per-operation HTTP endpoint resolution (`:131-135`), one Apollo
  client per vendor mode (`:98-111`), a fresh client per SSR request (`:104`), error link keyed on
  `TOKEN_EXPIRED`/`INVALID_TOKEN` (`:163-167`), headers `authorization`/`nonce`/`bop-auth`/`userId`/`isAuth`/
  `X-Client-Type: web` (`:204-213`), subscription split (`:239-245`). No batching, no persisted queries, no upload link.
- **Server route that must exist:** `app/api/maps/reverse-geocode/route.ts:10-51` (forwards to
  `{restUrl}maps/reverse-geocode`, 10 s timeout, `cache: no-store`), called by `lib/api/google-maps.ts:23-31`.
- **Provider gating:** Clarity `tjqw9wn955` inline at `app/layout.tsx:71`; EmailJS CDN loaded unconditionally at
  `app/layout.tsx:59-62`; Google Maps JS via `lib/context/global/google-maps.context.tsx:31-46`; Firebase messaging
  `app/NotificationInitialzer.tsx:22-72`; Stripe Elements `lib/ui/single-vendor/ProfileExtras.tsx:23,198-214`.
- **Web push is currently impossible even with correct Firebase config:** `app/NotificationInitialzer.tsx:28,66,90`
  needs `FIREBASE_VAPID_KEY`, but the config query `lib/api/graphql/queries/config.ts` selects `firebaseKey`,
  `authDomain`, `projectId`, `storageBucket`, `msgSenderId`, `appId` and **not `vapidKey`** (verified). Either the
  query must be extended (recorded edit) or the backend must supply the key through another agreed field.
- **Service worker with upstream credentials:** `public/serviceWorker.js:5-6,16-27` and the compiled
  `public/sw.js:19` embed the upstream Firebase project (`apiKey AIzaSyDx_iSQ9LroTF7NMm20aRvw2wJqhwSnJ3U`,
  project `enatega-multivender-web`). Must be configuration-gated before any launch.
- **Stripe/PayPal:** browser GET `${SERVER_URL}stripe/create-checkout-session?id=&platform=web`
  (`lib/ui/screens/protected/order/checkout/index.tsx:793-814`); single-vendor
  `POST {restUrl}stripe/create-web-checkout-session` (`lib/ui/single-vendor/Checkout.tsx:140-157`); return pages
  `/stripe/success` (accepts `id|orderId|reference`, polls orders every 3 s up to 60 s:
  `lib/ui/screens/protected/order/stripe-success/index.tsx:25-26,37-59,92-155`), `/stripe/pending`, `/stripe/cancel`;
  pending state in `localStorage` (`lib/mode/storage.ts:25-26`). Checkout also
  `router.replace('/paypal?id=…')` (`checkout/index.tsx:783-789`) but **no `/paypal` route exists** in the pinned tree.
- **Security items:** password-reset token read from the URL (`app/(localized)/auth/reset/page.tsx:16`); CSP built at
  `next.config.mjs:29-43` with wide `connect-src` (no change needed to point at a new backend); upstream CDN hosts
  allow-listed at `next.config.mjs:91-173`.
- **Test scaffolding present:** `vitest.config.ts`, `vitest.setup.ts`, `cypress.config.ts`, co-located `*.test.ts(x)`.

### 2.2 enatega-multivendor-admin

- **Env:** `NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_WS_SERVER_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`,
  `NEXT_PUBLIC_ENCRYPTION_KEY`, `NEXT_PUBLIC_ADMIN_EMAIL`, `NEXT_PUBLIC_ADMIN_PASSWORD`,
  `NEXT_PUBLIC_SINGLE_VENDOR_ADMIN_URL`, `NODE_ENV`.
- **Endpoint concatenation is unguarded:** `lib/hooks/useSetApollo.tsx:307-309,311` builds
  `` `${SERVER_URL}graphql` `` / `` `${WS_SERVER_URL}graphql` `` with no trailing-slash normalisation — a base URL
  without `/` yields a malformed endpoint.
- **Only web app with a working access-token refresh** (`lib/hooks/useSetApollo.tsx:203-278`, retried once after a
  metrics-token reset `:244-251`).
- **Secrets the client reads but the query does not return:** `lib/hooks/useConfiguration.tsx:24,26,49` reads
  `secretKey`, `clientSecret`, `twilioAuthToken`; `lib/api/graphql/queries/configuration/index.ts:3-59` does not
  select them. **This must stay true** — extending the query to "fix" the undefined reads would ship Stripe/PayPal/
  Twilio secrets to any browser.
- **Client-side AES-GCM config decryption with a `NEXT_PUBLIC_*` key** (`lib/utils/methods/decryption/decrypt.ts:20-67`,
  `decrypt-config-fields.ts`) is obfuscation only. Decide: keep (treat the key as public) or move server-side.
- **No CSP and no env gate** in `next.config.mjs` (image allow-list only, `:6-62`, including upstream
  `enatega-backend.s3.eu-north-1.amazonaws.com:51`, `assets.enatega.com:59`), unlike single-vendor admin.
- `lib/services/cloudinary.ts:15-64` uploads with an unsigned `upload_preset` to a backend-supplied URL; **no static
  importer found** — treat as dead until proven reachable. `codegen`-side config field `cloudinaryApiKey` is actually
  used as the upload preset.
- 59 `page.tsx`; 77 queries / 93 mutations / 5 subscriptions.

### 2.3 enatega-singlevendor-admin

- Same architecture as admin, but `requireBaseUrl()` (`lib/hooks/useSetApollo.tsx:46-52`) **throws** when an origin is
  unset, `next.config.mjs:24-32` throws in production on a non-`https`/`wss` URL, and `middleware.ts:3-31` emits a
  nonce-based CSP (`CSP_ENFORCE` toggles enforce vs report-only).
- `lib/hooks/useLocation.tsx:5,25-29,37-40,62-67` uses **`react-geocode` with a browser-exposed Google key**,
  bypassing the backend maps proxy that every other web app uses. Reconcile: either configure `react-geocode`
  deliberately or move single-vendor reverse geocoding to the backend REST route.
- 63 `page.tsx`; 71 queries / 108 mutations / 5 subscriptions.

### 2.4 enatega-multivendor-app (customer mobile)

- **All three environments hard-code `aws-server-v2.enatega.com`** with no env override
  (`environment.config.js:8-11,23-26,38-41`); single-vendor falls back to the upstream railway host
  (`:54-57,78-88`). Environment selection comes from the Expo Updates release channel, not `NODE_ENV`
  (`environment.js:13`).
- `app.config.js`: scheme `enategamultivendor` (`:30`), bundle/package `com.enatega.multivendor`, keystore-backed
  Google services files (`:67,105`), Live Activity app group `group.com.enatega.multivendor.shared` (`:221-229`),
  upstream EAS project `331d4e5b-…` (`:230-232`) and `updates.url https://u.expo.dev/331d4e5b-…` (`:237-239`),
  dev-only demo credentials (`:215-220`).
- `eas.json:30-36` bakes the upstream single-vendor railway endpoints into the **production** profile.
- **Token storage is already correct:** SecureStore with one-shot migration from plaintext
  (`src/utils/secureToken.js:1-79`); public token + device nonce in AsyncStorage
  (`src/utils/publicAccessToken.js:5-20`).
- **Uploads are GraphQL base64:** `src/apollo/mutations.js:3-4` `uploadImageToS3(image: String!)`, called with a data
  URL at `src/screens/ChatWithRider/useChatScreen.js:232`.
- **Media is expected to be signed and cacheable:** `src/utils/signedMediaUrl.js:22-73` parses CloudFront
  `Policy`/`Expires`/`Signature` and S3 `X-Amz-*`; `src/utils/mediaCache.js:29-96` keeps a SHA-256-keyed disk cache and
  evicts on expiry; `scripts/check-signed-media-url.js` asserts the rules.
- **Live Activities:** `src/utils/liveActivityService.js:13-57,82-127,207-262` — `registerLiveActivitySession(orderId,
activityId, platform, pushToken, schemaVersion:2, language)` and `removeLiveActivitySession(orderId, activityId)`,
  retry backoff 750/2000/5000 ms; native bridge `ActivityController.startLiveActivity`.
- **Reverse geocoding happens on-device too** (`src/screens/NewAddress/NewAddress.js:134`,
  `src/screens/EditAddress/EditAddress.js:149`) — the backend geocoder is not the only path.
- Sign-in: Apple (`expo-apple-authentication`) and Google (`@react-native-google-signin`) with an iOS
  `https://www.googleapis.com/userinfo/v2/me` call (`src/screens/CreateAccount/useCreateAccount.ios.js:124-129`).
- Client-computed cache field `distanceWithCurrentLocation` uses `coordinates[0], coordinates[1]`
  (`src/apollo/index.js:154-156`) — **different indexing from the rider app** (§2.6): the backend must return
  `location.coordinates` in the shape each client's policy expects.
- OTA update flow via `expo-updates` (`App.js:296-302`).

### 2.5 enatega-multivendor-store (merchant mobile)

- **The multivendor backend cannot be repointed without a source change** (`environment.ts:9-15`, no env override);
  `requireReleaseEndpoint()` throws in release builds when a single-vendor URL is missing/wrong-scheme (`:17-22`).
- `app.json`: scheme `enatega-store`, bundle/package `multivendor.enatega.restaurant`, `newArchEnabled: true`,
  upstream EAS project `6a94161f-…`; `eas.json` bakes upstream railway URLs into production.
- SecureStore-backed, mode-scoped token/id keys with legacy migration (`lib/services/secure-storage.ts:12-60`,
  `lib/mode/store-mode.ts:24-37`).
- **Subscriptions must be authenticated or the app silently degrades to polling** — comment at
  `lib/apollo/index.ts:79-83`; `subscribePlaceOrder` is authorisation-gated.
- **Useful inversion:** `lib/apollo/index.ts:272` places `requestLink` before the HTTP/WS split, so one header path
  covers both transports (rider does the same at `:245-264`).
- **Thermal printer is device-only**: `react-native-thermal-printer` + `expo-print`
  (`lib/utils/methods/print.ts:4-35`, `lib/utils/methods/format-receipt.ts:21`, `lib/hooks/usePrintOrder.ts:17`);
  printer identity persisted in AsyncStorage (`lib/context/global/restaurant.tsx:76-77`).
- **Push:** `expo-notifications` only; token sent via `saveRestaurantToken(token, isEnabled)`
  (`lib/apollo/mutations/notification.mutation.ts:3-11`), notification `data._id` drives navigation
  (`lib/hooks/useNotification.ts:42-104`).
- Bluetooth permissions declared (`app.json:58-64`); `UIBackgroundModes` includes `audio`.

### 2.6 enatega-multivendor-rider

- **The only mobile app whose multivendor backend is env-overridable** (`environment.ts:10-17`
  `EXPO_PUBLIC_GRAPHQL_URL` / `_WS_`), with upstream fallbacks.
- **Live upstream Sentry DSN hard-coded in source:** `lib/utils/service/sentry.ts:9`. The customer app deliberately
  removed its equivalent (`enatega-multivendor-app/environment.js:29-31`) — close this inconsistency.
- **Second, non-Apollo GraphQL client:** `lib/services/background-location.ts` POSTs
  `mutation BackgroundRiderLocation { updateRiderLocation(latitude, longitude, accuracy, heading, speed, deviceTimestamp) { _id } }`
  directly with hand-rolled headers (`:60-79`), filters accuracy > 50 m and throttles < 8 s / < 20 m (`:41-55`),
  runs under `TaskManager.defineTask` + `startLocationUpdatesAsync` with a foreground service (`:117-155`).
- Per-operation session invalidation is the most precise of the six (`lib/apollo/index.ts:226-240` +
  `lib/utils/session.ts`), with a `router.replace('/login')` fallback when no subscriber is mounted (`:134-140`).
- SecureStore wrapper degrades safely when the native module is absent (`lib/services/secure-storage.ts:13-60`);
  release builds do not trust un-migratable legacy values (`:60`).
- `google-services.json` is present but `@react-native-firebase/*` is not a declared dependency — **UNVERIFIED**
  whether Firebase is used at runtime.
- Client-computed `distanceWithCurrentLocation` indexes `coordinates[0][0][0]` (`lib/apollo/index.ts:100-102`).
- Background-location submission notes: `GOOGLE_PLAY_BACKGROUND_LOCATION_SUBMISSION.md`.

---

## 3. Non-GraphQL backend surface (must be implemented explicitly)

### 3.1 REST

| Method | Route                                                                                       | Consumer                                                                                                                            | Notes                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `{rest}/maps/reverse-geocode?latitude&longitude&language`                                   | admin `lib/api/google-maps.ts:27-40`; web via `app/api/maps/reverse-geocode/route.ts:27-44`; app `src/api/googleMapsProxy.js:86-95` | response `{success,error:{code,message},data:{status,errorMessage,formattedAddress,city}}`                         |
| GET    | `{rest}/maps/autocomplete?input&language&types`                                             | app `src/api/googleMapsProxy.js:43-53`                                                                                              | axios, 10 s timeout, returns `data.data`                                                                           |
| GET    | `{rest}/maps/place-details?placeId&language`                                                | app `src/api/googleMapsProxy.js:65-73`                                                                                              | returns `data.data`                                                                                                |
| POST   | `{rest}stripe/account` `{restaurantId}` → `{url}`                                           | admin `…/restaurant/payment/main/index.tsx:55-68`; single-admin `:51-68`                                                            | Stripe Connect onboarding; current call lacks auth headers — **must be authenticated server-side, not replicated** |
| POST   | `{rest}stripe/create-web-checkout-session` `{id,payment_method}` + Bearer → `{checkoutUrl}` | web `lib/ui/single-vendor/Checkout.tsx:140-157`                                                                                     |                                                                                                                    |
| GET    | `{rest}stripe/create-checkout-session?id&platform=web` → redirect                           | web `…/order/checkout/index.tsx:793-814`                                                                                            | server owns price and order ownership                                                                              |
| GET    | `/media/<key>` (and `public-media/<key>` alias)                                             | web `lib/utils/media-url.ts:14-51`; app `src/utils/mediaUrl.js:23-49`; single-admin `lib/utils/media.ts:11-26`                      | **signed URLs required** (§2.4)                                                                                    |
| GET    | `{rest}paypal?id`                                                                           | app `src/screens/Paypal/Paypal.js:149`                                                                                              | upstream bug concatenates `/graphql` + `paypal`; fix the client base, do not make the malformed URL canonical      |

Error mapping the maps proxy expects: `error.response.data.error.message`, `ECONNABORTED` → timeout, network →
"Network error" (`src/api/googleMapsProxy.js:15-33`).

### 3.2 GraphQL operations the clients treat as infrastructure

`metricsGeneral` (§0.2), `uploadImageToS3(image: String!)` (admin/single-admin also pass `publicMedia: Boolean`),
`saveRestaurantToken(token,isEnabled)`, `saveNotificationTokenWeb(token)`,
`registerLiveActivitySession` / `removeLiveActivitySession`, `updateRiderLocation`, plus all subscription roots in §1.

### 3.3 Transport contract

- HTTP: `POST /graphql` with `{query, variables, operationName}`.
- WS: `/graphql` speaking the **legacy `subscriptions-transport-ws`** frame set under the `graphql-ws` subprotocol
  name (`connection_init`, `connection_ack`, `start`, `data`, `stop`, `complete`, `connection_terminate`), proven by
  the in-repo smoke script `enatega-multivendor-store/scripts/check-single-vendor-store-auth.js:88-137`. A
  `graphql-transport-ws`-only server breaks all six clients.
- Headers observed: `authorization`, `nonce`, `bop-auth`, `x-platform`, `X-Client-Type`, `userId`, `isAuth`,
  `accept-language`, `user-agent`, `x-skip-public-auth`. `userId`/`isAuth` are untrusted hints.

---

## 4. Numbered integration blockers

1. **No package ships env files** (all six verified absent; local env files are excluded from the snapshot). Runtime
   configuration delivery is unsolved for every app.
2. **Node engine conflict:** repo requires Node `>=24 <25`; the three web packages require `>=20`, ship `.nvmrc v20.16.0`,
   and the two admins set `engine-strict=true`, so `npm install` **fails outright under Node 24**.
3. **Three web packages share the npm name `enatega-frontend`** and differ in Next/React majors (Next 16/React 19 vs
   Next 14/React 18), so they cannot share one workspace or bundle strategy. They are outside
   `implementation/pnpm-workspace.yaml` by design.
4. **Malformed-endpoint risk in admin:** unguarded `` `${SERVER_URL}graphql` `` concatenation.
5. **Customer app and store hard-code the multivendor upstream host with no env override** — repointing requires a
   recorded source edit.
6. **Upstream single-vendor endpoints are baked into all three production EAS profiles** — a production build today
   ships pointing at a third party.
7. **Live upstream Firebase web credentials are committed in four public files** (`serviceWorker.js`, `sw.js`, both
   `firebase-messaging-sw.js`) and are served to browsers.
8. **A live Sentry DSN is hard-coded in rider source** (`lib/utils/service/sentry.ts:9`).
9. **The `bop-auth`/`nonce` handshake is a hard dependency of every request in every app**, and `metricsGeneral` is a
   query in three apps and a mutation in the customer app.
10. **Legacy WS subprotocol required** (see §3.3).
11. **Web push cannot work** until `vapidKey` is supplied to the web config query (§2.1).
12. **Admin client reads secret config fields the query never returns** — keep it that way (§2.2).
13. **Client-side AES-GCM config "decryption" uses a public key** — decide keep vs move server-side.
14. **Single-vendor admin bypasses the backend geocoder** with `react-geocode` and a browser-exposed Google key.
15. **Rider and store mobile apps depend on backend-supplied provider config that does not exist yet**: Firebase keys,
    VAPID, per-app Sentry URLs, map keys, printer/notification settings.
16. **Customer web references a `/paypal` route that does not exist** in the pinned tree.
17. **Password-reset tokens travel in the URL** in customer web.
18. **Media must be served signed**, with a working refresh story, or mobile image caching breaks.
19. **EAS project IDs, `updates.url`, submission identities (`ascAppId` 1526488093/1526672537/1526674511,
    `appleTeamId GDFK7MVY6P`) and Firebase native binding files all belong to Enatega**, not FairBite.
20. **The vendor tree contains unrecorded Fair-authored edits** (§0.1) and the package-level provenance file has no
    `allowedModifications` key.
21. **`distanceWithCurrentLocation` client policies disagree between app and rider** on coordinate indexing; the
    backend must return the shape each expects.
22. **`uploadImageToS3` must tolerate the single-vendor `publicMedia` argument** and base64 data URLs up to the app's
    real payload sizes.
23. **No `node_modules` exists in any vendor package** — a per-package install/build matrix is required; there is no
    Turbo pipeline covering them.
24. **Third-party identifiers are unconfigurable:** Clarity `tjqw9wn955`/`tjqxrz689j`, the EmailJS CDN load, the iOS
    Google reversed client ID fallback, dev demo credentials.

---

## 5. Backend capabilities this audit adds to the requirement set

| #                                                                                        | Capability                                                                                                    | Owner workstream |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1                                                                                        | Accept `metricsGeneral` as **both** query and mutation, with `nonce` binding and decoy fields                 | W1 (kernel)      |
| 2                                                                                        | `bop-auth` verification on HTTP and WS, with `x-skip-public-auth` bypass and client-compatible error text     | W1               |
| 3                                                                                        | Legacy `subscriptions-transport-ws` frame set on `/graphql` (plus `graphql-transport-ws` for our own tooling) | W1               |
| 4                                                                                        | 3 maps REST routes + the web Next proxy contract + `REQUEST_DENIED` envelope when unconfigured                | W4 (L2)          |
| 5                                                                                        | `/media/<key>` with signed-URL generation and a refresh story                                                 | W4 (L2)          |
| 6                                                                                        | `uploadImageToS3(image, publicMedia?)` with magic-byte validation, size bounds, tenant ownership              | W4 (L2)          |
| 7                                                                                        | 3 Stripe REST routes incl. Connect onboarding with server-side ownership, plus return-URL contract            | W9 (L7)          |
| 8                                                                                        | PayPal path kept honest (`PROVIDER_UNAVAILABLE`) until an owner decision + provider account                   | W9 (L7)          |
| 9                                                                                        | Notification token roots for all three client flavours + Expo push delivery                                   | W10 (L8)         |
| 10                                                                                       | Live Activity session roots (`registerLiveActivitySession`, `removeLiveActivitySession`)                      | W10 (L8)         |
| 11                                                                                       | `updateRiderLocation` usable from the background task with hand-rolled headers                                | W8 (L6)          |
| 12                                                                                       | `configuration` query returning display names, currency, feature toggles and provider keys — **without** any  |
| secret (`secretKey`, `clientSecret`, `twilioAuthToken`, SMTP password, `sendGridApiKey`) | W4 (L2)                                                                                                       |

---

## 6. Open / UNVERIFIED items carried forward

- Which artifacts in §0.1 are upstream vs Fair-authored; whether the tree matches `claimedUpstreamCommit d9eb29e8…`.
- Reachability of `lib/services/cloudinary.ts` in both admins (no static importers found).
- `emailjs-com` declared in customer web with no import found.
- Whether the customer app has any reachable card-payment path (Stripe dependency present, no SDK call found).
- `/paypal` route resolution in customer web.
- Whether the store app needs a Google Maps native key (no key read found despite location permissions).
- Whether Firebase is used at runtime in rider (`google-services.json` present, no RN Firebase dependency).
- Contents of `enatega-multivendor-app/patches/` (6 entries applied by `patch-package` on `postinstall`).
- Runtime behaviour of anything requiring a device, emulator, network or native build.

---

## 7. Consequences for the plan

- Frontend lanes (W12–W14) start by writing `30-frontend-integration.md` and, before any edit, producing this audit
  for their own package in the same shape (only customer web had one previously:
  `implementation/.toolchain/enatega-original-customer-web/.fairbite-integration-audit.json`).
- W2 (contract/data-model freeze) additionally owns the provenance reconciliation of §0.1.
- W1 owns the transport contract items 1–3 in §5; they are prerequisites for every UI gate.
- W4 owns media signing, uploads, maps REST and the configuration surface (item 12 is a security requirement, not a
  convenience).
- Every recorded vendor edit must be added to `implementation/SOURCE_PROVENANCE.json → allowedModifications` and
  followed by `node tools/manifest-enatega-ui.mjs`, serialised by the lead.
