# 04 — Enatega multivendor-admin flows (backend contract reference)

Status: read-only research output, 2026-10-08. Audience: backend implementation agents.

Source root (all paths below are relative to it unless absolute):
`C:\Users\PREMKUMAR.MAMIDI\source\Fair\implementation\vendor\enatega-ui\enatega-multivendor-admin\`
GraphQL documents: `lib/api/graphql/**`. Appendix A has every document verbatim, with source line numbers.

Conventions in this file:

- `file:line` points at the source line. `GQL:` means a document under `lib/api/graphql/`.
- **UNVERIFIED** marks something inferred from UI behaviour rather than read from a GraphQL document or call site.
- **UNUSED** means the constant is exported but no component under `lib/ui`, `lib/context`, `lib/hooks` or `app` imports it. The backend can give these lower priority, but must not break them.
- Frontend boundary (AGENTS.md, 2026-10-08): the Enatega UI stays unchanged. The backend has to match these operation names, argument names/types and response shapes exactly. If a capability is unsupported, record it as an integration blocker. Never fake success data.

Contents:

- §0 Transport and protocol
- §1 Auth and roles
- §2 Admin areas, plus input shapes (§2.20)
- §3 Configuration
- §4 Pagination
- §5 Finance semantics
- §6 singlevendor-admin comparison
- §A Consolidated types
- §B Role/permission matrix
- §C Secret configuration fields
- §D Blockers and open questions
- Appendix A: verbatim GraphQL documents

Research method: the GraphQL documents were read directly. Three parallel read-only sub-investigations covered the call-site variables, the screen-to-operation map, and the singlevendor diff; their key claims were spot-checked against source.

---

## 0. Transport and cross-cutting protocol

| Item                               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------- |
| HTTP GraphQL                       | `POST ${NEXT_PUBLIC_SERVER_URL}graphql` (the base URL must end with `/`)                                                                                                                                                                                                                                                                                                                                                                                                                     | `lib/hooks/useSetApollo.tsx:300-309`                                                                                |
| WS GraphQL                         | `${NEXT_PUBLIC_WS_SERVER_URL}graphql`, **legacy `subscriptions-transport-ws`** (`graphql-ws` subprotocol, _not_ `graphql-transport-ws`), `lazy: true`, `reconnect: true`, timeout 30 s                                                                                                                                                                                                                                                                                                       | `lib/hooks/useSetApollo.tsx:12,311-318`                                                                             |
| WS auth                            | `connectionParams: { authorization: 'Bearer <token>' }` (empty string when logged out)                                                                                                                                                                                                                                                                                                                                                                                                       | `lib/hooks/useSetApollo.tsx:315-317`                                                                                |
| HTTP headers on every op           | `authorization: Bearer <token>` or `''`; `nonce`; `bop-auth: Bearer <metricsToken>`; `userId` (from localStorage); `isAuth: true/false`; `X-Client-Type: web`; `x-platform: web`                                                                                                                                                                                                                                                                                                             | `lib/hooks/useSetApollo.tsx:361-383`                                                                                |
| Request-security bootstrap         | Before any op (except `MetricsGeneral`), the client runs `mutation MetricsGeneral { metricsGeneral { excellence topgun experience skydiver rider haha hehe huhu yoyo turu } }` with header `nonce`. It keeps `experience` as the "metrics token" and `hehe` as its expiry (ISO date string), stored in localStorage `_zt7m2` / `_qw4v8`. The token is sent back as `bop-auth: Bearer <experience>` together with the same `nonce`. It is refreshed 10 s before expiry, at most once per 5 s. | `GQL: mutations/metrics/index.ts:3-17`; `lib/hooks/useSetApollo.tsx:146-201`; `lib/utils/methods/security.ts:1-104` |
| Metrics-error retry trigger        | When an error _message_ contains `fingerprint mismatch`, `nonce header missing`, `token missing`, `unauthorized: invalid token` or `unauthorized: jwt expired`, the client clears the nonce and metrics token, fetches a new one and retries once.                                                                                                                                                                                                                                           | `lib/hooks/useSetApollo.tsx:75-86,390-411`                                                                          |
| Access-token refresh trigger       | `extensions.code === 'TOKEN_EXPIRED'` or the message contains `access token expired`. The client calls `refreshToken(refreshToken, userType)` once, then retries.                                                                                                                                                                                                                                                                                                                            | `lib/hooks/useSetApollo.tsx:101-106,331-342,203-278`                                                                |
| Forced logout trigger              | Token still expired after refresh, `extensions.code === 'INVALID_TOKEN'`, or the message is exactly `invalid token`. The client clears storage and goes to `/authentication/login`.                                                                                                                                                                                                                                                                                                          | `lib/hooks/useSetApollo.tsx:108-116,138-144,344-349`                                                                |
| Session-verification failure codes | `UNAUTHENTICATED`, `FORBIDDEN`, `TOKEN_EXPIRED`, `INVALID_TOKEN` on `ownerSession` clear the session. Any other error leaves `isSessionVerified=false`, and the guards then redirect to login.                                                                                                                                                                                                                                                                                               | `lib/context/global/user-context.tsx:57-68,112-119`                                                                 |
| REST: Stripe Connect onboarding    | `POST ${SERVER_URL}stripe/account`, body `{"restaurantId": "<id>"}`, `Content-Type: application/json`, **no Authorization header is sent**. Expected response `{ url: "https://*.stripe.com/..." }`. The client rejects non-stripe.com hosts.                                                                                                                                                                                                                                                | `lib/ui/screen-components/protected/restaurant/payment/main/index.tsx:52-78`                                        |
| REST: reverse geocode              | `GET ${serverUrl}/maps/reverse-geocode?latitude=&longitude=&language=en`. Response `{ success, error: {code,message}                                                                                                                                                                                                                                                                                                                                                                         | null, data: { status, errorMessage, formattedAddress, city }                                                        | null }` | `lib/api/google-maps.ts:1-49` |
| Google Maps JS key                 | From env `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, _not_ from `configuration`                                                                                                                                                                                                                                                                                                                                                                                                                       | `lib/hooks/useConfiguration.tsx:28`                                                                                 |
| Env vars read                      | `NEXT_PUBLIC_SERVER_URL`, `NEXT_PUBLIC_WS_SERVER_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_ENCRYPTION_KEY` (see 3.4), `NEXT_PUBLIC_ADMIN_EMAIL`/`NEXT_PUBLIC_ADMIN_PASSWORD` (pre-fill the login form; must stay **unset** in Fair builds), `NEXT_PUBLIC_SINGLE_VENDOR_ADMIN_URL` (login-page link; defaults to an upstream netlify URL)                                                                                                                                         | `grep process.env`; sign-in `index.tsx:46-53`                                                                       |
| Upstream fallback constant         | `lib/utils/constants/url.ts:1-14` hard-codes `https://aws-server-v2.enatega.com/`. Nothing imports it (grep finds no consumer). It must never be wired up.                                                                                                                                                                                                                                                                                                                                   | `lib/utils/constants/url.ts`                                                                                        |

Backend implications:

1. `metricsGeneral` has to exist and be callable without authentication. It returns `experience` (an opaque, short-lived, nonce-bound token) and `hehe` (expiry as an ISO date). The other eight fields must be present; filler values are fine. The backend may validate `nonce` + `bop-auth`. If it does, it must return the exact error messages listed above, or the client cannot recover. **UNVERIFIED:** the upstream semantics of the other fields (decoys).
2. Errors must carry `extensions.code` in `{UNAUTHENTICATED, FORBIDDEN, TOKEN_EXPIRED, INVALID_TOKEN}` as appropriate.
3. Money is displayed with `toFixed(2)` / `toLocaleString` throughout. Every amount field is therefore a GraphQL `Float` in **major units**. Fair keeps integer minor units internally, so the GraphQL edge must convert. Clients never send authoritative prices for orders. They do send catalogue prices (food variation `price`, option `price`, delivery fee, coupon discount) as Float major units, and the server must validate and convert those.
4. `/stripe/account` sends no auth header. Fair's handler must authenticate the caller some other way (e.g. a same-site HttpOnly cookie, or by rejecting the request). Otherwise it is an IDOR on `restaurantId`. **Integration blocker** until resolved within the allowed adapter scope.

---

## 1. Auth, session, roles

### 1.1 `ownerLogin` (mutation)

`GQL: mutations/authentication/index.ts:4-27`

```graphql
mutation ownerLogin($email: String!, $password: String!) {
  ownerLogin(email: $email, password: $password) {
    userId
    token
    tokenExpiration
    refreshToken
    refreshTokenExpiration
    email
    userType
    restaurants {
      _id
      orderId
      name
      image
      address
    }
    permissions
    userTypeId
    image
    name
  }
}
```

- Call site: `lib/ui/screen-components/unprotected/authentication/sign-in-email-password/index.tsx:64-125`. It stores the whole payload in localStorage `user-Yalla` (`APP_NAME='Yalla'`, `lib/utils/constants/strings/global.ts:1`) and calls `setAuthTokens`. It then **immediately calls `ownerSession`** and routes by `DEFAULT_ROUTES[verifiedUser.userType]`.
- `userType` ∈ `'ADMIN' | 'STAFF' | 'VENDOR' | 'RESTAURANT'` (`lib/utils/interfaces/forms/sign-in.form.interface.ts:29`). Returning a different string leaves the user without a route.
- `userTypeId`: for `RESTAURANT` this is the restaurant `_id`, persisted as localStorage `restaurantId` (`lib/utils/methods/auth.ts:101-104`). For `VENDOR`, `userId` itself is persisted as `vendorId` and `email` as `selected-vendor-email` (`auth.ts:96-99`).
- `tokenExpiration` and `refreshTokenExpiration` are typed `string | number` and stored as strings. **UNVERIFIED:** units. The client never compares them, so either epoch seconds or an ISO string works.
- `restaurants[]` for VENDOR = their stores. For RESTAURANT = the single store. For ADMIN/STAFF = `[]` is acceptable (**UNVERIFIED**).
- `permissions: [String]`. Only meaningful for STAFF (values in 1.6).
- Optional client field `shopType` is read from the cached user (`auth.ts:103`; `user-context.tsx:54`). It is **not** selected by the query, so it is always `''`.

### 1.2 `ownerSession` (query)

`GQL: queries/authentication/index.ts:3-24`. Fields: `userId email userType userTypeId permissions name image restaurants{_id name} token tokenExpiration refreshToken refreshTokenExpiration isActive`.

- Called with `fetchPolicy: 'network-only'` on every app boot and after login (`lib/context/global/user-context.tsx:84-123,125-144`). It is the **authoritative** role source: the client merges it over the cached login payload but keeps the _cached_ `refreshToken`/`refreshTokenExpiration` (`user-context.tsx:41-55`).
- Must resolve purely from the bearer token. It must return `null` (or an UNAUTHENTICATED error) for inactive or revoked sessions. If `data.ownerSession` is null, the client clears the session (`user-context.tsx:101-104`).
- `token` here may echo the current access token (the client overwrites storage with it via `persistUserSession`, `auth.ts:83-94`). Do not mint a new long-lived token on each call (**UNVERIFIED** upstream behaviour).

### 1.3 `refreshToken` (mutation)

`GQL: mutations/authentication/refresh.ts:3-13`
`refreshToken(refreshToken: String!, userType: String!) { userId token tokenExpiration refreshToken refreshTokenExpiration }`

- Sent by raw `fetch` with `nonce` and `bop-auth` headers and **no `authorization`** (`useSetApollo.tsx:220-236`). `userType` is the stored string (`ADMIN|STAFF|VENDOR|RESTAURANT`).
- The returned `refreshToken` replaces the stored one, so rotation is supported (`auth.ts:35-36`). The backend should rotate and invalidate the old token (reuse detection).

### 1.4 `hasOwnerPermission(permission: String!): Boolean` (query)

`GQL: queries/authentication/index.ts:26-30`. **UNUSED.** No call site anywhere. Implement as a cheap authz probe.

### 1.5 `resetUserSession(userId: ID!) { _id }` (mutation)

`GQL: mutations/user.ts:29-35`. Called from Super-admin › Users › row action menu (`lib/ui/screen-components/protected/super-admin/users/view/main/ActionMenu.tsx:138-181`, variables `{ userId: rowData._id }`). Semantics: revoke all sessions and refresh tokens of a **customer** user. ADMIN/STAFF(`Users`) only.

### 1.6 Staff permission model

- Permission strings, from `lib/utils/constants/permissions.ts:1-20`: exact `code` values, with spaces and case preserved:
  `Admin`, `Vendors`, `Stores`, `Riders`, `Users`, `Staff`, `Configuration`, `Orders`, `Coupons`, `Cuisine`, `Banners`, `Tipping`, `Commission Rate`, `Withdraw Request`, `Notification`, `Zone`, `Dispatch`, `Shop Type`.
- Stored on the staff user as `permissions: [String]` (see `createStaff`/`editStaff` in §2.8).
- Route-to-permission map used by `SUPER_ADMIN_GUARD` (`lib/utils/constants/routes.ts:1-54`):

| Permission text  | Route                         |
| ---------------- | ----------------------------- |
| Configuration    | /management/configurations    |
| Coupons          | /management/coupons           |
| Cuisine          | /management/cuisines          |
| Banners          | /management/banners           |
| Tipping          | /management/tippings          |
| Commission Rate  | /management/commission-rates  |
| Withdraw Request | /management/withdraw-requests |
| Notification     | /management/notifications     |
| Vendors          | /general/vendors              |
| Stores           | /general/stores               |
| Riders           | /general/riders               |
| Users            | /general/users                |
| Staff            | /general/staff                |

Routes _not_ in this table (`/home`, `/dispatch`, `/zone`, `/management/orders`, `/management/shop-types`, `/customerSupport`, `/audit-logs`, `/wallet/*`, `/settings`, `/language`) are **open to any STAFF**: `staffAllowed` is true when `!findRouteName` (`lib/hoc/SUPER_ADMIN_GUARD.tsx:23-28`). The `Admin`, `Orders`, `Zone`, `Dispatch`, `Shop Type` permissions are therefore not enforced by the route guard. The backend **must** enforce them per operation (see matrix §B).

### 1.7 How the UI picks SUPER_ADMIN vs VENDOR vs RESTAURANT routes

- There is **no `middleware.ts`** in multivendor-admin (`find -name "middleware*"` returns nothing). All gating is client-side HOCs, and the server must re-check everything.
- After login: `DEFAULT_ROUTES = { ADMIN:'/home', STAFF:'/home', VENDOR:'/admin/vendor/dashboard', RESTAURANT:'/admin/store/dashboard' }` (`lib/utils/constants/routes.ts:56-61`). `/` redirects to `/home` when a token exists (`app/(localized)/(protected)/page.tsx:11-17`).
- `SUPER_ADMIN_GUARD` wraps `app/(localized)/(protected)/(super-admin)/layout.tsx:11-15`. It allows `userType ∉ {RESTAURANT, VENDOR}` and, for STAFF, requires `permissions ∋ ROUTES[path].text` (`lib/hoc/SUPER_ADMIN_GUARD.tsx:22-34`).
- `VENDOR_GUARD` wraps `/admin/vendor/*` (`app/(localized)/(protected)/(other-users)/admin/vendor/layout.tsx:14-18`). It allows `userType !== RESTAURANT`, and STAFF only with `Vendors` (`lib/hoc/VENDOR_GUARD.tsx:18-23`). ADMIN and VENDOR pass.
- `RESTAURANT_GUARD` wraps `/admin/store/*` (`.../admin/store/layout.tsx:14-18`). It allows every non-STAFF userType (ADMIN, VENDOR, RESTAURANT), and STAFF with `Restaurants` or `Stores` (`lib/hoc/RESTAURANT_GUARD.tsx:20-28`).
- Every guard requires `isSessionVerified` (the `ownerSession` round-trip succeeded) plus a local token. Failure leads to `/authentication/login` or `/forbidden`.
- **Context switching.** The store area reads `restaurantId` from localStorage `restaurantId` (`lib/context/restaurant/layout-restaurant.context.tsx:32-33`). The vendor area reads `vendorId` from localStorage `vendorId` (`lib/context/vendor/layout-vendor.context.tsx:25`). Both are then sent as plain arguments (`restaurant`, `restaurantId`, `id`, `vendorId`, `userId`, `owner`). **The backend must authorize every such argument against the session**:
  ADMIN may use any; STAFF may use any within its permissions; VENDOR only restaurants it owns and its own vendor id; RESTAURANT only its own `userTypeId`. See §B.

### 1.8 Client-side storage (all `localStorage`; nothing in cookies)

| Key                                                                                                  | Content                                   | Source                                                      |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `token`, `refreshToken`, `tokenExpiration`, `refreshTokenExpiration`, `userType`, `userId`           | auth                                      | `lib/utils/methods/auth.ts:10-17,21-42`                     |
| `user-Yalla`                                                                                         | full login/session JSON (includes tokens) | `auth.ts:19,78-81`                                          |
| `vendorId`, `selected-vendor-email`                                                                  | vendor context                            | `auth.ts:96-99`; `lib/utils/constants/local-storage.ts:1-3` |
| `restaurantId`, `shopType`                                                                           | store context                             | `auth.ts:101-104`                                           |
| `messaging-token`                                                                                    | FCM web push token                        | `lib/ui/layouts/protected/super-admin/index.tsx:78`         |
| `_px3k9` nonce, `_zt7m2` metrics token, `_qw4v8` expiry, `_rf8n1` last refresh, `_mn6q4` token nonce | request security                          | `lib/utils/methods/security.ts:1-7`                         |
| `selected-sidebar-menu`                                                                              | UI only                                   | `lib/utils/constants/local-storage.ts:4`                    |

The refresh token is readable by JavaScript (XSS exposure). The UI cannot change, so the backend should keep access tokens short-lived, rotate refresh tokens, and bind them to the session (with revocation via `resetUserSession` / logout).

### 1.9 Push token

`uploadToken(id: String!, pushToken: String!) { _id pushToken }`. It lives in `GQL: queries/token/index.ts:3-10` even though it is a mutation. Called by the super-admin layout after FCM `getToken`, with `{ id: user.userId, pushToken }` (`lib/ui/layouts/protected/super-admin/index.tsx:64-90`). The backend must only allow `id === session.userId`.

### 1.10 Logout and the unprotected auth pages

- multivendor-admin logout is **client-only**. It clears storage and the metrics data, clears the Apollo store, and redirects to the login page (`lib/ui/screen-components/protected/layout/restaurant-layout/app-bar/index.tsx:126-132`; the other app bars do the same, **UNVERIFIED** for each). No server call is made, so refresh tokens stay valid until they expire.
  - Keep refresh-token TTL bounded.
  - singlevendor-admin calls `ownerLogout`, so implement it and revoke the current session there.
- `/authentication/sign-up`, `otp`, `verify-email` and `verify-phone` exist as routes, but their components call **no** GraphQL operations (grep finds only `OWNER_LOGIN` under `lib/ui/screen-components/unprotected`). Owners cannot self-register through this UI; vendors, stores and staff are created by an admin.
- Route-table defect: `ROUTES` maps `Withdraw Request` to `/management/withdraw-requests`, but the real page is `/wallet/withdraw-requests`. The `/wallet/*` pages are therefore reachable by **any STAFF**. Server-side enforcement of `Withdraw Request` is mandatory.

---

## 2. Admin areas and their operations

Format per op: `rootField(args) → selection`, followed by the GQL file:line and the call-site notes.
Full selection sets are in Appendix A. The selections below are complete unless marked "…".
"Roles" lists who reaches the screen in the UI (SA = ADMIN or STAFF with the named permission; V = VENDOR; R = RESTAURANT/store; ADMIN/VENDOR can also enter store screens via context switching).

### 2.1 Dashboards

**Super-admin `/home`** (SA, open to every STAFF)

- `getDashboardUsers → { usersCount vendorsCount restaurantsCount ridersCount }`. `GQL: queries/dashboard/index.ts:4-14`
- `getDashboardUsersByYear(year: Int!) → { usersCount vendorsCount restaurantsCount ridersCount percentageChange{usersPercent vendorsPercent restaurantsPercent ridersPercent} }`. `:17-32`
- `getDashboardOrdersByType → [{ value label }]`, `getDashboardSalesByType → [{ value label }]`. `:34-50`. Used in `lib/ui/screen-components/protected/super-admin/home/stats-table/index.tsx:23-45` and also in `lib/ui/screen-components/protected/home/stats-table/index.tsx:19-41`. **UNVERIFIED:** `label` is a type such as Delivery/Pickup, and `value` is a count or sales amount (Float).

**Store dashboard `/admin/store/dashboard`** (R; argument `restaurant` = localStorage `restaurantId`)

- `getRestaurantDashboardOrdersSalesStats(restaurant: String!, starting_date: String!, ending_date: String!, dateKeyword: String) → { totalOrders totalSales totalCODOrders totalCardOrders }`. `:53-72`
- `getRestaurantDashboardSalesOrderCountDetailsByYear(restaurant: String!, year: Int!) → { salesAmount: [Float] ordersCount: [Int] }`. `:74-87` (**UNVERIFIED** arrays of 12 monthly values, used for a chart)
- `getRestaurantDashboardOrderSalesDetailsByPaymentMethod(restaurant, starting_date!, ending_date!, dateKeyword) → { total_orders total_sales total_sales_without_delivery total_delivery_fee pickup_total_orders delivery_total_orders pickup_orders delivery_orders pickup{total_orders} delivery{total_orders} all{_type data{total_orders total_sales total_sales_without_delivery total_delivery_fee}} cod{…same} card{…same} }`. `:89-145`

**Vendor dashboard `/admin/vendor/dashboard`** (V; `vendorId`/`id` = localStorage `vendorId`)

- `getVendorDashboardStatsCardDetails(vendorId: String!, dateKeyword, starting_date: String!, ending_date: String!) → { totalRestaurants totalOrders totalSales totalDeliveries }`. `:206-225`
- `getLiveMonitorData(id: String!, dateKeyword, starting_date, ending_date) → { online_stores cancelled_orders delayed_orders ratings }`. `:227-246` (operation name `GetVendorLiveMonitorData`; polled every 30 s, `lib/ui/screen-components/protected/vendor/dashboard/live-monitor/index.tsx:36`)
- `getVendorDashboardGrowthDetailsByYear(vendorId: String!, year: Int!) → { totalRestaurants totalOrders totalSales }`. `:248-256` (**UNVERIFIED** monthly arrays)
- `getStoreDetailsByVendorId(id: String!, dateKeyword, starting_date, ending_date) → [{ _id totalOrders restaurantName totalSales pickUpCount deliveryCount }]`. `:149-170`
- `getStoreDetailsByVendorIdPaginated(id!, dateKeyword, starting_date, ending_date, page, limit, search) → { data[…same] totalCount currentPage totalPages }`. `:172-204`

`dateKeyword` values seen: `'All'` (default), `'Custom'`. With `'Custom'`, `starting_date`/`ending_date` are sent; otherwise they are `undefined` (`lib/ui/screen-components/protected/super-admin/order/main/index.tsx:43,58-70`). All tab values: `'All' | 'Today' | 'Week' | 'Month' | 'Year' | 'Custom'` (`lib/ui/useable-components/dashboard-sub-header/index.tsx:39`). **Caveat:** the super-admin orders header, vendor sub-header and store sub-header build the options as `[t('All'), t('Today'), t('Week'), t('Month'), t('Year'), 'Custom']` (`lib/ui/screen-components/protected/super-admin/order/header/table-header/index.tsx:91-104`; `vendor/dashboard/sub-header/index.tsx:42-53`). `DateFilterCustomTab` then sends the **translated label** as `dateKeyword` (e.g. Arabic `الكل`). The backend must map the localized labels from every `locales/*.json` back to the canonical keywords, and treat unknown values as `All`. Only `'Custom'` is always literal. Dates are local `YYYY-MM-DD` strings (`super-admin/order/main/index.tsx:44-45`). The server resolves keywords in the platform timezone (**UNVERIFIED**). The dashboard queries that declare `starting_date: String!` still receive a value, because their default filter state supplies dates (**UNVERIFIED** per screen).

**Dispatch `/dispatch`** (SA, open to every STAFF in the UI; enforce `Dispatch` server-side)

- `getActiveOrders(restaurantId: ID, page: Int, rowsPerPage: Int, actions: [String], search: String) → { totalCount orders[…] }`. `GQL: queries/orders/index.ts:3-112`. The order selection includes `zone{_id}`, restaurant (with location), deliveryAddress, items (variation, addons/options), `user{_id name phone email}`, `paymentMethod paidAmount orderAmount orderStatus isPickedUp status paymentStatus reason isActive createdAt deliveryCharges tipping taxationAmount completionTime preparationTime eta{phase source readyAt estimatedArrivalAt windowStartAt windowEndAt calculatedAt lastLocationAt} rider{_id name username available}`.
  - Call: `lib/ui/screen-components/protected/super-admin/dispatch/view/main/index.tsx:47-68` sends `{ restaurantId: '', page, rowsPerPage, search, actions: selectedActions }`. **An empty string `restaurantId` means "all".** `actions` ⊆ `PENDING, ASSIGNED, ACCEPTED, PICKED, DELIVERED` (`.../dispatch/view/header/table-header/index.tsx:43-64`).
  - The client re-fetches 500 ms after each `subscriptionDispatcher` event and also polls every 30 s (`.../dispatch/view/main/index.tsx:81-115`).
- `subscriptionDispatcher → Order{ _id zone{_id} orderId restaurant{…} deliveryAddress{location deliveryAddress} user{name phone} paymentMethod orderStatus preparationTime completionTime eta{…} expectedTime acceptedAt selectedPrepTime isPickedUp status isActive createdAt rider{_id name username available} }`. `GQL: subscription/order-subscription/index.ts:85-141`
- `assignRider(id: String!, riderId: String!) → { _id orderStatus rider{_id name} }`. `GQL: mutations/dispatch/index.ts:11-22`
- `updateStatus(id: String!, orderStatus: String!) → { _id orderStatus }`. `:3-10`
  - The dispatch row dropdown offers `PENDING, ACCEPTED, ASSIGNED, PICKED, DELIVERED, CANCELLED` (`lib/ui/useable-components/table/columns/dispatch-columns.tsx:78-104`).
  - **After a successful `assignRider` the client also calls `updateStatus(orderStatus:'ASSIGNED')`** (`dispatch-columns.tsx:190-204`). `assignRider` must perform the transition itself, and `updateStatus('ASSIGNED')` on an already-assigned order must be an idempotent no-op success.
  - Every status change goes through the central transition validator. Admin-forced backwards moves (e.g. DELIVERED→PENDING) must be rejected, or audited if allowed (**policy decision; UNVERIFIED**).
  - Rider list for assignment: `riders` (`GET_RIDERS`, `dispatch-columns.tsx:~119`).
- Order details modal, shown when the order is `PICKED`:
  - `orderTracking(id: ID!) → { orderId status riderLocation{latitude longitude accuracy heading speed recordedAt} eta{…} }` (`GQL: subscription/order-subscription/index.ts:167-192`)
  - `subscriptionOrderTracking(id: String!)` with the same shape (`:194-219`). Used in `lib/ui/useable-components/popup-menu/order-details-modal.tsx:24-38`.
- `subscriptionOrder(id: String!)` (`:143-165`) and `subscribePlaceOrder(restaurant: String!) → { userId origin order{…} }` (`:3-83`) are **UNUSED** in multivendor-admin. The store mobile app and singlevendor-admin need them.
- `riderUpdated → { _id }` (`GQL: subscription/rider-subscription/index.ts:3-9`) is used by the super-admin app bar only to trigger a `webNotifications` refetch (`lib/ui/screen-components/protected/layout/super-admin-layout/app-bar/index.tsx:117-131`).

### 2.2 Vendors (`/general/vendors`, SA `Vendors`; vendor profile `/admin/vendor/profile`, V)

- `vendors → [{ unique_id _id email userType isActive name image restaurants{_id} }]` plus the Apollo-local `vendorCount @client`, which is **not a server field** and must not be added to the schema. `GQL: queries/vendors/index.ts:3-19`
- `getVendor(id: String!) → { _id email userType name image firstName lastName phoneNumber }` (`:29-42`). A variant adds `restaurants{ _id orderId orderPrefix slug name image address location{coordinates} shopType }` (`:44-67`).
- `createVendor(vendorInput: VendorInput)` and `editVendor(vendorInput: VendorInput)`, both `→ { _id email name image firstName lastName phoneNumber }`. `GQL: mutations/vendor/index.ts:3-29`. The `VendorInput` field list is in §2.20.
- `deleteVendor(id: String!) → scalar` (Boolean, **UNVERIFIED**). `:31-35`

### 2.3 Stores / restaurants

Super-admin `/general/stores` (SA `Stores`), vendor `/admin/vendor/stores` (V), store profile, timing and location (R).

Queries (`GQL: queries/restaurants/index.ts`):

- `restaurants` in three selections: `_id` (`:3-9`); `_id name` (`:11-18`); full (`:48-72`: `unique_restaurant_id _id name image orderPrefix slug address deliveryTime minimumOrder isActive commissionRate username tax owner{_id email isActive} shopType`). Also in combination with `riders{_id name}` (`GQL: queries/concurrent/index.tsx:3-14`, op `FetchStoresAndRidersL`).
- `restaurantsPaginated(page, limit, search) → { data[…full] totalCount currentPage totalPages }`. `:74-103`
- `getClonedRestaurants → [same as full]` (`:106-131`); `getClonedRestaurantsPaginated(page, limit, search) → {data totalCount currentPage totalPages}` (`:257-291`). **UNVERIFIED:** "cloned" means stores created via `duplicateRestaurant`, or soft-deleted ones, shown on a separate tab.
- `restaurantByOwner(id: String) → { _id email userType restaurants[{ unique_restaurant_id _id orderId orderPrefix name slug image address isActive deliveryTime minimumOrder username location{coordinates} deliveryInfo{minDeliveryFee deliveryDistance deliveryFee} openingTimes{day times{startTime endTime}} shopType }] }`. `:133-171`. `id` = vendor id.
- `getRestaurantDeliveryZoneInfo(id: ID!) → { boundType deliveryBounds{coordinates} location{coordinates} circleBounds{radius} address city postCode }`. `:173-193`
- `restaurant(id: String)` profile (`:195-253`): `_id orderId orderPrefix slug name image phone logo address location{coordinates} deliveryBounds{coordinates} deliveryInfo{…} username deliveryTime minimumOrder tax isAvailable stripeDetailsSubmitted openingTimes{day times{startTime endTime}} owner{_id email} shopType cuisines bussinessDetails{bankName accountName accountCode accountNumber bussinessRegNo companyRegNo taxRate} currentWalletAmount totalWalletAmount withdrawnWalletAmount`.
  - The same `restaurant(id)` root field is reused with catalogue selections (§2.4). Its resolver must support nested `categories`, `foods`, `addons` and `options`.

Mutations (`GQL: mutations/restaurant/index.ts` unless noted):

- `createRestaurant(restaurant: RestaurantInput!, owner: ID!) → { _id name image username orderPrefix slug phone address deliveryTime minimumOrder isActive commissionRate tax owner{_id email isActive} shopType orderId logo location{coordinates} cuisines }`. `:3-33`. **singlevendor-admin declares `owner: ID` (nullable), so the schema arg must be nullable.**
- `editRestaurant(restaurant: RestaurantProfileInput!) → { _id orderId orderPrefix name phone image logo slug address username location{coordinates} isAvailable minimumOrder tax openingTimes{day times{startTime endTime}} shopType }`. `:87-116` (the variable is `$restaurantInput`, the argument name is `restaurant`)
- `duplicateRestaurant(id: String!, owner: String!) → { same as create, minus phone }`. `:118-147`
- `deleteRestaurant(id: String!) → { _id isActive }`. `:36-43`. This is a soft delete/toggle: the UI expects `isActive` back. **UNVERIFIED** whether it toggles.
- `hardDeleteRestaurant(id: String!) → scalar`. `:45-49`
- `updateDeliveryBoundsAndLocation(id: ID!, boundType: String!, bounds: [[[Float!]]], circleBounds: CircleBoundsInput, location: CoordinatesInput!, address, postCode, city)`, aliased `result:`, `→ { success message data{ _id deliveryBounds{coordinates} location{coordinates} } }`. `:51-85`
- `updateRestaurantDelivery(id: ID!, minDeliveryFee: Float, deliveryDistance: Float, deliveryFee: Float) → { success message data{_id} }`. `:163-183`
- `updateRestaurantBussinessDetails(id: String!, bussinessDetails: BussinessDetailsInput) → { success message data{_id} }`. `:185-201`
- `updateDeliveryOptions(restId: String!, pickup: Boolean!, delivery: Boolean!) → { deliveryOptions{ delivery pickup } }`. `GQL: mutations/deliveryOptions/index.tsx:3-12`. Note that `restaurant.deliveryOptions` is never _queried_ by multivendor-admin (**UNVERIFIED** how the toggle initial state is obtained).
- `updateTimings(id: String!, openingTimes: [TimingsInput]) → { _id openingTimes{day times{startTime endTime}} }`. `GQL: mutations/timing/index.tsx:3-16`
- `updateCommission`: see §5.1.
- `updateFoodOutOfStock`: see §2.4.

### 2.4 Catalog (store `/admin/store/product-management/*`, R)

- Categories:
  - `restaurant(id) { _id categories{_id title image} }` (`GQL: queries/category/index.ts:3-15`)
  - `restaurantCategoriesPaginated(restaurantId: String!, page, limit, search) → {data[{_id title image}] totalCount currentPage totalPages}` (`:17-40`)
  - `createCategory(category: CategoryInput!)` and `editCategory(category: CategoryInput!)` both return the **whole restaurant**: `{ _id categories[{ _id title foods[{ _id title description variations[{_id title price discounted addons}] image isActive createdAt updatedAt }] createdAt updatedAt }] }` (`GQL: mutations/category/index.ts:3-61`)
  - `deleteCategory(id: String!, restaurant: String!)` returns the same (`:63-91`)
- Sub-categories:
  - `subCategories → [{_id title parentCategoryId}]`, `subCategory(_id: String) → {…}`, `subCategoriesByParentId(parentCategoryId: String!) → [{…}]` (`GQL: queries/sub-categories/index.ts:3-29`)
  - `createSubCategories(subCategories: [SubCategoryInput!]!) → scalar` and `deleteSubCategory(_id: String!) → scalar` (`GQL: mutations/sub-category/index.ts:3-13`; operation name `deleteSubCtg`, variable `$deleteSubCategoryId2`)
- Foods:
  - `restaurant(id) { _id categories{ _id title foods{ _id title description isOutOfStock subCategory variations{_id title price discounted addons isOutOfStock} image isActive } } }` (`GQL: queries/food/index.ts:3-31`). There is **no server-paginated foods query** in multivendor-admin; the table paginates client-side.
  - `createFood(foodInput: FoodInput!)` and `editFood(foodInput: FoodInput!)` return the restaurant with `categories{ _id title foods{ _id title description subCategory variations{_id title price discounted addons isOutOfStock} image isActive } createdAt updatedAt }` (`GQL: mutations/food/index.ts:3-61`)
  - `deleteFood(id: String!, restaurant: String!, categoryId: String!) → { _id }` (`:63-73`)
  - `updateFoodOutOfStock(id: String!, restaurant: String!, categoryId: String!) → scalar Boolean` (`GQL: mutations/restaurant/index.ts:149-161`). This toggles the flag.
  - `variations[].addons` is a list of **addon ids** (`[String]`). `discounted` is a Float price (**UNVERIFIED**: either the discounted price or the discount amount).
- Addons:
  - `restaurant(id) { _id addons{ _id title description quantityMinimum quantityMaximum options } }` (`GQL: queries/addon/index.ts:3-17`), where `options` = option ids `[String]`
  - `restaurantAddonsPaginated(restaurantId!, page, limit, search)` (`:19-45`)
  - `createAddons(addonInput: AddonInput)` and `editAddon(addonInput: editAddonInput)` return `{ _id addons{_id options title description quantityMinimum quantityMaximum} }`. `deleteAddon(id: String!, restaurant: String!)` returns the same (`GQL: mutations/addons/index.ts:3-48`)
- Options:
  - `restaurant(id) { _id options{_id title description price} }` (`GQL: queries/options/index.ts:3-15`)
  - `restaurantOptionsPaginated(restaurantId!, page, limit, search)` (`:17-41`)
  - `createOptions(optionInput: CreateOptionInput)` and `editOption(optionInput: editOptionInput)` return `{ _id options{_id title description price} }`. `deleteOption(id!, restaurant!)` returns the same (`GQL: mutations/options/index.ts:3-43`)

### 2.5 Coupons

- Platform coupons (SA `Coupons`):
  - `coupons → [{ _id title discount enabled startDate endDate lifeTimeActive }]` (`GQL: queries/coupons/index.ts:3-15`)
  - `couponsPaginated(page, limit, search, enabled: Boolean, startDate: String, endDate: String) → {data[…] totalCount currentPage totalPages}` (`:17-48`)
  - `createCoupon(couponInput: CouponInput!)` and `editCoupon(couponInput: CouponInput!)` return the same fields (`GQL: mutations/coupons/index.ts:3-28`). `deleteCoupon(id: String!) → scalar` (`:29-33`)
- Store coupons (R):
  - `restaurantCoupons(restaurantId: String!) → [{_id title discount enabled}]` and `restaurantCouponsPaginated(restaurantId!, page, limit, search, enabled)` (`GQL: queries/coupons-restaurant/index.tsx:3-40`)
  - `createRestaurantCoupon(restaurantId: ID!, couponInput: CouponInput!)` and `editRestaurantCoupon(...)` return `{_id title discount enabled}` (`GQL: mutations/coupons-restaurant/index.tsx:3-35`)
  - `deleteRestaurantCoupon(restaurantId: ID!, couponId: ID!) → scalar` (`:37-41`)
  - Note the type mismatch: `restaurantId` is `String!` in the queries but `ID!` in the mutations.

### 2.6 Banners (SA `Banners`)

- `banners → [{ _id title description action screen file parameters }]` (`GQL: queries/banners/index.tsx:3-15`). The banner list sends `{page, rowsPerPage, search:''}` as variables to `query Banners`, which declares none (`lib/ui/screen-components/protected/super-admin/banner/view/main/index.tsx:64-72`). Apollo/graphql-js ignores undeclared variables, so the server must **not** reject them (**UNVERIFIED**: depends on server; graphql-js ignores extra variables).
- `createBanner(bannerInput: BannerInput!)` and `editBanner(bannerInput: BannerInput!)` return the same; `deleteBanner(id: String!) → scalar` (`GQL: mutations/banners/index.ts:3-35`). `file` is an image or video URL (the upload component accepts mp4/webm). `parameters` is a String that the admin **never sends**. The customer app may read it (**UNVERIFIED**). Input values are listed in §2.20.

### 2.7 Cuisines (SA `Cuisine`) and shop types (SA; enforce `Shop Type` server-side)

- Cuisines:
  - `cuisines → [{_id name description image shopType}]` and `cuisinesPaginated(page, limit, search, shopType: String)` (`GQL: queries/cuisines/index.ts:3-40`)
  - `createCuisine` / `editCuisine(cuisineInput: CuisineInput!)` return the same; `deleteCuisine(id: String!) → scalar` (`GQL: mutations/cuisines/index.ts`)
- Shop types:
  - `fetchShopTypes(filter: FetchShopTypeFilter, pagination: PaginationInput) → { data[{_id name image isActive}] total page pageSize totalPages hasNextPage hasPrevPage }` (`GQL: queries/shop-types/index.ts:3-19`)
  - `fetchShopTypeByUnique(dto: FetchUniqueShopTypeInput) → {_id name image isActive}` (`:21-29`)
  - `createShopType(dto: CreateShopTypeInput)`, `updateShopType(dto: UpdateShopTypeInput)` and `deleteShopType(id: String!, type: DeleteTypeEnum)` all return `{_id name image isActive}` (`GQL: mutations/shop-type/index.ts:3-32`)
  - `restaurant.shopType` and `cuisine.shopType` are strings (**UNVERIFIED** whether they hold the shop-type name or its id; see §2.20).

### 2.8 Staff (SA `Staff`)

- `staffs → [{_id name email phone isActive permissions}]` (`GQL: queries/staff/index.ts:3-15`)
- `staffsPaginated(page, limit, search, isActive: Boolean) → {data[…] totalCount currentPage totalPages}` (`:17-43`)
- `createStaff(staffInput: StaffInput!)` and `editStaff(staffInput: StaffInput!)` return `{ _id name email phone isActive permissions userType }`; `deleteStaff(id: String!) → {_id}` (`GQL: mutations/staff/index.ts:3-37`)
- STAFF must never be able to grant permissions it does not hold, and must not create ADMIN accounts (server rule).

### 2.9 Zones (SA; enforce `Zone` server-side) — polygon format

- `zones → [{ _id title description location{coordinates} isActive }]` (`GQL: queries/zone/index.ts:3-15`)
- `zonesPaginated(page, limit, search, isActive)` (`:17-44`)
- `createZone(zone: ZoneInput!)` and `editZone(zone: ZoneInput!)` return the same; `deleteZone(id: String!)` returns the same (`GQL: mutations/zone/index.ts:3-43`)
- **Variables** (`lib/ui/screen-components/protected/super-admin/zone/form/index.tsx:86-100`): `zone: { _id: zone?._id ?? '', title, description, coordinates }`. Create sends `_id: ''`.
- **Coordinate format = a GeoJSON Polygon `coordinates` array.** Each position is `[lng, lat]`, and the ring is **closed** (the first point is repeated as the last). Built by `transformPath`: `path.map(p => [p.lng, p.lat]); geometry.push(geometry[0]); return [geometry]` (`lib/utils/methods/google-maps/index.ts:11-19`).
- On read, `transformPolygon(location.coordinates[0])` drops the last point and maps `[x,y]` to `{lat:y, lng:x}` (`:3-9`). The server must therefore return `location: { coordinates: [[[lng,lat], …, [lng0,lat0]]] }` (Float triple-nested; the `type: "Polygon"` field is not selected).
- An invalid or empty map yields `[[[0,0]]]` (`zone/form/index.tsx:93-99`). The server must reject this (fewer than 4 positions, or not closed).
- The same `[[[lng,lat]]]` format is used for `restaurant.deliveryBounds.coordinates` and the `bounds` argument of `updateDeliveryBoundsAndLocation`. **UNVERIFIED** for bounds; see §2.20.
- Point format: `location.coordinates` for restaurants and addresses is `[lng, lat]` or `[String, String]` (**UNVERIFIED**; Enatega stores strings for user addresses).

### 2.10 Riders (SA `Riders`)

Queries (`GQL: queries/riders/index.ts`):

- `riders → [{ _id name username phone available vehicleType assigned zone{_id title} }]` (`:3-19`)
- `ridersPaginated(page, limit, search, zone: String, available: Boolean, isActive: Boolean)` (`:21-56`)
- `rider(id: String!) → { _id name username phone available assigned zone{_id title} bussinessDetails{…7 fields} licenseDetails{number expiryDate image} vehicleDetails{number image} }` (`:58-91`), used on `/general/riders/[id]`
- `availableRiders → [{_id name username phone available vehicleType zone{_id}}]` (`:93-107`, an anonymous query)
- `ridersByZone(id: String!)` (`:108-123`)

Mutations (`GQL: mutations/riders/index.tsx`):

- `createRider(riderInput: RiderInput!) → {_id name username phone available vehicleType zone{_id}}`; `editRider` returns the same minus `available`; `deleteRider(id: String!) → {_id}`.
- `toggleAvailablity(id: String!) → { _id name username phone available vehicleType zone{title} }`. **The misspelling must be preserved.**
- `assignRider`: see §2.1.

### 2.11 Users (customers; SA `Users`)

Queries (`GQL: queries/user/index.ts`):

- `users → [{ _id name email phone createdAt userType status lastLogin notes addresses{location{coordinates} deliveryAddress} }]` (`:3-23`)
- `usersPaginated(page, limit, search, registrationMethod: String, status: String) → {data[…] totalCount currentPage totalPages}` (`:25-62`)
- `user(id: ID!)` (variable `$userId`) `→ { _id name phone phoneIsVerified email emailIsVerified isActive status lastLogin isOrderNotification isOfferNotification createdAt updatedAt notificationToken userType favourite notes addresses{_id deliveryAddress details label selected location{coordinates}} }` (`:71-103`). This selects **`notificationToken`**, a push token. Return `null` or a masked value: the UI only needs to know whether one exists (**UNVERIFIED** usage).

Mutations (`GQL: mutations/user.ts`):

- `updateUserStatus(id: ID!, status: String!, reason: String) → {_id status}` (`:3-10`)
- `updateUserNotes(id: ID!, notes: String!) → {_id notes}` (`:12-19`)
- `deleteUser(id: ID!) → {_id}` (`:21-27`)
- `resetUserSession(userId: ID!) → {_id}` (`:29-35`)

Order history:

- `ordersByUser(userId: ID!, page: Int, limit: Int) → { orders[{ _id orderId orderAmount orderStatus paymentMethod createdAt deliveryCharges paidAmount taxationAmount tipping restaurant{_id name} deliveryAddress{deliveryAddress details label location{coordinates}} items{_id title description quantity image specialInstructions variation{_id title price} addons{_id title options{_id title price}}} }] totalCount totalPages currentPage nextPage prevPage }` (`GQL: queries/order.ts:4-60`), used on `/general/users/user-detail/[id]`

### 2.12 Orders (SA `/management/orders`; vendor orders; store `/admin/store/orders`)

- `allOrdersPaginated(page, rows, dateKeyword, starting_date, ending_date, orderStatus: [String], search, restaurantId: ID, riderId: ID) → { totalCount currentPage totalPages prevPage nextPage orders[…] }` (`GQL: queries/orders/index.ts:358-467`). The items, variation, addons and options also select **both `_id` and `id`**: provide an `id` alias field.
- `orderFilterOptions → { restaurants{_id name} riders{_id name username phone} }` (`:469-484`)
- `ordersByRestId(restaurant: String!, page, rows, search, orderStatus: [String]) → { totalCount totalPages currentPage prevPage nextPage orders[…] }` (`:114-211`)
- `ordersByRestIdWithoutPagination(restaurant: String!, search) → [Order…]` (`:213-276`)
- `allOrders(page: Int) → [Order…]` (`:278-356`)
- `allOrdersWithoutPagination(dateKeyword, starting_date, ending_date) → [Order…]` (`:487-573`)
- Order status strings: `PENDING ACCEPTED ASSIGNED PICKED DELIVERED CANCELLED` (plus `COMPLETED`, **UNVERIFIED**). `status` (Boolean) and `isActive` are separate fields. `paymentStatus` is a String (e.g. `PENDING`/`PAID`, **UNVERIFIED**). `reason` is the cancellation reason.

### 2.13 Reviews (store `/admin/store/ratings`)

- `reviews(restaurant: String!) → [{ _id order{_id orderId items{title} user{_id name email}} restaurant{_id name image} rating comments description createdAt }]` (`GQL: queries/ratings/index.tsx:2-29`)
- `restaurantReviewsPaginated(restaurantId: String!, page, limit, search, minRating: Float, maxRating: Float) → {data[…] totalCount currentPage totalPages}` (`:31-77`)

### 2.14 Tips, taxation, finance

See §5.

### 2.15 Notifications (SA `Notification`; app bar for all)

- `notifications → [{_id body title createdAt}]` and `notificationsPaginated(page, limit, search)` (`GQL: queries/notifications/index.ts:3-28`)
- `sendNotificationUser(notificationTitle: String, notificationBody: String!) → scalar` (`GQL: mutations/notifications/index.ts:3-13`). This broadcasts to all customers (**UNVERIFIED** audience). Fair: if no push provider is configured, it is a provider blocker; return an error rather than success.
- `webNotifications → [{_id body navigateTo read createdAt}]` (`GQL: queries/notifications/index.ts:30-40`). These are per-session-user admin inbox entries.
- `markWebNotificationsAsRead → [same]` (`GQL: mutations/notifications/index.ts:15-25`) marks all of them read.

### 2.16 Support tickets (`/customerSupport`, SA; open to every STAFF in the UI)

Queries (`GQL: queries/supportTickets/index.ts`):

- `getTicketUsersWithLatest(input: FiltersInput) → { users[{ _id name email phone isActive userType latestTicket{ _id title description status category orderId otherDetails createdAt updatedAt } }] docsCount totalPages currentPage }` (`:6-33`). Polled every 30 s (`lib/ui/screen-components/protected/super-admin/customerSupport/view/main/index.tsx:81`).
- `getTicketUsers(input: FiltersInput)` (`:36-52`)
- `getSingleUserSupportTickets(input: SingleUserSupportTicketsInput!) → { tickets[{… user{_id name email}}] docsCount totalPages currentPage }` (`:54-78`)
- `getSingleSupportTicket(ticketId: ID!)` (`:80-100`)
- `getTicketMessages(input: TicketMessagesInput!) → { messages[{_id content senderType isRead createdAt updatedAt}] ticket{_id title status user{_id name}} page totalPages docsCount }` (`:102-127`)

Mutations (`GQL: mutations/supportTickets/index.ts`):

- `createSupportTicket(ticketInput: SupportTicketInput!)` (`:3-22`; **UNUSED** in admin; this is the customer side)
- `createMessage(messageInput: MessageInput!) → {_id content senderType isRead ticket createdAt updatedAt}` (`:24-36`; `ticket` is a scalar id)
- `updateSupportTicketStatus(input: UpdateSupportTicketInput!) → {_id status updatedAt}` (`:38-46`)

The input object fields and status values are in §2.20.

### 2.17 Audit logs (`/audit-logs`, SA; open to every STAFF in the UI — restrict server-side)

- `auditLogs(page: Int, limit: Int) → { auditLogs[{ _id timestamp admin{_id email} action targetType targetId changes }] totalCount currentPage totalPages }` (`GQL: queries/audit.ts:3-23`).
- Called with `{ page: currentPage (1-based), limit }` (`lib/ui/screens/super-admin/audit-logs/index.tsx:19-25`).
- `changes` is a JSON scalar or a JSON string. If it has exactly two keys, one starting with `old` and one with `new`, the UI renders a diff (`lib/ui/screen-components/protected/super-admin/audit-logs/ChangesDiff.tsx:14-45`). The backend **must redact secrets** (configuration secrets, passwords, tokens, bank numbers) from `changes`.

### 2.18 App versions

See §3.2 (`getVersions` / `setVersions`).

### 2.19 Uploads

- `uploadImageToS3(image: String!) → { imageUrl }` (`GQL: mutations/upload/index.ts:3-8`).
  - The client compresses images to 800 px at quality 0.7 and videos via `compressVideo`, then sends a **data URL** (`data:image/...;base64,` or `data:video/...`) (`lib/ui/useable-components/upload/upload-image.tsx:84-113`).
  - Accepted types: webp, jpeg, jpg, png, webm, mp4 (`:46-53`). Size limits: 2 MB landscape, 500 KB square, 8 MB video (`lib/utils/constants/global.ts:14-16`).
  - Server: decode, sniff the MIME type (do not trust the prefix), enforce size, store in object storage, and return a public URL. The HTTP body limit must allow roughly 11 MB of base64.
  - singlevendor-admin adds an optional `publicMedia: Boolean` argument.
- Cloudinary direct upload: `uploadImageToCloudinary(file, url, preset)` POSTs `FormData{file, upload_preset}` to a Cloudinary URL and reads `secure_url` (`lib/services/cloudinary.ts:15-65`). **It has no callers** (grep for `uploadImageToCloudinary(` returns nothing), so every upload goes through `uploadImageToS3`.
- The restaurant create forms do default `image`/`logo` to **upstream Cloudinary placeholder URLs** (`https://res.cloudinary.com/dc6xw0lzg/...`, e.g. `lib/ui/screen-components/protected/super-admin/restaurants/add-form/restaurant-details.tsx:84`; defaults at `:70-85`). The backend should replace known upstream placeholder URLs with Fair-hosted defaults, or reject them (**UNVERIFIED** policy).
- `cloudinaryUploadUrl`/`cloudinaryApiKey` are only stored and displayed by the configuration form.
- `uploadToken`: see §1.9.

### 2.20 Mutation input objects as actually sent

Path prefixes: `UI/` = `lib/ui/screen-components/protected/`; `UC/` = `lib/ui/useable-components/`; `SC/` = `lib/utils/schema/`. Validation rules are client-side Yup checks only, so the server must re-validate everything.

General rules for these inputs:

- Edit forms reuse the create input type and send `_id`. Create forms send `_id: ''` (empty string) for vendor, staff, rider, zone, banner and restaurant coupon. The server must treat `''` as "absent" on create.
- `__typename` is explicitly stripped before sending in the food and category forms. Elsewhere, values built from query results could still carry `__typename` (**UNVERIFIED** per form). Standard GraphQL rejects unknown input fields, so integration tests must exercise every form against the real schema. The singlevendor `scripts/check-single-vendor-schema.js` approach can be reused for document-level validation.
- Several edit forms **require a password in client validation** even though submit omits it when blank: rider, staff, store profile and vendor edit (`SC/vendor.ts`, `SC/staff.ts`, `SC/rider.ts`, `SC/restaurant.ts`). The UI cannot be changed, so the backend should accept the password and treat it as optional on edit. **UX blocker, record it.**
- Password policy on the client: at least 6 characters, with lowercase, uppercase, digit and special character. Fair's server policy may be stricter.

| Input (operation)                                         | Fields sent                                                                                                                                                                                                                                                         | Call site                                                                                                                                                                                                                                                                                        | Notes / validation                                                                                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VendorInput` (`createVendor`/`editVendor`, nullable arg) | `{ _id ('' on create), name (= first+' '+last), email, password?, firstName, lastName, image, phoneNumber: String (E.164, default country AU) }`                                                                                                                    | `UI/super-admin/vendor/form/vendor-add-form/index.tsx:113-123`; store wizard `UI/super-admin/restaurants/add-form/vendor-details.tsx:118-128` (always sends password); vendor self-profile `UI/vendor/profile/main/index.tsx:72-82`, `UI/vendor/profile/add-form/index.tsx:75-84` (no firstName) | names max 35; phone at least 5 characters; image is a URL                                                                                                                                                                                      |
| `RestaurantInput` + `owner: ID` (`createRestaurant`)      | `{ name, address, phone, image, logo, deliveryTime: Int/Float, minimumOrder: Float, username (an **email**, used as the store login), password, shopType: <shop-type _id>, salesTax: Float, cuisines: [<cuisine NAME>] }`; `owner` = vendor `_id`                   | `UI/super-admin/restaurants/add-form/restaurant-details.tsx:208-227`; `UI/super-admin/vendor/form/restaurant-add-form/restaurant-details.tsx:206-224`; `UI/vendor/restaurants/add-form/restaurant-details.tsx:178-196`                                                                           | Defaults deliveryTime 1, minOrder 1, salesTax 0. **`salesTax` is the input name, while the output field is `tax`.** Creating a restaurant also creates the RESTAURANT login (username/password).                                               |
| `RestaurantProfileInput` (`editRestaurant(restaurant:)`)  | `{ _id, name, phone, address, image, logo, deliveryTime, minimumOrder, username, shopType: <_id>, salesTax, orderPrefix, cuisines: [names], password? }`                                                                                                            | `UI/restaurant/profile/restaurant/add-form/update-profile-detail.tsx:154-171`                                                                                                                                                                                                                    | The initial shopType is matched by **name** (`:125-127`) but submitted as `_id`. The server should accept either and normalize (**UNVERIFIED** which one upstream stores).                                                                     |
| `duplicateRestaurant(id, owner)`                          | `{ id: restaurantId, owner: vendor _id }`                                                                                                                                                                                                                           | `UI/super-admin/restaurants/view/duplicate-dialog/index.tsx:118`                                                                                                                                                                                                                                 |                                                                                                                                                                                                                                                |
| `updateDeliveryBoundsAndLocation`                         | `{ id, boundType: 'point'\|'radius'\|'polygon', location: { latitude, longitude } (CoordinatesInput), address, bounds: [[[lng,lat]…closed]], circleBounds: { radius: <km, default 1> } }`. `postCode` and `city` are **never sent**.                                | `UC/google-maps/location-bounds-restaurants/index.tsx:523-549`, plus the 3 sibling components (profile, vendor, vendor-layout; the last omits `address`)                                                                                                                                         | Radius mode sends a 4-point closed square approximation in `bounds` _and_ `circleBounds.radius`. Point mode with no path sends `bounds: [[null]]` (**UNVERIFIED**), and the server must accept it. `circleBounds` is sent for every boundType. |
| `updateRestaurantDelivery`                                | `{ id, minDeliveryFee, deliveryDistance, deliveryFee }` (numbers)                                                                                                                                                                                                   | `UI/restaurant/delivery/view/main/index.tsx:58`; 4 other forms                                                                                                                                                                                                                                   | All three are required by the client                                                                                                                                                                                                           |
| `BussinessDetailsInput`                                   | `{ bankName, accountName, accountCode, accountNumber: Number, bussinessRegNo: Number\|null, companyRegNo: Number\|null, taxRate: Number }`                                                                                                                          | `UI/restaurant/profile/restaurant/add-form/update-bussiness-details.tsx:90-101`                                                                                                                                                                                                                  | **Numbers, not strings.** Leading zeros in account numbers are lost client-side (record as a data-quality blocker). Use a `Float` input or a lenient scalar.                                                                                   |
| `updateDeliveryOptions`                                   | `{ restId, pickup: Boolean, delivery: Boolean }`                                                                                                                                                                                                                    | `UI/restaurant/timing/deliveryOptions/index.tsx:56-60`                                                                                                                                                                                                                                           | The client requires at least one to be true                                                                                                                                                                                                    |
| `TimingsInput[]` (`updateTimings`)                        | `[{ day: 'MON'…'SUN', times: [{ startTime: ['HH','MM'], endTime: ['HH','MM'] }] }]`                                                                                                                                                                                 | `UI/restaurant/timing/add-form/index.tsx:78-98` (+4 copies)                                                                                                                                                                                                                                      | **Times are `[String]` pairs**, and the output returns the same. A closed day has `times: []`. No overlaps, and end is after start.                                                                                                            |
| `StaffInput`                                              | `{ _id ('' on create), name, email, phone: String, isActive: Boolean, permissions: [String], password? }`                                                                                                                                                           | `UI/super-admin/staff/add-form/index.tsx:77-89`; status toggle `UC/table/columns/staff-columns.tsx:58-68` (no password)                                                                                                                                                                          | at least 1 permission                                                                                                                                                                                                                          |
| `RiderInput`                                              | `{ _id ('' on create), name, username, phone: String, zone: <zone _id>, vehicleType: 'bicycle'\|'motorbike'\|'car'\|'pickup_truck', available: Boolean, password? }`                                                                                                | `UI/super-admin/riders/add-form/index.tsx:88-99`; values in `lib/utils/constants/vehicle-type.ts`                                                                                                                                                                                                | License, vehicle and bank details are not sent from admin (the rider app fills them in)                                                                                                                                                        |
| `ZoneInput`                                               | `{ _id ('' on create), title, description, coordinates: [[[lng,lat]…closed]] }`                                                                                                                                                                                     | `UI/super-admin/zone/form/index.tsx:88-100`                                                                                                                                                                                                                                                      | See §2.9                                                                                                                                                                                                                                       |
| `CouponInput` (platform)                                  | `{ _id? (edit), title, discount: Float (1–100, i.e. percent), enabled, lifeTimeActive, startDate: 'YYYY-MM-DD'\|'', endDate: 'YYYY-MM-DD'\|'' }`                                                                                                                    | `UI/super-admin/coupons/form/index.tsx:202-234`; toggle `UC/table/columns/coupons-columns.tsx:75-88`                                                                                                                                                                                             | endDate is required unless lifeTimeActive                                                                                                                                                                                                      |
| `CouponInput` (restaurant) + `restaurantId: ID!`          | `{ _id ('' on create), title, discount, enabled }`, with no dates                                                                                                                                                                                                   | `UI/restaurant/coupons/add-form/index.tsx:70-78`; toggle `UC/table/columns/coupons-restaurant-columns.tsx:50-58`                                                                                                                                                                                 | No client range check on discount, so the server must enforce 0–100                                                                                                                                                                            |
| `BannerInput`                                             | `{ _id ('' on create), title, description, file: URL, action: 'Navigate Specific Restaurant'\|'Navigate Specific Page', screen }`, where `screen` ∈ `'Near By Restaurants'\|'Grocery List'\|'Top Brands'` (for a page) or a **restaurant \_id** (for a restaurant)  | `UI/super-admin/banner/add-form/index.tsx:95-104`; constants `lib/utils/constants/banners.ts:1-10`                                                                                                                                                                                               | `parameters` is never sent. Title and description max 35.                                                                                                                                                                                      |
| `CuisineInput`                                            | `{ _id? , name, description, shopType: <shop-type NAME>, image }`                                                                                                                                                                                                   | `UI/super-admin/cuisines/form/index.tsx:146-173`                                                                                                                                                                                                                                                 | The list filter sends `shopType: 'restaurant'\|'grocery'` (`UI/super-admin/cuisines/view/main/index.tsx:82`). Name max 30, description max 40.                                                                                                 |
| `CreateShopTypeInput` / `UpdateShopTypeInput`             | create `{ name, image (default 'https://placehold.co/600x400') }`; update `{ _id, name, image, isActive }`                                                                                                                                                          | `UI/super-admin/shop-types/form/index.tsx:172-198`; toggle `UC/table/columns/shop-types-columns.tsx:75-86`                                                                                                                                                                                       | `deleteShopType` sends only `{id}`. **`DeleteTypeEnum` values are unknown (UNVERIFIED)**, so the arg must be optional. The placeholder image is an external host; Fair should substitute its own default server-side (**UNVERIFIED**).         |
| `TippingInput`                                            | `{ _id, tipVariations: [Float, Float, Float] (distinct), enabled: true }`                                                                                                                                                                                           | `UI/super-admin/tipping/add-form/add-form.tsx:59-65`                                                                                                                                                                                                                                             | Calls `editTipping` if `tips._id` exists, otherwise `createTipping`                                                                                                                                                                            |
| `CategoryInput`                                           | `{ restaurant, _id ('' on create), title, subCategories: [{ _id?, title, parentCategoryId }], image: (grocery ? url : '') }`                                                                                                                                        | `UI/restaurant/category/add-form/index.tsx:198-207`                                                                                                                                                                                                                                              | New sub-category rows likely carry `parentCategoryId: ''`, because of a client typo (`subCategorites`, `:308`, **UNVERIFIED**). The server should set parentCategoryId to the category being saved.                                            |
| `[SubCategoryInput!]!`                                    | `[{ parentCategoryId, title }]`                                                                                                                                                                                                                                     | `UI/restaurant/category/add-subcategories/index.tsx:119-122`                                                                                                                                                                                                                                     |                                                                                                                                                                                                                                                |
| `FoodInput`                                               | `{ _id (edit), restaurant, title, description, image, isOutOfStock: false, isActive: true, category: <category _id>, subCategory: <_id>\|undefined, variations: [{ _id?, title, price: Float, discounted: Float, isOutOfStock: Boolean, addons: [<addon _id>] }] }` | `UI/restaurant/food/form/add-form/variations.tsx:177-200`; step 1 `food/form/add-form/food.index.tsx:154-169`                                                                                                                                                                                    | price 0–99999; **every variation must have at least 1 addon** (client rule); at least 1 variation. Moving a food between categories happens through `category` on edit (**UNVERIFIED**).                                                       |
| `updateFoodOutOfStock`                                    | `{ id: foodId, categoryId, restaurant }`                                                                                                                                                                                                                            | `UC/table/columns/foods-columns.tsx:71-75`                                                                                                                                                                                                                                                       | Toggles the flag                                                                                                                                                                                                                               |
| `AddonInput` / `editAddonInput`                           | create `{ restaurant, addons: [{ title, description, quantityMinimum, quantityMaximum, options: [<option _id>] }] }`; edit `{ restaurant, addons: { _id, title, description, quantityMinimum, quantityMaximum, options } }` (**single object, not a list**)         | `UI/restaurant/add-on/add-form/index.tsx:171-180`                                                                                                                                                                                                                                                | min ≥ 0, max ≥ min                                                                                                                                                                                                                             |
| `CreateOptionInput` / `editOptionInput`                   | create `{ restaurant, options: [{ title, description, price }] }`; edit `{ restaurant, options: { _id, title, description, price } }` (single object)                                                                                                               | `UI/restaurant/options/add-form/index.tsx:116-124`                                                                                                                                                                                                                                               | price 0–99999                                                                                                                                                                                                                                  |
| `sendNotificationUser`                                    | `{ notificationTitle (max 25), notificationBody (max 1500) }`                                                                                                                                                                                                       | `UI/super-admin/notifications/form/index.tsx:74-77`                                                                                                                                                                                                                                              |                                                                                                                                                                                                                                                |
| `updateUserStatus`                                        | `{ id, status: 'active'\|'blocked'\|'deactivate', reason? (10–500 chars) }`                                                                                                                                                                                         | `UI/super-admin/users/view/main/ActionMenu.tsx:159-169`                                                                                                                                                                                                                                          | The `usersPaginated.status` filter uses the same values; `registrationMethod` ∈ `google\|apple\|default` (`users/view/header/screen-header/index.tsx:33-43`)                                                                                   |
| `updateWithdrawReqStatus`                                 | `{ id, status: 'REQUESTED'\|'TRANSFERRED'\|'CANCELLED' }`                                                                                                                                                                                                           | `UC/table/columns/withdraw-requests-columns.tsx:131-156`; the admin form always sends `'TRANSFERRED'` (`UI/super-admin/withdraw-requests/form/index.tsx:84-87`)                                                                                                                                  |                                                                                                                                                                                                                                                |
| `createWithdrawRequest`                                   | `{ requestAmount: Float ≥ 1 }`                                                                                                                                                                                                                                      | `UI/restaurant/withdraw-requests/form/index.tsx:73-75`                                                                                                                                                                                                                                           |                                                                                                                                                                                                                                                |
| `MessageInput`                                            | `{ content, ticket: <ticketId> }`. `senderType` is not sent; the server sets it to `'admin'` (the UI checks `senderType === 'admin'`)                                                                                                                               | `UI/super-admin/customerSupport/view/main/index.tsx:237-242`; `UC/ticket-chat-modal/index.tsx:185-190,344`                                                                                                                                                                                       |                                                                                                                                                                                                                                                |
| `UpdateSupportTicketInput`                                | `{ ticketId, status: 'open'\|'inProgress'\|'closed' }`                                                                                                                                                                                                              | `customerSupport/view/main/index.tsx:251-256`; `UC/ticket-chat-modal/index.tsx:209-230`                                                                                                                                                                                                          |                                                                                                                                                                                                                                                |
| `FiltersInput`                                            | `{ page: 1, limit: 20 }`                                                                                                                                                                                                                                            | `customerSupport/view/main/index.tsx:74-79`                                                                                                                                                                                                                                                      | Other fields are unknown (UNVERIFIED). Make them optional.                                                                                                                                                                                     |
| `SingleUserSupportTicketsInput`                           | `{ userId, filters: { page: 1, limit: 50 } }`                                                                                                                                                                                                                       | `:92-100`                                                                                                                                                                                                                                                                                        |                                                                                                                                                                                                                                                |
| `TicketMessagesInput`                                     | `{ ticket: <ticketId>, page: 1, limit: 50 }`                                                                                                                                                                                                                        | `UC/ticket-chat-modal/index.tsx:59-65`                                                                                                                                                                                                                                                           |                                                                                                                                                                                                                                                |
| `AppTypeInput`                                            | `{ android: 'x.y.z', ios: 'x.y.z' }`                                                                                                                                                                                                                                | `UI/super-admin/configuration/add-form/app-versions/index.tsx:43-56`                                                                                                                                                                                                                             | regex `^\d+\.\d+\.\d+$`                                                                                                                                                                                                                        |

**UNUSED mutation exports:** `createSupportTicket`, `createTaxation`, `editTaxation`, `saveFormEmailConfiguration`, `saveSendGridConfiguration`, `saveWebConfiguration`, `hasOwnerPermission` (query).

**UNUSED query exports:** `hasOwnerPermission`, `restaurantCoupons` (non-paginated), `reviews` (non-paginated), `availableRiders`, `ridersByZone`, `fetchShopTypeByUnique`, `staffs`, `getTicketUsers`, `users` (both), `getVendor` with restaurants, `allOrders`, `ordersByRestIdWithoutPagination`, `allOrdersWithoutPagination`, `getRestaurantDashboardOrdersSalesStats`, `getStoreDetailsByVendorId` (non-paginated), `subscribePlaceOrder`, `subscriptionOrder`.

Several of these are used by other Enatega apps (store, rider, customer, singlevendor), so implement them anyway.

### 2.21 Client defect that sends options as variables

`useQueryGQL(query, variables, options)` is often called with the _options_ object in the variables slot. Apollo then sends keys like `fetchPolicy`, `debounceMs` or `onCompleted` as GraphQL **variables**. Affected call sites:

- `GET_STORE_RIDER`: `UI/super-admin/earnings/view/header/table-header/index.tsx:34`
- `GET_DASHBOARD_USERS`, `GET_DASHBOARD_ORDERS_BY_TYPE`, `GET_DASHBOARD_SALES_BY_TYPE`
- `GET_TIPPING`, `GET_ZONES` (zone and rider forms), `GET_RESTAURANTS_DROPDOWN`, `GET_CUISINES`
- `GET_SUBCATEGORIES`: `UI/restaurant/category/view/main/index.tsx:92`
- `GET_VENDORS`: `lib/context/super-admin/vendor.context.tsx:39`

**The server must ignore undeclared variables.** graphql-js does this by default; do not add strict variable validation. Also, any `onCompleted` callback placed in that slot never runs (**UNVERIFIED** runtime impact).

---

## 3. Configuration screens (`/management/configurations`, STAFF permission `Configuration`)

### 3.1 `configuration` query: what the admin reads

`GQL: queries/configuration/index.ts:3-60` (`query getConfiguration`). Fields:
`_id email emailName enableEmail clientId sandbox publishableKey currency currencySymbol deliveryRate twilioAccountSid twilioPhoneNumber twilioEnabled skipWhatsAppOTP twilioWhatsAppNumber formEmail sendGridEnabled sendGridEmail sendGridEmailName dashboardSentryUrl webSentryUrl apiSentryUrl customerAppSentryUrl restaurantAppSentryUrl riderAppSentryUrl cloudinaryUploadUrl cloudinaryApiKey webAmplitudeApiKey appAmplitudeApiKey webClientID androidClientID iOSClientID expoClientID googleMapLibraries googleColor termsAndConditions privacyPolicy testOtp firebaseKey authDomain projectId storageBucket msgSenderId appId measurementId isPaidVersion skipEmailVerification skipMobileVerification costType vapidKey enableCustomerDemoMode customerDemoZoneId`

- **It is fetched before login.** `ConfigurationProvider` sits in the root layout, above `UserProvider` (`app/(localized)/layout.tsx:53-61`; fetch at `lib/context/global/configuration.context.tsx:95-100,174-181`). The same field set therefore goes to anonymous callers.
- Not selected (good): `password`, `clientSecret`, `secretKey`, `twilioAuthToken`, `sendGridApiKey`, `sendGridPassword`. The TS interface and context defaults mention them (`configuration.context.tsx:45,62,64,66,68,72`), and `useConfiguration` exposes `STRIPE_SECRET_KEY`, `PAYPAL_SECRET`, `PASSWORD`, `TWILIO_AUTH_TOKEN` (`lib/hooks/useConfiguration.tsx:24-26,44,49`). Because they are never selected, they are always `undefined` in the client. The backend **must not** add them to the `Configuration` type output (or must always resolve them to `null`).
- Fields the admin actually consumes at runtime: Firebase web config plus `vapidKey` for admin web push (`lib/ui/layouts/protected/super-admin/index.tsx:40-75`; `firebase.ts:5-46`); `currencySymbol` / `currency` for display (`useConfiguration.tsx:41,74-75`); `costType` defaults to `perKM` (`:47`); `googleColor`; and every form's initial values.
- `isPaidVersion` is read-only (no mutation sets it). **UNVERIFIED** meaning: an upstream licence flag. Return `true` or a Fair-defined constant; no screen should be blocked by it.

Recommended backend split, so the unchanged UI keeps working:

- Anonymous / customer / rider / store callers: public subset only (currency, currencySymbol, deliveryRate, costType, Google client IDs, Firebase web config, vapidKey, publishableKey, PayPal clientId, sandbox, Amplitude keys, Sentry DSNs, googleMapLibraries, googleColor, termsAndConditions, privacyPolicy, skip\* flags, twilioEnabled, enableCustomerDemoMode, customerDemoZoneId, isPaidVersion). Resolve every other field to `null`.
- ADMIN / STAFF(`Configuration`): additionally `email`, `emailName`, `enableEmail`, `formEmail`, `sendGrid*` (non-secret), `twilioAccountSid`, `twilioPhoneNumber`, `twilioWhatsAppNumber`, `cloudinaryUploadUrl`, `cloudinaryApiKey`, and a **masked** `testOtp` (**UNVERIFIED** policy decision; see §C).

### 3.2 Save mutations (all `configurationInput: <Type>!`; GQL `mutations/configuration/index.ts`)

Each form lives under `lib/ui/screen-components/protected/super-admin/configuration/add-form/<name>/index.tsx`.

| Mutation (GQL line)                                    | Input type                                                                                                 | Variables actually sent (form file:line)                                                                                                                                                        | Response selection                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveEmailConfiguration` (3-14)                        | `EmailConfigurationInput!`                                                                                 | `{ email, emailName, enableEmail, ...(password ? {password}) }`. Password omitted when blank ("Leave the password blank to keep the current value") (`nodemailer/index.tsx:46-54,151`)          | `_id email emailName enableEmail`                                                                                                                                                                                                                                 |
| `saveFormEmailConfiguration` (16-25)                   | `FormEmailConfigurationInput!`                                                                             | **UNUSED** (no form)                                                                                                                                                                            | `_id formEmail`                                                                                                                                                                                                                                                   |
| `saveSendGridConfiguration` (27-38)                    | `SendGridConfigurationInput!`                                                                              | **UNUSED** (no form)                                                                                                                                                                            | `_id sendGridEnabled sendGridEmail sendGridEmailName`                                                                                                                                                                                                             |
| `saveFirebaseConfiguration` (40-56)                    | `FirebaseConfigurationInput!`                                                                              | `{ firebaseKey, authDomain, projectId, storageBucket, msgSenderId, appId, measurementId, vapidKey }` (`firebase-admin/index.tsx:65-74`)                                                         | same + `_id`                                                                                                                                                                                                                                                      |
| `saveSentryConfiguration` (58-72)                      | `SentryConfigurationInput!`                                                                                | `{ dashboardSentryUrl, webSentryUrl, apiSentryUrl, customerAppSentryUrl, restaurantAppSentryUrl, riderAppSentryUrl }` (`sentry-config/index.tsx:59-66`)                                         | same + `_id`                                                                                                                                                                                                                                                      |
| `saveGoogleApiKeyConfiguration` (74-83)                | `GoogleApiKeyConfigurationInput!`                                                                          | `{ googleMapsApiKey }` (`google-api/index.tsx:48-50`)                                                                                                                                           | `_id googleApiKey: googleMapsApiKey` (alias). **The form's initial value reads `configuration.googleApiKey`, which `configuration` does not select**, so the field always starts empty. Treat `googleMapsApiKey` as write-only server-side (a Maps _server_ key). |
| `saveCloudinaryConfiguration` (85-95)                  | `CloudinaryConfigurationInput!`                                                                            | `{ cloudinaryUploadUrl, cloudinaryApiKey }` (`cloudinary/index.tsx:49-52`)                                                                                                                      | `_id cloudinaryUploadUrl cloudinaryApiKey`                                                                                                                                                                                                                        |
| `saveAmplitudeApiKeyConfiguration` (97-107)            | `AmplitudeApiKeyConfigurationInput!`                                                                       | `{ webAmplitudeApiKey, appAmplitudeApiKey }` (`amplitude/index.tsx:48-51`)                                                                                                                      | same + `_id`                                                                                                                                                                                                                                                      |
| `saveGoogleClientIDConfiguration` (109-121)            | `GoogleClientIDConfigurationInput!`                                                                        | `{ webClientID, androidClientID, iOSClientID, expoClientID }` (`google-client/index.tsx:55-60`)                                                                                                 | same + `_id`                                                                                                                                                                                                                                                      |
| `saveWebConfiguration` (123-131)                       | `WebConfigurationInput!`                                                                                   | **UNUSED** (no form)                                                                                                                                                                            | `_id googleMapLibraries googleColor`                                                                                                                                                                                                                              |
| `saveAppConfigurations` (133-146)                      | `AppConfigurationsInput!`                                                                                  | `{ termsAndConditions, privacyPolicy, testOtp: String, enableCustomerDemoMode: Boolean, customerDemoZoneId: String \| null }` (`app-config/index.tsx:90-96`)                                    | `_id termsAndConditions privacyPolicy testOtp enableCustomerDemoMode customerDemoZoneId`                                                                                                                                                                          |
| `saveDeliveryRateConfiguration` (148-158)              | `DeliveryCostConfigurationInput!`                                                                          | `{ deliveryRate: Float, costType: String }` (`delivery-rate/index.tsx:48-51`). **UNVERIFIED:** costType values `perKM` (default, `useConfiguration.tsx:47`) / `fixed`; check the form dropdown. | `_id deliveryRate costType`                                                                                                                                                                                                                                       |
| `savePaypalConfiguration` (160-170)                    | `PaypalConfigurationInput!`                                                                                | `{ clientId, sandbox, ...(clientSecret ? {clientSecret}) }` (`paypal/index.tsx:47-54`)                                                                                                          | `_id clientId sandbox`                                                                                                                                                                                                                                            |
| `saveStripeConfiguration` (172-181)                    | `StripeConfigurationInput!`                                                                                | `{ publishableKey, ...(secretKey ? {secretKey}) }` (`stripe/index.tsx:46-52`)                                                                                                                   | `_id publishableKey`                                                                                                                                                                                                                                              |
| `saveTwilioConfiguration` (183-196)                    | `TwilioConfigurationInput!`                                                                                | `{ twilioAccountSid, twilioPhoneNumber: String, twilioEnabled, twilioWhatsAppNumber: String, ...(twilioAuthToken ? {twilioAuthToken}) }` (`twilio/index.tsx:57-70`)                             | `_id twilioAccountSid twilioPhoneNumber twilioEnabled twilioWhatsAppNumber`                                                                                                                                                                                       |
| `saveVerificationsToggle` (198-208)                    | `VerificationConfigurationInput!`                                                                          | `{ skipEmailVerification, skipMobileVerification, skipWhatsAppOTP }` (`verification/index.tsx:53-57`)                                                                                           | `skipEmailVerification skipMobileVerification skipWhatsAppOTP` (no `_id`)                                                                                                                                                                                         |
| `saveCurrencyConfiguration` (210-220)                  | `CurrencyConfigurationInput!`                                                                              | `{ currency: <ISO code>, currencySymbol }`, both taken from dropdown `.code` (`currency/index.tsx:53-56`)                                                                                       | `_id currency currencySymbol`                                                                                                                                                                                                                                     |
| `setVersions` (`mutations/app-versions/index.ts:3-15`) | `customerAppVersion/riderAppVersion/restaurantAppVersion: AppTypeInput` = `{android: String, ios: String}` | `app-versions/index.tsx:41-55`                                                                                                                                                                  | scalar (no selection). **UNVERIFIED:** return type, probably `String`/`Boolean`                                                                                                                                                                                   |
| `getVersions` (`queries/app-versions/index.ts:3-19`)   | none                                                                                                       |                                                                                                                                                                                                 | `{customerAppVersion,riderAppVersion,restaurantAppVersion}{android ios}`                                                                                                                                                                                          |

Write-only semantics required by the UI: for `password`, `clientSecret`, `secretKey` and `twilioAuthToken`, the client **omits the key when the input is blank**. The backend must treat an absent key as "keep the existing value" and must never echo the secret back.

### 3.3 Secret vs public classification

See §C for the consolidated list.

### 3.4 Client-side "decryption" code (do not use)

`lib/utils/methods/decryption/decrypt.ts` and `decrypt-config-fields.ts` implement AES-GCM decryption of `iv:cipher:tag` config strings using `NEXT_PUBLIC_ENCRYPTION_KEY`, a key that would be shipped to every browser. `decryptConfigFields` has **no callers** (grep). The backend must return plaintext public values, and must never rely on client-side decryption to protect secrets.

---

## 4. Pagination conventions (for a shared backend helper)

The UI paginates 1-based everywhere: `page`/`pageNo` start at 1. The shared table component computes `page = floor(first/rows)+1`, offers rows-per-page `[10,15,25,50]`, and resets to page 1 when it receives an empty page and `currentPage > 1` (`lib/ui/useable-components/table/index.tsx:59-105`). The orders screen caps `rows` at 100 (`UI/super-admin/order/main/index.tsx:~207`). Search strings are debounced by 500 ms in most screens (600 ms on orders), and `''` is usually converted to `undefined`.

Fields the UI actually **reads**:

- the row array (`data` / `orders` / `auditLogs` / `deals` …)
- `totalCount`
- sometimes `currentPage`
- `pagination.total` for wallet queries

`totalPages`, `nextPage` and `prevPage` are selected but never read. They must still resolve, as non-null-safe values.

Seven argument/response shapes are in use:

| #   | Args                                                                                                                                                             | Response                                                                                                                     | Ops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `page: Int, limit: Int, search: String, …filters`                                                                                                                | `{ data: [T], totalCount: Int, currentPage: Int, totalPages: Int }`                                                          | `restaurantsPaginated`, `getClonedRestaurantsPaginated`, `usersPaginated(registrationMethod,status)`, `staffsPaginated(isActive)`, `ridersPaginated(zone,available,isActive)`, `zonesPaginated(isActive)`, `couponsPaginated(enabled,startDate,endDate)`, `restaurantCouponsPaginated(restaurantId!,enabled)`, `cuisinesPaginated(shopType)`, `notificationsPaginated`, `restaurantCategoriesPaginated(restaurantId!)`, `restaurantAddonsPaginated(restaurantId!)`, `restaurantOptionsPaginated(restaurantId!)`, `restaurantReviewsPaginated(restaurantId!,minRating,maxRating)` (default limit 5), `getStoreDetailsByVendorIdPaginated(id!,dateKeyword,starting_date,ending_date)` |
| P1b | `page, limit, search, sortBy: CommissionRateSortField, sortOrder: CommissionRateSortOrder`                                                                       | `{ restaurant: [T], currentPage, totalPages, totalCount, nextPage, prevPage }`                                               | `commissionRate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P1c | `page, limit` (+ `userId: ID!`)                                                                                                                                  | `{ orders\|auditLogs: [T], totalCount, totalPages, currentPage, nextPage?, prevPage? }`                                      | `ordersByUser`, `auditLogs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P2  | `page: Int, rows: Int, search, orderStatus: [String], …`                                                                                                         | `{ orders: [Order], totalCount, currentPage, totalPages, prevPage, nextPage }`                                               | `allOrdersPaginated(dateKeyword,starting_date,ending_date,restaurantId,riderId)`, `ordersByRestId(restaurant!)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P3  | `page: Int, rowsPerPage: Int, actions: [String], search, restaurantId: ID`                                                                                       | `{ totalCount, orders: [Order] }`                                                                                            | `getActiveOrders`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P4  | `pagination: { pageSize: Int!, pageNo: Int! }, dateFilter: { starting_date, ending_date }, search, userType, userId, …` (inline object literals in the document) | `{ success?, message?, data: …, pagination: { total: Int } }`                                                                | `earnings`, `transactionHistory`, `withdrawRequests` (no dateFilter)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P5  | `filter: FetchShopTypeFilter, pagination: PaginationInput` (never populated by the UI)                                                                           | `{ data, total, page, pageSize, totalPages, hasNextPage, hasPrevPage }`                                                      | `fetchShopTypes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P6  | `input: { page, limit }` / `{ userId, filters: { page, limit } }` / `{ ticket, page, limit }`                                                                    | `{ users\|tickets: [T], docsCount, totalPages, currentPage }`; messages: `{ messages, ticket, page, totalPages, docsCount }` | support tickets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Recommended helper: `paginate({ page = 1, limit = 10, maxLimit = 100 })` returns `{ items, totalCount, currentPage, totalPages, nextPage, prevPage, hasNextPage, hasPrevPage }`. Add thin per-shape adapters on top:

- P1: rename `items` to `data`.
- P2/P3: rename to `orders`; `rows`/`rowsPerPage` become `limit`.
- P4: `pageNo`/`pageSize` become `page`/`limit`; output `pagination: { total }`.
- P5: `total`, `page`, `pageSize`.
- P6: `docsCount`.

`nextPage`/`prevPage` are `Int` page numbers, or null at the edges (**UNVERIFIED** type).

Defaults to apply when an argument is absent, because P5 and several P1 calls omit them:

- `page = 1`
- `limit = 10`
- `fetchShopTypes` with no pagination returns **all** rows (the UI expects every shop type for dropdowns, `lib/hooks/useShopType.tsx:20-35`).

Client quirks the backend must tolerate:

- The super-admin transaction history sends `pageSize: pageSize + 30` (40 by default) (`UI/super-admin/transactionhistory/view/main/index.tsx:65-73`). Cap it with `maxLimit`.
- The super-admin withdraw-request status filter is applied client-side to the current page only (`UI/super-admin/withdraw-requests/view/main/index.tsx:98-109`).
- Wallet date filters send full ISO UTC strings (`2026-10-07T18:30:00.000Z`) from PrimeReact Calendar, while orders and dashboards send `YYYY-MM-DD`. Parse both.

---

## 5. Commission, earnings and finance semantics visible in the UI

### 5.1 Commission rate

- The restaurant field `commissionRate: Float` is shown on store lists (`GQL: queries/restaurants/index.ts:61,88`), on create and duplicate responses, and on withdraw-request `store`.
- The super-admin commission screen (`/management/commission-rates`, STAFF `Commission Rate`) works as follows:
  - **List:** `commissionRate(page, limit, search, sortBy: CommissionRateSortField, sortOrder: CommissionRateSortOrder)` (`GQL: queries/restaurants/index.ts:27-45`).
    - Response root fields: `restaurant` (a **list**, despite the singular name), `currentPage`, `totalPages`, `totalCount`, `nextPage`, `prevPage`.
    - Variables: `{ page: currentPage, limit: rowsPerPage, search: term || undefined, sortBy: 'COMMISSION_RATE' | 'NAME', sortOrder: 'ASC' | 'DESC' }` (`lib/ui/screen-components/protected/super-admin/commission-rate/view/main/index.tsx:68-81`).
    - The enums therefore need at least `CommissionRateSortField { NAME, COMMISSION_RATE }` and `CommissionRateSortOrder { ASC, DESC }`.
  - **Update:** `updateCommission(id: String!, commissionRate: Float!) { _id commissionRate }` (`GQL: mutations/commission-rate/index.ts:2-9`). The client sends only finite values in `0 ≤ rate ≤ 100`, so the unit is **percent** (`.../commission-rate/view/main/index.tsx:86-104`).
- Fair rule: zero food commission on the core plan. The backend stores the rate as integer basis points and exposes it as a Float percent. It rejects any change that violates the plan policy, with a clear GraphQL error; the UI shows `t('Error updating commission rate for')`. It defaults new stores to `0`. Do not fabricate a policy for non-core plans (**blocker** if undefined).

### 5.2 Earnings (`earnings` query)

`GQL: queries/earnings/index.ts:3-72` (super-admin `GET_EARNING`) and `:74-135` (store `GET_EARNING_FOR_STORE`, which drops `platformEarnings` and `grandTotalEarnings.platformTotal`).

Arguments:

- `userId: String`
- `userType: UserTypeEnum`
- `orderType: OrderTypeEnum`
- `paymentMethod: PaymentMethodEnum`
- `search: String`
- `pagination: { pageSize: Int!, pageNo: Int! }`, an inline input object. **UNVERIFIED** type name, e.g. `PaginationInput`.
- `dateFilter: { starting_date: String, ending_date: String }`

Enum values (from `lib/utils/interfaces/earnings.interface.ts:44-61`). The UI maps `'ALL'` to `undefined` before sending, so `ALL` never reaches the server from these screens; the enum still needs to declare it.

- `UserTypeEnum { ALL, RIDER, STORE }`
- `OrderTypeEnum { ALL, DELIVERY, PICKUP }`
- `PaymentMethodEnum { ALL, COD, PAYPAL, STRIPE }`

Response shape:

```
{ success, message,
  data { earnings [ { _id orderId orderType paymentMethod createdAt updatedAt
        platformEarnings { marketplaceCommission deliveryCommission tax platformFee totalEarnings }
        riderEarnings  { riderId { _id name username } deliveryFee tip totalEarnings }
        storeEarnings  { storeId { _id name username } orderAmount totalEarnings } } ]
        grandTotalEarnings { platformTotal riderTotal storeTotal } },
  pagination { total } }
```

Callers:

- Super-admin (`lib/ui/screen-components/protected/super-admin/earnings/view/main/index.tsx:42-66`) sends `{ pageSize, pageNo: currentPage, startingDate, endingDate, search, userType, userId, orderType, paymentMethod }`.
- Store (`lib/ui/screen-components/protected/restaurant/earnings/main/index.tsx:50-71`) hard-codes `userType: STORE, userId: restaurantId`. The backend must ignore or validate `userId` for RESTAURANT/VENDOR sessions.

Semantics, all **UNVERIFIED** and derived from field names:

- There is one earnings row per completed order. It splits the order into a platform share, a rider share and a store share.
- `platformEarnings.marketplaceCommission` is the food commission, which under Fair is `0` on the core plan. `deliveryCommission` is the platform cut of the delivery fee. `tax` is collected tax. `platformFee` is the customer service fee.
- `riderEarnings` is the delivery fee plus tip. `storeEarnings.orderAmount` is the food subtotal the store receives.
- Under Fair, these rows must be **projections of the immutable balanced journal**, not independently stored totals.

### 5.3 Transaction history (payouts executed)

`transactionHistory(userType, userId, search, pagination{pageSize,pageNo}, dateFilter{starting_date,ending_date})` (`GQL: queries/transaction-history/index.ts:3-73`).

Response:

```
{ data [ { _id amountCurrency status transactionId userType userId amountTransferred createdAt
           toBank { accountName bankName accountNumber accountCode }
           rider {...wallet fields...} store {...} } ],
  pagination { total } }
```

- Super-admin screen: `lib/ui/screen-components/protected/super-admin/transactionhistory/view/main/index.tsx:65`.
- Store screen: `.../restaurant/transaction-history/main/index.tsx:67-76`, which sends `{ pageSize, pageNo, startingDate, endingDate, userId: restaurantId, userType: 'STORE' }`.
- Semantics: one record per transferred withdrawal (**UNVERIFIED**).
- `toBank.accountNumber` is shown in full. Mask it server-side except for ADMIN / the owning store (**UNVERIFIED** policy).

### 5.4 Withdraw requests (payout requests)

- **List:** `withdrawRequests(userType, userId, pagination{pageSize,pageNo}, search) { message pagination{total} success data[{ _id requestId requestAmount requestTime status createdAt rider{… currentWalletAmount totalWalletAmount withdrawnWalletAmount bussinessDetails{…}} store{… stripeDetailsSubmitted commissionRate bussinessDetails{bankName accountName accountCode accountNumber bussinessRegNo companyRegNo taxRate}} }] }` (`GQL: queries/withdraw-requests/index.ts:3-77`).
  - Store screen: `.../restaurant/withdraw-requests/view/main/index.tsx:54-62`, which sends `{ pageSize, pageNo, userType: 'STORE', userId: restaurantId }`.
  - Super-admin screen: `.../super-admin/withdraw-requests/view/main/index.tsx:61`.
- **Status values:** `REQUESTED`, `TRANSFERRED`, `CANCELLED` (`.../restaurant/withdraw-requests/view/main/index.tsx:50-52`; dropdowns in `lib/ui/useable-components/table/columns/withdraw-requests-columns.tsx:~140-160` and `withdraw-request-admin-columns.tsx:21`).
- **Create (store):** `createWithdrawRequest(requestAmount: Float!) { _id requestId requestAmount requestTime status createdAt }` (`GQL: mutations/withdraw-requests/index.ts:71-82`). There is **no store id argument**, so the server derives the requester from the session (**UNVERIFIED** for ADMIN impersonating a store). The UI shows `restaurant.currentWalletAmount` as the available balance (`.../restaurant/withdraw-requests/form/index.tsx:37-38,126`). The server must reject amounts above the available balance, and must never trust the client figure.
- **Update (admin):** `updateWithdrawReqStatus(id: ID!, status: String!) { success message data{…same as list item…} }` (`GQL: mutations/withdraw-requests/index.ts:3-69`). The status transitions REQUESTED→TRANSFERRED and REQUESTED→CANCELLED must go through the central transition validator. TRANSFERRED must post a journal entry (store wallet → bank clearing) and create the `transactionHistory` record. Fair has no payout provider configured, so actually moving money is a **provider blocker**: do not report TRANSFERRED as a real bank transfer.

### 5.5 Wallet fields

- Restaurant: `currentWalletAmount`, `totalWalletAmount`, `withdrawnWalletAmount` (`GQL: queries/restaurants/index.ts:248-250`).
- Rider: the same three fields plus `accountNumber` (`GQL: queries/withdraw-requests/index.ts:36-39`).
- These are derived balances: available, lifetime credited and lifetime withdrawn. They must be computed from the journal.

### 5.6 Business and bank details

- `restaurant.bussinessDetails { bankName accountName accountCode accountNumber bussinessRegNo companyRegNo taxRate }` (spelling **bussiness** must be preserved).
- Written by `updateRestaurantBussinessDetails(id: String!, bussinessDetails: BussinessDetailsInput) { success message data{_id} }` (`GQL: mutations/restaurant/index.ts:185-201`).
- This is PII and financial data. Only ADMIN, STAFF(`Stores`/`Withdraw Request`) and the owning store/vendor may read it.

### 5.7 Stripe Connect

- `restaurant.stripeDetailsSubmitted: Boolean` drives the "connected" state of the store Payment screen.
- Clicking "connect" runs `POST /stripe/account {restaurantId}` and expects `{url}` (see §0). The return/refresh URLs are server-defined (**UNVERIFIED**).
- Fair: this is a **provider blocker** until a Stripe Connect account and keys exist. The endpoint must return an error, never a fabricated URL.

### 5.8 Order money fields displayed

- `orderAmount`, `paidAmount`, `deliveryCharges`, `tipping`, `taxationAmount` (orders queries).
- The order detail modal recomputes the subtotal client-side as `Σ (variation.price + Σ addon.options.price) × quantity` (`lib/ui/useable-components/popup-menu/order-details-modal.tsx:41-54`). Server-side item snapshots must make that formula reproduce the server's subtotal, so the display stays consistent.

### 5.9 Tipping and taxation

- `tips { _id tipVariations enabled }` (`GQL: queries/tippings/index.ts:3-11`).
- `createTipping` / `editTipping(tippingInput: TippingInput!)` (`GQL: mutations/tippings/index.ts`). `tipVariations` is a `[Float]` of preset amounts or percentages (**UNVERIFIED** which).
- Taxation: `createTaxation` / `editTaxation(taxationInput: TaxationInput!) { _id taxationCharges enabled }` are raw strings (`GQL: mutations/taxations/index.ts:1-14`) and are **UNUSED**: no query and no call site. There is no taxation screen in multivendor-admin. Store-level tax uses `restaurant.tax` (Float, a percent, **UNVERIFIED**) and `bussinessDetails.taxRate`.

---

## 6. Comparison: enatega-singlevendor-admin

Root: `vendor/enatega-ui/enatega-singlevendor-admin/`. All of its GraphQL lives in `lib/api/graphql/**`; there are no inline documents elsewhere. In this section, `SV:` paths are relative to that `lib/api/graphql/` directory.

The single-vendor admin uses the same transport, metrics/nonce headers, `ownerLogin`/`ownerSession`/`refreshToken` flow, userType values and guards as multivendor-admin.

It differs in four places:

- It **has a `middleware.ts`** (`enatega-singlevendor-admin/middleware.ts:1-35`). It only sets a CSP; it does no auth. Its `img-src` is `'self' data: blob: https://assets.enatega.com https://res.cloudinary.com https://*.amazonaws.com`, and the CSP is enforced only when `CSP_ENFORCE=true`. So `uploadImageToS3` URLs must come from one of those hosts (e.g. `*.amazonaws.com`) or from same-origin, or SV images break under enforced CSP. A config change to allow a Fair CDN host is an allowed integration change, but it must be recorded in provenance.
- Its Stripe `POST /stripe/account` call **does** send `Authorization: Bearer <token>` (`enatega-singlevendor-admin/lib/ui/screen-components/protected/restaurant/payment/main/index.tsx:51-58`). multivendor-admin's call does not.
- It ships `scripts/check-single-vendor-schema.js`, which validates every document against a server schema module (`SINGLE_VENDOR_SCHEMA_MODULE`). That makes it a useful conformance-test harness for the Fair schema.
- It reads mode flags `isMultiVendor`, `restaurantCount` and `isAppLaunched` from `adminConfiguration`.

### 6.1 Operations used by singlevendor-admin and not by multivendor-admin (27 root fields), by feature

| Feature                           | Op                                                  | Signature → key selection                                                                                                                                                                                                                                                                                                                                                   | SV location                                   |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Auth                              | M `ownerLogout`                                     | `ownerLogout → scalar` (called from all three app bars)                                                                                                                                                                                                                                                                                                                     | `SV:mutations/authentication/index.ts:31`     |
| Dashboard                         | Q `getDashboardOrderSalesDetailsByPaymentMethod`    | `(restaurant: String!, starting_date: String!, ending_date: String!) → { all{_type data{…}} cod{…} card{…} }`. This is **not** the same field as multivendor's `getRestaurantDashboardOrderSalesDetailsByPaymentMethod`.                                                                                                                                                    | `SV:queries/dashboard/index.ts:109`           |
| Catalog / food                    | Q `getAllfoods`                                     | `(restaurantId: String!) → [{ id title image variations{id title price outofstock} }]` (uses `id`, not `_id`)                                                                                                                                                                                                                                                               | `SV:queries/food/index.ts:35`                 |
|                                   | Q `getAllfoodsPaginated`                            | `(restaurantId: ID!, page, limit, search) → { page limit hasnext hasprev totalFoods foods[{ category{id title} food{ id title description subCategory ingredients usage nutritions{name quantity} nutritionDetail image isActive UOM inventory isOutOfStock orderQuantity{min max} variations{id title price outofstock deal{…} addons{title description isActive}} } }] }` | `:89`                                         |
|                                   | M `createFoodSingleVendor`                          | `(foodInput: inputCreateFood!) → { _id categories{…foods…} }`                                                                                                                                                                                                                                                                                                               | `SV:mutations/food/index.ts:77`               |
|                                   | M `updateFoodSingleVendor`                          | `(foodId: ID!, foodInput: inputUpdateFood!) → same`                                                                                                                                                                                                                                                                                                                         | `:110`                                        |
| Catalog / deals                   | Q `getAllFoodDealsAdmin`                            | `(page: Int!, limit: Int!, isActive: Boolean, search: String, restaurantId: ID!) → { total page limit deals[{ id title discountType food variation restaurant startDate endDate discountValue isActive foodTitle variationTitle }] }`                                                                                                                                       | `SV:queries/food/index.ts:57`                 |
|                                   | M `createFoodDeal`                                  | `(input: CreateDealInput!) → { id title discountType food variation startDate endDate discountValue isActive }`                                                                                                                                                                                                                                                             | `SV:mutations/food-deal/index.ts:5`           |
|                                   | M `updateFoodDeal`                                  | `(id: ID!, input: UpdateDealInput!) → same`                                                                                                                                                                                                                                                                                                                                 | `:23`                                         |
|                                   | M `deleteFoodDeal`                                  | `(id: ID!) → { message }`                                                                                                                                                                                                                                                                                                                                                   | `:41`                                         |
| Store schedule (scheduled orders) | Q `getRestaurantSchedule`                           | `(restaurantId: ID!) → [{ day isOpen _id times{startTime endTime maxOrder _id} }]`                                                                                                                                                                                                                                                                                          | `SV:queries/restaurants/index.ts:262`         |
|                                   | M `updateScheduleTimings`                           | `(id: ID!, scheduleTimings: [ScheduleTypeInput]) → { name scheduleTimings{_id day isOpen times{_id startTime endTime maxOrder}} }`                                                                                                                                                                                                                                          | `SV:mutations/restaurant/index.ts:208`        |
| Store banners                     | Q `bannerRestaurants`                               | `(restaurantId: ID) → [{ _id title description file foodId restaurant foodImage foodTitle displayImage isActive }]`                                                                                                                                                                                                                                                         | `SV:queries/bannerRestaurant/index.tsx:5`     |
|                                   | Q `bannerRestaurant`                                | `(banner: String!, restaurantId: ID!)`. Defined but unused.                                                                                                                                                                                                                                                                                                                 | `:22`                                         |
|                                   | M `createBannerRestaurant` / `editBannerRestaurant` | `(bannerInput: BannerRestaurantInput!)`                                                                                                                                                                                                                                                                                                                                     | `SV:mutations/bannerRestaurant/index.ts:5,22` |
|                                   | M `deleteBannerRestaurant`                          | `(id: String!)`                                                                                                                                                                                                                                                                                                                                                             | `:39`                                         |
| Configuration                     | Q `adminConfiguration` (aliased `configuration:`)   | multivendor fields + `googleApiKey hasEmailPasswordConfigured hasPaypalSecretConfigured hasStripeSecretConfigured hasTwilioSecretConfigured hasSendGridSecretConfigured isMultiVendor restaurantCount isAppLaunched`. **This is the correct write-only pattern: secrets are exposed only as `has*Configured` booleans.**                                                    | `SV:queries/configuration/index.ts:5`         |
|                                   | M `saveVendorTypeToggle`                            | `(configurationInput: VendorTypeConfigurationInput!) → { isMultiVendor }` (operation name collides with `SAVE_VERIFICATIONS_TOGGLE`)                                                                                                                                                                                                                                        | `SV:mutations/configuration/index.ts:210`     |
|                                   | M `saveGeneralConfiguration`                        | `(configurationInput: GeneralConfigurationInput!) → { isAppLaunched }`                                                                                                                                                                                                                                                                                                      | `:232`                                        |
| Users / credits                   | Q `getAllCreditsRecords`                            | `(searchTerm: String) → [{ _id userId{_id name email} amount orderId recordType createdAt updatedAt }]`                                                                                                                                                                                                                                                                     | `SV:queries/user-credits.ts:5`                |
|                                   | Q `getAllUsersDropDownSearch`                       | `(searchTerm: String) → [{ _id name email }]`                                                                                                                                                                                                                                                                                                                               | `:23`                                         |
|                                   | M `giveUserCredits`                                 | `(userId: ID!, amount: Float!, orderId: String!, recordType: CreditRecordType!)`                                                                                                                                                                                                                                                                                            | `SV:mutations/user-credits/index.ts:5`        |
|                                   | M `editUserCreditsHistory`                          | `(id: ID!, amount: Float!)`                                                                                                                                                                                                                                                                                                                                                 | `:23`                                         |
| Finance / subscription plans      | Q `getAllSubscriptionPlans`                         | `→ { plans[{ id amount interval intervalCount productName productId }] }`                                                                                                                                                                                                                                                                                                   | `SV:queries/subscription/index.ts:5`          |
|                                   | M `createPriceForProduct`                           | `(input: CreatePriceInput!) → { success message price{…} }`                                                                                                                                                                                                                                                                                                                 | `SV:mutations/subscription/index.ts:5`        |
|                                   | M `deactivatePrice`                                 | `(input: DeactivatePriceInput!) → { success message }`                                                                                                                                                                                                                                                                                                                      | `:22`                                         |

These features have **no** singlevendor-only root fields: categories, sub-categories, addons/options, riders, zones, staff, coupons (platform), reviews, tipping/taxation, support, audit, earnings/withdrawals/transaction history.

### 6.2 Shared root fields whose shapes differ (the schema must accept both)

| Root field                                                                                                            | multivendor-admin                        | singlevendor-admin                                                                            | Backend requirement                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `createRestaurant`                                                                                                    | `owner: ID!`                             | `owner: ID`                                                                                   | Declare `owner: ID` (nullable). A non-null declaration breaks SV validation. |
| `configuration`                                                                                                       | plain `configuration{…}`                 | `adminConfiguration{…}` aliased                                                               | Both root fields. `Configuration` type = union of fields.                    |
| `saveGoogleApiKeyConfiguration`                                                                                       | selects `googleApiKey: googleMapsApiKey` | selects `googleApiKey`                                                                        | Expose both `googleMapsApiKey` and `googleApiKey` (masked or null; see §C).  |
| `uploadImageToS3`                                                                                                     | `(image)`                                | `(image, publicMedia: Boolean)`                                                               | Optional `publicMedia`.                                                      |
| `sendNotificationUser`, `notifications`                                                                               | no recipient                             | `recipientType: NotificationRecipientType` arg + field                                        | Add enum, optional arg and field.                                            |
| `coupons`, `createCoupon`, `editCoupon`                                                                               | + `startDate endDate lifeTimeActive`     | without them                                                                                  | Additive.                                                                    |
| `restaurantCoupons`, `create/editRestaurantCoupon`                                                                    | no dates                                 | + `startDate endDate`                                                                         | Restaurant coupon type needs dates.                                          |
| `banners`, `createBanner`, `editBanner`                                                                               |                                          | + `buttonText`                                                                                | Add `Banner.buttonText`.                                                     |
| `getActiveOrders`, `subscriptionDispatcher`                                                                           |                                          | + `deliveryType`                                                                              | Add `Order.deliveryType`.                                                    |
| `ordersByRestId`, `allOrders`, `allOrdersWithoutPagination`, `ordersByRestIdWithoutPagination`, `subscribePlaceOrder` | no `eta` in these                        | + `completionTime preparationTime eta{…}`                                                     | Additive.                                                                    |
| `restaurants`                                                                                                         | flat                                     | op `GetSingleVendorDashboardCatalog` selects `categories{_id createdAt foods{_id createdAt}}` | Nested resolvers on list.                                                    |
| `getClonedRestaurants(Paginated)`                                                                                     | + `unique_restaurant_id`                 | without                                                                                       | Additive.                                                                    |

---

## A. Consolidated admin domain types and fields

These are the union of fields selected across multivendor-admin. `+SV` marks extra fields that only singlevendor-admin needs. Money fields are `Float` major units. Ids are `String`/`ID` Mongo-style `_id`; Fair may use UUIDs as long as they are strings.

- **OwnerAuthPayload** (`ownerLogin`, `ownerSession`): userId, token, tokenExpiration, refreshToken, refreshTokenExpiration, email, userType (`ADMIN|STAFF|VENDOR|RESTAURANT`), userTypeId, restaurants[`{_id orderId name image address}`], permissions[String], image, name, isActive.
- **RefreshPayload**: userId, token, tokenExpiration, refreshToken, refreshTokenExpiration.
- **MetricsPayload**: excellence, topgun, experience, skydiver, rider, haha, hehe, huhu, yoyo, turu (all `String`, **UNVERIFIED** types).
- **Vendor (Owner)**: \_id, unique_id, email, userType, isActive, name, image, firstName, lastName, phoneNumber, restaurants[Restaurant].
- **RestaurantByOwner**: \_id, email, userType, restaurants[Restaurant].
- **Restaurant**:
  - Identity and contact: \_id, unique_restaurant_id, orderId (Int counter), orderPrefix, slug, name, image, logo, phone, address, city, postCode, username.
  - Location and delivery: location{coordinates}, deliveryBounds{coordinates}, boundType, circleBounds{radius}, deliveryInfo{minDeliveryFee deliveryDistance deliveryFee}, deliveryOptions{delivery pickup}, deliveryTime, minimumOrder.
  - Status: isActive, isAvailable.
  - Money and payments: commissionRate, tax, stripeDetailsSubmitted, bussinessDetails{bankName accountName accountCode accountNumber bussinessRegNo companyRegNo taxRate}, currentWalletAmount, totalWalletAmount, withdrawnWalletAmount.
  - Ratings: rating, reviewAverage.
  - Relations: owner{\_id email isActive}, shopType (String), cuisines[String], openingTimes[{day times[{startTime:[String] endTime:[String]}]}], categories[Category], addons[Addon], options[Option].
  - `+SV`: scheduleTimings (via a separate op).
- **RestaurantDeliveryZoneInfo**: boundType, deliveryBounds{coordinates}, location{coordinates}, circleBounds{radius}, address, city, postCode.
- **MutationResult\<T>** (`updateDeliveryBoundsAndLocation`, `updateRestaurantDelivery`, `updateRestaurantBussinessDetails`): `{ success: Boolean, message: String, data: T }`.
- **Category**: \_id, title, image, foods[Food], createdAt, updatedAt; `+SV` subCategories via a separate op.
- **SubCategory**: \_id, title, parentCategoryId.
- **Food**: \_id, title, description, image, isActive, isOutOfStock, subCategory (String id), variations[Variation], createdAt, updatedAt. `+SV`: id, ingredients, usage, nutritions, nutritionDetail, UOM, inventory, orderQuantity{min max}.
- **Variation**: \_id, title, price, discounted, addons[String ids], isOutOfStock; `+SV` id, outofstock, deal.
- **Addon**: \_id, title, description, quantityMinimum, quantityMaximum, options[String ids].
- **Option**: \_id, title, description, price.
- **Order**:
  - Identity: \_id, orderId (display string), zone{\_id}.
  - Parties: restaurant{\_id name image address location{coordinates}}, user{\_id name phone email}, rider{\_id name username available}.
  - Address: deliveryAddress{location{coordinates} deliveryAddress details label}.
  - Items: items[{\_id id title description image quantity specialInstructions isActive createdAt updatedAt variation{\_id id title price discounted} addons[{\_id id title description quantityMinimum quantityMaximum options[{_id id title description price}]}]}].
  - Money and payment: paymentMethod, paidAmount, orderAmount, deliveryCharges, tipping, taxationAmount, paymentStatus.
  - Status and timing: orderStatus, status (Boolean), isPickedUp, reason, isActive, createdAt, completionTime, preparationTime, expectedTime, acceptedAt, selectedPrepTime.
  - eta{phase source readyAt estimatedArrivalAt windowStartAt windowEndAt calculatedAt lastLocationAt}.
  - `+SV`: deliveryType.
- **OrderTracking**: orderId, status, riderLocation{latitude longitude accuracy heading speed recordedAt}, eta{…}.
- **PlaceOrderEvent**: userId, origin, order.
- **Rider**:
  - Profile: \_id, name, username, email, phone, image, vehicleType, zone{\_id title}.
  - Status: available, assigned, isActive.
  - Money: accountNumber, currentWalletAmount, totalWalletAmount, withdrawnWalletAmount, bussinessDetails{…}.
  - Documents: licenseDetails{number expiryDate image}, vehicleDetails{number image}.
  - Timestamps: createdAt, updatedAt.
- **Zone**: \_id, title, description, location{coordinates: [[[Float]]]}, isActive.
- **Staff**: \_id, name, email, phone, isActive, permissions[String], userType.
- **User (customer)**: \_id, name, email, phone, phoneIsVerified, emailIsVerified, isActive, status (`active|blocked|deactivate`), lastLogin, notes, isOrderNotification, isOfferNotification, notificationToken, userType (`google|apple|default`), favourite, createdAt, updatedAt, addresses[{_id deliveryAddress details label selected location{coordinates}}].
- **Coupon**: \_id, title, discount, enabled, startDate, endDate, lifeTimeActive.
- **Banner**: \_id, title, description, action, screen, file, parameters; `+SV` buttonText.
- **Cuisine**: \_id, name, description, image, shopType.
- **ShopType**: \_id, name, image, isActive.
- **Tipping**: \_id, tipVariations[Float], enabled.
- **Taxation**: \_id, taxationCharges, enabled.
- **Review**: \_id, order{\_id orderId items{title} user{\_id name email}}, restaurant{\_id name image}, rating, comments, description, createdAt.
- **Notification**: \_id, title, body, createdAt; `+SV` recipientType.
- **WebNotification**: \_id, body, navigateTo, read, createdAt.
- **AuditLog**: \_id, timestamp, admin{\_id email}, action, targetType, targetId, changes (JSON).
- **SupportTicket**: \_id, title, description, status (`open|inProgress|closed`), category, orderId, otherDetails, createdAt, updatedAt, user{\_id name email phone}.
- **TicketUser**: \_id, name, email, phone, isActive, userType, latestTicket.
- **TicketMessage**: \_id, content, senderType (`admin|user`, **UNVERIFIED** values besides `admin`), isRead, ticket (id), createdAt, updatedAt.
- **Earning**: \_id, orderId, orderType, paymentMethod, createdAt, updatedAt, platformEarnings{marketplaceCommission deliveryCommission tax platformFee totalEarnings}, riderEarnings{riderId{\_id name username} deliveryFee tip totalEarnings}, storeEarnings{storeId{\_id name username} orderAmount totalEarnings}; totals in grandTotalEarnings{platformTotal riderTotal storeTotal}.
- **TransactionHistory**: \_id, amountCurrency, status, transactionId, userType, userId, amountTransferred, createdAt, toBank{accountName bankName accountNumber accountCode}, rider{…}, store{unique_restaurant_id \_id name rating reviewAverage isActive isAvailable slug stripeDetailsSubmitted address phone city postCode}.
- **WithdrawRequest**: \_id, requestId, requestAmount, requestTime, status (`REQUESTED|TRANSFERRED|CANCELLED`), createdAt, rider{…}, store{…}.
- **Configuration**: see §3.1. `+SV` googleApiKey, has\*Configured ×5, hasEmailPasswordConfigured, isMultiVendor, restaurantCount, isAppLaunched.
- **Versions**: {customerAppVersion, riderAppVersion, restaurantAppVersion}{android ios}.
- **Dashboard aggregates**: see §2.1. The field names keep upstream snake_case where used (`total_orders`, `online_stores`, `_type` …).
- **Enums/strings**:
  - orderStatus `PENDING ACCEPTED ASSIGNED PICKED DELIVERED CANCELLED`
  - `UserTypeEnum{ALL RIDER STORE}`, `OrderTypeEnum{ALL DELIVERY PICKUP}`, `PaymentMethodEnum{ALL COD PAYPAL STRIPE}`
  - `CommissionRateSortField{NAME COMMISSION_RATE}`, `CommissionRateSortOrder{ASC DESC}`
  - `DeleteTypeEnum{?}` (UNVERIFIED)
  - day `MON…SUN`
  - boundType `point|radius|polygon`
  - vehicleType `bicycle|motorbike|car|pickup_truck`
  - banner action/screen strings: §2.20

---

## B. Role / permission matrix (server-side enforcement required)

Legend:

- **A** = ADMIN.
- **S(x)** = STAFF holding permission `x`.
- **S\*** = any STAFF. This is what the UI currently allows; the recommendation follows in brackets.
- **V** = VENDOR, scoped to its own vendor id and owned restaurants.
- **R** = RESTAURANT, scoped to its own `userTypeId`.
- **own** = the scope check described in §1.7.
- **pub** = unauthenticated.

| Operations                                                                                                                                                                                                                                                                                                          | Allowed                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `metricsGeneral`, `ownerLogin`, `refreshToken`                                                                                                                                                                                                                                                                      | pub (rate-limited)                                                                                                                                                                               |
| `ownerSession`, `ownerLogout`(SV), `hasOwnerPermission`, `uploadToken`(id = self), `webNotifications`, `markWebNotificationsAsRead`                                                                                                                                                                                 | any authenticated owner                                                                                                                                                                          |
| `configuration`                                                                                                                                                                                                                                                                                                     | pub → public subset only; A, S(Configuration) → admin view (§3.1)                                                                                                                                |
| `adminConfiguration`(SV), all `save*Configuration`, `saveVerificationsToggle`, `saveVendorTypeToggle`(SV), `saveGeneralConfiguration`(SV), `setVersions`                                                                                                                                                            | A, S(Configuration)                                                                                                                                                                              |
| `getVersions`                                                                                                                                                                                                                                                                                                       | pub (apps check for force-update, **UNVERIFIED**)                                                                                                                                                |
| `getDashboardUsers`, `getDashboardUsersByYear`, `getDashboardOrdersByType`, `getDashboardSalesByType`                                                                                                                                                                                                               | A, S\* [recommend S(Admin)]                                                                                                                                                                      |
| `getVendorDashboard*`, `getLiveMonitorData`, `getStoreDetailsByVendorId*`                                                                                                                                                                                                                                           | A, S(Vendors), V(own)                                                                                                                                                                            |
| `getRestaurantDashboard*`, `getDashboardOrderSalesDetailsByPaymentMethod`(SV)                                                                                                                                                                                                                                       | A, S(Stores), V(own restaurant), R(own)                                                                                                                                                          |
| `vendors`, `getVendor`, `createVendor`, `deleteVendor`                                                                                                                                                                                                                                                              | A, S(Vendors). `getVendor`/`editVendor` also V(self)                                                                                                                                             |
| `restaurants`, `restaurantsPaginated`, `getClonedRestaurants*`, `duplicateRestaurant`, `deleteRestaurant`, `hardDeleteRestaurant`                                                                                                                                                                                   | A, S(Stores). Recommend `hardDeleteRestaurant` A-only. `restaurants` list for V is filtered to its own (**UNVERIFIED** need)                                                                     |
| `restaurantByOwner(id)`                                                                                                                                                                                                                                                                                             | A, S(Vendors\|Stores), V(id = self)                                                                                                                                                              |
| `createRestaurant(owner)`                                                                                                                                                                                                                                                                                           | A, S(Stores), V(owner = self)                                                                                                                                                                    |
| `restaurant(id)`, `editRestaurant`, `updateDeliveryBoundsAndLocation`, `getRestaurantDeliveryZoneInfo`, `updateRestaurantDelivery`, `updateDeliveryOptions`, `updateTimings`, `updateRestaurantBussinessDetails`, `getRestaurantSchedule`/`updateScheduleTimings`(SV)                                               | A, S(Stores), V(own), R(own). Note: `restaurant(id)` is also a public storefront query for customer apps, but `bussinessDetails` and wallet fields must be field-level restricted to these roles |
| `commissionRate`, `updateCommission`                                                                                                                                                                                                                                                                                | A, S(Commission Rate)                                                                                                                                                                            |
| Catalogue: `create/edit/deleteCategory`, `createSubCategories`, `deleteSubCategory`, `subCategories*`, `create/edit/deleteFood`, `updateFoodOutOfStock`, `create/edit/deleteAddon(s)`, `create/edit/deleteOption(s)`, `restaurant*Paginated` (categories/addons/options), food/deal SV ops, `bannerRestaurant*`(SV) | A, S(Stores), V(own), R(own)                                                                                                                                                                     |
| `coupons`, `couponsPaginated`, `create/edit/deleteCoupon`                                                                                                                                                                                                                                                           | A, S(Coupons)                                                                                                                                                                                    |
| `restaurantCoupons*`, `create/edit/deleteRestaurantCoupon`                                                                                                                                                                                                                                                          | A, S(Stores), V(own), R(own)                                                                                                                                                                     |
| `banners` (read)                                                                                                                                                                                                                                                                                                    | pub (customer app); write `create/edit/deleteBanner`: A, S(Banners)                                                                                                                              |
| `cuisines` (read)                                                                                                                                                                                                                                                                                                   | pub; `cuisinesPaginated` + writes: A, S(Cuisine)                                                                                                                                                 |
| `fetchShopTypes`, `fetchShopTypeByUnique` (read)                                                                                                                                                                                                                                                                    | pub; writes: A, S(Shop Type)                                                                                                                                                                     |
| `staffs`, `staffsPaginated`, `create/edit/deleteStaff`                                                                                                                                                                                                                                                              | A, S(Staff). STAFF cannot grant permissions it lacks and cannot touch ADMIN accounts                                                                                                             |
| `zones`, `zonesPaginated` (read)                                                                                                                                                                                                                                                                                    | A, S\* (needed by rider/app-config forms), and pub for the customer app (**UNVERIFIED**); writes: A, S(Zone)                                                                                     |
| `riders`, `ridersPaginated`, `rider`, `availableRiders`, `ridersByZone`, `create/edit/deleteRider`, `toggleAvailablity`                                                                                                                                                                                             | A, S(Riders). `riders` is also needed by S(Dispatch) for assignment                                                                                                                              |
| `users`, `usersPaginated`, `user`, `updateUserStatus`, `updateUserNotes`, `deleteUser`, `resetUserSession`, `ordersByUser`                                                                                                                                                                                          | A, S(Users)                                                                                                                                                                                      |
| `getAllCreditsRecords`, `getAllUsersDropDownSearch`, `giveUserCredits`, `editUserCreditsHistory` (SV)                                                                                                                                                                                                               | A, S(Users) [money-moving: recommend A + audit]                                                                                                                                                  |
| `allOrdersPaginated`, `orderFilterOptions`, `allOrders`, `allOrdersWithoutPagination`                                                                                                                                                                                                                               | A, S\* [recommend S(Orders)]                                                                                                                                                                     |
| `ordersByRestId`, `ordersByRestIdWithoutPagination`, `subscribePlaceOrder`                                                                                                                                                                                                                                          | A, S(Orders\|Stores), V(own), R(own)                                                                                                                                                             |
| `getActiveOrders`, `subscriptionDispatcher`, `assignRider`, `updateStatus`                                                                                                                                                                                                                                          | A, S\* [recommend S(Dispatch)]. `updateStatus` is also used by R in the store app (separate doc), subject to transition rules                                                                    |
| `orderTracking`, `subscriptionOrderTracking`, `subscriptionOrder`                                                                                                                                                                                                                                                   | A, S(Dispatch\|Orders), V/R(own order)                                                                                                                                                           |
| `riderUpdated`                                                                                                                                                                                                                                                                                                      | A, S\*                                                                                                                                                                                           |
| `reviews`, `restaurantReviewsPaginated`                                                                                                                                                                                                                                                                             | A, S(Stores), V(own), R(own)                                                                                                                                                                     |
| `tips` (read)                                                                                                                                                                                                                                                                                                       | pub; `createTipping`/`editTipping`: A, S(Tipping)                                                                                                                                                |
| `createTaxation`/`editTaxation`                                                                                                                                                                                                                                                                                     | A only (UNUSED)                                                                                                                                                                                  |
| `earnings`                                                                                                                                                                                                                                                                                                          | A, S\* [recommend S(Admin)]. R/V only with `userType=STORE` and userId = own restaurant (force server-side)                                                                                      |
| `transactionHistory`                                                                                                                                                                                                                                                                                                | same as `earnings`                                                                                                                                                                               |
| `withdrawRequests`                                                                                                                                                                                                                                                                                                  | A, S(Withdraw Request); R/V own store only                                                                                                                                                       |
| `updateWithdrawReqStatus`                                                                                                                                                                                                                                                                                           | A, S(Withdraw Request)                                                                                                                                                                           |
| `createWithdrawRequest`                                                                                                                                                                                                                                                                                             | R (own; amount ≤ available balance). V and A acting in the store context: **UNVERIFIED**; recommend rejecting non-RESTAURANT callers or requiring an explicit store scope                        |
| `notifications`, `notificationsPaginated`, `sendNotificationUser`                                                                                                                                                                                                                                                   | A, S(Notification)                                                                                                                                                                               |
| `getTicketUsers*`, `getSingleUserSupportTickets`, `getSingleSupportTicket`, `getTicketMessages`, `createMessage`, `updateSupportTicketStatus`                                                                                                                                                                       | A, S\* [recommend a new permission or S(Users)]                                                                                                                                                  |
| `auditLogs`                                                                                                                                                                                                                                                                                                         | A, S\* [recommend A only]                                                                                                                                                                        |
| `uploadImageToS3`                                                                                                                                                                                                                                                                                                   | any authenticated owner (rate- and size-limited)                                                                                                                                                 |
| `getAllSubscriptionPlans`, `createPriceForProduct`, `deactivatePrice` (SV)                                                                                                                                                                                                                                          | A only (provider blocker until Stripe Billing exists)                                                                                                                                            |
| REST `POST /stripe/account`                                                                                                                                                                                                                                                                                         | R(own), V(own), A. Must authenticate (§0)                                                                                                                                                        |
| REST `GET /maps/reverse-geocode`                                                                                                                                                                                                                                                                                    | authenticated owner (rate-limited; it proxies a paid API)                                                                                                                                        |

The `Admin` permission code exists but no route maps to it. Using it as the gate for platform-wide dashboards, earnings and audit is a Fair policy decision (**UNVERIFIED**). Record it as an open question rather than inventing behaviour silently.

---

## C. Secret configuration fields

**Write-only.** Never return these in any query, subscription, audit `changes` or error message. Store them encrypted at rest in the provider-secret store, not in the config row. A blank or absent value on save means "keep".

- `password` (SMTP/NodeMailer), sent by `saveEmailConfiguration`
- `clientSecret` (PayPal), sent by `savePaypalConfiguration`
- `secretKey` (Stripe), sent by `saveStripeConfiguration`
- `twilioAuthToken`, sent by `saveTwilioConfiguration`
- `sendGridApiKey`, `sendGridPassword`: SendGrid input. The mutation is UNUSED in multivendor; the singlevendor `has*` flags imply the same. **UNVERIFIED** field names in `SendGridConfigurationInput`.
- `googleMapsApiKey` (as saved via `saveGoogleApiKeyConfiguration`), if used as a server-side Maps/Geocoding key. The browser key comes from env `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Respond with a masked value or null in `googleApiKey: googleMapsApiKey`.
- `testOtp`: a static OTP that bypasses phone/email verification. Treat it as a secret: return it masked or null, admin-only, and disable it in production (**UNVERIFIED** policy; it is currently returned to anonymous callers by upstream).
- Expose `has*Configured: Boolean` (singlevendor names: `hasEmailPasswordConfigured`, `hasPaypalSecretConfigured`, `hasStripeSecretConfigured`, `hasTwilioSecretConfigured`, `hasSendGridSecretConfigured`).

**Admin-only, non-secret.** Return to A/S(Configuration) only; null for everyone else:

- `email`, `emailName`, `enableEmail`, `formEmail`
- `sendGridEnabled`, `sendGridEmail`, `sendGridEmailName`
- `twilioAccountSid`, `twilioPhoneNumber`, `twilioWhatsAppNumber`
- `cloudinaryUploadUrl` (an unsigned preset URL is usable by anyone, so keep it admin-only plus server-side upload preferred)
- `cloudinaryApiKey` (a public id, but not needed by clients)
- `restaurantCount`(SV)

**Public.** Safe for all clients, and needed by the customer, rider and store apps:

- currency: `currency`, `currencySymbol`
- delivery pricing: `deliveryRate`, `costType`
- Stripe/PayPal client config: `publishableKey`, `clientId` (PayPal client id), `sandbox`
- Google OAuth client IDs: `webClientID`, `androidClientID`, `iOSClientID`, `expoClientID`
- Firebase web config: `firebaseKey`, `authDomain`, `projectId`, `storageBucket`, `msgSenderId`, `appId`, `measurementId`, `vapidKey`
- analytics and error reporting: `webAmplitudeApiKey`, `appAmplitudeApiKey`, `dashboardSentryUrl`, `webSentryUrl`, `apiSentryUrl`, `customerAppSentryUrl`, `restaurantAppSentryUrl`, `riderAppSentryUrl` (DSNs are public by design)
- maps display: `googleMapLibraries`, `googleColor`
- legal links: `termsAndConditions`, `privacyPolicy`
- verification flags: `skipEmailVerification`, `skipMobileVerification`, `skipWhatsAppOTP`, `twilioEnabled`
- app mode: `enableCustomerDemoMode`, `customerDemoZoneId`, `isPaidVersion`, `isMultiVendor`(SV), `isAppLaunched`(SV)

**Also secret, though not configuration.** Never return:

- password hashes
- refresh tokens other than the caller's own
- `user.notificationToken` (return masked or null)
- full bank `accountNumber` to non-owners
- staff/vendor/restaurant `password` (inputs only)

Separately, `NEXT_PUBLIC_ENCRYPTION_KEY` (client env) must not be populated with any key that protects real secrets (§3.4).

---

## D. Integration blockers and open questions surfaced by this research

1. `POST /stripe/account` in multivendor-admin sends no auth (§0). There is also no Stripe Connect account → **provider blocker**.
2. Payout execution behind `updateWithdrawReqStatus('TRANSFERRED')` and Stripe Billing (SV subscription plans) → **provider blocker**.
3. `sendNotificationUser` and admin web push (FCM) need a Firebase project. The upstream service worker hard-codes Enatega's Firebase web config (`public/firebase-messaging-sw.js:10-11`) → **provider and config blocker**.
4. Hard-coded upstream links remain in the UI. Configuration gating is required, and any change must be recorded in provenance:
   - `https://multivendor.enatega.com/` in the super-admin sidebar (`UI/layout/super-admin-layout/side-bar/index.tsx:66`)
   - the singlevendor netlify URL (`UI/layout/super-admin-layout/app-bar/index.tsx:86`; sign-in `:51-53`)
   - `assets.enatega.com` in `UC/safe-image/index.tsx:3`
5. Translated `dateKeyword` values (§2.1).
6. `DeleteTypeEnum`, `FiltersInput` extra fields, `costType` values, the `discounted` semantics, the `tipVariations` unit (amount vs %), dashboard monthly array shapes, and `isPaidVersion` semantics are all **UNVERIFIED**. Decide them in the schema packet and document them, rather than guessing silently.
7. Several edit forms require re-entering a password in client validation (§2.20). This is UX friction only; the backend must not require it.
8. The zero-commission core-plan policy vs `updateCommission` (§5.1). Non-core plan commission policy is undefined → **policy blocker**.

---

## Appendix A — Verbatim GraphQL documents (multivendor-admin)

Generated mechanically from `vendor/enatega-ui/enatega-multivendor-admin/lib/api/graphql/**`. Line numbers are source line numbers. Barrel index files omitted.

### `lib/api/graphql/mutations/addons/index.ts`

```graphql
   3  export const CREATE_ADDONS = gql`
   4    mutation CreateAddons($addonInput: AddonInput) {
   5      createAddons(addonInput: $addonInput) {
   6        _id
   7        addons {
   8          _id
   9          options
  10          title
  11          description
  12          quantityMinimum
  13          quantityMaximum
  14        }
  15      }
  16    }
  17  `;
  18  export const EDIT_ADDON = gql`
  19    mutation editAddon($addonInput: editAddonInput) {
  20      editAddon(addonInput: $addonInput) {
  21        _id
  22        addons {
  23          _id
  24          options
  25          title
  26          description
  27          quantityMinimum
  28          quantityMaximum
  29        }
  30      }
  31    }
  32  `;
  34  export const DELETE_ADDON = gql`
  35    mutation DeleteAddon($id: String!, $restaurant: String!) {
  36      deleteAddon(id: $id, restaurant: $restaurant) {
  37        _id
  38        addons {
  39          _id
  40          options
  41          title
  42          description
  43          quantityMinimum
  44          quantityMaximum
  45        }
  46      }
  47    }
  48  `;
```

### `lib/api/graphql/mutations/app-versions/index.ts`

```graphql
   3  export const SET_VERSIONS = gql`
   4    mutation SetVersions(
   5      $customerAppVersion: AppTypeInput
   6      $riderAppVersion: AppTypeInput
   7      $restaurantAppVersion: AppTypeInput
   8    ) {
   9      setVersions(
  10        customerAppVersion: $customerAppVersion
  11        riderAppVersion: $riderAppVersion
  12        restaurantAppVersion: $restaurantAppVersion
  13      )
  14    }
  15  `;
```

### `lib/api/graphql/mutations/authentication/index.ts`

```graphql
   2  export { REFRESH_TOKEN } from './refresh';
   4  export const OWNER_LOGIN = gql`
   5    mutation ownerLogin($email: String!, $password: String!) {
   6      ownerLogin(email: $email, password: $password) {
   7        userId
   8        token
   9        tokenExpiration
  10        refreshToken
  11        refreshTokenExpiration
  12        email
  13        userType
  14        restaurants {
  15          _id
  16          orderId
  17          name
  18          image
  19          address
  20        }
  21        permissions
  22        userTypeId
  23        image
  24        name
  25      }
  26    }
  27  `;
```

### `lib/api/graphql/mutations/authentication/refresh.ts`

```graphql
   3  export const REFRESH_TOKEN = gql`
   4    mutation RefreshToken($refreshToken: String!, $userType: String!) {
   5      refreshToken(refreshToken: $refreshToken, userType: $userType) {
   6        userId
   7        token
   8        tokenExpiration
   9        refreshToken
  10        refreshTokenExpiration
  11      }
  12    }
  13  `;
```

### `lib/api/graphql/mutations/banners/index.ts`

```graphql
   3  export const CREATE_BANNER = gql`
   4    mutation CreateBanner($bannerInput: BannerInput!) {
   5      createBanner(bannerInput: $bannerInput) {
   6        _id
   7        title
   8        description
   9        action
  10        file
  11        screen
  12        parameters
  13      }
  14    }
  15  `;
  17  export const EDIT_BANNER = gql`
  18    mutation editBanner($bannerInput: BannerInput!) {
  19      editBanner(bannerInput: $bannerInput) {
  20        _id
  21        title
  22        description
  23        action
  24        file
  25        screen
  26        parameters
  27      }
  28    }
  29  `;
  31  export const DELETE_BANNER = gql`
  32    mutation DeleteBanner($id: String!) {
  33      deleteBanner(id: $id)
  34    }
  35  `;
```

### `lib/api/graphql/mutations/category/index.ts`

```graphql
   3  export const CREATE_CATEGORY = gql`
   4    mutation CreateCategory($category: CategoryInput!) {
   5      createCategory(category: $category) {
   6        _id
   7        categories {
   8          _id
   9          title
  10          foods {
  11            _id
  12            title
  13            description
  14            variations {
  15              _id
  16              title
  17              price
  18              discounted
  19              addons
  20            }
  21            image
  22            isActive
  23            createdAt
  24            updatedAt
  25          }
  26          createdAt
  27          updatedAt
  28        }
  29      }
  30    }
  31  `;
  33  export const EDIT_CATEGORY = gql`
  34    mutation EditCategory($category: CategoryInput!) {
  35      editCategory(category: $category) {
  36        _id
  37        categories {
  38          _id
  39          title
  40          foods {
  41            _id
  42            title
  43            description
  44            variations {
  45              _id
  46              title
  47              price
  48              discounted
  49              addons
  50            }
  51            image
  52            isActive
  53            createdAt
  54            updatedAt
  55          }
  56          createdAt
  57          updatedAt
  58        }
  59      }
  60    }
  61  `;
  63  export const DELETE_CATEGORY = gql`
  64    mutation DeleteCategory($id: String!, $restaurant: String!) {
  65      deleteCategory(id: $id, restaurant: $restaurant) {
  66        _id
  67        categories {
  68          _id
  69          title
  70          foods {
  71            _id
  72            title
  73            description
  74            variations {
  75              _id
  76              title
  77              price
  78              discounted
  79              addons
  80            }
  81            image
  82            isActive
  83            createdAt
  84            updatedAt
  85          }
  86          createdAt
  87          updatedAt
  88        }
  89      }
  90    }
  91  `;
```

### `lib/api/graphql/mutations/commission-rate/index.ts`

```graphql
   2  export const updateCommission = gql`
   3    mutation UpdateCommission($id: String!, $commissionRate: Float!) {
   4      updateCommission(id: $id, commissionRate: $commissionRate) {
   5        _id
   6        commissionRate
   7      }
   8    }
   9  `;
```

### `lib/api/graphql/mutations/configuration/index.ts`

```graphql
   3  export const SAVE_EMAIL_CONFIGURATION = gql`
   4    mutation SAVE_EMAIL_CONFIGURATION(
   5      $configurationInput: EmailConfigurationInput!
   6    ) {
   7      saveEmailConfiguration(configurationInput: $configurationInput) {
   8        _id
   9        email
  10        emailName
  11        enableEmail
  12      }
  13    }
  14  `;
  16  export const SAVE_FORM_EMAIL_CONFIGURATION = gql`
  17    mutation SAVE_FORM_EMAIL_CONFIGURATION(
  18      $configurationInput: FormEmailConfigurationInput!
  19    ) {
  20      saveFormEmailConfiguration(configurationInput: $configurationInput) {
  21        _id
  22        formEmail
  23      }
  24    }
  25  `;
  27  export const SAVE_SENDGRID_API_KEY = gql`
  28    mutation SAVE_SENDGRID_API_KEY(
  29      $configurationInput: SendGridConfigurationInput!
  30    ) {
  31      saveSendGridConfiguration(configurationInput: $configurationInput) {
  32        _id
  33        sendGridEnabled
  34        sendGridEmail
  35        sendGridEmailName
  36      }
  37    }
  38  `;
  40  export const SAVE_FIREBASE_CONFIGURATION = gql`
  41    mutation SAVE_FIREBASE_CONFIGURATION(
  42      $configurationInput: FirebaseConfigurationInput!
  43    ) {
  44      saveFirebaseConfiguration(configurationInput: $configurationInput) {
  45        _id
  46        firebaseKey
  47        authDomain
  48        projectId
  49        storageBucket
  50        msgSenderId
  51        appId
  52        measurementId
  53        vapidKey
  54      }
  55    }
  56  `;
  58  export const SAVE_SENTRY_CONFIGURATION = gql`
  59    mutation SAVE_SENTRY_CONFIGURATION(
  60      $configurationInput: SentryConfigurationInput!
  61    ) {
  62      saveSentryConfiguration(configurationInput: $configurationInput) {
  63        _id
  64        dashboardSentryUrl
  65        webSentryUrl
  66        apiSentryUrl
  67        customerAppSentryUrl
  68        restaurantAppSentryUrl
  69        riderAppSentryUrl
  70      }
  71    }
  72  `;
  74  export const SAVE_GOOGLE_API_KEY_CONFIGURATION = gql`
  75    mutation SAVE_GOOGLE_API_KEY_CONFIGURATION(
  76      $configurationInput: GoogleApiKeyConfigurationInput!
  77    ) {
  78      saveGoogleApiKeyConfiguration(configurationInput: $configurationInput) {
  79        _id
  80        googleApiKey: googleMapsApiKey
  81      }
  82    }
  83  `;
  85  export const SAVE_CLOUDINARY_CONFIGURATION = gql`
  86    mutation SAVE_CLOUDINARY_CONFIGURATION(
  87      $configurationInput: CloudinaryConfigurationInput!
  88    ) {
  89      saveCloudinaryConfiguration(configurationInput: $configurationInput) {
  90        _id
  91        cloudinaryUploadUrl
  92        cloudinaryApiKey
  93      }
  94    }
  95  `;
  97  export const SAVE_AMPLITUDE_API_KEY_CONFIGURATION = gql`
  98    mutation SAVE_AMPLITUDE_API_KEY_CONFIGURATION(
  99      $configurationInput: AmplitudeApiKeyConfigurationInput!
 100    ) {
 101      saveAmplitudeApiKeyConfiguration(configurationInput: $configurationInput) {
 102        _id
 103        webAmplitudeApiKey
 104        appAmplitudeApiKey
 105      }
 106    }
 107  `;
 109  export const SAVE_GOOGLE_CLIENT_ID_CONFIGURATION = gql`
 110    mutation SAVE_GOOGLE_CLIENT_ID_CONFIGURATION(
 111      $configurationInput: GoogleClientIDConfigurationInput!
 112    ) {
 113      saveGoogleClientIDConfiguration(configurationInput: $configurationInput) {
 114        _id
 115        webClientID
 116        androidClientID
 117        iOSClientID
 118        expoClientID
 119      }
 120    }
 121  `;
 123  export const SAVE_WEB_CONFIGURATION = gql`
 124    mutation SAVE_WEB_CONFIGURATION($configurationInput: WebConfigurationInput!) {
 125      saveWebConfiguration(configurationInput: $configurationInput) {
 126        _id
 127        googleMapLibraries
 128        googleColor
 129      }
 130    }
 131  `;
 133  export const SAVE_APP_CONFIGURATION = gql`
 134    mutation SAVE_APP_CONFIGURATION(
 135      $configurationInput: AppConfigurationsInput!
 136    ) {
 137      saveAppConfigurations(configurationInput: $configurationInput) {
 138        _id
 139        termsAndConditions
 140        privacyPolicy
 141        testOtp
 142        enableCustomerDemoMode
 143        customerDemoZoneId
 144      }
 145    }
 146  `;
 148  export const SAVE_DELIVERY_RATE_CONFIGURATION = gql`
 149    mutation SAVE_DELIVERY_RATE_CONFIGURATION(
 150      $configurationInput: DeliveryCostConfigurationInput!
 151    ) {
 152      saveDeliveryRateConfiguration(configurationInput: $configurationInput) {
 153        _id
 154        deliveryRate
 155        costType
 156      }
 157    }
 158  `;
 160  export const SAVE_PAYPAL_CONFIGURATION = gql`
 161    mutation SAVE_PAYPAL_CONFIGURATION(
 162      $configurationInput: PaypalConfigurationInput!
 163    ) {
 164      savePaypalConfiguration(configurationInput: $configurationInput) {
 165        _id
 166        clientId
 167        sandbox
 168      }
 169    }
 170  `;
 172  export const SAVE_STRIPE_CONFIGURATION = gql`
 173    mutation SAVE_STRIPE_CONFIGURATION(
 174      $configurationInput: StripeConfigurationInput!
 175    ) {
 176      saveStripeConfiguration(configurationInput: $configurationInput) {
 177        _id
 178        publishableKey
 179      }
 180    }
 181  `;
 183  export const SAVE_TWILIO_CONFIGURATION = gql`
 184    mutation SAVE_TWILIO_CONFIGURATION(
 185      $configurationInput: TwilioConfigurationInput!
 186    ) {
 187      saveTwilioConfiguration(configurationInput: $configurationInput) {
 188        _id
 189        twilioAccountSid
 190        twilioPhoneNumber
 191        twilioEnabled
 192        twilioWhatsAppNumber
 194      }
 195    }
 196  `;
 198  export const SAVE_VERIFICATION_CONFIGURATION = gql`
 199    mutation SAVE_VERIFICATIONS_TOGGLE(
 200      $configurationInput: VerificationConfigurationInput!
 201    ) {
 202      saveVerificationsToggle(configurationInput: $configurationInput) {
 203        skipEmailVerification
 204        skipMobileVerification
 205        skipWhatsAppOTP
 206      }
 207    }
 208  `;
 210  export const SAVE_CURRENCY_CONFIGURATION = gql`
 211    mutation SAVE_CURRENCY_CONFIGURATION(
 212      $configurationInput: CurrencyConfigurationInput!
 213    ) {
 214      saveCurrencyConfiguration(configurationInput: $configurationInput) {
 215        _id
 216        currency
 217        currencySymbol
 218      }
 219    }
 220  `;
```

### `lib/api/graphql/mutations/coupons/index.ts`

```graphql
   3  export const CREATE_COUPON = gql`
   4    mutation CreateCoupon($couponInput: CouponInput!) {
   5      createCoupon(couponInput: $couponInput) {
   6        _id
   7        title
   8        discount
   9        enabled
  10        startDate
  11        endDate
  12        lifeTimeActive
  13      }
  14    }
  15  `;
  16  export const EDIT_COUPON = gql`
  17    mutation editCoupon($couponInput: CouponInput!) {
  18      editCoupon(couponInput: $couponInput) {
  19        _id
  20        title
  21        discount
  22        enabled
  23        startDate
  24        endDate
  25        lifeTimeActive
  26      }
  27    }
  28  `;
  29  export const DELETE_COUPON = gql`
  30    mutation DeleteCoupon($id: String!) {
  31      deleteCoupon(id: $id)
  32    }
  33  `;
```

### `lib/api/graphql/mutations/coupons-restaurant/index.tsx`

```graphql
   3  export const CREATE_RESTAURANT_COUPON = gql`
   4    mutation createRestaurantCoupon(
   5      $restaurantId: ID!
   6      $couponInput: CouponInput!
   7    ) {
   8      createRestaurantCoupon(
   9        restaurantId: $restaurantId
  10        couponInput: $couponInput
  11      ) {
  12        _id
  13        title
  14        discount
  15        enabled
  16      }
  17    }
  18  `;
  20  export const EDIT_RESTAURANT_COUPON = gql`
  21    mutation EditRestaurantCoupon(
  22      $restaurantId: ID!
  23      $couponInput: CouponInput!
  24    ) {
  25      editRestaurantCoupon(
  26        restaurantId: $restaurantId
  27        couponInput: $couponInput
  28      ) {
  29        _id
  30        title
  31        discount
  32        enabled
  33      }
  34    }
  35  `;
  37  export const DELETE_RESTAURANT_COUPON = gql`
  38    mutation DeleteRestaurantCoupon($restaurantId: ID!, $couponId: ID!) {
  39      deleteRestaurantCoupon(restaurantId: $restaurantId, couponId: $couponId)
  40    }
  41  `;
```

### `lib/api/graphql/mutations/cuisines/index.ts`

```graphql
   3  export const CREATE_CUISINE = gql`
   4    mutation CreateCuisine($cuisineInput: CuisineInput!) {
   5      createCuisine(cuisineInput: $cuisineInput) {
   6        _id
   7        name
   8        description
   9        image
  10        shopType
  11      }
  12    }
  13  `;
  14  export const EDIT_CUISINE = gql`
  15    mutation editCuisine($cuisineInput: CuisineInput!) {
  16      editCuisine(cuisineInput: $cuisineInput) {
  17        _id
  18        name
  19        description
  20        image
  21        shopType
  22      }
  23    }
  24  `;
  25  export const DELETE_CUISINE = gql`
  26    mutation DeleteCuisine($id: String!) {
  27      deleteCuisine(id: $id)
  28    }
  29  `;
```

### `lib/api/graphql/mutations/deliveryOptions/index.tsx`

```graphql
   3  export const UPDATE_DELIVERY_OPTIONS = gql`
   4      mutation UpdateDeliveryOptions($restId: String!, $pickup: Boolean!, $delivery: Boolean!) {
   5          updateDeliveryOptions(restId: $restId, pickup: $pickup, delivery: $delivery) {
   6              deliveryOptions {
   7                  delivery
   8                  pickup
   9              }
  10          }
  11      }
  12  `;
```

### `lib/api/graphql/mutations/dispatch/index.ts`

```graphql
   3  export const UPDATE_STATUS = gql`
   4    mutation UpdateStatus($id: String!, $orderStatus: String!) {
   5      updateStatus(id: $id, orderStatus: $orderStatus) {
   6        _id
   7        orderStatus
   8      }
   9    }
  10  `;
  11  export const ASSIGN_RIDER = gql`
  12    mutation AssignRider($id: String!, $riderId: String!) {
  13      assignRider(id: $id, riderId: $riderId) {
  14        _id
  15        orderStatus
  16        rider {
  17          _id
  18          name
  19        }
  20      }
  21    }
  22  `;
```

### `lib/api/graphql/mutations/food/index.ts`

```graphql
   3  export const CREATE_FOOD = gql`
   4    mutation CreateFood($foodInput: FoodInput!) {
   5      createFood(foodInput: $foodInput) {
   6        _id
   7        categories {
   8          _id
   9          title
  10          foods {
  11            _id
  12            title
  13            description
  14            subCategory
  15            variations {
  16              _id
  17              title
  18              price
  19              discounted
  20              addons
  21              isOutOfStock
  22            }
  23            image
  24            isActive
  25          }
  26          createdAt
  27          updatedAt
  28        }
  29      }
  30    }
  31  `;
  33  export const EDIT_FOOD = gql`
  34    mutation EditFood($foodInput: FoodInput!) {
  35      editFood(foodInput: $foodInput) {
  36        _id
  37        categories {
  38          _id
  39          title
  40          foods {
  41            _id
  42            title
  43            description
  44            subCategory
  45            variations {
  46              _id
  47              title
  48              price
  49              discounted
  50              addons
  51              isOutOfStock
  52            }
  53            image
  54            isActive
  55          }
  56          createdAt
  57          updatedAt
  58        }
  59      }
  60    }
  61  `;
  63  export const DELETE_FOOD = gql`
  64    mutation DeleteFood(
  65      $id: String!
  66      $restaurant: String!
  67      $categoryId: String!
  68    ) {
  69      deleteFood(id: $id, restaurant: $restaurant, categoryId: $categoryId) {
  70        _id
  71      }
  72    }
  73  `;
```

### `lib/api/graphql/mutations/metrics/index.ts`

```graphql
   3  export const METRICS_GENERAL = gql`
   4    mutation MetricsGeneral {
   5      metricsGeneral {
   6        excellence
   7        topgun
   8        experience
   9        skydiver
  10        rider
  11        haha
  12        hehe
  13        huhu
  14        yoyo
  15        turu
  16      }
  17    }
  18  `;
```

### `lib/api/graphql/mutations/notifications/index.ts`

```graphql
   3  export const SEND_NOTIFICATION_USER = gql`
   4    mutation SendNotificationUser(
   5      $notificationTitle: String
   6      $notificationBody: String!
   7    ) {
   8      sendNotificationUser(
   9        notificationTitle: $notificationTitle
  10        notificationBody: $notificationBody
  11      )
  12    }
  13  `;
  15  export const MARK_WEB_NOTIFICATIONS_AS_READ = gql`
  16    mutation MarkWebNotificationsAsRead {
  17      markWebNotificationsAsRead {
  18        _id
  19        body
  20        navigateTo
  21        read
  22        createdAt
  23      }
  24    }
  25  `;
```

### `lib/api/graphql/mutations/options/index.ts`

```graphql
   3  export const CREATE_OPTIONS = gql`
   4    mutation CreateOptions($optionInput: CreateOptionInput) {
   5      createOptions(optionInput: $optionInput) {
   6        _id
   7        options {
   8          _id
   9          title
  10          description
  11          price
  12        }
  13      }
  14    }
  15  `;
  17  export const DELETE_OPTION = gql`
  18    mutation DeleteOption($id: String!, $restaurant: String!) {
  19      deleteOption(id: $id, restaurant: $restaurant) {
  20        _id
  21        options {
  22          _id
  23          title
  24          description
  25          price
  26        }
  27      }
  28    }
  29  `;
  31  export const EDIT_OPTION = gql`
  32    mutation EditOption($optionInput: editOptionInput) {
  33      editOption(optionInput: $optionInput) {
  34        _id
  35        options {
  36          _id
  37          title
  38          description
  39          price
  40        }
  41      }
  42    }
  43  `;
```

### `lib/api/graphql/mutations/restaurant/index.ts`

```graphql
   3  export const CREATE_RESTAURANT = gql`
   4    mutation CreateRestaurant($restaurant: RestaurantInput!, $owner: ID!) {
   5      createRestaurant(restaurant: $restaurant, owner: $owner) {
   6        _id
   7        name
   8        image
   9        username
  10        orderPrefix
  11        slug
  12        phone
  13        address
  14        deliveryTime
  15        minimumOrder
  16        isActive
  17        commissionRate
  18        tax
  19        owner {
  20          _id
  21          email
  22          isActive
  23        }
  24        shopType
  25        orderId
  26        logo
  27        location {
  28          coordinates
  29        }
  30        cuisines
  31      }
  32    }
  33  `;
  35  // Delete
  36  export const DELETE_RESTAURANT = gql`
  37    mutation DeleteRestaurant($id: String!) {
  38      deleteRestaurant(id: $id) {
  39        _id
  40        isActive
  41      }
  42    }
  43  `;
  45  export const HARD_DELETE_RESTAURANT = gql`
  46    mutation HardDeleteRestaurant($id: String!) {
  47      hardDeleteRestaurant(id: $id)
  48    }
  49  `;
  51  export const UPDATE_DELIVERY_BOUNDS_AND_LOCATION = gql`
  52    mutation updateDeliveryBoundsAndLocation(
  53      $id: ID!
  54      $boundType: String!
  55      $bounds: [[[Float!]]]
  56      $circleBounds: CircleBoundsInput
  57      $location: CoordinatesInput!
  58      $address: String
  59      $postCode: String
  60      $city: String
  61    ) {
  62      result: updateDeliveryBoundsAndLocation(
  63        id: $id
  64        boundType: $boundType
  65        circleBounds: $circleBounds
  66        bounds: $bounds
  67        location: $location
  68        address: $address
  69        postCode: $postCode
  70        city: $city
  71      ) {
  72        success
  73        message
  74        data {
  75          _id
  76          deliveryBounds {
  77            coordinates
  78          }
  79          location {
  80            coordinates
  81          }
  82        }
  83      }
  84    }
  85  `;
  87  export const EDIT_RESTAURANT = gql`
  88    mutation EditRestaurant($restaurantInput: RestaurantProfileInput!) {
  89      editRestaurant(restaurant: $restaurantInput) {
  90        _id
  91        orderId
  92        orderPrefix
  93        name
  94        phone
  95        image
  96        logo
  97        slug
  98        address
  99        username
 100        location {
 101          coordinates
 102        }
 103        isAvailable
 104        minimumOrder
 105        tax
 106        openingTimes {
 107          day
 108          times {
 109            startTime
 110            endTime
 111          }
 112        }
 113        shopType
 114      }
 115    }
 116  `;
 118  export const DUPLICATE_RESTAURANT = gql`
 119    mutation DuplicateRestaurant($id: String!, $owner: String!) {
 120      duplicateRestaurant(id: $id, owner: $owner) {
 121        _id
 122        name
 123        image
 124        username
 125        orderPrefix
 126        slug
 127        address
 128        deliveryTime
 129        minimumOrder
 130        isActive
 131        commissionRate
 132        tax
 133        owner {
 134          _id
 135          email
 136          isActive
 137        }
 138        shopType
 139        orderId
 140        logo
 141        location {
 142          coordinates
 143        }
 144        cuisines
 145      }
 146    }
 147  `;
 149  export const UPDATE_FOOD_OUT_OF_STOCK = gql`
 150    mutation UpdateFoodOutOfStock(
 151      $id: String!
 152      $restaurant: String!
 153      $categoryId: String!
 154    ) {
 155      updateFoodOutOfStock(
 156        id: $id
 157        restaurant: $restaurant
 158        categoryId: $categoryId
 159      )
 160    }
 161  `;
 163  export const UPDATE_RESTAURANT_DELIVERY = gql`
 164    mutation updateRestaurantDelivery(
 165      $id: ID!
 166      $minDeliveryFee: Float
 167      $deliveryDistance: Float
 168      $deliveryFee: Float
 169    ) {
 170      updateRestaurantDelivery(
 171        id: $id
 172        minDeliveryFee: $minDeliveryFee
 173        deliveryDistance: $deliveryDistance
 174        deliveryFee: $deliveryFee
 175      ) {
 176        success
 177        message
 178        data {
 179          _id
 180        }
 181      }
 182    }
 183  `;
 185  export const UPDATE_RESTAURANT_BUSSINESS_DETAILS = gql`
 186    mutation updateRestaurantBussinessDetails(
 187      $id: String!
 188      $bussinessDetails: BussinessDetailsInput
 189    ) {
 190      updateRestaurantBussinessDetails(
 191        id: $id
 192        bussinessDetails: $bussinessDetails
 193      ) {
 194        success
 195        message
 196        data {
 197          _id
 198        }
 199      }
 200    }
 201  `;
```

### `lib/api/graphql/mutations/riders/index.tsx`

```graphql
   3  export const CREATE_RIDER = gql`
   4    mutation CreateRider($riderInput: RiderInput!) {
   5      createRider(riderInput: $riderInput) {
   6        _id
   7        name
   8        username
   9        phone
  10        available
  11        vehicleType
  12        zone {
  13          _id
  14        }
  15      }
  16    }
  17  `;
  19  export const EDIT_RIDER = gql`
  20    mutation EditRider($riderInput: RiderInput!) {
  21      editRider(riderInput: $riderInput) {
  22        _id
  23        name
  24        username
  25        phone
  26        vehicleType
  27        zone {
  28          _id
  29        }
  30      }
  31    }
  32  `;
  34  export const DELETE_RIDER = gql`
  35    mutation DeleteRider($id: String!) {
  36      deleteRider(id: $id) {
  37        _id
  38      }
  39    }
  40  `;
  42  export const TOGGLE_RIDER = gql`
  43    mutation ToggleRider($id: String!) {
  44      toggleAvailablity(id: $id) {
  45        _id
  46        name
  47        username
  48        phone
  49        available
  50        vehicleType
  51        zone {
  52          title
  53        }
  54      }
  55    }
  56  `;
```

### `lib/api/graphql/mutations/shop-type/index.ts`

```graphql
   3  export const CREATE_SHOP_TYPE = gql`
   4    mutation CreateShopType($dto: CreateShopTypeInput) {
   5      createShopType(dto: $dto) {
   6        _id
   7        name
   8        image
   9        isActive
  10      }
  11    }
  12  `;
  13  export const UPDATE_SHOP_TYPE = gql`
  14    mutation UpdateShopType($dto: UpdateShopTypeInput) {
  15      updateShopType(dto: $dto) {
  16        _id
  17        name
  18        image
  19        isActive
  20      }
  21    }
  22  `;
  23  export const DELETE_SHOP_TYPE = gql`
  24    mutation DeleteShopType($id: String!, $type: DeleteTypeEnum) {
  25      deleteShopType(id: $id, type: $type) {
  26        _id
  27        name
  28        image
  29        isActive
  30      }
  31    }
  32  `;
```

### `lib/api/graphql/mutations/staff/index.ts`

```graphql
   3  export const CREATE_STAFF = gql`
   4    mutation CreateStaff($staffInput: StaffInput!) {
   5      createStaff(staffInput: $staffInput) {
   6        _id
   7        name
   8        email
   9        phone
  10        isActive
  11        permissions
  12        userType
  13      }
  14    }
  15  `;
  17  export const EDIT_STAFF = gql`
  18    mutation EditStaff($staffInput: StaffInput!) {
  19      editStaff(staffInput: $staffInput) {
  20        _id
  21        name
  22        email
  23        phone
  24        isActive
  25        permissions
  26        userType
  27      }
  28    }
  29  `;
  31  export const DELETE_STAFF = gql`
  32    mutation DeleteStaff($id: String!) {
  33      deleteStaff(id: $id) {
  34        _id
  35      }
  36    }
  37  `;
```

### `lib/api/graphql/mutations/sub-category/index.ts`

```graphql
   3  export const CREATE_SUB_CATEGORIES = gql`
   4    mutation createSubCategories($subCategories: [SubCategoryInput!]!) {
   5      createSubCategories(subCategories: $subCategories)
   6    }
   7  `;
   9  export const DELETE_SUB_CATEGORY = gql`
  10    mutation deleteSubCtg($deleteSubCategoryId2: String!) {
  11      deleteSubCategory(_id: $deleteSubCategoryId2)
  12    }
  13  `;
```

### `lib/api/graphql/mutations/supportTickets/index.ts`

```graphql
   3  export const CREATE_SUPPORT_TICKET = gql`
   4    mutation CreateSupportTicket($ticketInput: SupportTicketInput!) {
   5      createSupportTicket(ticketInput: $ticketInput) {
   6        _id
   7        title
   8        description
   9        status
  10        category
  11        orderId
  12        otherDetails
  13        createdAt
  14        updatedAt
  15        user {
  16          _id
  17          name
  18          email
  19        }
  20      }
  21    }
  22  `;
  24  export const CREATE_TICKET_MESSAGE = gql`
  25    mutation CreateMessage($messageInput: MessageInput!) {
  26      createMessage(messageInput: $messageInput) {
  27        _id
  28        content
  29        senderType
  30        isRead
  31        ticket
  32        createdAt
  33        updatedAt
  34      }
  35    }
  36  `;
  38  export const UPDATE_TICKET_STATUS = gql`
  39    mutation UpdateSupportTicketStatus($input: UpdateSupportTicketInput!) {
  40      updateSupportTicketStatus(input: $input) {
  41        _id
  42        status
  43        updatedAt
  44      }
  45    }
  46  `;
```

### `lib/api/graphql/mutations/taxations/index.ts`

```graphql
   1  export const createTaxation = `mutation CreateTaxation($taxationInput:TaxationInput!){
   2  createTaxation(taxationInput:$taxationInput){
   3        _id
   4      taxationCharges
   5      enabled
   6      }
   7    }`;
   8  export const editTaxation = `mutation editTaxation($taxationInput:TaxationInput!){
   9      editTaxation(taxationInput:$taxationInput){
  10              _id
  11              taxationCharges
  12              enabled
  13                }
  14              }`;
```

### `lib/api/graphql/mutations/timing/index.tsx`

```graphql
   3  export const UPDATE_TIMINGS = gql`
   4    mutation UpdateTimings($id: String!, $openingTimes: [TimingsInput]) {
   5      updateTimings(id: $id, openingTimes: $openingTimes) {
   6        _id
   7        openingTimes {
   8          day
   9          times {
  10            startTime
  11            endTime
  12          }
  13        }
  14      }
  15    }
  16  `;
```

### `lib/api/graphql/mutations/tippings/index.ts`

```graphql
   3  export const CREATE_TIPPING = gql`
   4    mutation CreateTipping($tippingInput: TippingInput!) {
   5      createTipping(tippingInput: $tippingInput) {
   6        _id
   7        tipVariations
   8        enabled
   9      }
  10    }
  11  `;
  13  export const EDIT_TIPPING = gql`
  14    mutation editTipping($tippingInput: TippingInput!) {
  15      editTipping(tippingInput: $tippingInput) {
  16        _id
  17        tipVariations
  18        enabled
  19      }
  20    }
  21  `;
```

### `lib/api/graphql/mutations/upload/index.ts`

```graphql
   3  export const UPLOAD_IMAGE_TO_S3 = gql`
   4    mutation UploadImageToS3($image: String!) {
   5      uploadImageToS3(image: $image) {
   6        imageUrl
   7      }
   8    }
   9  `;
```

### `lib/api/graphql/mutations/user.ts`

```graphql
   3  export const UPDATE_USER_STATUS = gql`
   4    mutation updateUserStatus($id: ID!, $status: String!, $reason: String) {
   5      updateUserStatus(id: $id, status: $status, reason: $reason) {
   6        _id
   7        status
   8      }
   9    }
  10  `;
  12  export const UPDATE_USER_NOTES = gql`
  13    mutation updateUserNotes($id: ID!, $notes: String!) {
  14      updateUserNotes(id: $id, notes: $notes) {
  15        _id
  16        notes
  17      }
  18    }
  19  `;
  21  export const DELETE_USER = gql`
  22    mutation deleteUser($id: ID!) {
  23      deleteUser(id: $id) {
  24        _id
  25      }
  26    }
  27  `;
  29  export const RESET_USER_SESSION = gql`
  30    mutation resetUserSession($userId: ID!) {
  31      resetUserSession(userId: $userId) {
  32        _id
  33      }
  34    }
  35  `;
```

### `lib/api/graphql/mutations/vendor/index.ts`

```graphql
   3  export const CREATE_VENDOR = gql`
   4    mutation CreateVendor($vendorInput: VendorInput) {
   5      createVendor(vendorInput: $vendorInput) {
   6        _id
   7        email
   8        name
   9        image
  10        firstName
  11        lastName
  12        phoneNumber
  13      }
  14    }
  15  `;
  17  export const EDIT_VENDOR = gql`
  18    mutation EditVendor($vendorInput: VendorInput) {
  19      editVendor(vendorInput: $vendorInput) {
  20        _id
  21        email
  22        name
  23        image
  24        firstName
  25        lastName
  26        phoneNumber
  27      }
  28    }
  29  `;
  31  export const DELETE_VENDOR = gql`
  32    mutation DeleteVendor($id: String!) {
  33      deleteVendor(id: $id)
  34    }
  35  `;
```

### `lib/api/graphql/mutations/withdraw-requests/index.ts`

```graphql
   3  export const UPDATE_WITHDRAW_REQUEST = gql`
   4    mutation UpdateWithdrawRequest($id: ID!, $status: String!) {
   5      updateWithdrawReqStatus(id: $id, status: $status) {
   6        # type RiderAndWithdrawRequest {
   7        #   _id: String
   8        #   rider: Rider!
   9        #   withdrawRequest: WithdrawRequest!
  10        # }
  11        success
  12        message
  13        data {
  14          _id
  15          requestId
  16          requestAmount
  17          requestTime
  18          status
  19          createdAt
  21          rider {
  22            _id
  23            name
  24            email
  25            phone
  26            available
  27            isActive
  28            # isSuperAdminRider
  29            accountNumber
  30            currentWalletAmount
  31            totalWalletAmount
  32            withdrawnWalletAmount
  33            createdAt
  34            updatedAt
  35            username
  36            bussinessDetails {
  37              bankName
  38              accountName
  39              accountCode
  40              accountNumber
  41              bussinessRegNo
  42              companyRegNo
  43              taxRate
  44            }
  45          }
  46          store {
  47            unique_restaurant_id
  48            _id
  49            image
  50            logo
  51            address
  52            username
  53            slug
  54            stripeDetailsSubmitted
  55            commissionRate
  56            bussinessDetails {
  57              bankName
  58              accountName
  59              accountCode
  60              accountNumber
  61              bussinessRegNo
  62              companyRegNo
  63              taxRate
  64            }
  65          }
  66        }
  67      }
  68    }
  69  `;
  71  export const CREATE_WITHDRAW_REQUEST = gql`
  72    mutation CreateWithdrawRequest($requestAmount: Float!) {
  73      createWithdrawRequest(requestAmount: $requestAmount) {
  74        _id
  75        requestId
  76        requestAmount
  77        requestTime
  78        status
  79        createdAt
  80      }
  81    }
  82  `;
```

### `lib/api/graphql/mutations/zone/index.ts`

```graphql
   3  export const CREATE_ZONE = gql`
   4    mutation CreateZone($zone: ZoneInput!) {
   5      createZone(zone: $zone) {
   6        _id
   7        title
   8        description
   9        location {
  10          coordinates
  11        }
  12        isActive
  13      }
  14    }
  15  `;
  17  export const EDIT_ZONE = gql`
  18    mutation EditZone($zone: ZoneInput!) {
  19      editZone(zone: $zone) {
  20        _id
  21        title
  22        description
  23        location {
  24          coordinates
  25        }
  26        isActive
  27      }
  28    }
  29  `;
  31  export const DELETE_ZONE = gql`
  32    mutation DeleteZone($id: String!) {
  33      deleteZone(id: $id) {
  34        _id
  35        title
  36        description
  37        location {
  38          coordinates
  39        }
  40        isActive
  41      }
  42    }
  43  `;
```

### `lib/api/graphql/queries/addon/index.ts`

```graphql
   3  export const GET_ADDONS_BY_RESTAURANT_ID = gql`
   4    query Restaurant($id: String) {
   5      restaurant(id: $id) {
   6        _id
   7        addons {
   8          _id
   9          title
  10          description
  11          quantityMinimum
  12          quantityMaximum
  13          options
  14        }
  15      }
  16    }
  17  `;
  19  export const GET_RESTAURANT_ADDONS_PAGINATED = gql`
  20    query RestaurantAddonsPaginated(
  21      $restaurantId: String!
  22      $page: Int
  23      $limit: Int
  24      $search: String
  25    ) {
  26      restaurantAddonsPaginated(
  27        restaurantId: $restaurantId
  28        page: $page
  29        limit: $limit
  30        search: $search
  31      ) {
  32        data {
  33          _id
  34          title
  35          description
  36          quantityMinimum
  37          quantityMaximum
  38          options
  39        }
  40        totalCount
  41        currentPage
  42        totalPages
  43      }
  44    }
  45  `;
```

### `lib/api/graphql/queries/app-versions/index.ts`

```graphql
   3  export const GET_VERSIONS = gql`
   4  query GetVersions {
   5    getVersions {
   6      customerAppVersion {
   7          android
   8          ios
   9      }
  10      riderAppVersion {
  11          android
  12          ios
  13      }
  14      restaurantAppVersion {
  15          android
  16          ios
  17      }
  18    }
  19  }
  20  `;
```

### `lib/api/graphql/queries/audit.ts`

```graphql
   3  export const GET_AUDIT_LOGS = gql`
   4    query AuditLogs($page: Int, $limit: Int) {
   5      auditLogs(page: $page, limit: $limit) {
   6        auditLogs {
   7          _id
   8          timestamp
   9          admin {
  10            _id
  11            email
  12          }
  13          action
  14          targetType
  15          targetId
  16          changes
  17        }
  18        totalCount
  19        currentPage
  20        totalPages
  21      }
  22    }
  23  `;
```

### `lib/api/graphql/queries/authentication/index.ts`

```graphql
   3  export const OWNER_SESSION = gql`
   4    query OwnerSession {
   5      ownerSession {
   6        userId
   7        email
   8        userType
   9        userTypeId
  10        permissions
  11        name
  12        image
  13        restaurants {
  14          _id
  15          name
  16        }
  17        token
  18        tokenExpiration
  19        refreshToken
  20        refreshTokenExpiration
  21        isActive
  22      }
  23    }
  24  `;
  26  export const HAS_OWNER_PERMISSION = gql`
  27    query HasOwnerPermission($permission: String!) {
  28      hasOwnerPermission(permission: $permission)
  29    }
  30  `;
```

### `lib/api/graphql/queries/banners/index.tsx`

```graphql
   3  export const GET_BANNERS = gql`
   4    query Banners {
   5      banners {
   6        _id
   7        title
   8        description
   9        action
  10        screen
  11        file
  12        parameters
  13      }
  14    }
  15  `;
```

### `lib/api/graphql/queries/category/index.ts`

```graphql
   3  export const GET_CATEGORY_BY_RESTAURANT_ID = gql`
   4    query Restaurant($id: String) {
   5      restaurant(id: $id) {
   6        _id
   8        categories {
   9          _id
  10          title
  11          image
  12        }
  13      }
  14    }
  15  `;
  17  export const GET_RESTAURANT_CATEGORIES_PAGINATED = gql`
  18    query RestaurantCategoriesPaginated(
  19      $restaurantId: String!
  20      $page: Int
  21      $limit: Int
  22      $search: String
  23    ) {
  24      restaurantCategoriesPaginated(
  25        restaurantId: $restaurantId
  26        page: $page
  27        limit: $limit
  28        search: $search
  29      ) {
  30        data {
  31          _id
  32          title
  33          image
  34        }
  35        totalCount
  36        currentPage
  37        totalPages
  38      }
  39    }
  40  `;
```

### `lib/api/graphql/queries/concurrent/index.tsx`

```graphql
   3  export const GET_STORE_RIDER = gql`
   4    query FetchStoresAndRidersL {
   5      riders {
   6        _id
   7        name
   8      }
   9      restaurants {
  10        name
  11        _id
  12      }
  13    }
  14  `;
```

### `lib/api/graphql/queries/configuration/index.ts`

```graphql
   3  export const GET_CONFIGURATION = gql`
   4    query getConfiguration {
   5      configuration {
   6        _id
   7        email
   8        emailName
   9        enableEmail
  10        clientId
  11        sandbox
  12        publishableKey
  13        currency
  14        currencySymbol
  15        deliveryRate
  16        twilioAccountSid
  17        twilioPhoneNumber
  18        twilioEnabled
  19        skipWhatsAppOTP
  20        twilioWhatsAppNumber
  21        formEmail
  22        sendGridEnabled
  23        sendGridEmail
  24        sendGridEmailName
  25        dashboardSentryUrl
  26        webSentryUrl
  27        apiSentryUrl
  28        customerAppSentryUrl
  29        restaurantAppSentryUrl
  30        riderAppSentryUrl
  31        cloudinaryUploadUrl
  32        cloudinaryApiKey
  33        webAmplitudeApiKey
  34        appAmplitudeApiKey
  35        webClientID
  36        androidClientID
  37        iOSClientID
  38        expoClientID
  39        googleMapLibraries
  40        googleColor
  41        termsAndConditions
  42        privacyPolicy
  43        testOtp
  44        firebaseKey
  45        authDomain
  46        projectId
  47        storageBucket
  48        msgSenderId
  49        appId
  50        measurementId
  51        isPaidVersion
  52        skipEmailVerification
  53        skipMobileVerification
  54        costType
  55        vapidKey
  56        enableCustomerDemoMode
  57        customerDemoZoneId
  58      }
  59    }
  60  `;
```

### `lib/api/graphql/queries/coupons/index.ts`

```graphql
   3  export const GET_COUPONS = gql`
   4    query Coupons {
   5      coupons {
   6        _id
   7        title
   8        discount
   9        enabled
  10        startDate
  11        endDate
  12        lifeTimeActive
  13      }
  14    }
  15  `;
  17  export const GET_COUPONS_PAGINATED = gql`
  18    query CouponsPaginated(
  19      $page: Int
  20      $limit: Int
  21      $search: String
  22      $enabled: Boolean
  23      $startDate: String
  24      $endDate: String
  25    ) {
  26      couponsPaginated(
  27        page: $page
  28        limit: $limit
  29        search: $search
  30        enabled: $enabled
  31        startDate: $startDate
  32        endDate: $endDate
  33      ) {
  34        data {
  35          _id
  36          title
  37          discount
  38          enabled
  39          startDate
  40          endDate
  41          lifeTimeActive
  42        }
  43        totalCount
  44        currentPage
  45        totalPages
  46      }
  47    }
  48  `;
```

### `lib/api/graphql/queries/coupons-restaurant/index.tsx`

```graphql
   3  export const GET_RESTAURANT_COUPONS = gql`
   4    query GetRestaurantCoupons($restaurantId: String!) {
   5      restaurantCoupons(restaurantId: $restaurantId) {
   6        _id
   7        title
   8        discount
   9        enabled
  10      }
  11    }
  12  `;
  14  export const GET_RESTAURANT_COUPONS_PAGINATED = gql`
  15    query RestaurantCouponsPaginated(
  16      $restaurantId: String!
  17      $page: Int
  18      $limit: Int
  19      $search: String
  20      $enabled: Boolean
  21    ) {
  22      restaurantCouponsPaginated(
  23        restaurantId: $restaurantId
  24        page: $page
  25        limit: $limit
  26        search: $search
  27        enabled: $enabled
  28      ) {
  29        data {
  30          _id
  31          title
  32          discount
  33          enabled
  34        }
  35        totalCount
  36        currentPage
  37        totalPages
  38      }
  39    }
  40  `;
```

### `lib/api/graphql/queries/cuisines/index.ts`

```graphql
   3  export const GET_CUISINES = gql`
   4    query Cuisines {
   5      cuisines {
   6        _id
   7        name
   8        description
   9        image
  10        shopType
  11      }
  12    }
  13  `;
  15  export const GET_CUISINES_PAGINATED = gql`
  16    query CuisinesPaginated(
  17      $page: Int
  18      $limit: Int
  19      $search: String
  20      $shopType: String
  21    ) {
  22      cuisinesPaginated(
  23        page: $page
  24        limit: $limit
  25        search: $search
  26        shopType: $shopType
  27      ) {
  28        data {
  29          _id
  30          name
  31          description
  32          image
  33          shopType
  34        }
  35        totalCount
  36        currentPage
  37        totalPages
  38      }
  39    }
  40  `;
```

### `lib/api/graphql/queries/dashboard/index.ts`

```graphql
   3  // Super Admin
   4  export const GET_DASHBOARD_USERS = gql`
   5    query GetDashboardUsers {
   6      getDashboardUsers {
   7        usersCount
   8        vendorsCount
   9        restaurantsCount
  10        ridersCount
  12      }
  13    }
  14  `;
  17  export const GET_DASHBOARD_USERS_BY_YEAR = gql`
  18    query GetDashboardUsersByYear($year: Int!) {
  19      getDashboardUsersByYear(year: $year) {
  20        usersCount
  21        vendorsCount
  22        restaurantsCount
  23        ridersCount
  24        percentageChange {
  25          usersPercent
  26          vendorsPercent
  27          restaurantsPercent
  28          ridersPercent
  29        }
  30      }
  31    }
  32  `;
  34  export const GET_DASHBOARD_ORDERS_BY_TYPE = gql`
  35    query GetDashboardOrdersByType {
  36      getDashboardOrdersByType {
  37        value
  38        label
  39      }
  40    }
  41  `;
  43  export const GET_DASHBOARD_SALES_BY_TYPE = gql`
  44    query GetDashboardSalesByType {
  45      getDashboardSalesByType {
  46        value
  47        label
  48      }
  49    }
  50  `;
  52  // Restaurant
  53  export const GET_DASHBOARD_RESTAURANT_ORDERS = gql`
  54    query GetRestaurantDashboardOrdersSalesStats(
  55      $restaurant: String!
  56      $starting_date: String!
  57      $ending_date: String!
  58      $dateKeyword: String
  59    ) {
  60      getRestaurantDashboardOrdersSalesStats(
  61        restaurant: $restaurant
  62        starting_date: $starting_date
  63        ending_date: $ending_date
  64        dateKeyword: $dateKeyword
  65      ) {
  66        totalOrders
  67        totalSales
  68        totalCODOrders
  69        totalCardOrders
  70      }
  71    }
  72  `;
  74  export const GET_DASHBOARD_RESTAURANT_SALES_ORDER_COUNT_DETAILS_BY_YEAR = gql`
  75    query GetRestaurantDashboardSalesOrderCountDetailsByYear(
  76      $restaurant: String!
  77      $year: Int!
  78    ) {
  79      getRestaurantDashboardSalesOrderCountDetailsByYear(
  80        restaurant: $restaurant
  81        year: $year
  82      ) {
  83        salesAmount
  84        ordersCount
  85      }
  86    }
  87  `;
  89  export const GET_RESTAURANT_DASHBOARD_ORDER_SALES_DETAILS_BY_PAYMENT_METHOD = gql`
  90    query GetRestaurantDashboardOrderSalesDetailsByPaymentMethod(
  91      $restaurant: String!
  92      $starting_date: String!
  93      $ending_date: String!
  94      $dateKeyword: String
  95    ) {
  96      getRestaurantDashboardOrderSalesDetailsByPaymentMethod(
  97        restaurant: $restaurant
  98        starting_date: $starting_date
  99        ending_date: $ending_date
 100        dateKeyword: $dateKeyword
 101      ) {
 102        total_orders
 103        total_sales
 104        total_sales_without_delivery
 105        total_delivery_fee
 106        pickup_total_orders
 107        delivery_total_orders
 108        pickup_orders
 109        delivery_orders
 110        pickup {
 111          total_orders
 112        }
 113        delivery {
 114          total_orders
 115        }
 116        all {
 117          _type
 118          data {
 119            total_orders
 120            total_sales
 121            total_sales_without_delivery
 122            total_delivery_fee
 123          }
 124        }
 125        cod {
 126          _type
 127          data {
 128            total_orders
 129            total_sales
 130            total_sales_without_delivery
 131            total_delivery_fee
 132          }
 133        }
 134        card {
 135          _type
 136          data {
 137            total_orders
 138            total_sales
 139            total_sales_without_delivery
 140            total_delivery_fee
 141          }
 142        }
 143      }
 144    }
 145  `;
 147  // Vendor
 149  export const GET_STORE_DETAILS_BY_VENDOR_ID = gql`
 150    query GetStoreDetailsByVendorId(
 151      $id: String!
 152      $dateKeyword: String
 153      $starting_date: String
 154      $ending_date: String
 155    ) {
 156      getStoreDetailsByVendorId(
 157        id: $id
 158        dateKeyword: $dateKeyword
 159        starting_date: $starting_date
 160        ending_date: $ending_date
 161      ) {
 162        _id
 163        totalOrders
 164        restaurantName
 165        totalSales
 166        pickUpCount
 167        deliveryCount
 168      }
 169    }
 170  `;
 172  export const GET_STORE_DETAILS_BY_VENDOR_ID_PAGINATED = gql`
 173    query GetStoreDetailsByVendorIdPaginated(
 174      $id: String!
 175      $dateKeyword: String
 176      $starting_date: String
 177      $ending_date: String
 178      $page: Int
 179      $limit: Int
 180      $search: String
 181    ) {
 182      getStoreDetailsByVendorIdPaginated(
 183        id: $id
 184        dateKeyword: $dateKeyword
 185        starting_date: $starting_date
 186        ending_date: $ending_date
 187        page: $page
 188        limit: $limit
 189        search: $search
 190      ) {
 191        data {
 192          _id
 193          totalOrders
 194          restaurantName
 195          totalSales
 196          pickUpCount
 197          deliveryCount
 198        }
 199        totalCount
 200        currentPage
 201        totalPages
 202      }
 203    }
 204  `;
 206  export const GET_VENDOR_DASHBOARD_STATS_CARD_DETAILS = gql`
 207    query GetVendorDashboardStatsCardDetails(
 208      $vendorId: String!
 209      $dateKeyword: String
 210      $starting_date: String!
 211      $ending_date: String!
 212    ) {
 213      getVendorDashboardStatsCardDetails(
 214        vendorId: $vendorId
 215        dateKeyword: $dateKeyword
 216        starting_date: $starting_date
 217        ending_date: $ending_date
 218      ) {
 219        totalRestaurants
 220        totalOrders
 221        totalSales
 222        totalDeliveries
 223      }
 224    }
 225  `;
 227  export const GET_VENDOR_LIVE_MONITOR = gql`
 228    query GetVendorLiveMonitorData(
 229      $id: String!
 230      $dateKeyword: String
 231      $starting_date: String
 232      $ending_date: String
 233    ) {
 234      getLiveMonitorData(
 235        id: $id
 236        dateKeyword: $dateKeyword
 237        starting_date: $starting_date
 238        ending_date: $ending_date
 239      ) {
 240        online_stores
 241        cancelled_orders
 242        delayed_orders
 243        ratings
 244      }
 245    }
 246  `;
 248  export const GET_VENDOR_DASHBOARD_GROWTH_DETAILS_BY_YEAR = gql`
 249    query GetVendorDashboardGrowthDetailsByYear($vendorId: String!, $year: Int!) {
 250      getVendorDashboardGrowthDetailsByYear(vendorId: $vendorId, year: $year) {
 251        totalRestaurants
 252        totalOrders
 253        totalSales
 254      }
 255    }
 256  `;
```

### `lib/api/graphql/queries/earnings/index.ts`

```graphql
   3  export const GET_EARNING = gql`
   4    query GetEarning(
   5      $userId: String
   6      $userType: UserTypeEnum
   7      $orderType: OrderTypeEnum
   8      $paymentMethod: PaymentMethodEnum
   9      $pageSize: Int!
  10      $pageNo: Int!
  11      $startingDate: String
  12      $endingDate: String
  13      $search: String
  14    ) {
  15      earnings(
  16        userId: $userId
  17        userType: $userType
  18        orderType: $orderType
  19        paymentMethod: $paymentMethod
  20        search: $search
  21        pagination: { pageSize: $pageSize, pageNo: $pageNo }
  22        dateFilter: { starting_date: $startingDate, ending_date: $endingDate }
  23      ) {
  24        success
  25        message
  26        data {
  27          earnings {
  28            _id
  29            orderId
  30            orderType
  31            paymentMethod
  32            createdAt
  33            updatedAt
  34            platformEarnings {
  35              marketplaceCommission
  36              deliveryCommission
  37              tax
  38              platformFee
  39              totalEarnings
  40            }
  41            riderEarnings {
  42              riderId {
  43                _id
  44                name
  45                username
  46              }
  47              deliveryFee
  48              tip
  49              totalEarnings
  50            }
  51            storeEarnings {
  52              storeId {
  53                _id
  54                name
  55                username
  56              }
  57              orderAmount
  58              totalEarnings
  59            }
  60          }
  61          grandTotalEarnings {
  62            platformTotal
  63            riderTotal
  64            storeTotal
  65          }
  66        }
  67        pagination {
  68          total
  69        }
  70      }
  71    }
  72  `;
  74  export const GET_EARNING_FOR_STORE = gql`
  75    query GetEarning(
  76      $userId: String
  77      $userType: UserTypeEnum
  78      $orderType: OrderTypeEnum
  79      $paymentMethod: PaymentMethodEnum
  80      $pageSize: Int!
  81      $pageNo: Int!
  82      $search: String
  83      $startingDate: String
  84      $endingDate: String
  85    ) {
  86      earnings(
  87        userId: $userId
  88        userType: $userType
  89        orderType: $orderType
  90        paymentMethod: $paymentMethod
  91        search: $search
  92        pagination: { pageSize: $pageSize, pageNo: $pageNo }
  93        dateFilter: { starting_date: $startingDate, ending_date: $endingDate }
  94      ) {
  95        success
  96        message
  97        data {
  98          earnings {
  99            _id
 100            orderId
 101            orderType
 102            paymentMethod
 103            createdAt
 104            updatedAt
 105            riderEarnings {
 106              riderId {
 107                _id
 108                name
 109                username
 110              }
 111              deliveryFee
 112              tip
 113              totalEarnings
 114            }
 115            storeEarnings {
 116              storeId {
 117                _id
 118                name
 119                username
 120              }
 121              orderAmount
 122              totalEarnings
 123            }
 124          }
 125          grandTotalEarnings {
 126            riderTotal
 127            storeTotal
 128          }
 129        }
 130        pagination {
 131          total
 132        }
 133      }
 134    }
 135  `;
```

### `lib/api/graphql/queries/food/index.ts`

```graphql
   3  export const GET_FOODS_BY_RESTAURANT_ID = gql`
   4    query Restaurant($id: String) {
   5      restaurant(id: $id) {
   6        _id
   7        categories {
   8          _id
   9          title
  10          foods {
  11            _id
  12            title
  13            description
  14            isOutOfStock
  15            subCategory
  16            variations {
  17              _id
  18              title
  19              price
  20              discounted
  21              addons
  22              isOutOfStock
  23            }
  24            image
  25            isActive
  26            subCategory
  27          }
  28        }
  29      }
  30    }
  31  `;
```

### `lib/api/graphql/queries/notifications/index.ts`

```graphql
   3  export const GET_NOTIFICATIONS = gql`
   4    query GetNotifications {
   5      notifications {
   6        _id
   7        body
   8        title
   9        createdAt
  10      }
  11    }
  12  `;
  14  export const GET_NOTIFICATIONS_PAGINATED = gql`
  15    query NotificationsPaginated($page: Int, $limit: Int, $search: String) {
  16      notificationsPaginated(page: $page, limit: $limit, search: $search) {
  17        data {
  18          _id
  19          body
  20          title
  21          createdAt
  22        }
  23        totalCount
  24        currentPage
  25        totalPages
  26      }
  27    }
  28  `;
  30  export const GET_WEB_NOTIFICATIONS = gql`
  31    query GetWebNotifications {
  32      webNotifications {
  33        _id
  34        body
  35        navigateTo
  36        read
  37        createdAt
  38      }
  39    }
  40  `;
```

### `lib/api/graphql/queries/options/index.ts`

```graphql
   3  export const GET_OPTIONS_BY_RESTAURANT_ID = gql`
   4    query Restaurant($id: String) {
   5      restaurant(id: $id) {
   6        _id
   7        options {
   8          _id
   9          title
  10          description
  11          price
  12        }
  13      }
  14    }
  15  `;
  17  export const GET_RESTAURANT_OPTIONS_PAGINATED = gql`
  18    query RestaurantOptionsPaginated(
  19      $restaurantId: String!
  20      $page: Int
  21      $limit: Int
  22      $search: String
  23    ) {
  24      restaurantOptionsPaginated(
  25        restaurantId: $restaurantId
  26        page: $page
  27        limit: $limit
  28        search: $search
  29      ) {
  30        data {
  31          _id
  32          title
  33          description
  34          price
  35        }
  36        totalCount
  37        currentPage
  38        totalPages
  39      }
  40    }
  41  `;
```

### `lib/api/graphql/queries/order.ts`

```graphql
   1  'use client';
   4  export const GET_ORDERS_BY_USER = gql`
   5    query OrdersByUser($userId: ID!, $page: Int, $limit: Int) {
   6      ordersByUser(userId: $userId, page: $page, limit: $limit) {
   7        orders {
   8          _id
   9          orderId
  10          orderAmount
  11          orderStatus
  12          paymentMethod
  13          createdAt
  14          deliveryCharges
  15          paidAmount
  16          taxationAmount
  17          tipping
  18          restaurant {
  19            _id
  20            name
  21          }
  22          deliveryAddress {
  23            deliveryAddress
  24            details
  25            label
  26            location {
  27              coordinates
  28            }
  29          }
  30          items {
  31            _id
  32            title
  33            description
  34            quantity
  35            image
  36            specialInstructions
  37            variation {
  38              _id
  39              title
  40              price
  41            }
  42            addons {
  43              _id
  44              title
  45              options {
  46                _id
  47                title
  48                price
  49              }
  50            }
  51          }
  52        }
  53        totalCount
  54        totalPages
  55        currentPage
  56        nextPage
  57        prevPage
  58      }
  59    }
  60  `;
```

### `lib/api/graphql/queries/orders/index.ts`

```graphql
   3  export const GET_ACTIVE_ORDERS = gql`
   4    query GetActiveOrders(
   5      $restaurantId: ID
   6      $page: Int
   7      $rowsPerPage: Int
   8      $actions: [String]
   9      $search: String
  10    ) {
  11      getActiveOrders(
  12        restaurantId: $restaurantId
  13        page: $page
  14        rowsPerPage: $rowsPerPage
  15        actions: $actions
  16        search: $search
  17      ) {
  18        totalCount
  19        orders {
  20          _id
  21          zone {
  22            _id
  23          }
  24          orderId
  25          restaurant {
  26            _id
  27            name
  28            image
  29            address
  30            location {
  31              coordinates
  32            }
  33          }
  34          deliveryAddress {
  35            location {
  36              coordinates
  37            }
  38            deliveryAddress
  39            details
  40            label
  41          }
  42          items {
  43            _id
  44            title
  45            description
  46            image
  47            quantity
  48            variation {
  49              _id
  50              title
  51              price
  52              discounted
  53            }
  54            addons {
  55              _id
  56              options {
  57                _id
  58                title
  59                description
  60                price
  61              }
  62              description
  63              title
  64              quantityMinimum
  65              quantityMaximum
  66            }
  67            specialInstructions
  68            isActive
  69            createdAt
  70            updatedAt
  71          }
  72          user {
  73            _id
  74            name
  75            phone
  76            email
  77          }
  78          paymentMethod
  79          paidAmount
  80          orderAmount
  81          orderStatus
  82          isPickedUp
  83          status
  84          paymentStatus
  85          reason
  86          isActive
  87          createdAt
  88          deliveryCharges
  89          tipping
  90          taxationAmount
  91          completionTime
  92          preparationTime
  93          eta {
  94            phase
  95            source
  96            readyAt
  97            estimatedArrivalAt
  98            windowStartAt
  99            windowEndAt
 100            calculatedAt
 101            lastLocationAt
 102          }
 103          rider {
 104            _id
 105            name
 106            username
 107            available
 108          }
 109        }
 110      }
 111    }
 112  `;
 114  export const GET_ORDER_BY_RESTAURANT = gql`
 115    query ordersByRestId(
 116      $restaurant: String!
 117      $page: Int
 118      $rows: Int
 119      $search: String
 120      $orderStatus: [String]
 121    ) {
 122      ordersByRestId(
 123        restaurant: $restaurant
 124        page: $page
 125        rows: $rows
 126        search: $search
 127        orderStatus: $orderStatus
 128      ) {
 129        totalCount
 130        totalPages
 131        currentPage
 132        prevPage
 133        nextPage
 134        orders {
 135          _id
 136          orderId
 137          restaurant {
 138            _id
 139            name
 140            image
 141            address
 142            location {
 143              coordinates
 144            }
 145          }
 146          deliveryAddress {
 147            location {
 148              coordinates
 149            }
 150            deliveryAddress
 151            details
 152            label
 153          }
 154          items {
 155            _id
 156            title
 157            description
 158            image
 159            quantity
 160            variation {
 161              _id
 162              title
 163              price
 164              discounted
 165            }
 166            addons {
 167              _id
 168              options {
 169                _id
 170                title
 171                description
 172                price
 173              }
 174              description
 175              title
 176              quantityMinimum
 177              quantityMaximum
 178            }
 179            specialInstructions
 180            isActive
 181            createdAt
 182            updatedAt
 183          }
 184          user {
 185            _id
 186            name
 187            phone
 188            email
 189          }
 190          paymentMethod
 191          paidAmount
 192          orderAmount
 193          orderStatus
 194          status
 195          paymentStatus
 196          reason
 197          isActive
 198          createdAt
 199          deliveryCharges
 200          tipping
 201          taxationAmount
 202          rider {
 203            _id
 204            name
 205            username
 206            available
 207          }
 208        }
 209      }
 210    }
 211  `;
 213  export const GET_ORDER_BY_RESTAURANT_WITHOUT_PAGINATION = gql`
 214    query ordersByRestIdWithoutPagination($restaurant: String!, $search: String) {
 215      ordersByRestIdWithoutPagination(restaurant: $restaurant, search: $search) {
 216        _id
 217        orderId
 218        deliveryAddress {
 219          location {
 220            coordinates
 221          }
 222          deliveryAddress
 223          details
 224          label
 225        }
 226        items {
 227          _id
 228          title
 229          description
 230          image
 231          quantity
 232          variation {
 233            _id
 234            title
 235            price
 236            discounted
 237          }
 238          addons {
 239            _id
 240            options {
 241              _id
 242              title
 243              description
 244              price
 245            }
 246            description
 247            title
 248            quantityMinimum
 249            quantityMaximum
 250          }
 251          specialInstructions
 252          isActive
 253          createdAt
 254          updatedAt
 255        }
 256        user {
 257          _id
 258          name
 259          phone
 260          email
 261        }
 262        paymentMethod
 263        paidAmount
 264        orderAmount
 265        orderStatus
 266        status
 267        paymentStatus
 268        reason
 269        isActive
 270        createdAt
 271        deliveryCharges
 272        tipping
 273        taxationAmount
 274      }
 275    }
 276  `;
 278  export const GET_ORDERS = gql`
 279    query Orders($page: Int) {
 280      allOrders(page: $page) {
 281        _id
 282        orderId
 283        restaurant {
 284          _id
 285          name
 286          image
 287          address
 288          location {
 289            coordinates
 290          }
 291        }
 292        deliveryAddress {
 293          location {
 294            coordinates
 295          }
 296          deliveryAddress
 297          details
 298          label
 299        }
 300        items {
 301          _id
 302          title
 303          description
 304          image
 305          quantity
 306          variation {
 307            _id
 308            title
 309            price
 310            discounted
 311          }
 312          addons {
 313            _id
 314            options {
 315              _id
 316              title
 317              description
 318              price
 319            }
 320            description
 321            title
 322            quantityMinimum
 323            quantityMaximum
 324          }
 325          specialInstructions
 326          isActive
 327          createdAt
 328          updatedAt
 329        }
 330        user {
 331          _id
 332          name
 333          phone
 334          email
 335        }
 336        paymentMethod
 337        paidAmount
 338        orderAmount
 339        orderStatus
 340        status
 341        paymentStatus
 342        reason
 343        isActive
 344        createdAt
 345        deliveryCharges
 346        tipping
 347        taxationAmount
 348        rider {
 349          _id
 350          name
 351          username
 352          available
 353        }
 354      }
 355    }
 356  `;
 358  export const GET_ALL_ORDERS_PAGINATED = gql`
 359    query allOrdersPaginated(
 360      $page: Int
 361      $rows: Int
 362      $dateKeyword: String
 363      $starting_date: String
 364      $ending_date: String
 365      $orderStatus: [String]
 366      $search: String
 367      $restaurantId: ID
 368      $riderId: ID
 369    ) {
 370      allOrdersPaginated(
 371        page: $page
 372        rows: $rows
 373        dateKeyword: $dateKeyword
 374        starting_date: $starting_date
 375        ending_date: $ending_date
 376        orderStatus: $orderStatus
 377        search: $search
 378        restaurantId: $restaurantId
 379        riderId: $riderId
 380      ) {
 381        totalCount
 382        currentPage
 383        totalPages
 384        prevPage
 385        nextPage
 386        orders {
 387          _id
 388          orderId
 389          restaurant {
 390            _id
 391            name
 392            image
 393            address
 394            location {
 395              coordinates
 396            }
 397          }
 398          deliveryAddress {
 399            location {
 400              coordinates
 401            }
 402            deliveryAddress
 403            details
 404            label
 405          }
 406          items {
 407            _id
 408            id
 409            title
 410            description
 411            image
 412            quantity
 413            variation {
 414              _id
 415              id
 416              title
 417              price
 418              discounted
 419            }
 420            addons {
 421              _id
 422              id
 423              options {
 424                _id
 425                id
 426                title
 427                description
 428                price
 429              }
 430              description
 431              title
 432              quantityMinimum
 433              quantityMaximum
 434            }
 435            specialInstructions
 436            isActive
 437            createdAt
 438            updatedAt
 439          }
 440          user {
 441            _id
 442            name
 443            phone
 444            email
 445          }
 446          paymentMethod
 447          paidAmount
 448          orderAmount
 449          orderStatus
 450          status
 451          paymentStatus
 452          reason
 453          isActive
 454          createdAt
 455          deliveryCharges
 456          tipping
 457          taxationAmount
 458          rider {
 459            _id
 460            name
 461            username
 462            available
 463          }
 464        }
 465      }
 466    }
 467  `;
 469  export const GET_ORDER_FILTER_OPTIONS = gql`
 470    query OrderFilterOptions {
 471      orderFilterOptions {
 472        restaurants {
 473          _id
 474          name
 475        }
 476        riders {
 477          _id
 478          name
 479          username
 480          phone
 481        }
 482      }
 483    }
 484  `;
 487  export const GET_ORDERS_WITHOUT_PAGINATION = gql`
 488    query OrdersWithoutPagination(
 489      $dateKeyword: String
 490      $starting_date: String
 491      $ending_date: String
 492    ) {
 493      allOrdersWithoutPagination(
 494        dateKeyword: $dateKeyword
 495        starting_date: $starting_date
 496        ending_date: $ending_date
 497      ) {
 498        _id
 499        orderId
 500        restaurant {
 501          _id
 502          name
 503          image
 504          address
 505          location {
 506            coordinates
 507          }
 508        }
 509        deliveryAddress {
 510          location {
 511            coordinates
 512          }
 513          deliveryAddress
 514          details
 515          label
 516        }
 517        items {
 518          _id
 519          title
 520          description
 521          image
 522          quantity
 523          variation {
 524            _id
 525            title
 526            price
 527            discounted
 528          }
 529          addons {
 530            _id
 531            options {
 532              _id
 533              title
 534              description
 535              price
 536            }
 537            description
 538            title
 539            quantityMinimum
 540            quantityMaximum
 541          }
 542          specialInstructions
 543          isActive
 544          createdAt
 545          updatedAt
 546        }
 547        user {
 548          _id
 549          name
 550          phone
 551          email
 552        }
 553        paymentMethod
 554        paidAmount
 555        orderAmount
 556        orderStatus
 557        status
 558        paymentStatus
 559        reason
 560        isActive
 561        createdAt
 562        deliveryCharges
 563        tipping
 564        taxationAmount
 565        rider {
 566          _id
 567          name
 568          username
 569          available
 570        }
 571      }
 572    }
 573  `;
```

### `lib/api/graphql/queries/ratings/index.tsx`

```graphql
   2  export const GET_REVIEWS = gql`
   3    query Reviews($restaurant: String!) {
   4      reviews(restaurant: $restaurant) {
   5        _id
   6        order {
   7          _id
   8          orderId
   9          items {
  10            title
  11          }
  12          user {
  13            _id
  14            name
  15            email
  16          }
  17        }
  18        restaurant {
  19          _id
  20          name
  21          image
  22        }
  23        rating
  24        comments
  25        description
  26        createdAt
  27      }
  28    }
  29  `;
  31  export const GET_REVIEWS_PAGINATED = gql`
  32    query RestaurantReviewsPaginated(
  33      $restaurantId: String!
  34      $page: Int
  35      $limit: Int
  36      $search: String
  37      $minRating: Float
  38      $maxRating: Float
  39    ) {
  40      restaurantReviewsPaginated(
  41        restaurantId: $restaurantId
  42        page: $page
  43        limit: $limit
  44        search: $search
  45        minRating: $minRating
  46        maxRating: $maxRating
  47      ) {
  48        data {
  49          _id
  50          order {
  51            _id
  52            orderId
  53            items {
  54              title
  55            }
  56            user {
  57              _id
  58              name
  59              email
  60            }
  61          }
  62          restaurant {
  63            _id
  64            name
  65            image
  66          }
  67          rating
  68          comments
  69          description
  70          createdAt
  71        }
  72        totalCount
  73        currentPage
  74        totalPages
  75      }
  76    }
  77  `;
```

### `lib/api/graphql/queries/restaurants/index.ts`

```graphql
   3  export const GET_RESTAURANTS_L = gql`
   4    query restaurants {
   5      restaurants {
   6        _id
   7      }
   8    }
   9  `;
  11  export const GET_RESTAURANTS_DROPDOWN = gql`
  12    query restaurants {
  13      restaurants {
  14        _id
  15        name
  16      }
  17    }
  18  `;
  20  //commission rate pagination query
  21  //apply pagination on this query
  22  //search
  23  // shopType
  24  // totalCount
  25  // currentPage
  26  // totalPages
  27  export const GET_COMMISSION_RATES_PAGINATED = gql`
  28    query CommissionRate($page: Int, $limit: Int, $search: String, $sortBy: CommissionRateSortField, $sortOrder: CommissionRateSortOrder) {
  29      commissionRate(page: $page, limit: $limit, search: $search, sortBy: $sortBy, sortOrder: $sortOrder) {
  30        restaurant {
  31          _id
  32          unique_restaurant_id
  33          orderId
  34          orderPrefix
  35          name
  36          commissionRate
  37        }
  38        currentPage
  39        totalPages
  40        totalCount
  41        nextPage
  42        prevPage
  43      }
  44    }
  45  `;
  47  //apply pagination on this query
  48  export const GET_RESTAURANTS = gql`
  49    query restaurants {
  50      restaurants {
  51        unique_restaurant_id
  52        _id
  53        name
  54        image
  55        orderPrefix
  56        slug
  57        address
  58        deliveryTime
  59        minimumOrder
  60        isActive
  61        commissionRate
  62        username
  63        tax
  64        owner {
  65          _id
  66          email
  67          isActive
  68        }
  69        shopType
  70      }
  71    }
  72  `;
  74  export const GET_RESTAURANTS_PAGINATED = gql`
  75    query restaurantsPaginated($page: Int, $limit: Int, $search: String) {
  76      restaurantsPaginated(page: $page, limit: $limit, search: $search) {
  77        data {
  78          unique_restaurant_id
  79          _id
  80          name
  81          image
  82          orderPrefix
  83          slug
  84          address
  85          deliveryTime
  86          minimumOrder
  87          isActive
  88          commissionRate
  89          username
  90          tax
  91          owner {
  92            _id
  93            email
  94            isActive
  95          }
  96          shopType
  97        }
  98        totalCount
  99        currentPage
 100        totalPages
 101      }
 102    }
 103  `;
 106  export const GET_CLONED_RESTAURANTS = gql`
 107    query getClonedRestaurants {
 108      getClonedRestaurants {
 109        unique_restaurant_id
 110        _id
 111        name
 112        image
 113        username
 114        orderPrefix
 115        slug
 116        address
 117        deliveryTime
 118        minimumOrder
 119        isActive
 120        commissionRate
 121        username
 122        tax
 123        owner {
 124          _id
 125          email
 126          isActive
 127        }
 128        shopType
 129      }
 130    }
 131  `;
 133  export const GET_RESTAURANTS_BY_OWNER = gql`
 134    query RestaurantByOwner($id: String) {
 135      restaurantByOwner(id: $id) {
 136        _id
 137        email
 138        userType
 139        restaurants {
 140          unique_restaurant_id
 141          _id
 142          orderId
 143          orderPrefix
 144          name
 145          slug
 146          image
 147          address
 148          isActive
 149          deliveryTime
 150          minimumOrder
 151          username
 152          location {
 153            coordinates
 154          }
 155          deliveryInfo {
 156            minDeliveryFee
 157            deliveryDistance
 158            deliveryFee
 159          }
 160          openingTimes {
 161            day
 162            times {
 163              startTime
 164              endTime
 165            }
 166          }
 167          shopType
 168        }
 169      }
 170    }
 171  `;
 173  export const GET_RESTAURANT_DELIVERY_ZONE_INFO = gql`
 174    query RestaurantDeliveryZoneInfo($id: ID!) {
 175      getRestaurantDeliveryZoneInfo(id: $id) {
 176        boundType
 177        deliveryBounds {
 178          coordinates
 179        }
 180        location {
 181          coordinates
 182        }
 184        circleBounds {
 185          radius
 186        }
 188        address
 189        city
 190        postCode
 191      }
 192    }
 193  `;
 195  export const GET_RESTAURANT_PROFILE = gql`
 196    query Restaurant($id: String) {
 197      restaurant(id: $id) {
 198        _id
 199        orderId
 200        orderPrefix
 201        slug
 202        name
 203        image
 204        phone
 205        logo
 206        address
 207        location {
 208          coordinates
 209        }
 210        deliveryBounds {
 211          coordinates
 212        }
 213        deliveryInfo {
 214          minDeliveryFee
 215          deliveryDistance
 216          deliveryFee
 217        }
 218        username
 219        deliveryTime
 220        minimumOrder
 221        tax
 222        isAvailable
 223        stripeDetailsSubmitted
 224        openingTimes {
 225          day
 226          times {
 227            startTime
 228            endTime
 229          }
 230        }
 231        owner {
 232          _id
 233          email
 234        }
 235        shopType
 236        cuisines
 238        bussinessDetails {
 239          bankName
 240          accountName
 241          accountCode
 242          accountNumber
 243          bussinessRegNo
 244          companyRegNo
 245          taxRate
 246        }
 248        currentWalletAmount
 249        totalWalletAmount
 250        withdrawnWalletAmount
 251      }
 252    }
 253  `;
 257  export const GET_CLONED_RESTAURANTS_PAGINATED = gql`
 258    query getClonedRestaurantsPaginated(
 259      $page: Int
 260      $limit: Int
 261      $search: String
 262    ) {
 263      getClonedRestaurantsPaginated(page: $page, limit: $limit, search: $search) {
 264        data {
 265          unique_restaurant_id
 266          _id
 267          name
 268          image
 269          username
 270          orderPrefix
 271          slug
 272          address
 273          deliveryTime
 274          minimumOrder
 275          isActive
 276          commissionRate
 277          username
 278          tax
 279          owner {
 280            _id
 281            email
 282            isActive
 283          }
 284          shopType
 285        }
 286        totalCount
 287        currentPage
 288        totalPages
 289      }
 290    }
 291  `;
```

### `lib/api/graphql/queries/riders/index.ts`

```graphql
   3  export const GET_RIDERS = gql`
   4    query riders {
   5      riders {
   6        _id
   7        name
   8        username
   9        phone
  10        available
  11        vehicleType
  12        assigned
  13        zone {
  14          _id
  15          title
  16        }
  17      }
  18    }
  19  `;
  21  export const GET_RIDERS_PAGINATED = gql`
  22    query RidersPaginated(
  23      $page: Int
  24      $limit: Int
  25      $search: String
  26      $zone: String
  27      $available: Boolean
  28      $isActive: Boolean
  29    ) {
  30      ridersPaginated(
  31        page: $page
  32        limit: $limit
  33        search: $search
  34        zone: $zone
  35        available: $available
  36        isActive: $isActive
  37      ) {
  38        data {
  39          _id
  40          name
  41          username
  42          phone
  43          available
  44          vehicleType
  45          assigned
  46          zone {
  47            _id
  48            title
  49          }
  50        }
  51        totalCount
  52        currentPage
  53        totalPages
  54      }
  55    }
  56  `;
  58  export const GET_RIDER = gql`
  59    query Rider($id: String!) {
  60      rider(id: $id) {
  61        _id
  62        name
  63        username
  64        phone
  65        available
  66        assigned
  67        zone {
  68          _id
  69          title
  70        }
  71        bussinessDetails {
  72          bankName
  73          accountName
  74          accountCode
  75          accountNumber
  76          bussinessRegNo
  77          companyRegNo
  78          taxRate
  79        }
  80        licenseDetails {
  81          number
  82          expiryDate
  83          image
  84        }
  85        vehicleDetails {
  86          number
  87          image
  88        }
  89      }
  90    }
  91  `;
  93  export const GET_AVAILABLE_RIDERS = gql`
  94    query {
  95      availableRiders {
  96        _id
  97        name
  98        username
  99        phone
 100        available
 101        vehicleType
 102        zone {
 103          _id
 104        }
 105      }
 106    }
 107  `;
 108  export const GET_RIDERS_BY_ZONE = gql`
 109    query RidersByZone($id: String!) {
 110      ridersByZone(id: $id) {
 111        _id
 112        name
 113        username
 114        phone
 115        available
 116        vehicleType
 117        zone {
 118          _id
 119          title
 120        }
 121      }
 122    }
 123  `;
```

### `lib/api/graphql/queries/shop-types/index.ts`

```graphql
   3  export const GET_SHOP_TYPES = gql`
   4   query FetchShopTypes($filter: FetchShopTypeFilter, $pagination: PaginationInput) {
   5    fetchShopTypes(filter: $filter, pagination: $pagination) {
   6      data {
   7        _id
   8        name
   9        image
  10        isActive
  11      }
  12      total
  13      page
  14      pageSize
  15      totalPages
  16      hasNextPage
  17      hasPrevPage
  18    }
  19  }`;
  21  export const GET_UNIQUE_SHOP_TYPE = gql`
  22   query FetchUniqueShopType($dto: FetchUniqueShopTypeInput) {
  23    fetchShopTypeByUnique(dto: $dto) {
  24        _id
  25        name
  26        image
  27        isActive
  28    }
  29  }`;
```

### `lib/api/graphql/queries/staff/index.ts`

```graphql
   3  export const GET_STAFFS = gql`
   4    query staffs {
   5      staffs {
   6        _id
   7        name
   8        email
   9        phone
  10        # vehicleType
  11        isActive
  12        permissions
  13      }
  14    }
  15  `;
  17  export const GET_STAFFS_PAGINATED = gql`
  18    query StaffsPaginated(
  19      $page: Int
  20      $limit: Int
  21      $search: String
  22      $isActive: Boolean
  23    ) {
  24      staffsPaginated(
  25        page: $page
  26        limit: $limit
  27        search: $search
  28        isActive: $isActive
  29      ) {
  30        data {
  31          _id
  32          name
  33          email
  34          phone
  35          isActive
  36          permissions
  37        }
  38        totalCount
  39        currentPage
  40        totalPages
  41      }
  42    }
  43  `;
```

### `lib/api/graphql/queries/sub-categories/index.ts`

```graphql
   3  export const GET_SUBCATEGORIES = gql`
   4    query subCategories {
   5      subCategories {
   6        _id
   7        title
   8        parentCategoryId
   9      }
  10    }
  11  `;
  12  export const GET_SUBCATEGORY = gql`
  13    query SubCategory($id: String) {
  14      subCategory(_id: $id) {
  15        _id
  16        title
  17        parentCategoryId
  18      }
  19    }
  20  `;
  21  export const GET_SUBCATEGORIES_BY_PARENT_ID = gql`
  22    query GetSubCategoriesByParentId($parentCategoryId: String!) {
  23      subCategoriesByParentId(parentCategoryId: $parentCategoryId) {
  24        _id
  25        title
  26        parentCategoryId
  27      }
  28    }
  29  `;
```

### `lib/api/graphql/queries/supportTickets/index.ts`

```graphql
   1  // Path: /lib/api/graphql/queries/supportTickets/index.ts
   5  // Get users who have support tickets WITH their latest ticket info
   6  export const GET_TICKET_USERS_WITH_LATEST = gql`
   7    query GetTicketUsersWithLatest($input: FiltersInput) {
   8      getTicketUsersWithLatest(input: $input) {
   9        users {
  10          _id
  11          name
  12          email
  13          phone
  14          isActive
  15          userType
  16          latestTicket {
  17            _id
  18            title
  19            description
  20            status
  21            category
  22            orderId
  23            otherDetails
  24            createdAt
  25            updatedAt
  26          }
  27        }
  28        docsCount
  29        totalPages
  30        currentPage
  31      }
  32    }
  33  `;
  35  // Original queries unchanged
  36  export const GET_TICKET_USERS = gql`
  37    query GetTicketUsers($input: FiltersInput) {
  38      getTicketUsers(input: $input) {
  39        users {
  40          _id
  41          name
  42          email
  43          phone
  44          isActive
  45          userType
  46        }
  47        docsCount
  48        totalPages
  49        currentPage
  50      }
  51    }
  52  `;
  54  export const GET_USER_SUPPORT_TICKETS = gql`
  55    query GetSingleUserSupportTickets($input: SingleUserSupportTicketsInput!) {
  56      getSingleUserSupportTickets(input: $input) {
  57        tickets {
  58          _id
  59          title
  60          description
  61          status
  62          category
  63          orderId
  64          otherDetails
  65          createdAt
  66          updatedAt
  67          user {
  68            _id
  69            name
  70            email
  71          }
  72        }
  73        docsCount
  74        totalPages
  75        currentPage
  76      }
  77    }
  78  `;
  80  export const GET_SINGLE_SUPPORT_TICKET = gql`
  81    query GetSingleSupportTicket($ticketId: ID!) {
  82      getSingleSupportTicket(ticketId: $ticketId) {
  83        _id
  84        title
  85        description
  86        status
  87        category
  88        orderId
  89        otherDetails
  90        createdAt
  91        updatedAt
  92        user {
  93          _id
  94          name
  95          email
  96          phone
  97        }
  98      }
  99    }
 100  `;
 102  export const GET_TICKET_MESSAGES = gql`
 103    query GetTicketMessages($input: TicketMessagesInput!) {
 104      getTicketMessages(input: $input) {
 105        messages {
 106          _id
 107          content
 108          senderType
 109          isRead
 110          createdAt
 111          updatedAt
 112        }
 113        ticket {
 114          _id
 115          title
 116          status
 117          user {
 118            _id
 119            name
 120          }
 121        }
 122        page
 123        totalPages
 124        docsCount
 125      }
 126    }
 127  `;
```

### `lib/api/graphql/queries/tippings/index.ts`

```graphql
   3  export const GET_TIPPING = gql`
   4    query Tips {
   5      tips {
   6        _id
   7        tipVariations
   8        enabled
   9      }
  10    }
  11  `;
```

### `lib/api/graphql/queries/token/index.ts`

```graphql
   3  export const UPLOAD_TOKEN = gql`
   4    mutation UploadToken($id: String!, $pushToken: String!) {
   5      uploadToken(id: $id, pushToken: $pushToken) {
   6        _id
   7        pushToken
   8      }
   9    }
  10  `;
```

### `lib/api/graphql/queries/transaction-history/index.ts`

```graphql
   3  export const GET_TRANSACTION_HISTORY = gql`
   4    query TransactionHistory(
   5      $userType: UserTypeEnum
   6      $userId: String
   7      $search: String
   8      $pageSize: Int!
   9      $pageNo: Int!
  10      $startingDate: String
  11      $endingDate: String
  12    ) {
  13      transactionHistory(
  14        userType: $userType
  15        userId: $userId
  16        search: $search
  17        pagination: { pageSize: $pageSize, pageNo: $pageNo }
  18        dateFilter: { starting_date: $startingDate, ending_date: $endingDate }
  19      ) {
  20        data {
  21          _id
  22          amountCurrency
  23          status
  24          transactionId
  25          userType
  26          userId
  27          amountTransferred
  28          createdAt
  29          toBank {
  30            accountName
  31            bankName
  32            accountNumber
  33            accountCode
  34          }
  35          rider {
  36            _id
  37            name
  38            email
  39            username
  40            phone
  41            image
  42            available
  43            isActive
  44            # isSuperAdminRider
  45            accountNumber
  46            currentWalletAmount
  47            totalWalletAmount
  48            withdrawnWalletAmount
  49            createdAt
  50            updatedAt
  51          }
  52          store {
  53            unique_restaurant_id
  54            _id
  55            name
  56            rating
  57            reviewAverage
  58            isActive
  59            isAvailable
  60            slug
  61            stripeDetailsSubmitted
  62            address
  63            phone
  64            city
  65            postCode
  66          }
  67        }
  68        pagination {
  69          total
  70        }
  71      }
  72    }
  73  `;
```

### `lib/api/graphql/queries/user/index.ts`

```graphql
   3  export const GET_USERS = gql`
   4    query users {
   5      users {
   6        _id
   7        name
   8        email
   9        phone
  10        createdAt
  11        userType
  12        status
  13        lastLogin
  14        notes
  15        addresses {
  16          location {
  17            coordinates
  18          }
  19          deliveryAddress
  20        }
  21      }
  22    }
  23  `;
  25  export const GET_USERS_PAGINATED = gql`
  26    query UsersPaginated(
  27      $page: Int
  28      $limit: Int
  29      $search: String
  30      $registrationMethod: String
  31      $status: String
  32    ) {
  33      usersPaginated(
  34        page: $page
  35        limit: $limit
  36        search: $search
  37        registrationMethod: $registrationMethod
  38        status: $status
  39      ) {
  40        data {
  41          _id
  42          name
  43          email
  44          phone
  45          createdAt
  46          userType
  47          status
  48          lastLogin
  49          notes
  50          addresses {
  51            location {
  52              coordinates
  53            }
  54            deliveryAddress
  55          }
  56        }
  57        totalCount
  58        currentPage
  59        totalPages
  60      }
  61    }
  62  `;
  63  export const GET_USERS_L = gql`
  64    query users {
  65      users {
  66        _id
  67      }
  68    }
  69  `;
  71  export const GET_USER_BY_ID = gql`
  72    query GetUser($userId: ID!) {
  73      user(id: $userId) {
  74        _id
  75        name
  76        phone
  77        phoneIsVerified
  78        email
  79        emailIsVerified
  80        isActive
  81        status
  82        lastLogin
  83        isOrderNotification
  84        isOfferNotification
  85        createdAt
  86        updatedAt
  87        notificationToken
  88        userType
  89        favourite
  90        notes
  91        addresses {
  92          _id
  93          deliveryAddress
  94          details
  95          label
  96          selected
  97          location {
  98            coordinates
  99          }
 100        }
 101      }
 102    }
 103  `;
```

### `lib/api/graphql/queries/vendors/index.ts`

```graphql
   3  export const GET_VENDORS = gql`
   4    query vendors {
   5      vendors {
   6        unique_id
   7        _id
   8        email
   9        userType
  10        isActive
  11        name
  12        image
  13        restaurants {
  14          _id
  15        }
  16      }
  17      vendorCount @client
  18    }
  19  `;
  21  export const GET_VENDORS_L = gql`
  22    query vendors {
  23      vendors {
  24        _id
  25      }
  26    }
  27  `;
  29  export const GET_VENDOR_BY_ID = gql`
  30    query GetVendor($id: String!) {
  31      getVendor(id: $id) {
  32        _id
  33        email
  34        userType
  35        name
  36        image
  37        firstName
  38        lastName
  39        phoneNumber
  40      }
  41    }
  42  `;
  44  export const GET_VENDOR_BY_ID_WITH_RESTAURANTS = gql`
  45    query GetVendor($id: String!) {
  46      getVendor(id: $id) {
  47        _id
  48        email
  49        userType
  50        name
  51        image
  52        restaurants {
  53          _id
  54          orderId
  55          orderPrefix
  56          slug
  57          name
  58          image
  59          address
  60          location {
  61            coordinates
  62          }
  63          shopType
  64        }
  65      }
  66    }
  67  `;
```

### `lib/api/graphql/queries/withdraw-requests/index.ts`

```graphql
   3  export const GET_ALL_WITHDRAW_REQUESTS = gql`
   4    query WithdrawRequests(
   5      $userType: UserTypeEnum
   6      $userId: String
   7      $pageSize: Int!
   8      $pageNo: Int!
   9      $search: String
  10    ) {
  11      withdrawRequests(
  12        userType: $userType
  13        userId: $userId
  14        pagination: { pageSize: $pageSize, pageNo: $pageNo }
  15        search: $search
  16      ) {
  17        message
  18        pagination {
  19          total
  20        }
  21        data {
  22          _id
  23          requestId
  24          requestAmount
  25          requestTime
  26          status
  27          createdAt
  28          rider {
  29            _id
  30            name
  31            email
  32            phone
  33            available
  34            isActive
  35            # isSuperAdminRider
  36            accountNumber
  37            currentWalletAmount
  38            totalWalletAmount
  39            withdrawnWalletAmount
  40            createdAt
  41            updatedAt
  42            username
  43            bussinessDetails {
  44              bankName
  45              accountName
  46              accountCode
  47              accountNumber
  48              bussinessRegNo
  49              companyRegNo
  50              taxRate
  51            }
  52          }
  53          store {
  54            unique_restaurant_id
  55            _id
  56            image
  57            logo
  58            address
  59            username
  60            slug
  61            stripeDetailsSubmitted
  62            commissionRate
  63            bussinessDetails {
  64              bankName
  65              accountName
  66              accountCode
  67              accountNumber
  68              bussinessRegNo
  69              companyRegNo
  70              taxRate
  71            }
  72          }
  73        }
  74        success
  75      }
  76    }
  77  `;
```

### `lib/api/graphql/queries/zone/index.ts`

```graphql
   3  export const GET_ZONES = gql`
   4    query Zones {
   5      zones {
   6        _id
   7        title
   8        description
   9        location {
  10          coordinates
  11        }
  12        isActive
  13      }
  14    }
  15  `;
  17  export const GET_ZONES_PAGINATED = gql`
  18    query ZonesPaginated(
  19      $page: Int
  20      $limit: Int
  21      $search: String
  22      $isActive: Boolean
  23    ) {
  24      zonesPaginated(
  25        page: $page
  26        limit: $limit
  27        search: $search
  28        isActive: $isActive
  29      ) {
  30        data {
  31          _id
  32          title
  33          description
  34          location {
  35            coordinates
  36          }
  37          isActive
  38        }
  39        totalCount
  40        currentPage
  41        totalPages
  42      }
  43    }
  44  `;
```

### `lib/api/graphql/subscription/order-subscription/index.ts`

```graphql
   3  export const SUBSCRIPTION_PLACE_ORDER = gql`
   4    subscription SubscribePlaceOrder($restaurant: String!) {
   5      subscribePlaceOrder(restaurant: $restaurant) {
   6        userId
   7        origin
   8        order {
   9          _id
  10          orderId
  11          restaurant {
  12            _id
  13            name
  14            image
  15            address
  16            location {
  17              coordinates
  18            }
  19          }
  20          deliveryAddress {
  21            location {
  22              coordinates
  23            }
  24            deliveryAddress
  25            details
  26            label
  27          }
  28          items {
  29            _id
  30            title
  31            description
  32            image
  33            quantity
  34            variation {
  35              _id
  36              title
  37              price
  38              discounted
  39            }
  40            addons {
  41              _id
  42              options {
  43                _id
  44                title
  45                description
  46                price
  47              }
  48              description
  49              title
  50              quantityMinimum
  51              quantityMaximum
  52            }
  53            specialInstructions
  54            isActive
  55            createdAt
  56            updatedAt
  57          }
  58          user {
  59            _id
  60            name
  61            phone
  62            email
  63          }
  64          paymentMethod
  65          paidAmount
  66          orderAmount
  67          orderStatus
  68          status
  69          paymentStatus
  70          reason
  71          isActive
  72          createdAt
  73          deliveryCharges
  74          rider {
  75            _id
  76            name
  77            username
  78            available
  79          }
  80        }
  81      }
  82    }
  83  `;
  85  export const SUBSCRIPTION_DISPATCH_ORDER = gql`
  86    subscription SubscriptionDispatcher {
  87      subscriptionDispatcher {
  88        _id
  89        zone {
  90          _id
  91        }
  92        orderId
  93        restaurant {
  94          _id
  95          name
  96          image
  97          address
  98          location {
  99            coordinates
 100          }
 101        }
 102        deliveryAddress {
 103          location {
 104            coordinates
 105          }
 106          deliveryAddress
 107        }
 108        user {
 109          name
 110          phone
 111        }
 112        paymentMethod
 113        orderStatus
 114        preparationTime
 115        completionTime
 116        eta {
 117          phase
 118          source
 119          readyAt
 120          estimatedArrivalAt
 121          windowStartAt
 122          windowEndAt
 123          calculatedAt
 124          lastLocationAt
 125        }
 126        expectedTime
 127        acceptedAt
 128        selectedPrepTime
 129        isPickedUp
 130        status
 131        isActive
 132        createdAt
 133        rider {
 134          _id
 135          name
 136          username
 137          available
 138        }
 139      }
 140    }
 141  `;
 143  export const SUBSCRIPTION_ORDER = gql`
 144    subscription SubscriptionOrder($id: String!) {
 145      subscriptionOrder(id: $id) {
 146        _id
 147        orderStatus
 148        rider {
 149          _id
 150        }
 151        completionTime
 152        preparationTime
 153        eta {
 154          phase
 155          source
 156          readyAt
 157          estimatedArrivalAt
 158          windowStartAt
 159          windowEndAt
 160          calculatedAt
 161          lastLocationAt
 162        }
 163      }
 164    }
 165  `;
 167  export const ORDER_TRACKING = gql`
 168    query OrderTracking($id: ID!) {
 169      orderTracking(id: $id) {
 170        orderId
 171        status
 172        riderLocation {
 173          latitude
 174          longitude
 175          accuracy
 176          heading
 177          speed
 178          recordedAt
 179        }
 180        eta {
 181          phase
 182          source
 183          readyAt
 184          estimatedArrivalAt
 185          windowStartAt
 186          windowEndAt
 187          calculatedAt
 188          lastLocationAt
 189        }
 190      }
 191    }
 192  `;
 194  export const SUBSCRIPTION_ORDER_TRACKING = gql`
 195    subscription SubscriptionOrderTracking($id: String!) {
 196      subscriptionOrderTracking(id: $id) {
 197        orderId
 198        status
 199        riderLocation {
 200          latitude
 201          longitude
 202          accuracy
 203          heading
 204          speed
 205          recordedAt
 206        }
 207        eta {
 208          phase
 209          source
 210          readyAt
 211          estimatedArrivalAt
 212          windowStartAt
 213          windowEndAt
 214          calculatedAt
 215          lastLocationAt
 216        }
 217      }
 218    }
 219  `;
```

### `lib/api/graphql/subscription/rider-subscription/index.ts`

```graphql
   3  export const RIDER_UPDATED_SUBSCRIPTION = gql`
   4    subscription RiderUpdated {
   5      riderUpdated {
   6        _id
   7      }
   8    }
   9  `;
```
