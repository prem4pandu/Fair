# 01 - Client transport, public-access handshake and local launch (pinned Enatega UI)

Status: read-only research reference, 2026-10-08. Source of truth is the pinned,
unchanged UI in `implementation/vendor/enatega-ui/`. Every claim below cites
`file:line` relative to that directory (prefix `V/`). Anything that could not
be proven from the vendored source is marked **UNVERIFIED**.

Frontend boundary reminder (AGENTS.md, owner directive 2026-10-08): the product
UI must remain the complete pinned Enatega UI. Allowed frontend edits are
limited to transport/adapters, secure session handling, validated data mapping,
configuration and centralized display-name imports. Every edit inside the
vendored source must be recorded in `SOURCE_PROVENANCE.json` under
`allowedModifications`. An unsupported backend capability is an integration
blocker, never permission to substitute UI, fabricate data or call upstream.

Important environment fact: no `node_modules` are installed for any of the six
apps and no `.env*` files are vendored (`find V -name ".env*"` returns nothing;
`V/FAIR_INTEGRATION.md:17-19` says local environment files were excluded).
Statements about Apollo Client library internals (how `HttpLink`, `onError`,
`ServerError` behave) are therefore based on Apollo Client 3.x source behaviour
and are **UNVERIFIED against the installed library**. Locked versions are listed
in section 8.

App short names used below:

| Short   | Directory                      | Kind                           |
| ------- | ------------------------------ | ------------------------------ |
| ADMIN   | `V/enatega-multivendor-admin`  | Next.js 14.2.35                |
| SVADMIN | `V/enatega-singlevendor-admin` | Next.js 14.2.5                 |
| WEB     | `V/enatega-multivendor-web`    | Next.js 16.2.10 (customer web) |
| APP     | `V/enatega-multivendor-app`    | Expo 53 (customer)             |
| STORE   | `V/enatega-multivendor-store`  | Expo 54 (merchant)             |
| RIDER   | `V/enatega-multivendor-rider`  | Expo 53 (rider)                |

---

## 0. One-page matrix

|                                  | ADMIN                                 | SVADMIN               | WEB                                                     | APP                                        | STORE                                    | RIDER                                                                |
| -------------------------------- | ------------------------------------- | --------------------- | ------------------------------------------------------- | ------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------- |
| HTTP GraphQL URL                 | `${NEXT_PUBLIC_SERVER_URL}graphql`    | same, base validated  | `NEXT_PUBLIC_SERVER_URL` normalised to `.../graphql`    | hard-coded `environment.config.js` (MULTI) | hard-coded `environment.ts` (MULTI)      | `EXPO_PUBLIC_GRAPHQL_URL` or hard-coded fallback                     |
| WS URL                           | `${NEXT_PUBLIC_WS_SERVER_URL}graphql` | same, validated       | `NEXT_PUBLIC_WS_SERVER_URL` normalised to `.../graphql` | hard-coded                                 | hard-coded                               | `EXPO_PUBLIC_WS_GRAPHQL_URL` or fallback                             |
| WS library                       | subscriptions-transport-ws 0.11.0     | same                  | same                                                    | same (via `WebSocketLink({uri,options})`)  | same                                     | same                                                                 |
| User token storage               | `localStorage.token`                  | same                  | `localStorage["@enatega/<mode>/token"]`                 | SecureStore `customer-token-<mode>`        | SecureStore `enatega-store-<mode>-token` | SecureStore (dev fallback AsyncStorage) `enatega-rider-<mode>-token` |
| Refresh token flow               | yes (`RefreshToken` mutation)         | yes                   | no                                                      | no                                         | no                                       | no                                                                   |
| Public access (`metricsGeneral`) | yes                                   | yes                   | yes                                                     | yes                                        | yes                                      | yes                                                                  |
| Public-token retry on error      | yes (message match)                   | yes (error path only) | no                                                      | yes (regex, once)                          | yes (only if no user auth)               | no (foreground); yes (background task)                               |
| `bop-auth`/`nonce` on WS         | no                                    | no                    | no                                                      | no                                         | yes                                      | yes                                                                  |
| Client JWT decoding              | no                                    | no                    | no                                                      | yes (`jwt-decode`, needs `exp`)            | yes (`atob`, see 2.5)                    | no                                                                   |

---

## 1. Apollo client setup per app

### 1.1 ADMIN (`V/enatega-multivendor-admin/lib/hooks/useSetApollo.tsx`)

URL sources

- `SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL` (`:300`), `WS_SERVER_URL = process.env.NEXT_PUBLIC_WS_SERVER_URL` (`:301`).
- HTTP link: `createHttpLink({ uri: \`${SERVER_URL}graphql\` })` (`:307-309`). Literal concatenation: the env value must be a base ending in `/`and must not contain`graphql`(e.g.`http://localhost:4100/`).
- Public-token and refresh calls also use `${serverUrl}graphql` (`:159`, `:221`).
- `V/enatega-multivendor-admin/lib/utils/constants/url.ts:1-14` (`BACKEND_URL`, upstream hosts) is not imported anywhere (grep for `BACKEND_URL` finds only its definition). Dead code.

Link chain: `concat(ApolloLink.from([errorLink, terminatingLink, requestLink]), httpLink)` (`:456-460`). `terminatingLink = split(isSubscription, wsLink)` (`:448-454`) has no right branch, so non-subscriptions pass through to `requestLink` then `httpLink`. Subscriptions never pass through `requestLink` (no `bop-auth`/`nonce` on WS).

Headers set on every HTTP operation by `request()` (`:361-383`), always present (empty string when absent):

| Header          | Value                                                         | Source                                 |
| --------------- | ------------------------------------------------------------- | -------------------------------------- |
| `authorization` | `Bearer <token>` or `""`                                      | `localStorage.token` (`:362`, `:374`)  |
| `nonce`         | 32-hex nonce or `""`                                          | `localStorage._px3k9` (`:370`, `:375`) |
| `bop-auth`      | `Bearer <metricsToken>` or `""`                               | `localStorage._zt7m2` (`:371`, `:376`) |
| `userId`        | `localStorage.userId` or `""`                                 | (`:363`, `:377`)                       |
| `isAuth`        | boolean `!!token` (serialised by fetch as `"true"`/`"false"`) | (`:378`)                               |
| `X-Client-Type` | `web`                                                         | (`:379`)                               |
| `x-platform`    | `web`                                                         | (`:380`)                               |

Before setting headers, if the operation is not `MetricsGeneral` and `shouldRefreshToken()` is true, it awaits `fetchMetricsToken` (`:366-368`).

Token storage (`V/enatega-multivendor-admin/lib/utils/methods/auth.ts:10-17`, `:19`): localStorage keys `token`, `userType`, `userId`, `tokenExpiration`, `refreshToken`, `refreshTokenExpiration`, and the stored user JSON under `user-Yalla` (`SESSION_USER_KEY = \`user-${APP_NAME}\``, `APP_NAME = 'Yalla'`at`lib/utils/constants/strings/global.ts:1`). `persistUserSession` (`auth.ts:83-105`) also writes `vendorId`+`selected-vendor-email`for`userType === 'VENDOR'`, and `restaurantId`+`shopType`for`userType === 'RESTAURANT'` (`lib/utils/constants/local-storage.ts:1-5`). `clearStoredSessionState` (`auth.ts:107-117`) removes all of these plus `messaging-token`.

Public-access storage (`V/enatega-multivendor-admin/lib/utils/methods/security.ts:1-7`): localStorage `_px3k9` (nonce), `_zt7m2` (metrics token), `_qw4v8` (expiry string), `_rf8n1` (last refresh ms), `_mn6q4` (nonce the token was minted for).

Refresh flow (`useSetApollo.tsx:203-278`)

- Trigger: `errorLink` (`:322-359`) on the observable **error** path only, when `hasExpiredAccessToken(error)` (`extensions.code === 'TOKEN_EXPIRED'` or message contains `access token expired`, `:101-106`) and the operation was not already retried (context key `accessTokenRetry`).
- Requires `localStorage.refreshToken` and `localStorage.userType`; otherwise returns null (`:212-214`).
- Raw `fetch POST ${serverUrl}graphql`, headers `Content-Type: application/json`, `nonce`, `bop-auth: Bearer <metrics>` or `""`, `x-platform: web`, `X-Client-Type: web` (no `authorization`) (`:221-236`). Body: `query: print(REFRESH_TOKEN)`, `variables: { refreshToken, userType }`.
- Document (`lib/api/graphql/mutations/authentication/refresh.ts:3-13`):
  ```graphql
  mutation RefreshToken($refreshToken: String!, $userType: String!) {
    refreshToken(refreshToken: $refreshToken, userType: $userType) {
      userId
      token
      tokenExpiration
      refreshToken
      refreshTokenExpiration
    }
  }
  ```
- If the refresh response is a metrics auth error (see 3.1), clears metrics data, new nonce, re-mints, retries once (`:244-251`).
- Success requires `response.ok`, no `errors`, and `data.refreshToken.token` (`:255-257`); stores all returned fields (`setAuthTokens`) and merges into stored user (`:259-266`); original operation is replayed (`:338-341`).
- Concurrency: single in-flight promise (`accessTokenRefreshPromise`, `:204-206`).

Logout / invalid-session triggers

- `errorLink`: if after the refresh attempt the error is still expired, or `hasInvalidAccessToken` (`extensions.code === 'INVALID_TOKEN'` or message trimmed/lowercased exactly `invalid token`, `:108-116`) then `handleInvalidSession()` clears session + metrics data and `window.location.assign('/authentication/login')` (`:138-144`, `:344-349`).
- `lib/context/global/user-context.tsx:57-67`: bootstrap query `OwnerSession` (`ownerSession { userId email ... }`, `lib/api/graphql/queries/authentication/index.ts:3-7`). On failure, if `ApolloError.graphQLErrors[].extensions.code` is one of `UNAUTHENTICATED`, `FORBIDDEN`, `TOKEN_EXPIRED`, `INVALID_TOKEN` the session is cleared (`user-context.tsx:113-117`); a null `ownerSession` also clears it (`:98-101`).
- Manual logout in app bars: `restaurant-layout/app-bar/index.tsx:128`, `super-admin-layout/app-bar/index.tsx:173`, `vendor-layout/app-bar/index.tsx:123` (all call `clearStoredSessionState()`).

### 1.2 SVADMIN (`V/enatega-singlevendor-admin/lib/hooks/useSetApollo.tsx`)

Identical to ADMIN (security/auth utils byte-identical; `diff` of `lib/utils/methods/auth.ts` reports no difference) except:

- `requireBaseUrl()` (`:46-53`) trims, strips trailing slashes, throws `"<NAME> is not configured"` if empty, re-adds one `/`. Used for both env vars (`:292-299`). Missing env var therefore throws during render.
- HTTP link `${SERVER_URL}graphql` (`:322`), WS `${WS_SERVER_URL}graphql` (`:325`).
- Metrics retry in `requestLink` runs only on the observable **error** path (`:413-430`); the `next` path does not inspect `result.errors`. Consequence: a public-access failure delivered as HTTP 200 + `errors` is never retried by SVADMIN (see 3.4).
- `next.config.mjs:24-32`: `NODE_ENV=production` build throws unless `NEXT_PUBLIC_SERVER_URL` starts with `https://` and `NEXT_PUBLIC_WS_SERVER_URL` with `wss://`.
- `middleware.ts:4-31`: CSP with `connect-src 'self' https: wss:` and `upgrade-insecure-requests`, sent as `Content-Security-Policy-Report-Only` unless `CSP_ENFORCE === 'true'` (`:24-29`). Default dev is report-only, so `http://localhost:4100` works.
- `lib/utils/media.ts:8-29`: `/media/<key>` URLs and `public-media/<key>` values are rewritten onto `NEXT_PUBLIC_SERVER_URL`.
- Stripe onboarding sends `Authorization` (see 4.2).

### 1.3 WEB (`V/enatega-multivendor-web/lib/hooks/useSetApollo.tsx`)

URL sources (`lib/mode/environment.ts:40-59`)

- MULTI: `NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_WS_SERVER_URL`; SINGLE: `NEXT_PUBLIC_SINGLE_VENDOR_SERVER_URL`, `NEXT_PUBLIC_SINGLE_VENDOR_WS_SERVER_URL`, `NEXT_PUBLIC_SINGLE_VENDOR_REST_URL` (falls back to single server URL).
- `withGraphql(url)` appends `/graphql` unless already present (`:30-31`); `restUrl = withTrailingSlash(serverUrl)` (`:33-34`, `:48-56`). Therefore `NEXT_PUBLIC_SERVER_URL` must be the base (`http://localhost:4100/`), not `.../graphql`, or every REST URL becomes `.../graphql/...`. If unset, `graphqlUrl` becomes relative `/graphql` (silent misconfiguration).
- `environment.ts` (root) `getEnv()` is commented out in `useSetApollo.tsx:2`, `:123` (unused).
- One Apollo client per mode, cached for the tab lifetime (`useSetApollo.tsx:98-111`); SSR always creates a fresh client (`:104`). `httpLink` resolves the URI per operation from `operation.getContext().appMode` (`:131-135`).

Link chain identical in shape to ADMIN (`:247-251`).

Headers set by `request()` (`:183-214`):

| Header          | Value                                                              |
| --------------- | ------------------------------------------------------------------ |
| `authorization` | `Bearer <token>` or `""` (`localStorage["@enatega/<mode>/token"]`) |
| `nonce`         | `localStorage["@enatega/<mode>/_px3k9"]` or `""`                   |
| `bop-auth`      | `Bearer <localStorage["@enatega/<mode>/_zt7m2"]>` or `""`          |
| `userId`        | `localStorage["@enatega/<mode>/userId"]` or `""` (`:188-193`)      |
| `isAuth`        | `!!token`                                                          |
| `X-Client-Type` | `web`                                                              |

WEB does **not** send `x-platform`. `<mode>` is `multi` or `single` (`lib/mode/storage.ts:94-95`; shared, unscoped keys at `:68-76`: `@enatega/app-mode`, `theme`, `locale`, `NEXT_LOCALE`, `messaging-token`, `pendingOrderNavigation`, `knownOrderOrigins`).

Token storage (`lib/utils/methods/auth.ts:5-10`): mode-scoped `token`, `userType`, `userId`, `tokenExpiration`. Login stores `userType: 'USER'` (`lib/context/auth/auth.context.tsx:275-280`). No refresh token, no refresh flow.

Public-access storage (`lib/utils/methods/security.ts:5-10`): mode-scoped `_px3k9`, `_zt7m2`, `_qw4v8`, `_rf8n1` (no token-nonce key, unlike ADMIN).

Logout / invalid-session triggers

- `errorLink` (`:152-181`) on the error path: if `error.graphQLErrors` contains `extensions.code` `TOKEN_EXPIRED` or `INVALID_TOKEN` it calls `invalidateClientSession(mode)` and `window.location.assign('/auth/login')` (`:48-53`). **UNVERIFIED**: at link level Apollo emits `ServerError` (which carries `.result`, not `.graphQLErrors`), so this branch may never fire for HTTP errors.
- `lib/hoc/auth.guard.tsx:19-38`: protected pages invalidate the session when no token is stored.
- `lib/context/User/User.context.tsx:480-490`: manual logout (`invalidateClientSession`, `client.resetStore()`).
- `invalidateClientSession` clears auth keys, the session keys listed in `auth.ts:12-26`, and metrics data (`auth.ts:85-95`).

### 1.4 APP (`V/enatega-multivendor-app/src/apollo/index.js`)

URL sources

- `App.js:85-95` reads `GRAPHQL_URL`, `WS_GRAPHQL_URL`, `PUBLIC_ACCESS_REQUIRED` from `useEnvVars()` (`environment.js:13-37`), which spreads `getEnvironmentConfig(Updates.channel, mode)` (`environment.config.js:95-107`).
- MULTI URLs are hard-coded for all three channels: `environment.config.js:8-11`, `:23-26`, `:38-41` (`https://aws-server-v2.enatega.com/graphql`, `wss://aws-server-v2.enatega.com/graphql`, `SERVER_URL` = the GraphQL URL, `SERVER_REST_URL: 'https://aws-server-v2.enatega.com/'`). There is no env override for MULTI.
- Channel: `normalizeEnvironment` maps anything other than `production`/`staging` to `development` (`:90-93`); `expo start` therefore uses the `development` block (**UNVERIFIED** value of `Updates.channel` in a dev client; any value maps to a block with the same upstream URLs).
- One client per `mode:GRAPHQL_URL:WS_GRAPHQL_URL:PUBLIC_ACCESS_REQUIRED` key (`App.js:106-119`).

Link chain: `ApolloLink.from([errorLink, terminatingLink])` (`:330-331`); `terminatingLink = split(isSubscription, wsLink, ApolloLink.from([retryLink, requestLink, timeoutLink, httpLink]))` (`:321-328`).

- `timeoutLink`: abort after 15 000 ms (queries) / 30 000 ms (mutations) (`:30-31`, `:35-64`).
- `retryLink`: queries only, max 3 attempts, delay 300..2000 ms jitter, retries on any error (`:68-74`).
- Default `errorPolicy: 'all'`, `fetchPolicy: 'cache-first'`, `returnPartialData: true` (`:333-346`).

Headers set by `request()` (`:195-221`):

| Header            | Value                           | Condition                                                                                                                     |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `authorization`   | `Bearer <jwt>` or `""`          | omitted (empty) for operations `ForgotPassword`, `VerifyOtp`, `ResetPassword` (`:94`, `:200-201`) and when the JWT is expired |
| `bop-auth`        | `Bearer <publicToken>` or `""`  | only if `publicAccessRequired` (always true)                                                                                  |
| `nonce`           | nonce string                    | only if `publicAccessRequired`                                                                                                |
| `user-agent`      | `EnategaApp/<Platform.OS>`      | always                                                                                                                        |
| `accept-language` | `en-US` (fixed)                 | always                                                                                                                        |
| `x-platform`      | `Platform.OS` (`ios`/`android`) | always                                                                                                                        |

Context flag `hasUserToken` (`:208-209`) is used by the error link.

Token storage (`src/utils/secureToken.js:13-17`): SecureStore key `customer-token-multi` / `customer-token-single`; legacy `token` (SecureStore or AsyncStorage) migrated once for MULTI (`:44-68`).

Client-side JWT expiry (`src/utils/decode-jwt.js:19-24`): `isJwtTokenExpired` returns **true when the token cannot be decoded or has no `exp`**. Every request (`index.js:202-206`) and WS connect (`:178-183`) calls `invalidateUserSession({reason:'token_expired'})` for such tokens. Server requirement: customer user tokens must be JWTs with a numeric `exp` (seconds).

Logout / invalid-session triggers (`index.js:244-278`, `src/utils/session.js:43-66`)

- If the request carried a user JWT (`hasUserToken === true`) and either a GraphQL error has `extensions.code` in `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, or the network error status is `401` (`networkError.statusCode === 401 || networkError.response.status === 401`): delete token, notify listeners; `App.js` shows the session-expired modal for reasons `invalid_token`, `token_expired`, `network_unauthorized`, `graphql_unauthenticated` (`session.js:7-12`, `App.js:249-256`).
- No refresh token flow (grep for `refreshToken` finds only a Google sign-in option).

### 1.5 STORE (`V/enatega-multivendor-store/lib/apollo/index.ts`)

URL sources (`V/enatega-multivendor-store/environment.ts`)

- MULTI hard-coded: `GRAPHQL_URL: "https://aws-server-v2.enatega.com/graphql"`, `WS_GRAPHQL_URL: "wss://aws-server-v2.enatega.com/graphql"`, `PUBLIC_ACCESS_REQUIRED: true` (`:9-15`). No env override.
- SINGLE: `EXPO_PUBLIC_SINGLE_VENDOR_GRAPHQL_URL` / `EXPO_PUBLIC_SINGLE_VENDOR_WS_GRAPHQL_URL`, default railway host; release builds (`!__DEV__`) throw unless `https://` / `wss://` (`:17-38`).

Link chain: `ApolloLink.from([errorLink, requestLink, terminatingLink])` (`:272`), `terminatingLink = split(isSubscription, wsLink, httpLink)` (`:255-270`). Subscriptions also pass through `requestLink` (headers are set but WS ignores per-operation headers).

Headers set by `request()` (`:126-152`):

| Header                             | Value                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `authorization`                    | `Bearer <token>` or `""` (SecureStore `tokenKey`)                                    |
| `x-platform`                       | `Platform.OS`                                                                        |
| `accept-language`                  | AsyncStorage `lang` or `en`                                                          |
| `user-agent`                       | `Enatega-Store-App/<Platform.OS>` (`lib/services/public-access-token.service.ts:33`) |
| any headers from operation context | spread last (`:141`)                                                                 |
| `nonce`                            | singleton nonce or `""` (unless `x-skip-public-auth`)                                |
| `bop-auth`                         | `Bearer <publicToken>` or `""` (unless `x-skip-public-auth`)                         |

The `MetricsGeneral` call puts `x-skip-public-auth: "true"` in context headers (`public-access-token.service.ts:170-176`); because `request()` spreads context headers, **the header `x-skip-public-auth: true` is actually sent to the server**, together with any stored `authorization`. The server must tolerate it.

Client-side JWT expiry (`index.ts:28-39`): `JSON.parse(globalThis.atob(token.split(".")[1]))`; expired if `exp*1000 <= now + 15000`; **returns true (expired) if decoding throws**. `atob` rejects base64url characters `-` and `_`, so a store JWT whose payload segment contains `-` or `_` is treated as expired and the user is logged out on every request (`:131-134` throws `"Session expired"`). Server requirement: store login tokens (`restaurantLogin.token`) must be JWTs whose payload segment contains only `[A-Za-z0-9]` (e.g. add/adjust a filler claim until the encoding is clean) and must carry numeric `exp` if expiry is desired (missing `exp` is treated as non-expired, `:32-35`).

Token storage (`lib/mode/store-mode.ts:36-40`): SecureStore `enatega-store-multi-token` / `enatega-store-single-token`; store id `enatega-store-<mode>-id`; legacy `store-token` / `store-id` migrated (`:42-78`, `lib/utils/constants/local-storage.ts:1-2`). Mode key AsyncStorage `@enatega/store/server-mode` (`store-mode.ts:24`).

Logout / invalid-session triggers (`index.ts:47-65`, `:175-243`)

- If the request had a non-empty `authorization` and (code in `TOKEN_EXPIRED`, `INVALID_TOKEN`, `UNAUTHENTICATED`, or network status 401): delete token + store id, `router.replace("/(un-protected)/login")`.
- Expired/undecodable stored JWT before any request (`:131-134`) or WS connect (`:93-101`).
- Login always deletes the stored token and calls `PublicAccessTokenService.reset(client)` first (`lib/hooks/useLogin.ts:96-109`). On success stores `restaurantLogin.restaurantId` and `restaurantLogin.token` (`:70-77`).

### 1.6 RIDER (`V/enatega-multivendor-rider/lib/apollo/index.ts`)

URL sources (`V/enatega-multivendor-rider/environment.ts`)

- MULTI: `process.env.EXPO_PUBLIC_GRAPHQL_URL ?? "https://aws-server-v2.enatega.com/graphql"` (`:10-13`), `process.env.EXPO_PUBLIC_WS_GRAPHQL_URL ?? "wss://aws-server-v2.enatega.com/graphql"` (`:14-17`). Env override exists; no code edit needed.
- SINGLE: `EXPO_PUBLIC_SINGLE_VENDOR_GRAPHQL_URL` / `_WS_GRAPHQL_URL`, default railway, release builds require https/wss (`:18-35`).
- `PUBLIC_ACCESS_REQUIRED: true` (`:68`).

Link chain: `ApolloLink.from([errorLink, requestLink, split(isSubscription, wsLink, httpLink)])` (`:243-265`).

Headers set by `request()` (`:186-206`): `authorization` (`Bearer <token>` or `""`), `x-platform` (`Platform.OS`), `accept-language` (AsyncStorage `lang` or `en`), `user-agent` `Enatega-Rider-App/<Platform.OS>` (`lib/services/public-access-token.service.ts:26`), context headers spread, then unless `x-skip-public-auth`: `bop-auth` (`Bearer <token>` or `""`) and `nonce` (or `""`). As in STORE, `x-skip-public-auth: true` reaches the server on the MetricsGeneral call.

Token storage: `lib/mode/rider-mode.ts:33-37` SecureStore `enatega-rider-multi-token` / `enatega-rider-multi-id` (and `-single-`). `lib/services/secure-storage.ts:40-97`: uses SecureStore when `isAvailableAsync()`; otherwise, **only in `__DEV__`**, falls back to AsyncStorage; in release it throws `"Secure storage is unavailable; refusing to persist credentials."`.

Logout / invalid-session triggers (`lib/utils/session.ts:37-79`, `index.ts:122-146`, `:226-240`): only if the request had `authorization`; invalid when

- `extensions.code` (upper-cased) in `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`; else
- NOT invalid if message starts with `unauthorized:` or contains `fingerprint`, `public token`, `bop-auth`, `nonce`; else
- invalid if message equals `unauthorized`, starts with `unauthenticated`, contains `access token expired`, equals `invalid token`, or contains `token must be provided`; else
- for operation name `rider` only: code `FORBIDDEN` or message contains `not authorized`, `rider does not exist`, `rider not found`.
  Network status 401 alone does **not** log the rider out (only codes/messages).

---

## 2. Public-access handshake (`metricsGeneral`)

### 2.1 Document (identical in ADMIN, SVADMIN, WEB, APP, STORE, RIDER `lib/apollo/mutations/metrics/index.ts`)

Files: `V/enatega-multivendor-admin/lib/api/graphql/mutations/metrics/index.ts:3-18`, `V/enatega-singlevendor-admin/lib/api/graphql/mutations/metrics/index.ts`, `V/enatega-multivendor-web/lib/api/graphql/mutations/metrics/index.ts:3-18`, `V/enatega-multivendor-app/src/apollo/publicAccess.js:3-18`, `V/enatega-multivendor-store/lib/services/public-access-token.service.ts:9-24`, `V/enatega-multivendor-rider/lib/apollo/mutations/metrics/index.ts:3-20`.

```graphql
mutation MetricsGeneral {
  metricsGeneral {
    excellence
    topgun
    experience
    skydiver
    rider
    haha
    hehe
    huhu
    yoyo
    turu
  }
}
```

Variant documents (also must validate):

- RIDER service (`lib/services/public-access-token.service.ts:17-24`): `mutation MetricsGeneral { metricsGeneral { experience hehe } }`.
- RIDER background task (`lib/services/background-location.ts:100`): `mutation BackgroundPublicToken { metricsGeneral { experience hehe } }` (different operation name - the server must not key on operation name `MetricsGeneral`).

No variables in any variant.

### 2.2 Response fields

Only two fields are read by any client:

- `experience`: the public-access token string. Sent back as `bop-auth: Bearer <experience>`. Never decoded client-side. APP's comment calls it a JWT and expects server messages like `"Unauthorized: jwt expired"` (`src/apollo/index.js:252-256`).
- `hehe`: expiry, parsed with `new Date(hehe)` everywhere (ADMIN `security.ts:79`; WEB `security.ts:74`; APP `publicAccessToken.js:57` and `publicAcccessService.js:31`; STORE `public-access-token.service.ts:189`; RIDER `public-access-token.service.ts:189`). Must be an ISO-8601 date-time string (e.g. `2026-10-08T12:30:00.000Z`). A numeric-string epoch would produce `Invalid Date`: ADMIN/WEB would then never refresh (`now >= NaN` is false), STORE/RIDER would store `NaN`.
- RIDER rejects the response unless both `experience` and `hehe` are truthy (`public-access-token.service.ts:181-183`). STORE ignores the response unless `typeof experience === "string"` (`:186-187`).
- `excellence`, `topgun`, `skydiver`, `rider`, `haha`, `huhu`, `yoyo`, `turu`: requested but never read by any client. They are decoys. They must exist in the schema as leaf (scalar) fields or the document fails validation. Upstream types are **UNVERIFIED**; nullable `String` satisfies every client.

### 2.3 Nonce generation (the "fingerprint")

| App            | Format                                                                                                  | Source                                         | Storage                                                                          | Rotation                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ADMIN, SVADMIN | 16 random bytes as 32 lowercase hex                                                                     | `security.ts:12-16` (`crypto.getRandomValues`) | localStorage `_px3k9`                                                            | removed by `clearMetricsData()`; re-created on first `getNonce()`/`initializeNonce()` |
| WEB            | 32 lowercase hex                                                                                        | `security.ts:15-19`                            | localStorage `@enatega/<mode>/_px3k9`                                            | cleared on session invalidation (`auth.ts:90`)                                        |
| APP            | `${Device.modelId \|\| Device.osInternalBuildId \|\| 'unknown'}-${Date.now()}-${Crypto.randomUUID()}`   | `src/utils/publicAccessToken.js:13-20`         | AsyncStorage `_device_fp_id:<encodeURIComponent(graphqlUrl)>` (`:5-11`)          | never rotated (only token/expiry are cleared, `:60-65`)                               |
| STORE          | `${Device.osBuildId \|\| Device.osInternalBuildId \|\| ""}-${Date.now().toString(36)}-${32 hex}`        | `public-access-token.service.ts:115-123`       | SecureStore `dev_meta_id.<scope>` (`:27-31`, `:90-93`)                           | cleared by `reset()` (login, public-proof retry)                                      |
| RIDER          | `${Device.osBuildId \|\| Device.osInternalBuildId \|\| "unknown"}-${Date.now().toString(36)}-${32 hex}` | `public-access-token.service.ts:112-121`       | SecureStore `_device_fp_id.<scope>` (`lib/utils/constants/local-storage.ts:3-5`) | cleared only by `clearTokens()`                                                       |

STORE/RIDER `<scope>` is `${mode}:${GRAPHQL_URL}` with every char outside `[A-Za-z0-9._-]` replaced by `_` (STORE `app/_layout.tsx:51-58`, RIDER `app/_layout.tsx:73`). Example: `usr_prf_cache.MULTI_http___localhost_4100_graphql`.

Device-derived prefixes (`osBuildId`, `modelId`) can contain dots, commas, spaces and may be empty (STORE nonce can start with `-`). The server must treat the nonce as an opaque string; do not validate hex format.

### 2.4 How each client obtains and attaches the token

ADMIN / SVADMIN (`useSetApollo.tsx:146-201`)

- Request: raw `fetch POST ${serverUrl}graphql`, headers `Content-Type: application/json`, `nonce: <nonce or "">`, `x-platform: web`, `X-Client-Type: web`; body `{"query": print(METRICS_GENERAL)}` (no `operationName`, no `variables`, no `authorization`, no `bop-auth`).
- Failure if `!response.ok` or `errors` present (`:173-178`) - logged, returns null.
- If the nonce changed while in flight, result is discarded (`:183-185`).
- Stores token, expiry, `Date.now()`, and the nonce used (`security.ts:49-57`).
- When: on mount if `shouldRefreshToken()` (`:284-288`); before every non-`MetricsGeneral` operation if `shouldRefreshToken()` (`:366-368`); before refresh-token calls (`:216-218`).
- `shouldRefreshToken()` (`security.ts:63-93`): true if no token/expiry; if token nonce differs from current nonce; if expired; if within 10 000 ms of expiry and last refresh at least 5 000 ms ago.
- Retry on metrics auth error: clear metrics data, new nonce, re-mint, replay once (`useSetApollo.tsx:390-438`; context key `metricsTokenRetry`). ADMIN checks both `next` results and errors; SVADMIN only errors (`SVADMIN useSetApollo.tsx:413-430`).

WEB (`useSetApollo.tsx:55-92`)

- Request: raw `fetch POST <graphqlUrl>`, headers only `Content-Type: application/json` and `nonce`; body `{"query": print(METRICS_GENERAL)}`.
- No `!response.ok` check; any failure returns null.
- When: before every non-`MetricsGeneral` operation if `shouldRefreshToken(mode)` (`:195-200`) (same rules as ADMIN minus the token-nonce check).
- No retry on server rejection. A rejected but unexpired token stays in use until `hehe` passes.

APP (`src/services/publicAcccessService.js`)

- Request: separate `ApolloClient` with `createHttpLink({ uri: graphqlUrl, headers: { 'user-agent': 'EnategaApp/<os>', 'accept-language': 'en-US', 'x-platform': <os>, nonce } })`, `client.mutate({ mutation: METRICS_GENERAL })`, 10 000 ms abort (`:44-95`). Apollo sends `operationName: "MetricsGeneral"`.
- Stores token/expiry in AsyncStorage `_sys_cache_v2:<scope>` / `_session_ttl:<scope>` (`publicAccessToken.js:5-9`, `:32-37`).
- Expired when `new Date(expiry) - 15000 <= now` (`publicAccessToken.js:52-58`).
- Proactive timer: refresh at `expiry - 30000` ms (min 1000 ms) (`publicAcccessService.js:19`, `:26-42`); started at app start and on every return to foreground (`App.js:166-180`).
- Retry on error (`src/apollo/index.js:280-318`): if any GraphQL error message matches `/unauthorized|unauthenticated|jwt expired|invalid token|forbidden/i` and the user-session branch did not fire, re-mint and replay once (context `publicTokenRetried`); second failure shows `i18n.t('sessionRefreshFailed')`.

STORE (`lib/services/public-access-token.service.ts`)

- Request: through the main Apollo client with context headers `nonce`, `x-platform`, `accept-language`, `user-agent: Enatega-Store-App/<os>`, `x-skip-public-auth: "true"`, `fetchPolicy: "no-cache"` (`:165-179`). Stored `authorization` is also sent.
- Expiry stored as ms in SecureStore `sess_ttl_ts.<scope>`; token `usr_prf_cache.<scope>`; nonce `dev_meta_id.<scope>` (`:27-31`).
- Expired when `now >= expiry` (no skew) (`:146-149`); proactive timer at `expiry - 30000` (min 1000) (`:95-113`).
- Initialised before the UI renders (`app/_layout.tsx:47-79`; UI waits for `isTokenReady`).
- Retry: in `errorLink` (`lib/apollo/index.ts:198-234`) only when `PUBLIC_ACCESS_REQUIRED`, the request had **no** `authorization`, was not `x-skip-public-auth`, and (codes `TOKEN_EXPIRED`/`INVALID_TOKEN`/`UNAUTHENTICATED` or message contains `public proof`, `fingerprint`, `invalid token`, `unauthorized`): `reset()` (clear nonce+token, new nonce, re-mint) and replay once (`hasRetriedPublicProof`).
- WS `connectionParams` also include `nonce` and `bop-auth` (`index.ts:109-119`).

RIDER (`lib/services/public-access-token.service.ts`)

- Same pattern as STORE (`:151-212`), user-agent `Enatega-Rider-App/<os>`, keys `_sys_cache_v2.<scope>`, `_device_fp_id.<scope>`, `_session_ttl.<scope>`; timer at `expiry - 30000` (`:40`, `:128-149`).
- No foreground retry on server rejection.
- Background location task (`lib/services/background-location.ts:37-115`): raw `fetch POST graphqlUrl` with `Content-Type`, `authorization: Bearer <token>`, `x-platform`, `accept-language`, `user-agent`, `bop-auth` (if stored), `nonce` (if stored); mutation `BackgroundRiderLocation` calling `updateRiderLocation(latitude: String!, longitude: String!, accuracy: Float, heading: Float, speed: Float, deviceTimestamp: String) { _id }`. If the response has any `errors` and a nonce is stored, it mints a new token with the same nonce (`BackgroundPublicToken`) and retries once. The public token and nonce are persisted in plaintext AsyncStorage `rider.background-location.config.v1` (`:9`, `:107`, `:137`).

### 2.5 Server specification for `metricsGeneral` (derived)

S1. Schema: `type Mutation { metricsGeneral: <Type>! }` where `<Type>` has leaf fields `excellence, topgun, experience, skydiver, rider, haha, hehe, huhu, yoyo, turu`. `experience: String!`, `hehe: String!` (ISO-8601 UTC). Other eight fields: any scalar, may be null (types UNVERIFIED upstream).

S2. Callable without `authorization` and without `bop-auth`. Must ignore `authorization` if present (STORE/RIDER send it). Must not require `operationName` (ADMIN/WEB send none; RIDER background sends `BackgroundPublicToken`). Must tolerate header `x-skip-public-auth: true`.

S3. Required input: header `nonce`, non-empty. Treat as opaque; accept any printable string including spaces, dots, commas, leading `-`; recommended limit 1..512 chars, reject control characters. ADMIN/WEB send `nonce: ""` only when storage is unavailable (SSR); respond with the missing-nonce error.

S4. Token: signed (HMAC/JWT) and bound to the exact nonce string (claim). Expiry `hehe` equals token expiry. TTL must be comfortably larger than the 30 s client refresh buffer (APP/STORE/RIDER refresh at `expiry - 30 s`, minimum 1 s; a TTL <= 30 s causes a refresh every second). Recommended TTL >= 10 minutes (exact upstream TTL UNVERIFIED).

S5. Re-minting for an existing nonce must be allowed and must not revoke earlier unexpired tokens (APP never rotates its nonce; STORE/RIDER reuse it on timer refresh; WEB tabs share one nonce; RIDER background re-mints with the same nonce while the foreground token is still in use).

S6. Signing key must persist across server restarts. WEB and RIDER (foreground) never retry on rejection; a key rotation leaves them failing until their stored `hehe` passes.

S7. Validation on other HTTP GraphQL operations (if the gate is enforced): read `bop-auth` (`Bearer <token>`; empty string means missing) and `nonce`; verify signature, expiry and `claim.nonce === header nonce`. Do **not** bind to `user-agent`, `x-platform`, `X-Client-Type`, `accept-language`, `authorization`, IP or Origin:

- WEB's metrics fetch sends no `X-Client-Type`/`x-platform` but its operations send `X-Client-Type: web`.
- APP sends `accept-language: en-US` over HTTP but `i18n.language` over WS.
- Browser UA changes on browser auto-update.

S8. Do not require `bop-auth`/`nonce` on the WebSocket `connection_init` (ADMIN, SVADMIN, WEB, APP never send them, section 3). Do not require them on REST `/maps/*`, `/stripe/*`, `/paypal`, `/media/*` (no client sends them there; the WEB reverse-geocode proxy calls from the Next server with no headers).

S9. Rejection response (chosen so that every client's matcher recognises it as a public-access failure and none logs the user out; see 3.4):

- HTTP status **403** (not 401: APP and STORE log out on 401 when a user token is present; not 200: SVADMIN only retries on the error path).
- Body `{"data": null, "errors": [{"message": "<msg>", "extensions": {"code": "PUBLIC_ACCESS_DENIED"}}]}`. `PUBLIC_ACCESS_DENIED` is our own code (upstream code UNVERIFIED); it must **not** be `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN` or `FORBIDDEN` (those trigger logouts in APP/STORE/RIDER/ADMIN).
- Messages (all start with `Unauthorized: ` so APP regex `/unauthorized/i`, STORE `includes("unauthorized")`, RIDER `startsWith("unauthorized:")` match; ADMIN substrings in `useSetApollo.tsx:75-86`):

| Condition                   | Exact message                        |
| --------------------------- | ------------------------------------ |
| `bop-auth` missing or empty | `Unauthorized: token missing`        |
| `nonce` missing or empty    | `Unauthorized: nonce header missing` |
| bad signature / malformed   | `Unauthorized: invalid token`        |
| expired                     | `Unauthorized: jwt expired`          |
| nonce claim != header       | `Unauthorized: fingerprint mismatch` |

Notes: ADMIN's user-session check `message.trim().toLowerCase() === 'invalid token'` (`useSetApollo.tsx:108-116`) does not match `Unauthorized: invalid token`, so it is safe. Body must be JSON (RIDER background and ADMIN call `response.json()`).

S10. `metricsGeneral` itself: return HTTP 200 with data on success; on missing nonce use the S9 shape with `Unauthorized: nonce header missing`.

---

## 3. Error / status contract seen by clients (derived)

### 3.1 Exact strings and codes the clients key off

| App           | File:line                                   | Matcher                                                                                                                                                   | Effect                                               |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| ADMIN/SVADMIN | `useSetApollo.tsx:75-86` (SV `:82`)         | message (lowercased) includes `fingerprint mismatch`, `nonce header missing`, `token missing`, `unauthorized: invalid token`, `unauthorized: jwt expired` | clear metrics, new nonce, re-mint, replay once       |
| ADMIN/SVADMIN | `:101-106` (SV `:108`)                      | code `TOKEN_EXPIRED` or message includes `access token expired`                                                                                           | refresh-token flow, replay once; then logout         |
| ADMIN/SVADMIN | `:108-116` (SV `:115`)                      | code `INVALID_TOKEN` or message exactly `invalid token`                                                                                                   | logout to `/authentication/login`                    |
| ADMIN         | `lib/context/global/user-context.tsx:57-67` | `graphQLErrors` code in `UNAUTHENTICATED`, `FORBIDDEN`, `TOKEN_EXPIRED`, `INVALID_TOKEN` (OwnerSession)                                                   | clear session                                        |
| WEB           | `useSetApollo.tsx:161-171`                  | `error.graphQLErrors` code `TOKEN_EXPIRED` or `INVALID_TOKEN`                                                                                             | logout to `/auth/login` (may never fire, UNVERIFIED) |
| APP           | `src/apollo/index.js:246-278`               | (has user token) code in `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN` or HTTP 401                                                                  | logout + session-expired modal                       |
| APP           | `:255-256`, `:284-318`                      | message `/unauthorized\|unauthenticated\|jwt expired\|invalid token\|forbidden/i`                                                                         | re-mint public token, replay once                    |
| STORE         | `lib/apollo/index.ts:175-243`               | see 2.4 / 1.5                                                                                                                                             | public retry (no user auth) or logout (user auth)    |
| STORE         | `lib/hooks/useLogin.ts:56-66`               | message includes `incorrect password` / `user not found`                                                                                                  | shows `Invalid credentials`                          |
| RIDER         | `lib/utils/session.ts:37-79`                | see 1.6                                                                                                                                                   | logout (only with user auth)                         |

### 3.2 Where GraphQL errors surface in Apollo links (UNVERIFIED against installed library)

Apollo Client 3.x `HttpLink` turns any HTTP status >= 300 into a `ServerError` on the observable error path with the parsed body in `.result`; HTTP 200 + `errors` is delivered on the `next` path. `onError` (APP, STORE, RIDER) passes `networkError.result.errors` as `graphQLErrors` for non-2xx responses. Consequences:

- ADMIN/SVADMIN `errorLink` (custom, error path only): user-token refresh fires only for non-2xx responses. ADMIN `getGraphQLErrors` reads `.result.errors` (`useSetApollo.tsx:52-73`).
- ADMIN `user-context` `isAuthFailure` reads `ApolloError.graphQLErrors`, which is empty for `ServerError` - fires only on HTTP 200.
- WEB `errorLink` reads `error.graphQLErrors`, which a `ServerError` does not have.

### 3.3 Recommended server responses for user-session failures

| Condition                            | HTTP | `extensions.code` | message                                                                                                                                         |
| ------------------------------------ | ---- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| expired user JWT                     | 401  | `TOKEN_EXPIRED`   | `Access token expired`                                                                                                                          |
| invalid/unsigned user JWT            | 401  | `INVALID_TOKEN`   | `Invalid token`                                                                                                                                 |
| no user JWT on a protected operation | 401  | `UNAUTHENTICATED` | `Unauthenticated`                                                                                                                               |
| authenticated but not permitted      | 403  | `FORBIDDEN`       | `Forbidden` (note: ADMIN `OwnerSession` treats FORBIDDEN as logout only on HTTP 200 path; RIDER treats it as logout only for operation `rider`) |

401 makes ADMIN refresh (error path), APP/STORE log out, RIDER log out via code. Trade-off: ADMIN `OwnerSession` bootstrap only clears on HTTP 200 codes; with 401 the ADMIN errorLink handles `TOKEN_EXPIRED`/`INVALID_TOKEN` instead (after refresh fails). Verify both paths in E2E before finalising.

### 3.4 Why public-access failures should be 403 (not 401, not 200)

| Status       | ADMIN             | SVADMIN      | WEB      | APP                                             | STORE                   | RIDER                                   |
| ------------ | ----------------- | ------------ | -------- | ----------------------------------------------- | ----------------------- | --------------------------------------- |
| 200 + errors | retry (next path) | **no retry** | no retry | retry                                           | retry (no user auth)    | none                                    |
| 401 + errors | retry             | retry        | no retry | **logout if user token**                        | **logout if user auth** | none (message `unauthorized:` excluded) |
| 403 + errors | retry             | retry        | no retry | retry (RetryLink also retries queries 3x first) | retry (no user auth)    | none                                    |

STORE never retries public-access failures for logged-in requests (`index.ts:198-202`), so stability of the token (S4-S6) matters more than the retry path.

---

## 4. WebSocket link

All six use `subscriptions-transport-ws` 0.11.0 (`SubscriptionClient` / `WebSocketLink` from `@apollo/client/link/ws`). Server must speak the **legacy subscriptions-transport-ws protocol** (WebSocket subprotocol `graphql-ws`; messages `connection_init` (payload = connectionParams), `connection_ack`, `ka`, `start`, `data`, `error`, `complete`, `stop`, `connection_terminate`). The newer `graphql-ws` library protocol (subprotocol `graphql-transport-ws`) is incompatible. (`graphql-ws` is listed in STORE dependencies but not used by its Apollo setup.)

| App     | URL                                                                                  | Options                                                                       | `connectionParams` (exact keys)                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN   | `${NEXT_PUBLIC_WS_SERVER_URL}graphql` (`:311`)                                       | `reconnect: true`, `timeout: 30000`, `lazy: true` (`:311-318`)                | `{ authorization: "Bearer <token>" \| "" }`                                                                                                                                        |
| SVADMIN | `${WS_SERVER_URL}graphql` (`:325-334`)                                               | same                                                                          | same                                                                                                                                                                               |
| WEB     | `getModeEnvironment(mode).websocketUrl` (`:138-149`)                                 | `reconnect: true`, `timeout: 30000`, `lazy: true`, `inactivityTimeout: 30000` | `{ authorization }`                                                                                                                                                                |
| APP     | `WS_GRAPHQL_URL` (`src/apollo/index.js:169-193`)                                     | `reconnect: true`, `lazy: true`                                               | `{ authorization, 'x-platform': Platform.OS, 'accept-language': i18n.language \|\| 'en', 'user-agent': 'EnategaApp/<os>' }` (async; expired JWT -> `authorization: ""` and logout) |
| STORE   | `WS_GRAPHQL_URL` (`lib/apollo/index.ts:84-124`)                                      | `reconnect: true`, `lazy: true`, `timeout: 30000`                             | `{ authorization, 'x-platform', 'accept-language', 'user-agent': 'Enatega-Store-App/<os>', nonce, 'bop-auth' }` (nonce/bop-auth only if PUBLIC_ACCESS_REQUIRED)                    |
| RIDER   | `WS_GRAPHQL_URL` (`lib/apollo/index.ts:148-184`), `WebSocket` impl passed explicitly | `reconnect: true`, `lazy: true`, `connectionCallback` logs in dev             | `{ authorization, 'x-platform', 'accept-language', 'user-agent': 'Enatega-Rider-App/<os>', 'bop-auth', nonce }`                                                                    |

Semantics:

- `lazy: true`: socket opens on first subscription only.
- `timeout: 30000`: keep-alive timeout; per subscriptions-transport-ws it applies only after the server has sent a `ka`. If the server sends `ka`, it must send them at intervals < 30 s or the client drops and reconnects (UNVERIFIED against installed library).
- `reconnect: true`: unlimited attempts with library default backoff (UNVERIFIED).
- `connectionParams` is evaluated on every (re)connect.
- `authorization` is `""` (not absent) for guests; the server must accept anonymous sockets and enforce auth per subscription.
- APP disposes sockets on mode change (`client.dispose`, `src/apollo/index.js:349-356`); STORE `disposeModeClient` (`:278-302`); RIDER `dispose` (`:267-273`); ADMIN closes on unmount (`:289-293`).

---

## 5. Non-GraphQL HTTP calls to our backend

### 5.1 Google Maps proxy (`/maps/*`)

All return an envelope `{ "success": boolean, "error": { "code": string, "message": string } | null, "data": <payload> | null }`. APP reads `response.data.data` (axios) and on HTTP errors uses `error.response.data.error.message` (`src/api/googleMapsProxy.js:15-33`). Base URL: APP `SERVER_REST_URL` with trailing `/` stripped, then `/maps<path>` (`:5-13`); 10 000 ms timeout. No auth, no `bop-auth` headers are sent.

`GET /maps/reverse-geocode?latitude=<n>&longitude=<n>&language=en`

- Callers: ADMIN browser `fetch` with `Accept: application/json`, `cache: 'no-store'` (`V/enatega-multivendor-admin/lib/api/google-maps.ts:27-40`); WEB Next route `app/api/maps/reverse-geocode/route.ts:27-44` (server-side, no headers, 10 s timeout, forwards body and status unchanged); APP axios (`googleMapsProxy.js:79-99`).
- WEB browser calls its own route `GET /api/maps/reverse-geocode?mode=<MULTI|SINGLE>&latitude&longitude&language=en` (`lib/api/google-maps.ts:23-31`); the route validates lat in [-90,90], lng in [-180,180] (400 `{"success":false,"error":{"code":"REVERSE_GEOCODE_FAILED","message":"Valid coordinates are required."}}`) and maps fetch exceptions to 502 with the same code (`route.ts:4-8`, `:16-25`, `:45-50`).
- `data`: `{ "status": "OK" | "ZERO_RESULTS" | <other>, "errorMessage": string | null, "formattedAddress": string | null, "city": string | null }` (ADMIN `google-maps.ts:1-13`, WEB `lib/api/google-maps.ts:3-12`).
- ADMIN/WEB throw unless `response.ok && payload.success && payload.data` (message `payload.error?.message || 'Unable to fetch address.'`). APP (`src/ui/hooks/useGeocoding.js:21-32`): success needs `status === 'OK' && formattedAddress`; `ZERO_RESULTS` -> "No address found for the given coordinates."; else `errorMessage`.

`GET /maps/autocomplete?input=<text>&language=en&types=geocode` (APP only, `googleMapsProxy.js:35-57`)

- `data`: `{ "status": "OK" | "ZERO_RESULTS" | "REQUEST_DENIED" | <other>, "errorMessage"?: string, "predictions": [ { "id": string, "placeId": string, "description": string, "mainText": string } ] }`.
- Fields used: `status`, `predictions`, `errorMessage` (`src/components/Address/SearchModal.js:198-226`); `item.description`, `item.id` (keyExtractor), `place.placeId` (`:313`, `:346`, `:477`); single-vendor also `item.mainText` and key `item.id || item.placeId` (`src/singlevendor/components/AddAddress/SearchingAddress.js:38-41`, `:132`).
- `REQUEST_DENIED` shows an alert "Location search access denied. Please check your backend Maps configuration."

`GET /maps/place-details?placeId=<id>&language=en` (APP only, `googleMapsProxy.js:59-77`)

- `data`: `{ "status": "OK", "result": { "geometry": { "location": { "lat": number, "lng": number } }, "formatted_address": string, "name": string } }` (`SearchModal.js:261-279`, `src/singlevendor/screens/AddAddress/useAddAddress.js:293-311`). Anything else -> null / "Unable to get coordinates for this location".

CORS: ADMIN calls `/maps/reverse-geocode` directly from the browser (GET with only `Accept`: a CORS simple request; response needs `Access-Control-Allow-Origin`).

### 5.2 Stripe / PayPal

| #   | Caller                                                                                                   | Request                                                                                                                                                                                                           | Expected response / redirect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | ADMIN restaurant payment (`lib/ui/screen-components/protected/restaurant/payment/main/index.tsx:52-78`)  | `POST ${SERVER_URL}stripe/account`, headers `Content-Type: application/json` only (no `Authorization`), body `{"restaurantId": "<id>"}`                                                                           | JSON `{ "url": "https://<stripe.com or *.stripe.com>/..." }`; client `window.location.assign(url)`; anything else -> toast "Error connecting to Stripe" (`:36-50`)                                                                                                                                                                                                                                                                                                                                                                                                        |
| P2  | SVADMIN same screen (`.../payment/main/index.tsx:48-66`)                                                 | same, plus `Authorization: Bearer <token>`                                                                                                                                                                        | JSON `{ url }` (https stripe host); on failure reads `message` or `error` (also handles non-JSON text)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3  | WEB multi checkout (`lib/ui/screens/protected/order/checkout/index.tsx:790-815`)                         | browser navigation (`router.replace`) to `new URL("stripe/create-checkout-session?id=<placeOrder.orderId>&platform=web", restUrl)`; no headers                                                                    | server should redirect to Stripe Checkout. Return pages exist in WEB: `/stripe/success` (reads `id` \| `orderId` \| `reference`, else `localStorage.pending_stripe_order_id`; polls `ORDERS` (or `SINGLE_VENDOR_ACTIVE_ORDERS`) every 3000 ms up to 60 000 ms, `stripe-success/index.tsx:23-59`, `:93-140`), `/stripe/cancel`, `/stripe/pending?orderId=` (`app/(localized)/stripe/*/page.tsx`)                                                                                                                                                                           |
| P4  | WEB multi PayPal (`checkout/index.tsx:783-789`)                                                          | `router.replace('/paypal?id=<placeOrder._id>')`                                                                                                                                                                   | **No `/paypal` route exists in WEB `app/`** (find returns none) - upstream dead route; integration blocker if PayPal is enabled                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P5  | WEB single-vendor (`lib/ui/single-vendor/Checkout.tsx:136-157`)                                          | `POST ${restUrl}stripe/create-web-checkout-session`, headers `Content-Type: application/json`, `Authorization: Bearer <token>`, body `{"id": "<order._id>", "payment_method": "paypal" \| "card"}`                | JSON `{ "checkoutUrl": "<url>" }` (else `{ "error": "<msg>" }`); `window.location.assign(checkoutUrl)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P6  | APP Stripe WebView (`src/screens/Stripe/StripeCheckout.js:136-145`, `:162-185`)                          | `GET ${SERVER_REST_URL}stripe/create-checkout-session?id=<orderId>` with header `Authorization: Bearer <multi token>`                                                                                             | URL containing `stripe/success` -> polls `myOrders` every 3 s for `paymentStatus === 'PAID'` or `paidAmount > 0` (`:96-130`); URL containing `stripe/cancel` -> back. Navigation allowed only to hosts `checkout.stripe.com, js.stripe.com, api.stripe.com, hooks.stripe.com, stripe.com, stripe.network, m.stripe.network, q.stripe.com, b.stripecdn.com` (+subdomains) or the backend host (`:43-53`, `:168-176`). Therefore Stripe `success_url`/`cancel_url` must be on the backend host, e.g. `<backend>/stripe/success?...`, and the backend must serve those pages |
| P7  | APP PayPal WebView (`src/screens/Paypal/Paypal.js:119-129`, `:139-155`)                                  | `GET ${SERVER_URL}paypal?id=<orderId>` where `SERVER_URL` is the **GraphQL URL** (`environment.config.js:10`), producing e.g. `https://host/graphqlpaypal?id=...`                                                 | detects `paypal/success` / `paypal/cancel`; allowed hosts `paypal.com, www.paypal.com, sandbox.paypal.com, www.sandbox.paypal.com, paypalobjects.com, www.paypalobjects.com` + backend host. Upstream URL-concatenation defect; integration blocker if PayPal is enabled (a config value cannot fix it without breaking GraphQL; needs a recorded transport edit)                                                                                                                                                                                                         |
| P8  | APP single-vendor (`src/singlevendor/screens/Checkout/SingleVendorPaymentCheckout.js:62-76`, `:134-171`) | `GET new URL('stripe/create-checkout-session', SERVER_REST_URL)` with `id=<order _id param>` and `payment_method=<card \| ...>`, header `Authorization: Bearer <single token>`; `originWhitelist={['https://*']}` | `stripe/success` / `stripe/cancel`, plus subscription `subscriptionPaymentSuccess` matching `orderId`; allowed hosts `checkout.stripe.com, js.stripe.com, api.stripe.com, stripe.com, stripe.network, stripecdn.com, paypal.com, paypalobjects.com` + backend host (`:21-31`). `https://*` whitelist means an `http://` backend will not load (UNVERIFIED exact WebView behaviour)                                                                                                                                                                                        |

### 5.3 Media

- WEB `lib/utils/media-url.ts:21-58` and SVADMIN `lib/utils/media.ts:8-29`: values `public-media/<key>` and any URL whose path is `/media/<key>` are rewritten to `<configured REST/server base>/media/<key>`. The backend must serve `GET /media/<key>`.
- APP `src/utils/signedMediaUrl.js` inspects CloudFront/S3 signed-URL expiry params (`Expires`, `Policy`, `X-Amz-Date`/`X-Amz-Expires`); informational.
- `uploadImageToS3(image: String!)` is GraphQL (ADMIN `lib/api/graphql/mutations/upload/index.ts:5`; SVADMIN adds `publicMedia` arg), not REST.
- `lib/services/cloudinary.ts` in ADMIN/SVADMIN posts directly to a Cloudinary URL; no caller of `uploadImageToCloudinary(` was found in ADMIN.

### 5.4 Browser CORS requirements (derived)

Origins: the dev origins of ADMIN, SVADMIN, WEB (e.g. `http://localhost:3000..3002`). Apollo default `credentials: 'same-origin'`, so no cookies are sent cross-origin (no `Allow-Credentials` needed unless we add cookies). Preflight `Access-Control-Allow-Headers` must include: `content-type, authorization, nonce, bop-auth, userid, isauth, x-client-type, x-platform, accept`. Methods: `GET, POST, OPTIONS`.

---

## 6. Server URL configuration and minimal edits for `http://localhost:4100/graphql` and `ws://localhost:4100/graphql`

### 6.1 Per-app configuration

ADMIN (env only; no code edit)

```dotenv
# V/enatega-multivendor-admin/.env.local
NEXT_PUBLIC_SERVER_URL=http://localhost:4100/
NEXT_PUBLIC_WS_SERVER_URL=ws://localhost:4100/
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=            # browser Maps JS key (useConfiguration.tsx:28)
NEXT_PUBLIC_SINGLE_VENDOR_ADMIN_URL=http://localhost:3002/   # else header link -> enatega-singlevendor-admin.netlify.app
NEXT_PUBLIC_ADMIN_EMAIL=                     # optional login prefill (sign-in-email-password/index.tsx:47-48)
NEXT_PUBLIC_ADMIN_PASSWORD=
NEXT_PUBLIC_ENCRYPTION_KEY=                  # only used by decrypt(); decryptConfigFields is exported but never imported
```

Trailing `/` required, no `graphql` suffix (`useSetApollo.tsx:308`, `:311`, `:159`, `:221`; REST `${SERVER_URL}stripe/account`).

SVADMIN (env only)

```dotenv
NEXT_PUBLIC_SERVER_URL=http://localhost:4100/
NEXT_PUBLIC_WS_SERVER_URL=ws://localhost:4100/
NEXT_PUBLIC_GOOGLE_MAPS_KEY=                 # falls back to configuration.googleApiKey (useConfiguration.tsx:31-32)
NEXT_PUBLIC_MULTIVENDOR_ADMIN_URL=http://localhost:3000/     # else -> multivendor-admin-backup.netlify.app
NEXT_PUBLIC_SINGLE_VENDOR_WEB_URL=
NEXT_PUBLIC_SINGLE_VENDOR_ADMIN_DEMO_EMAIL=  # else dev default admin@fastfresh.com / Admin@12345 (sign-in .../index.tsx:48-52)
NEXT_PUBLIC_SINGLE_VENDOR_ADMIN_DEMO_PASSWORD=
# CSP_ENFORCE unset -> CSP is report-only (middleware.ts:24-29)
```

`netlify.toml:8-9` hard-codes railway URLs for Netlify builds (not used locally). Production build refuses non-https/wss (`next.config.mjs:24-32`).

WEB (env, plus a likely-required CSP config edit)

```dotenv
NEXT_PUBLIC_SERVER_URL=http://localhost:4100/
NEXT_PUBLIC_WS_SERVER_URL=ws://localhost:4100/
NEXT_PUBLIC_VENDOR_MODE=MULTI                 # disables mode toggle; see section 7
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_EMAILJS_SERVICE_ID=
NEXT_PUBLIC_EMAILJS_PUBLIC_KEY=
```

CSP blocker: `next.config.mjs:29-43` sends an enforced `Content-Security-Policy` with `connect-src 'self' https: wss: ws:` and `upgrade-insecure-requests` for every route (`:55-63`), also under `next dev`. A browser `fetch` to `http://localhost:4100/graphql` from origin `http://localhost:3000` is not allowed by `'self'` or `https:`. Unless browsers exempt localhost from `upgrade-insecure-requests` (UNVERIFIED), the minimal fix is a recorded configuration edit to `next.config.mjs` adding the configured API origins (`http://localhost:4100`, `ws://localhost:4100`) to `connect-src` and omitting `upgrade-insecure-requests` outside production; alternative without editing: serve the API over `https://localhost:4100` / `wss://` with a trusted dev certificate. `img-src` lacks `http:`, but `next/image` fetches server-side and `configuredApiImagePatterns` already admits the API host (`:5-27`).

APP (code edit required - record in `SOURCE_PROVENANCE.json`)

- Edit `V/enatega-multivendor-app/environment.config.js:8-11` (and `:23-26`, `:38-41` if staging/production channels are used): `GRAPHQL_URL`, `WS_GRAPHQL_URL`, `SERVER_URL` (= GraphQL URL), `SERVER_REST_URL` (base with trailing `/`). Preferably replace the literals with `process.env.EXPO_PUBLIC_*` reads (configuration-only change) and fail closed when missing.
- Device reachability: `localhost` is the device itself. Use `adb reverse tcp:4100 tcp:4100` (Android) or the host LAN IP; iOS simulator can use `localhost`. Android release builds may block cleartext `http://` (UNVERIFIED for this config; debug builds normally allow it).
- `.env` (Expo inlines `EXPO_PUBLIC_*`):
  ```dotenv
  EXPO_PUBLIC_VENDOR_MODE=MULTI      # or set the three SINGLE_VENDOR URLs to our backend; see section 7
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
  EXPO_PUBLIC_GOOGLE_IOS_REVERSED_CLIENT_ID=
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID=
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS=
  ```
  (from `environment.js.example`).

STORE (code edit required - record)

- Edit `V/enatega-multivendor-store/environment.ts:10-11` (`GRAPHQL_URL`, `WS_GRAPHQL_URL`) or replace with env reads. `.env`: `EXPO_PUBLIC_VENDOR_MODE=MULTI` (or SINGLE URLs pointed at our backend).

RIDER (env only)

```dotenv
EXPO_PUBLIC_GRAPHQL_URL=http://localhost:4100/graphql
EXPO_PUBLIC_WS_GRAPHQL_URL=ws://localhost:4100/graphql
EXPO_PUBLIC_VENDOR_MODE=MULTI
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID=
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS=
```

(`environment.ts:10-17`; app.config also reads `IOS_GOOGLE_MAPS_API_KEY`, `ANDROID_GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_API_KEY`, `app.config.js:1-8`.)

### 6.2 Hard-coded upstream URLs (all must be neutralised or confirmed unused)

Backend endpoints

- `V/enatega-multivendor-admin/lib/utils/constants/url.ts:3-12` aws-server-v2 / backup-server (unused).
- `V/enatega-singlevendor-admin/lib/utils/constants/url.ts:3-12` railway (BACKEND_URL; unused per grep); `netlify.toml:8-9` railway.
- `V/enatega-multivendor-app/environment.config.js:8-45` aws-server-v2 / backup-server; `:56-57` `SINGLE_VENDOR_DEFAULT_HOST = 'enatega-multivendor-api-production-9b09.up.railway.app'` used when SINGLE env vars are absent (`:78-87`); `eas.json:32-34` railway for production profile.
- `V/enatega-multivendor-store/environment.ts:10-13`, `:30`, `:36`; `eas.json:26-27`.
- `V/enatega-multivendor-rider/environment.ts:12-17`, `:27`, `:34`; `eas.json:26-27`.
- Scripts (not runtime): `V/enatega-multivendor-web/scripts/check-single-vendor-schema.js:8`, `V/enatega-multivendor-app/scripts/check-single-vendor-schema.js:19`, `V/enatega-multivendor-store/scripts/check-single-vendor-schema.js:12`, `V/enatega-multivendor-store/scripts/check-single-vendor-store-auth.js:6-8`, `V/enatega-multivendor-rider/scripts/check-single-vendor-schema.js:12`.

OTA / telemetry endpoints with upstream identities

- APP `app.config.js:236-239` `updates.url: 'https://u.expo.dev/331d4e5b-b12a-434a-92ec-d6d283dc0e46'` and `extra.eas.projectId`; `App.js:292-300` calls `Updates.checkForUpdateAsync()` in non-dev builds: a release build could download the upstream OTA bundle. Must be reconfigured before any release build.
- RIDER `lib/utils/service/sentry.ts:7-16`: `Sentry.init` with hard-coded upstream DSN `https://9303b1d33deae903abe4e00ea9f25467@o4507787652694016.ingest.us.sentry.io/4508759522017280`, called at module load (`app/_layout.tsx:48`), not config-gated. Sends crash data to upstream Sentry. Also `app.config.js:64-70` Sentry plugin org `ninjas-code`.
- Microsoft Clarity hard-coded project ids: ADMIN `app/layout.tsx:28-37` (`tjqxrz689j`), SVADMIN `app/layout.tsx:29-37` (`tjqxrz689j`), WEB `app/layout.tsx:64-73` (`tjqw9wn955`), APP `App.js:267-289` (`mcdyi6urgs`, gated by `CLARITY_ENABLED`, which is `true` in every MULTI block and `false` in SINGLE).
- Firebase upstream web project `enatega-multivender-web` in service workers: ADMIN `public/firebase-messaging-sw.js:9-17`, SVADMIN same file, WEB `public/serviceWorker.js:17` and compiled `public/sw.js:19` (WEB registers `/sw.js` on load, `app/(localized)/ClientProviders.tsx:31-51`). `V/FAIR_INTEGRATION.md:28-32` requires these to be configuration-gated or replaced before any web app launches.
- WEB `app/layout.tsx:59-62` loads `https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js`.

Links (non-transport, informational): ADMIN `super-admin-layout/side-bar/index.tsx:66` (`https://multivendor.enatega.com/`), ADMIN app-bar/sign-in `:86`/`:53` netlify fallbacks, SVADMIN app-bar/sign-in `:86`/`:57`, APP `src/routes/index.js:84-85` deep-link prefixes, APP `Account.js:513,523` and `SecuritySettings.js:79,84` terms/privacy, RIDER/STORE drawer links, WEB footer `ninjascode.com`.

### 6.3 Third-party SDK initialisation and gating

| SDK                      | App                                                                                                 | Init / gate                                                                                                                                                                                                                                                                                  | Behaviour without keys                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Firebase web messaging   | ADMIN/SVADMIN                                                                                       | `firebase.ts:5-23` returns null if any of key/authDomain/projectId/storageBucket/msgSenderId/appId/measurementId missing                                                                                                                                                                     | safe (logs error)                                                                            |
| Firebase web messaging   | WEB                                                                                                 | `FirebaseForegroundHandler.tsx:19-29` gated on 6 keys; `NotificationInitialzer.tsx:46-68` calls `setupFirebase` without key check, but only after login and `Notification.permission === "default"` and granted                                                                              | ungated path may throw inside async handler (UNVERIFIED)                                     |
| `@react-native-firebase` | APP                                                                                                 | `index.js` -> `registerLiveActivityBackgroundHandler()` calls `messaging()` on Android at startup (`src/utils/liveActivityMessaging.js:39-44`); plugins `app.config.js:181-182`; files `./GoogleService-Info.plist`, `./google-services.json` (`:67`, `:105`) are excluded from the baseline | prebuild/build fails without the files; runtime likely throws "No Firebase App" (UNVERIFIED) |
| Firebase files           | STORE `app.json:57` android `googleServicesFile: ./google-services.json`; RIDER `app.config.js:101` | file absent                                                                                                                                                                                                                                                                                  | Android prebuild fails (UNVERIFIED exact error)                                              |
| Sentry                   | APP                                                                                                 | `src/components/Sentry/SentryInit.js` inits only if server `configuration.customerAppSentryUrl` is set (`environment.js:31`)                                                                                                                                                                 | safe                                                                                         |
| Sentry                   | RIDER                                                                                               | hard-coded DSN, unconditional                                                                                                                                                                                                                                                                | sends to upstream (blocker)                                                                  |
| Amplitude                | APP                                                                                                 | `src/utils/analytics.js:48-53` skips if no `appAmplitudeApiKey` from server configuration                                                                                                                                                                                                    | safe                                                                                         |
| Clarity                  | ADMIN/SVADMIN/WEB/APP                                                                               | unconditional (APP: `CLARITY_ENABLED`)                                                                                                                                                                                                                                                       | sends to upstream projects (blocker)                                                         |
| EmailJS                  | WEB                                                                                                 | `lib/utils/methods/helpers.ts:6-10` env ids; CDN script always loaded                                                                                                                                                                                                                        | UNVERIFIED                                                                                   |
| Google OAuth (web)       | WEB                                                                                                 | `auth.context.tsx:647` `GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID ?? "not_found"}`; client id from `configuration.webClientID` validated by regex `^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$` else `"not_found"` (`configuration.context.tsx:20`, `:47-52`)                         | renders; Google sign-in fails                                                                |
| Google Sign-In (native)  | APP                                                                                                 | `useCreateAccount.android.js:88-96` configure on screen; `App.js:96-105` only warns on invalid ids; iOS fallback URL scheme `com.googleusercontent.apps.650001300965-...` (`app.config.js:8-14`)                                                                                             | warns                                                                                        |
| Google Maps JS           | ADMIN/SVADMIN/WEB                                                                                   | `useJsApiLoader` with env key                                                                                                                                                                                                                                                                | maps fail to load (UNVERIFIED crash behaviour)                                               |
| Google Maps native       | APP/RIDER                                                                                           | keys only added if env present (`app.config.js` `config.googleMaps`)                                                                                                                                                                                                                         | Android MapView without key likely crashes (UNVERIFIED)                                      |
| Stripe RN                | APP single-vendor                                                                                   | `StripeProvider` in `src/singlevendor/routes/SingleVendorAppContainer.js:63`, `:92` with server publishable key                                                                                                                                                                              | UNVERIFIED                                                                                   |
| Expo OTA                 | APP                                                                                                 | see 6.2                                                                                                                                                                                                                                                                                      | upstream bundle risk                                                                         |

ADMIN/SVADMIN/WEB obtain Firebase/Stripe/PayPal/Amplitude/Sentry/Google ids from the GraphQL `configuration` query (ADMIN `lib/context/global/configuration.context.tsx:88-178`; WEB `lib/context/configuration/configuration.context.tsx:26-100` uses the MULTI configuration even in SINGLE mode, `:30-33`). Note ADMIN's configuration interface includes secrets (`secretKey`, `clientSecret`, `twilioAuthToken`, `sendGridApiKey`, `password`) - the server must not return provider secrets to clients (AGENTS.md); return null/empty for those fields.

---

## 7. Single-vendor mode inside the multivendor apps

| App   | Selector                                                          | Values / default                                                                                                            | SINGLE endpoints                                                                                                            | SINGLE default when unset                                                                                                                                           |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WEB   | `NEXT_PUBLIC_VENDOR_MODE` (`lib/mode/constants.ts:11-16`)         | `SINGLE`/`MULTI` force; anything else -> toggle; initial mode `MULTI` (`:8`); persisted `localStorage["@enatega/app-mode"]` | `NEXT_PUBLIC_SINGLE_VENDOR_SERVER_URL`, `NEXT_PUBLIC_SINGLE_VENDOR_WS_SERVER_URL`, `NEXT_PUBLIC_SINGLE_VENDOR_REST_URL`     | no upstream default; empty -> relative `/graphql`. SINGLE selectable in toggle mode only if `NEXT_PUBLIC_SINGLE_VENDOR_ENABLED === "true"` (`environment.ts:36-38`) |
| APP   | `EXPO_PUBLIC_VENDOR_MODE` (`src/mode/constants.js:15-25`)         | `TOGGLE` (default), `MULTI`, `SINGLE`; AsyncStorage `@enatega/app-mode`                                                     | `EXPO_PUBLIC_SINGLE_VENDOR_GRAPHQL_URL`, `_WS_GRAPHQL_URL`, `_REST_URL` (all three required, `environment.config.js:59-76`) | **railway host** (`:78-87`), and `SINGLE_VENDOR_ENABLED` is true unless `EXPO_PUBLIC_SINGLE_VENDOR_ENABLED === 'false'`                                             |
| STORE | `EXPO_PUBLIC_VENDOR_MODE` (`lib/mode/store-mode.ts:17-22`)        | `SINGLE`/`MULTI` force else toggle; default `MULTI`; AsyncStorage `@enatega/store/server-mode`                              | `EXPO_PUBLIC_SINGLE_VENDOR_GRAPHQL_URL`, `_WS_GRAPHQL_URL`                                                                  | railway (dev); release throws                                                                                                                                       |
| RIDER | `EXPO_PUBLIC_VENDOR_MODE` (`lib/mode/rider-mode.ts:22-27`)        | same; AsyncStorage `@enatega/rider/selected-server-mode`                                                                    | same two vars                                                                                                               | railway (dev); release throws                                                                                                                                       |
| ADMIN | none (links to SVADMIN via `NEXT_PUBLIC_SINGLE_VENDOR_ADMIN_URL`) | -                                                                                                                           | -                                                                                                                           | -                                                                                                                                                                   |

Critical: in APP toggle mode with no SINGLE env vars, `singleVendorAvailable` is true (`src/mode/AppModeContext.js:39-41`), and `App.js:129-148` (prewarm call at `:138`) pre-warms the SINGLE client (public token + Home data) 2 s after startup while in MULTI mode. That contacts the upstream railway backend automatically. To prevent any upstream call set `EXPO_PUBLIC_VENDOR_MODE=MULTI` (or `EXPO_PUBLIC_SINGLE_VENDOR_ENABLED=false`, or point all three SINGLE vars at our backend). STORE/RIDER only contact the SINGLE default if a user selects it; forcing `MULTI` removes the selector.

Forced mode overrides any persisted mode (`V/VENDOR_MODE_CONFIGURATION.md:91-92`; e.g. WEB `AppModeContext.tsx:53-58`).

---

## 8. Running each app locally

Common facts (all six): npm with `package-lock.json` (Next apps declare `"yarn": "Please use npm instead."`); `.nvmrc` = `v20.16.0` in every app; Next apps declare `engines.node >=20.0.0`, `npm >=10.0.0`; ADMIN and SVADMIN `.npmrc` `engine-strict=true`; WEB, APP, STORE `.npmrc` `legacy-peer-deps=true`. No `.env.example` files are present in the vendored tree (SVADMIN README `:7` references one; APP has `environment.js.example`).

Locked versions (from each `package-lock.json`): ADMIN `@apollo/client` 3.13.0, next 14.2.35; SVADMIN 3.13.0, next 14.2.5; WEB 3.14.1, next 16.2.10, graphql 16.14.2; APP 3.14.0, expo 53.0.22, react-native 0.79.5 (no react-native-web); STORE 3.14.0, expo 54.0.35, RN 0.81.5, react-native-web 0.21.2; RIDER 3.13.9, expo 53.0.27, RN 0.79.5, react-native-web 0.20.0; subscriptions-transport-ws 0.11.0 everywhere.

| App     | Install                                     | Dev command                                                                          | Port                                    | Notes                                                                                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN   | `npm ci`                                    | `npm run dev` = `cross-env NODE_OPTIONS='--inspect' next dev`                        | 3000 (`README.md:17`)                   | `--inspect` binds 9229; running several Next apps at once produces inspector port conflicts (UNVERIFIED whether fatal). Use `npm run dev -- -p 3000`. `husky` runs on `prepare`.                                                                                                                                                   |
| SVADMIN | `npm ci`                                    | `npm run dev` (same script)                                                          | 3000 default; choose `-p 3002`          | throws at render if env URLs missing (`requireBaseUrl`)                                                                                                                                                                                                                                                                            |
| WEB     | `npm ci`                                    | `npm run dev` = `cross-env NODE_OPTIONS='--inspect' next dev --webpack`              | 3000 (`README.md:17`); choose `-p 3001` | tests `npm test` (vitest). Registers `/sw.js` (Workbox caches pages/GraphQL GETs; disable/clear for Playwright). CSP blocker (6.1).                                                                                                                                                                                                |
| APP     | `npm ci` (runs `patch-package` postinstall) | `npm start` = `expo start`; native: `npm run android` / `npm run ios` = `expo run:*` | Metro 8081 (Expo default)               | Requires a development build: native modules not in Expo Go (`@react-native-firebase/*`, `@stripe/stripe-react-native`, `@microsoft/react-native-clarity`, `@react-native-google-signin/google-signin`, `@bacons/apple-targets`). Prebuild needs the excluded Firebase files. `platforms: ['ios','android']` (`app.config.js:45`). |
| STORE   | `npm ci`                                    | `npm start`; `npm run android`/`ios`; `npm run web` = `expo start --web` exists      | 8081                                    | `expo-dev-client` dependency; `react-native-thermal-printer` native; `app.json:42` `platforms: ["ios","android"]`                                                                                                                                                                                                                  |
| RIDER   | `npm ci`                                    | `npm start`; `npm run android`/`ios`; `npm run web` exists                           | 8081                                    | `expo-dev-client`; Sentry plugin; README `:36-50` uses `eas build`                                                                                                                                                                                                                                                                 |

Expo web / Playwright feasibility

| App   | react-native-web | `--web` script     | Blockers                                                                                                                                                                                                                                                                  |
| ----- | ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APP   | absent           | none               | platforms excludes web; react-native-maps, react-native-firebase, Stripe RN, WebView, SecureStore: not runnable in a browser. Native gate only.                                                                                                                           |
| STORE | present          | `expo start --web` | `platforms` excludes `web` (Expo CLI likely refuses web, UNVERIFIED); Apollo calls `expo-secure-store` directly (`lib/apollo/index.ts:15`, `:91`, `:129`), which has no web implementation (UNVERIFIED), so every request would fail; thermal printer native module.      |
| RIDER | present          | `expo start --web` | `platforms` excludes `web` (UNVERIFIED CLI behaviour); secure-storage falls back to AsyncStorage in `__DEV__` (`secure-storage.ts:40-61`), but `react-native-maps`, `expo-task-manager` background location and Sentry native are native-only (UNVERIFIED web behaviour). |

Conclusion: Playwright can drive ADMIN, SVADMIN and WEB. Expo web exports or browser smoke checks cannot satisfy native gates for APP/STORE/RIDER (AGENTS.md); those need emulator/device runs (e.g. Android emulator with `adb reverse tcp:4100 tcp:4100`).

---

## 9. Open items / UNVERIFIED summary for implementers

1. Apollo 3.x internals (ServerError vs next-path errors, `onError` graphQLErrors population) - verify after `npm ci` by reading `node_modules/@apollo/client/link/http/parseAndCheckHttpResponse.js` and `link/error/index.js`.
2. Upstream server's real `metricsGeneral` validation, field types and TTL are not observable from clients; section 2.5 is a derived spec satisfying all six clients.
3. WEB CSP vs `http://localhost:4100` (6.1) - confirm in a browser; edit `next.config.mjs` only as a recorded configuration change.
4. APP PayPal URL `${GRAPHQL_URL}paypal` defect (P7) and WEB missing `/paypal` page (P4) are integration blockers if PayPal is offered.
5. STORE `atob` JWT decoding (1.5) constrains token encoding; add a server test that generated store tokens decode with `atob`.
6. RIDER hard-coded Sentry DSN, Clarity ids, Firebase service-worker configs and APP OTA URL send data to upstream; each needs a recorded configuration gate before launch.
7. Expo CLI behaviour with `platforms` lacking `web`, Android cleartext policy, missing Google Maps keys and missing Firebase files - confirm on device.
