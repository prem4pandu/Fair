# 03 — Store (merchant) and Rider app flows: backend contract reference

Status: read-only research, written 2026-10-08. It covers the unchanged Enatega sources in
`implementation/vendor/enatega-ui/`. Backend agents must implement exactly the operation names,
arguments and selection sets below. Anything marked **UNVERIFIED** is an inference that the client
code does not prove. Confirm it before relying on it.

Path abbreviations used in citations:

- `S/` = `implementation/vendor/enatega-ui/enatega-multivendor-store/`
- `R/` = `implementation/vendor/enatega-ui/enatega-multivendor-rider/`
- `A/` = `implementation/vendor/enatega-ui/enatega-multivendor-admin/` (used only for audience cross-reference)
- `C/` = `implementation/vendor/enatega-ui/enatega-multivendor-app/` (customer app; audience cross-reference only)

Frontend boundary reminder (AGENTS.md, owner directive 2026-10-08): the product UI is the unchanged
pinned Enatega frontend. FairBite owns the backend and integration layer only. Do not create,
redesign or replace Enatega screens. Any edit inside the vendored Enatega tree must be recorded in
`SOURCE_PROVENANCE.json` under `allowedModifications`. If the backend lacks a capability, treat it as
an integration blocker. It never justifies a substitute UI, fabricated data or calls to the upstream
production backend. Include this rule in every frontend/mobile handoff.

---

## 0. Transport and session (both apps)

### 0.1 Endpoints (integration blocker)

- Store MULTI mode **hard-codes the upstream production backend** with no env override:
  `GRAPHQL_URL: "https://aws-server-v2.enatega.com/graphql"`,
  `WS_GRAPHQL_URL: "wss://aws-server-v2.enatega.com/graphql"` (`S/environment.ts:9-15`).
  SINGLE mode reads `EXPO_PUBLIC_SINGLE_VENDOR_GRAPHQL_URL` / `EXPO_PUBLIC_SINGLE_VENDOR_WS_GRAPHQL_URL`
  and falls back to an upstream railway URL in dev (`S/environment.ts:24-38`).
  - Result: the store app cannot reach our backend in MULTI mode unless someone makes a recorded
    `allowedModifications` config edit, or uses SINGLE mode with env vars.
  - This is a **blocker for the lead/mobile lane**. Backend must not "solve" it by proxying the
    upstream backend.
- Rider: `EXPO_PUBLIC_GRAPHQL_URL` / `EXPO_PUBLIC_WS_GRAPHQL_URL` override MULTI, but the fallback is
  still upstream (`R/environment.ts:10-17`). SINGLE requires https/wss env vars in release builds
  (`R/environment.ts:18-35`).
- Mode selection comes from `EXPO_PUBLIC_VENDOR_MODE` = `SINGLE` | `MULTI` (otherwise toggle)
  (`S/lib/mode/store-mode.ts`, `R/lib/mode/rider-mode.ts`).

### 0.2 HTTP and WS headers sent

- Both apps send these headers on every HTTP operation:
  - `authorization: "Bearer <jwt>"`, or `""` when there is no session
  - `x-platform: ios|android`
  - `accept-language: <lang, default "en">`
  - `user-agent`: `Enatega-Store-App/<os>` or `Enatega-Rider-App/<os>`
  - when `PUBLIC_ACCESS_REQUIRED` (always `true`): `nonce: <device nonce>` and `bop-auth: "Bearer <public token>"`
- Citations: `S/lib/apollo/index.ts:126-152`, `R/lib/apollo/index.ts:184-204`.
- WS `connectionParams` carry the **same keys as a flat object**:
  - `authorization`, `x-platform`, `accept-language`, `user-agent`, `nonce`, `bop-auth`
  - `S/lib/apollo/index.ts:84-124` uses `subscriptions-transport-ws` via `WebSocketLink`, `lazy`, `reconnect`, `timeout: 30000`.
  - `R/lib/apollo/index.ts:148-182` uses `subscriptions-transport-ws` `SubscriptionClient`, `lazy`, `reconnect`.
  - Server must speak the **legacy `subscriptions-transport-ws` (graphql-ws subprotocol)**.
  - Server must authenticate the socket from `connectionParams.authorization` (comment `S/lib/apollo/index.ts:79-83`: "the server rejects `subscribePlaceOrder` (ensureRestaurantAccess)").
- The store login explicitly sends `authorization: ""` (`S/lib/hooks/useLogin.ts:162-166`).

### 0.3 Public-access proof (`metricsGeneral`), required before almost every call

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

- Defined at `S/lib/services/public-access-token.service.ts:9-24` and `R/lib/apollo/mutations/metrics/index.ts:3-20`.
- The client sends it with headers `nonce`, `x-platform`, `accept-language`, `user-agent`, `x-skip-public-auth: "true"`, and no `bop-auth`.
- The client reads `metricsGeneral.experience` as the public token (string) and `metricsGeneral.hehe` as its expiry. The expiry must parse with `new Date(...)`.
  - Citation: `S/lib/services/public-access-token.service.ts:167-189`.
- It refreshes 30 s before expiry (`:95-113`).
- Background rider location reuses it through a raw fetch, `mutation BackgroundPublicToken { metricsGeneral { experience hehe } }` (`R/lib/services/background-location.ts:89-110`).
- The other 8 fields must exist in the schema (any scalar). **UNVERIFIED**: what they mean upstream. Treat them as decoys.
- Server rules:
  - Issue a short-lived token bound to `nonce` (and optionally the user-agent/platform fingerprint).
  - Validate `bop-auth` + `nonce` on other operations.
  - The store retries once after `PublicAccessTokenService.reset` when it sees an error message containing `public proof` / `fingerprint` / `invalid token` / `unauthorized` on a request **without** user authorization (`S/lib/apollo/index.ts:198-234`).
- **Do not** return the `UNAUTHENTICATED` code for public-proof failures. The rider treats messages that start with `unauthorized:` or contain `fingerprint` / `public token` / `bop-auth` / `nonce` as _non-session_ errors (`R/lib/utils/session.ts:48-58`). Use the message prefix `Unauthorized: public proof ...`.

### 0.4 Session invalidation semantics

- Store: if a request **had user authorization** and the response carries GraphQL `extensions.code` in `TOKEN_EXPIRED | INVALID_TOKEN | UNAUTHENTICATED`, or HTTP 401, the app deletes the token and store-id and goes to login.
  - Citation: `S/lib/apollo/index.ts:175-242`.
- The store also decodes the JWT client-side and logs out when `exp*1000 <= now+15s` (`S/lib/apollo/index.ts:28-39,131-134`), so **the access token must be a JWT with numeric `exp`**.
- Rider session is invalid when:
  - the code is one of the three above, or
  - the message is `unauthorized` / starts with `unauthenticated` / contains `access token expired` / `invalid token` / `token must be provided`, or
  - for operation name `rider`: code `FORBIDDEN`, or a message containing `not authorized` / `rider does not exist` / `rider not found`.
  - Citation: `R/lib/utils/session.ts:37-79`.
- The rider profile query is named `rider` (`R/lib/apollo/queries/rider.query.ts:44`).
- When `rider(id)` returns `null` or "rider not found", the rider app logs out (`R/lib/context/global/user.context.tsx:132-144`).
- Logout is **client-only** in both apps. No server mutation is called (`S/lib/context/global/auth.context.tsx:75-88`, `R/lib/context/global/auth.context.tsx:80-90`). The server cannot rely on a logout call to clear push tokens.

### 0.5 Configuration query

```graphql
# store  S/lib/apollo/queries/configuration.query.ts:3-12
query Configuration {
  configuration {
    _id
    currency
    currencySymbol
    restaurantAppSentryUrl
  }
}
# rider  R/lib/api/graphql/query/configuration/index.ts:3-12
query Configuration {
  configuration {
    _id
    currency
    currencySymbol
    riderAppSentryUrl
  }
}
```

- The rider skips the query until auth is ready, and in SINGLE mode also until a token exists (`R/lib/context/global/configuration.context.tsx:44-49`). In MULTI mode it is called anonymously (with public proof only).
- `currencySymbol` is prefixed to every amount display.
- **Amounts are floats in major units on the wire** (`toFixed(2)`). Our integer-minor-unit ledger must convert at the GraphQL edge.

---

## 1. STORE app (merchant)

### 1.1 Login: `restaurantLogin`

```graphql
# S/lib/apollo/mutations/login.mutation.ts:3-18
mutation RestaurantLogin(
  $username: String!
  $password: String!
  $notificationToken: String
) {
  restaurantLogin(
    username: $username
    password: $password
    notificationToken: $notificationToken
  ) {
    token
    restaurantId
  }
}
```

- Flow (`S/lib/hooks/useLogin.ts:87-167`):
  1. Wipe the local token and store id.
  2. `PublicAccessTokenService.reset` (mint a new proof).
  3. Request notification permission and get an Expo push token. `notificationToken` is an **Expo push token (`ExponentPushToken[...]`)**, or `null`.
  4. Call the mutation with `authorization: ""` and `fetchPolicy: no-cache`.
- On success (`:70-78`) the app stores `restaurantId` under the store-id key and `token` under the token key, then routes home.
- Error mapping (`:34-67`):
  - Code `TOO_MANY_REQUESTS` / `RATE_LIMITED`, or a message containing "rate limit" / "too many request" / "too many attempt", is shown raw.
  - Code `UNAUTHENTICATED`, or a message containing "invalid credential(s)" / "invalid username" / "invalid password" / "incorrect password" / "user not found", becomes "Invalid credentials".
  - Anything else is shown raw.
- Server rules:
  - `username` is the restaurant's login username (vendor/restaurant credential, **not** the customer user).
  - Token claims must identify the restaurant (and owner/vendor).
  - Persist `notificationToken` on the restaurant when it is non-null.
  - Rate-limit.
  - Return `restaurantId` as the restaurant `_id` string.
- **UNVERIFIED**: whether one vendor login can own several restaurants. The app assumes a single `restaurantId` per session.

### 1.2 Push token: `saveRestaurantToken`

```graphql
# S/lib/apollo/mutations/notification.mutation.ts:3-11
mutation saveRestaurantToken($token: String, $isEnabled: Boolean) {
  saveRestaurantToken(token: $token, isEnabled: $isEnabled) {
    _id
    notificationToken
    enableNotification
  }
}
```

- Called at app start (`S/app/index.tsx:45-58`): if `restaurant.enableNotification` is true and permission is granted, send `{ token: <Expo push token>, isEnabled: true }`.
- No restaurant id is passed, so the **server must derive the restaurant from the JWT**.
- Return type is `Restaurant`.
- Push notification payload the store reads: `content.data._id` (string, order `_id`), used only for dedupe (`S/lib/hooks/useNotification.ts:76-93`).
- Server should push to the restaurant on new order. **UNVERIFIED**: the exact body text.

### 1.3 Restaurant profile and lookups (`restaurant(id)`)

Four documents use `restaurant(id: String)`, which returns `Restaurant`:

1. `STORE_PROFILE` (MULTI): `query Restaurant($restaurantId: String!) { restaurant(id: $restaurantId) {...} }` (`S/lib/apollo/queries/store.query.ts:65-99`).
   - Fields: `_id unique_restaurant_id orderId orderPrefix name image logo address username minimumOrder isActive isAvailable slug commissionRate tax notificationToken enableNotification shopType phone hasBusinessDetails openingTimes { day times { startTime endTime } }`.
   - Used by the user context (`S/lib/context/global/user.context.tsx:53-66`, `cache-and-network`, variables `{ restaurantId: <stored id> }`). It is refetched after toggle, bank and schedule mutations.
2. `STORE_PROFILE_SINGLE_VENDOR` (`:101-138`): same fields, minus `hasBusinessDetails`, plus `bussinessDetails { bankName accountNumber accountName accountCode }`. The client derives `hasBusinessDetails` itself (`user.context.tsx:98-113`).
3. `GET_RESTAURANT_BY_ID`: `query Restaurant($id: String) { restaurant(id: $id) { _id orderId orderPrefix name image address location { coordinates } deliveryTime username isAvailable notificationToken enableNotification openingTimes { day times { startTime endTime } } } }` (`:140-166`).
   - Used at startup with `{ id: storeId }` (`S/lib/hooks/useNotification.ts:17-30`).
4. `STORE_BY_ID`: `query Restaurant($restaurantId: String) { restaurant(id: $restaurantId) { zone { _id } location { coordinates } totalWalletAmount withdrawnWalletAmount currentWalletAmount bussinessDetails { bankName accountNumber accountName accountCode } } }` (`:3-23`).
   - **Client bug**: the wallet screen passes variables `{ id: userId }`, not `{ restaurantId }` (`S/lib/ui/screen-components/wallet/view/main/index.tsx:84-95,136-139`).
   - So the server receives `restaurant(id: null)`.
   - **Server rule required**: when `id` is null/omitted and the caller is a restaurant session, resolve to the caller's restaurant. Otherwise the wallet balance never renders.

Server rules for `restaurant(id)`:

- Restaurant callers may only read **their own** restaurant. If `id` differs from the token's restaurant, return FORBIDDEN.
- The customer apps also call `restaurant(id)` publicly. Sensitive fields must be null or forbidden for non-owners: `notificationToken`, `bussinessDetails`, wallet amounts, `commissionRate`, `username`.
- `openingTimes.times.startTime` / `endTime` are **arrays of strings `["HH","MM"]`** (see `updateTimings`, §1.10).
- `location.coordinates` is GeoJSON `[lng, lat]`.
- Wallet amounts are floats.

### 1.4 Order list: `restaurantOrders`

- MULTI: `query Orders { restaurantOrders { ... } }`, **no arguments** (`S/lib/apollo/queries/orders.ts:3-109`).
- SINGLE: `query SingleVendorStoreOrders($offset: Int, $limit: Int) { restaurantOrders(offset: $offset, limit: $limit) {...} }` (`:111-216`), pages of 50 (`S/lib/context/global/restaurant.tsx:88-111`).

MULTI selection set (exact):

```
_id orderId id
restaurant { _id name image address location { coordinates } }
deliveryAddress { location { coordinates } deliveryAddress details label }
items { _id id title description image quantity specialInstructions
        variation { _id id title price discounted }
        addons { _id id options { _id id title description price } description title quantityMinimum quantityMaximum }
        isActive createdAt updatedAt }
user { _id name phone email }
paymentMethod paidAmount orderAmount orderStatus tipping taxationAmount status paymentStatus reason isActive
createdAt orderDate pickedAt deliveryCharges isPickedUp preparationTime
eta { phase source readyAt estimatedArrivalAt windowStartAt windowEndAt calculatedAt lastLocationAt }
acceptedAt isRinged instructions
rider { _id name username available }
discountAmount
```

SINGLE adds `eta { baseArrivalAt durationSeconds distanceMeters encodedPolyline version }` and drops `discountAmount`.

Client behaviour:

- `fetchPolicy: cache-and-network`, **no polling** (`restaurant.tsx:84-95`).
- It refetches on pull-to-refresh, on app foreground (`:235-255`) and after a subscription error with a 1.5 s retry (`:204-211`).
- Tab filters (`S/lib/hooks/useOrders.ts:14-36`):
  - **New** = `orderStatus === "PENDING"`.
  - **Processing** = `ACCEPTED | ASSIGNED | PICKED`.
  - **Delivered** = `DELIVERED`.
  - `CANCELLED` orders are not shown anywhere. The server may still return them, but returning them is not useful.
- The sum of the order's line items is computed client-side (`orderSubTotal`). It shows Tip (`tipping`), Tax (`taxationAmount`), `discountAmount` (if > 0), Delivery Charges (hidden when `isPickedUp`) and Total (`orderAmount`) (`S/lib/ui/useable-components/order/index.tsx:300-331`).
- **`isPickedUp` means "customer self-pickup / takeaway"**, not "rider has collected".

Server rules:

- Return only orders whose `restaurant` equals the caller's restaurant. Sort newest first. **UNVERIFIED**: the upstream sort order. The UI prepends new orders, so use `createdAt` descending.
- Multi has no pagination, so bound the result set, for example to active orders plus recent delivered. **UNVERIFIED**: the upstream window.
- `orderId` is the human-readable id (prefix plus number).
- `id` and `_id` both exist on Order/Item/Addon/Option. Return the same value for both.

### 1.5 Realtime: `subscribePlaceOrder` (restaurant channel)

```graphql
# S/lib/apollo/subscriptions.ts:3-108
subscription SubscribePlaceOrder($restaurant: String!) {
  subscribePlaceOrder(restaurant: $restaurant) {
    userId
    origin
    order { ...same fields as restaurantOrders MULTI, minus nothing; includes discountAmount, eta(8 fields), rider{_id name username available} }
  }
}
```

- The client subscribes once per stored restaurant id via `subscribeToMore` (`S/lib/context/global/restaurant.tsx:163-212`).
- `origin === "new"`: prepend unless the `_id` already exists (`:172-181`).
- `origin === "update"`: merge into the existing row, or prepend if missing ("self-heal") (`:182-201`).
- Any other origin is ignored.
- On error: unsubscribe, then after 1.5 s refetch and resubscribe.

Server rules:

- Authorize: the socket identity must own `restaurant`. Otherwise reject (the client comment calls this `ensureRestaurantAccess`).
- Fire `origin:"new"` when a customer order is placed and payment is confirmed. For card payments, only after the payment is captured or authorized. **UNVERIFIED** in upstream.
- Fire `origin:"update"` on **every** status change of that restaurant's orders, including rider assignment, picked, delivered, cancel by customer/admin/timeout, and ETA change.
- `userId` is the customer user id. **UNVERIFIED** semantics; the client never reads it.

### 1.6 Realtime: `subscriptionOrder(id)` (per order card)

```graphql
# S/lib/apollo/subscriptions.ts:115-138 (single) / :140-163 (multi), identical selection:
subscription SubscriptionOrder($id: String!) {
  subscriptionOrder(id: $id) {
    _id
    orderStatus
    isPickedUp
    rider {
      _id
    }
    completionTime
    preparationTime
    eta {
      phase
      source
      readyAt
      estimatedArrivalAt
      windowStartAt
      windowEndAt
      calculatedAt
      lastLocationAt
    }
  }
}
```

- Mounted for **every rendered order card** (`S/lib/ui/useable-components/order/index.tsx:74-80`).
- The result is written into the Apollo cache by `_id`. The client never reads it directly.
- The same operation is used by the customer app, the web app and the admin (`C/src/apollo/subscriptions.js:2`, `A/lib/api/graphql/subscription/order-subscription/index.ts:145`).
- Server rules:
  - Authorize per order. Allowed callers: the owning restaurant, the customer, the assigned rider, and admin.
  - Publish on every order mutation.
  - Expect N concurrent subscriptions per store socket, so design for that fan-out.

### 1.7 Ring and sound: `isRinged` and `muteRing`

```graphql
# S/lib/apollo/mutations/order.mutation.ts:28-32
mutation muteRing($orderId: String) {
  muteRing(orderId: $orderId)
} # returns Boolean
```

- The sound loops (`beep3.mp3`) while **any PENDING order has `isRinged === true`** (`S/lib/hooks/useOrders.ts:38-50`, `S/lib/context/global/sound.context.tsx:82-108`). It also plays in background/silent mode.
- Local "silence" (`silenceRing`) suppresses the sound until the set of ringing ids changes.
- `muteRing` is called **after a successful accept** with the **human-readable `orderId`**, not `_id`. The optimistic cache update matches `order.orderId === id` (`S/lib/ui/useable-components/set-order-accept-time/index.tsx:52-67`, `S/lib/hooks/useOrderRing.ts:8-25`).
- Server rules:
  - New orders start with `isRinged: true`.
  - `muteRing(orderId)` looks up the order by `orderId` **scoped to the caller's restaurant** and sets `isRinged=false`. It returns `true`.
  - Recommendation: accept `_id` too.
  - `acceptOrder` / `cancelOrder` should also clear `isRinged`. The client's optimistic accept sets `isRinged:false` (`S/lib/hooks/useAcceptOrder.ts:25-46`).

### 1.8 Accept: `acceptOrder` (preparation time)

```graphql
# S/lib/apollo/mutations/order.mutation.ts:3-14
mutation AcceptOrder($_id: String!, $time: String) {
  acceptOrder(_id: $_id, time: $time) {
    _id
    orderStatus
    preparationTime
    eta {
      phase
      source
      readyAt
      estimatedArrivalAt
      windowStartAt
      windowEndAt
      calculatedAt
      lastLocationAt
    }
  }
}
```

- UI: the "Set Preparation Time" sheet offers `TIMES = [10,20,30,40,50,60,70,80,90]` minutes (`S/lib/utils/constants/order.ts:1`). The default is 10.
- `time` is sent as a **string of minutes**, e.g. `"20"` (`set-order-accept-time/index.tsx:59,81`).
- An optional "Accept & Print" path prints first and accepts only if printing succeeds.
- The optimistic response is `orderStatus:"ACCEPTED"` with `preparationTime = now + time minutes` as an ISO string (`S/lib/hooks/useAcceptOrder.ts:9-24`).
- `preparationTime` is parsed by `parseTimestamp` and drives the "Time Left" countdown (`order/index.tsx:103-110`). **Return `preparationTime` as an ISO-8601 timestamp** (absolute ready-at time).
- The Accept button only renders when `orderStatus === "PENDING"`. A countdown (scheduled orders) is shown instead when the order is scheduled more than 5 min in the future: `getIsAcceptButtonVisible(orderDate) = now + 5min >= orderDate` (`S/lib/utils/methods/gloabl.ts:36-39`, `order/index.tsx:86-121`).
- Server rules:
  - Caller must own the order's restaurant.
  - Allowed only from `PENDING`.
  - Reject `time` that is not a positive integer within a bound (for example 1..180). **UNVERIFIED**: the upstream bound.
  - Set `orderStatus=ACCEPTED`, `acceptedAt=now`, `preparationTime=now+time`, `isRinged=false`, and compute the ETA.
  - Then publish:
    - `subscribePlaceOrder(update)` (store)
    - `subscriptionOrder` (everyone)
    - customer `orderStatusChanged(userId)` (`C/src/apollo/subscriptions.js:41`)
    - `subscriptionZoneOrders(zoneId, origin:"new")` to **available riders in the order's zone**, for delivery orders only (`isPickedUp=false`)
    - `subscriptionDispatcher` (admin)
  - Push to zone riders. **UNVERIFIED**: the payload; the rider reads `data._id`.

### 1.9 Decline / cancel: `cancelOrder` (reason)

```graphql
# S/lib/apollo/mutations/order.mutation.ts:16-26
mutation CancelOrder($_id: String!, $reason: String!) {
  cancelOrder(_id: $_id, reason: $reason) {
    _id
    orderStatus
    eta {
      phase
      source
      readyAt
      estimatedArrivalAt
      windowStartAt
      windowEndAt
      calculatedAt
      lastLocationAt
    }
  }
}
```

- Only reachable from the PENDING card's "Decline" button.
- The reason is **hard-coded `"not available"`** (`S/lib/ui/useable-components/order/index.tsx:123-126`).
- Server rules:
  - Caller must own the restaurant. Allow from `PENDING` only, from the store side.
  - Set `CANCELLED`, `reason`, `cancelledAt`, `isRinged=false`.
  - Trigger refund or void of any captured payment through the ledger/provider. A restaurant decline must not take commission.
  - Publish store update, `subscriptionOrder`, customer `orderStatusChanged`, and dispatcher.
  - Also accept the `reason` from admin and customer paths.
- **Auto-decline**: the card shows "Auto decline in" with a countdown of `MAX_TIME = 120` s from `createdAt` (`S/lib/utils/constants/general.ts:1`, `order/index.tsx:96-101,384-398`). The client **never** auto-cancels.
  - **UNVERIFIED**: whether the server must auto-cancel PENDING orders after 120 s. The UI implies it.
  - The server should own this timeout (a job that cancels with a reason such as "restaurant did not respond", then publishes updates). Make the window configurable.
  - Scheduled orders (`orderDate` in the future) need the window measured from the scheduled acceptance time. **UNVERIFIED**.

### 1.10 Hand-over for takeaway: `orderPickedUp`

```graphql
# S/lib/apollo/mutations/order.mutation.ts:34-44
mutation OrderPickedUp($_id: String!) {
  orderPickedUp(_id: $_id) {
    _id
    orderStatus
    eta {
      phase
      source
      readyAt
      estimatedArrivalAt
      windowStartAt
      windowEndAt
      calculatedAt
      lastLocationAt
    }
  }
}
```

- The button "Deliver Order to Customer" appears only when `orderStatus === "ACCEPTED" && order.isPickedUp === true`, i.e. a takeaway order (`order/index.tsx:453-480`).
- The store has **no** action for delivery orders after accept. Riders drive the rest.
- For `ACCEPTED`, a delivery order with no rider shows "Waiting for Rider" (`:256-298`).
- Server rules:
  - Owner restaurant only.
  - Allowed only for `isPickedUp=true` and `orderStatus=ACCEPTED`. Reject for delivery orders.
  - Set `orderStatus=DELIVERED`, `deliveredAt=now`, `completionTime`. **UNVERIFIED**: upstream may set `PICKED` and then `DELIVERED`. The store "Delivered" tab only lists `DELIVERED`, so the result must be `DELIVERED` for the order to leave Processing.
  - Post the earnings journal (§D).
  - Publish all order channels.

### 1.11 Availability: `toggleStoreAvailability`

```graphql
# S/lib/apollo/mutations/store.mutation.ts:3-10
mutation ToggleStore($restaurantId: String!) {
  toggleStoreAvailability(restaurantId: $restaurantId) {
    _id
    isAvailable
  }
}
```

- Drawer switch (`S/lib/ui/screen-components/home/drawer/drawer-header/index.tsx:21-47`). It refetches `STORE_PROFILE` afterwards and shows `graphQLErrors[0].message` on error.
- Server: `restaurantId` must equal the caller's restaurant. Flip `isAvailable`. Unavailable restaurants must be excluded from customer ordering.

### 1.12 Opening hours: `updateTimings`

```graphql
# S/lib/apollo/mutations/work-schedule.ts:3-12
mutation UpdateTimings(
  $updateTimingsId: String!
  $openingTimes: [TimingsInput]
) {
  updateTimings(id: $updateTimingsId, openingTimes: $openingTimes) {
    _id
  }
}
```

- Variables are built at `S/lib/ui/screen-components/work-schedule/view/main/index.tsx:158-193`.
  - `updateTimingsId` = `restaurant._id`.
  - `openingTimes` = an entry for all 7 days: `{ day: "MON"|"TUE"|..., times: [ { startTime: ["09","00"], endTime: ["17","00"] } ] }`. A closed day is sent as `times: []`.
- So `TimingsInput = { day: String, times: [TimeInput] }` and `TimeInput = { startTime: [String], endTime: [String] }`.
- The client checks overlaps and rejects a schedule where all days are empty (`:89-115`).
- It refetches `STORE_PROFILE` with `awaitRefetchQueries`.
- Server:
  - Owner only.
  - Validate HH 00-23 and MM 00-59, `start < end`, no overlaps.
  - Store per day.
  - **UNVERIFIED**: timezone. The restaurant has no timezone field in these documents.

### 1.13 Bank details: `updateRestaurantBussinessDetails` (spelling must match exactly)

```graphql
# S/lib/apollo/mutations/store.mutation.ts:11-27
mutation UpdateRestaurantBussinessDetails(
  $updateRestaurantBussinessDetailsId: String!
  $bussinessDetails: BussinessDetailsInput
) {
  updateRestaurantBussinessDetails(
    id: $updateRestaurantBussinessDetailsId
    bussinessDetails: $bussinessDetails
  ) {
    success
    message
    data {
      _id
    }
  }
}
```

- Variables (`S/lib/ui/screen-components/home/bank-management/view/main/index.tsx:112-125`): `{ bankName, accountName, accountNumber: Number(formData.accountNumber), accountCode }`.
- `accountNumber` is sent as a **JSON number**, so `BussinessDetailsInput.accountNumber` must accept a number (Float/Int).
  - Leading zeros are lost on the client. This is a known upstream data-loss issue. **UNVERIFIED**: the upstream type. Do not "fix" it in the UI.
- Server:
  - Owner only.
  - Store encrypted, and return masked values on read if policy requires. `restaurant.bussinessDetails.accountNumber` is rendered back.
  - Must return the `{success,message,data{_id}}` envelope.
  - Validate all four fields as required.

### 1.14 Earnings and wallet

| Op                                      | Document                                                                                                                                                                                                                                                                                                                                                                      | Variables sent                                                                                                                                                                                                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storeEarningsGraph`                    | `query StoreEarningsGraph($storeId: ID!, $page: Int, $limit: Int, $startDate: String, $endDate: String) { storeEarningsGraph(storeId,page,limit,startDate,endDate) { totalCount earnings { _id totalEarningsSum earningsArray { totalOrderAmount totalEarnings orderDetails { orderId orderType paymentMethod } date } } } }` (`S/lib/apollo/queries/earnings.query.ts:3-35`) | Earnings tab: `{ storeId, startDate: ISO, endDate: ISO, page: 1, limit: rangeDays }` (`S/lib/ui/screen-components/earnings/view/main/index.tsx:113-126`). Details screen: `{ storeId }`, then refetch `{ storeId, startDate, endDate }` (`earning-details/view/index.tsx:56-71,115-121`). Header: `{ storeId }` (`earning-details/header/index.tsx:23-28`). | `earnings[]` is grouped **per day**: `_id` is a date string formatted for the chart label. `totalEarningsSum` may be negative (the client takes `-x` for bar height). "Total Deliveries" = `earningsArray.length`. `limit` = number of days (7/…).                               |
| `earnings` (STORE_EARNINGS)             | `query StoreEarnings { earnings { data { grandTotalEarnings { storeTotal } earnings { storeEarnings { totalEarnings } } } } }` (`S/lib/apollo/queries/store.query.ts:25-40`)                                                                                                                                                                                                  | No args are declared. The extra variables the client passes are dropped (`wallet/view/main/index.tsx:201-204`).                                                                                                                                                                                                                                             | The server must infer `userType=STORE`, `userId` = the caller's restaurant. The result is fetched but not displayed. It must not error.                                                                                                                                          |
| `earnings` (STORE_GRAND_TOTAL_EARNINGS) | `(userType: UserTypeEnum, userId: String, orderType: OrderTypeEnum, paymentMethod: PaymentMethodEnum, pagination: PaginationInput, dateFilter: DateFilter) { message data { grandTotalEarnings { storeTotal } } }` (`earnings.query.ts:37-62`)                                                                                                                                | **Unused** in the store UI.                                                                                                                                                                                                                                                                                                                                 | The admin uses this signature, so the schema must accept these args.                                                                                                                                                                                                             |
| `transactionHistory`                    | `query TransactionHistory { transactionHistory { data { status amountTransferred createdAt } } }` (`store.query.ts:42-52`)                                                                                                                                                                                                                                                    | none                                                                                                                                                                                                                                                                                                                                                        | The server infers the caller (restaurant). `status` values rendered: `TRANSFERRED`, `PAID`, `CANCELLED`, `REQUESTED` (`S/lib/ui/screen-components/wallet/view/recent-transactions/index.tsx:36-72`). `amountTransferred` is a float.                                             |
| `storeCurrentWithdrawRequest`           | `query StoreCurrentWithdrawRequest($storeId: String) { storeCurrentWithdrawRequest(storeId: $storeId) { _id requestAmount status createdAt } }` (`store.query.ts:54-63`)                                                                                                                                                                                                      | `{ storeId }`                                                                                                                                                                                                                                                                                                                                               | Returns the open (REQUESTED) request, or null. The banner renders `requestAmount` and `status`.                                                                                                                                                                                  |
| `createWithdrawRequest`                 | `mutation Mutation($requestAmount: Float!, $userId: String!) { createWithdrawRequest(requestAmount: $requestAmount, userId: $userId) { status } }` (`S/lib/apollo/mutations/withdraw-request.mutation.ts:3-9`)                                                                                                                                                                | `{ requestAmount, userId: restaurantId }` (`wallet/view/main/index.tsx:165-185`)                                                                                                                                                                                                                                                                            | The client validates `amount <= currentWalletAmount` and `>= 10`. The error `message` is shown in an Alert. It refetches `STORE_BY_ID`, `STORE_CURRENT_WITHDRAW_REQUEST`, `STORE_PROFILE` (with the wrong var `userId`, which fails validation harmlessly) and `STORE_EARNINGS`. |

Server rules for money:

- `storeId` / `userId` must equal the caller's restaurant, otherwise FORBIDDEN.
- Enforce the minimum, the available balance (`currentWalletAmount`), and a single open request. Reject a second request with a clear message.
- Create the request with status `REQUESTED`.
- Funds should be reserved by a balanced journal entry (§D).
- `requestAmount` arrives as a float in major units. Convert it to integer minor units with explicit rounding rules, and reject more than 2 decimals.

### 1.15 Uploads (store)

- The store app performs **no uploads**. Only an unused `ICloudinaryResponse` interface exists (`S/lib/utils/interfaces/cloudinary.interface.ts:3`).
- The logo and image are read-only in this app.

### 1.16 Store status authority (summary)

- The store can only move:
  - `PENDING → ACCEPTED` (acceptOrder)
  - `PENDING → CANCELLED` (cancelOrder)
  - `ACCEPTED(takeaway) → DELIVERED` (orderPickedUp)
- Everything else comes from riders, admin or the server.

---

## 2. RIDER app

### 2.1 Login: `riderLogin`

```graphql
# R/lib/api/graphql/mutation/login/index.ts:3-20
mutation RiderLogin(
  $username: String
  $password: String
  $notificationToken: String
  $timeZone: String!
) {
  riderLogin(
    username: $username
    password: $password
    notificationToken: $notificationToken
    timeZone: $timeZone
  ) {
    userId
    token
  }
}
```

- Flow (`R/lib/hooks/useLogin.ts:79-99`):
  - `username.toLowerCase()`, password.
  - Expo push token or null (`R/lib/utils/methods/permission.ts`).
  - `timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone` (IANA).
- On success (`:50-65`): store `userId` (the rider `_id`), then the token, then route home.
- Errors: **any** GraphQL error shows "Invalid username or password" (anti-enumeration). A network error shows "Unable to connect".
- Server:
  - Match the username case-insensitively.
  - Rider must be `isActive`.
  - Persist `notificationToken` and `timeZone`.
  - Return a JWT (numeric `exp`) with a rider role claim.
  - Rate-limit.

### 2.2 `login`, signup, emailExist, phoneExist, OTP, forgot, reset, changePassword, Deactivate

- These are all **defined but unused** in the rider app. A grep for each constant name finds no importers outside the definition file.
- Definitions are in `R/lib/apollo/mutations/authentication.mutation.ts:1-61`:
  - `emailExist(email)`, `phoneExist(phone)`
  - `sendOtpToEmail(email, otp){result}`, `sendOtpToPhoneNumber(phone, otp){result}`
  - `Deactivate(isActive, email){isActive}`
  - `login(email,password,type,appleId,idToken,name,notificationToken){userId token tokenExpiration isActive name email phone isNewUser}`
  - `forgotPassword(email, otp){result}`, `changePassword(oldPassword,newPassword)`, `resetPassword(password,email){result}`
- There is **no rider signup**. Riders are created by admin.
- These are customer-app operations copied into the rider tree. Implement them for the customer app (see the customer reference), not as rider requirements.
- Note the insecure upstream pattern: the client sends `otp` itself. Do **not** replicate client-generated OTPs. **UNVERIFIED**: how the customer app uses them; see the customer reference doc.

### 2.3 Rider profile: `rider(id)`

```graphql
# R/lib/apollo/queries/rider.query.ts:43-98  (operation name "rider" matters, see §0.4)
query rider($id: String!) {
  rider(id: $id) {
    accountNumber
    assigned
    available
    _id
    zone {
      _id
    }
    bussinessDetails {
      bankName
      accountName
      accountCode
      accountNumber
    }
    createdAt
    currentWalletAmount
    email
    image
    isActive
    vehicleType
    location {
      coordinates
    }
    name
    phone
    totalWalletAmount
    updatedAt
    username
    withdrawnWalletAmount
    licenseDetails {
      expiryDate
      image
      number
    }
    vehicleDetails {
      image
      number
    }
    timeZone
    workSchedule {
      day
      enabled
      slots {
        startTime
        endTime
      }
    }
  }
}
```

- Used by the user context with `{ id: storedRiderId }` (`R/lib/context/global/user.context.tsx:78-90`), `cache-and-network` then `cache-first`.
- Wallet variant `RIDER_BY_ID`: `query Rider($id: String!) { rider(id: $id) { _id location { coordinates } zone { _id } currentWalletAmount totalWalletAmount withdrawnWalletAmount } }` (`rider.query.ts:3-18`).
- `rider` minimal doc (`:100-109`) is unused.
- Server:
  - A rider caller may read only `id == self`. Otherwise return code `FORBIDDEN`, which forces a client logout.
  - Admin may read any rider.
  - `zone._id` is **required** for dispatch. With no zone, the rider gets no zone subscription.
  - `assigned` is a Boolean or count. **UNVERIFIED**; it is not rendered in the flows read.
  - `licenseDetails.expiryDate` is an ISO/date string (the client does `new Date(...)`).
  - `workSchedule.slots.startTime` is a string `"HH:MM"`. Note this differs from the restaurant format.

### 2.4 Availability: `toggleAvailablity` (spelling must match exactly)

```graphql
# R/lib/apollo/mutations/rider.mutation.ts:60-66
mutation ToggleRider($id: String!) {
  toggleAvailablity(id: $id) {
    _id
  }
}
```

- Drawer switch, called with `{ id: rider._id }`. It refetches `RIDER_PROFILE` (`R/lib/ui/screen-components/home/drawer/drawer-header/index.tsx:29-31,128-130`).
- Effects in the client:
  - The zone subscription is only opened when `rider.available` is true (`user.context.tsx:196-213`).
  - When unavailable, unassigned "new" orders are filtered out of the list (`:248-258`).
- Server:
  - `id == self`, or admin.
  - Flip `available`.
  - When unavailable, exclude the rider from zone broadcasts and pushes. **UNVERIFIED**: whether the toggle is blocked while the rider holds active orders.

### 2.5 Location: `updateRiderLocation` (frequency and args)

```graphql
# R/lib/apollo/mutations/rider.mutation.ts:18-36 (single) and :38-58 (multi), identical
mutation UpdateRiderLocation(
  $latitude: String!
  $longitude: String!
  $accuracy: Float
  $heading: Float
  $speed: Float
  $deviceTimestamp: String
) {
  updateRiderLocation(
    latitude: $latitude
    longitude: $longitude
    accuracy: $accuracy
    heading: $heading
    speed: $speed
    deviceTimestamp: $deviceTimestamp
  ) {
    _id
  }
}
```

- **Only sent while actively delivering.** That means the rider owns at least one order with `orderStatus ∈ {ASSIGNED, PICKED}` (or `orderState ∈ {PICKED_UP, ON_ROUTE}`) and `order.rider._id === me` (`R/lib/context/global/location.context.tsx:92-104,294-339`). No idle tracking.
- Foreground: `watchPositionAsync({accuracy: High, distanceInterval: 25, timeInterval: 10000})` (`:46-50`).
  - Fixes with `accuracy > 50` m are dropped.
  - The client throttles to at most 1 per 8 s **and** at least 20 m of movement (`:180-235`).
- Background (if permission granted): `TaskManager` `RIDER_LOCATION` with the same filters. It uses a raw `fetch` POST of `mutation BackgroundRiderLocation(...) { updateRiderLocation(...) { _id } }` with the bearer token + `bop-auth` + `nonce` (`R/lib/services/background-location.ts:37-115,132-150`).
- Lat/lng arrive as **strings**. `deviceTimestamp` is ISO. `accuracy`, `heading` and `speed` can be null.
- Server:
  - Caller must be a rider and must be the subject. There is no rider id argument.
  - Validate the ranges, reject stale or out-of-order `deviceTimestamp`, and rate-limit at about 1 per 5 s.
  - Persist as GeoJSON `[lng,lat]`.
  - Recompute the ETA of the rider's active orders.
  - Publish `subscriptionRiderLocation(riderId)` (`C/src/apollo/subscriptions.js:34`: `{ _id location { coordinates } }`) to the customer/admin of the active orders only.
  - Publish `subscriptionOrder` ETA updates.

### 2.6 Order list: `riderOrders`

- MULTI: `query RiderOrders { riderOrders { ... } }`, **no args declared**. The client passes `{ userId }`, which is dropped (`R/lib/apollo/queries/rider.query.ts:111-205`, `user.context.tsx:100-109`).
- `pollInterval: 30000` in MULTI, none in SINGLE.
- SINGLE: `riderOrders(limit: $limit, offset: $offset)`, pages of 50, and adds `orderState`.

Selection set (MULTI):

```
_id orderId createdAt acceptedAt pickedAt assignedAt isPickedUp deliveredAt expectedTime deliveryCharges
restaurant { _id name image address location { coordinates } }
deliveryAddress { location { coordinates } deliveryAddress label details }
items { _id title food description image quantity
        variation { _id title price }
        addons { _id options { _id title price } title description quantityMinimum quantityMaximum }
        isActive createdAt }
user { _id name phone }
paymentMethod paidAmount orderAmount paymentStatus orderStatus tipping taxationAmount reason isRiderRinged preparationTime
eta { phase source readyAt baseArrivalAt estimatedArrivalAt windowStartAt windowEndAt durationSeconds distanceMeters encodedPolyline calculatedAt lastLocationAt version }
rider { _id name username }
```

The **single list feeds all three tabs**:

- **New** = `orderStatus === "ACCEPTED" && !rider && !isPickedUp` (`R/lib/utils/order-state.ts:4-16`, `R/lib/ui/screen-components/home/orders/main/new-orders.tsx:54`).
- **Processing** = `orderStatus ∈ {PICKED, ASSIGNED} && !isPickedUp`, with **no rider-id filter** (`order-state.ts:18-35`).
- **Delivered** = `orderStatus ∈ {DELIVERED, CANCELLED} && rider._id === me` (`delivered-orders.tsx:43-46`).

Therefore the server MUST:

1. Return the caller's own assigned orders (ASSIGNED, PICKED, DELIVERED, CANCELLED-after-assignment), bounded by recency.
2. **Also return unassigned `ACCEPTED`, non-takeaway orders in the rider's zone** (when the rider is available). After a refetch or poll, this is the only way the New tab is populated, because the zone subscription adds rows only incrementally.
3. **Never return other riders' ASSIGNED/PICKED orders.** They would appear in this rider's Processing tab, and the chat and location logic would treat them as live.

Other client facts:

- The sound loops while any `ACCEPTED && !rider && !isPickedUp` order is in the list (`R/lib/context/global/sound.context.tsx:70-93`). `isRiderRinged` is fetched but not used for sound.
- Per-card timer: if `acceptedAt` is set, the card counts down `MAX_TIME=120` s from `acceptedAt`, then calls `refetchAssigned()` (`R/lib/hooks/useOrder.ts:23-60`, `R/lib/utils/methods/get-remaining-accepting-time.ts`). This implies a **2-minute self-assignment window after store acceptance** (see §C, **UNVERIFIED**).
- Payment collection: the "Mark as Delivered" confirm adds "Confirm you have collected <amount>" when `paymentStatus !== "PAID"`, i.e. COD (`R/lib/ui/screen-components/home/orders/main/order-details/index.tsx:859-900`). `paymentStatus` must be `PAID` for prepaid orders.

### 2.7 Realtime: `subscriptionZoneOrders(zoneId)` (broadcast of unassigned orders)

```graphql
# R/lib/apollo/subscriptions.ts:34-115
subscription SubscriptionZoneOrders($zoneId: String!) {
  subscriptionZoneOrders(zoneId: $zoneId) {
    zoneId
    origin
    order {
      _id
      createdAt
      acceptedAt
      expectedTime
      pickedAt
      assignedAt
      isPickedUp
      deliveredAt
      deliveryCharges
      orderId
      restaurant {
        _id
        name
        address
        location {
          coordinates
        }
      }
      deliveryAddress {
        location {
          coordinates
        }
        deliveryAddress
        label
        details
      }
      items {
        _id
        title
        food
        description
        quantity
        variation {
          _id
          title
          price
        }
        addons {
          _id
          options {
            _id
            title
            price
          }
          title
          description
          quantityMinimum
          quantityMaximum
        }
        isActive
        createdAt
      }
      user {
        _id
        name
        phone
      }
      paymentMethod
      paidAmount
      orderAmount
      paymentStatus
      orderStatus
      tipping
      taxationAmount
      reason
      isRiderRinged
      preparationTime
      rider {
        _id
        name
        username
      }
    }
  }
}
```

- The subscription only opens when the profile has `zone._id` **and** `available === true` (`user.context.tsx:156-213`).
- `origin` `"new"` or `"update"` upserts the row. Every other origin (including `"remove"`) is **ignored**.
- Server:
  - Authorize that `zoneId` equals the caller rider's zone.
  - Emit `"new"` when an order in that zone becomes ACCEPTED with no rider and is not takeaway.
  - **Do not** emit `"update"` with `rider` set to another rider. The client would upsert it into this rider's Processing tab (§2.6 rule 3).
  - When the order is taken or cancelled, emit `"remove"`. The client ignores it today, but it is the safe signal. The stale "New" row is cleared by the 30 s poll, and `assignOrder` must fail cleanly for it.
- The customer phone `user.phone` is exposed to every zone rider before acceptance. Consider returning `null` for unassigned riders as a privacy minimisation. The client tolerates a missing phone; the chat button only shows for ASSIGNED/PICKED. **UNVERIFIED** that nothing else breaks.

### 2.8 Self-assign: `assignOrder`

```graphql
# R/lib/apollo/mutations/order.mutation.ts:3-15
mutation AssignOrder($id: String!) {
  assignOrder(id: $id) {
    _id
    orderStatus
    rider {
      _id
      name
      username
    }
  }
}
```

- Two callers:
  - the card's "Assign me" (`R/lib/ui/useable-components/order/index.tsx:311-316`, via `R/lib/hooks/useOrder.ts:67-74`)
  - the detail sheet's "Assign me" (`order-details/index.tsx:905-925`), which refetches `riderOrders`
- On success: flash "Order has been assigned to you." and navigate to Processing.
- On error: `graphQLErrors.map(m=>m.message).join(", ")` is shown.
- Server:
  - Caller must be an **available, active** rider in the **order's zone**.
  - The order must be `ACCEPTED`, `rider == null` and `isPickedUp == false`.
  - Assign **atomically** (compare-and-set) so that the first rider wins. Others get a clear "Order already assigned" error.
  - Set `rider`, `orderStatus=ASSIGNED`, `assignedAt=now`.
  - Publish:
    - `subscriptionAssignRider(riderId=me, origin:"new")`
    - zone `"remove"`
    - store `subscribePlaceOrder(update)`
    - `subscriptionOrder`
    - customer `orderStatusChanged`
    - `subscriptionDispatcher`

### 2.9 Realtime: `subscriptionAssignRider(riderId)` (orders for this rider)

```graphql
# R/lib/apollo/subscriptions.ts:201-281
subscription SubscriptionAssignRider($riderId: String!) {
  subscriptionAssignRider(riderId: $riderId) {
    order {
      _id
      orderId
      createdAt
      acceptedAt
      pickedAt
      isPickedUp
      deliveredAt
      expectedTime
      deliveryCharges
      restaurant {
        _id
        name
        address
        location {
          coordinates
        }
      }
      deliveryAddress {
        location {
          coordinates
        }
        deliveryAddress
        label
        details
      }
      items {
        _id
        title
        image
        food
        description
        quantity
        variation {
          _id
          title
          price
        }
        addons {
          _id
          options {
            _id
            title
            price
          }
          title
          description
          quantityMinimum
          quantityMaximum
        }
        isActive
        createdAt
      }
      user {
        _id
        name
        phone
      }
      paymentMethod
      paidAmount
      orderAmount
      paymentStatus
      orderStatus
      tipping
      taxationAmount
      reason
      isRiderRinged
      preparationTime
      rider {
        _id
        name
        username
      }
    }
    origin
  }
}
```

- Always open (regardless of availability) while a rider id and zone are known (`user.context.tsx:174-194`).
- `"new"` / `"update"` upsert the row. `"remove"` filters it out.
- Server:
  - `riderId` must equal the caller.
  - Emit `"new"` on self-assign **or admin `assignRider`** (`A/lib/api/graphql/mutations/dispatch/index.ts:11-21`).
  - Emit `"update"` on every later status or ETA change of that rider's orders, including store/admin cancel.
  - Emit `"remove"` when admin reassigns the order to another rider, or unassigns it.
  - Also send a push to the rider on admin assignment. The payload `data._id` is the order `_id`; tapping refetches `riderOrders` and opens the order detail (`R/lib/context/global/chat-notification.context.tsx:270-317`).

### 2.10 Status: `updateOrderStatusRider` (allowed statuses)

```graphql
# R/lib/apollo/mutations/order.mutation.ts:17-24
mutation UpdateOrderStatusRider($id: String!, $status: String!) {
  updateOrderStatusRider(id: $id, status: $status) {
    _id
    orderStatus
  }
}
```

- The client only sends:
  - `status:"PICKED"`, from Processing when `orderStatus === "ASSIGNED"` (`order-details/index.tsx:835-857`, `order-state.ts:37-49`)
  - `status:"DELIVERED"`, from Processing when `orderStatus === "PICKED"`, after a confirm Alert (`:859-900`, `order-state.ts:51-63`)
- The client updates the cached `orderStatus` (`R/lib/hooks/useDetail.tsx:171-209`).
- After `DELIVERED` it refetches `RIDER_PROFILE` and `RIDER_EARNINGS_GRAPH`. The latter uses the wrong variable name `rideId`, so that refetch fails validation harmlessly (`useDetail.tsx:106-125`).
- The success flash reads "Order marked as <orderStatus>".
- Server:
  - Caller must be `order.rider`.
  - Allowed transitions are only `ASSIGNED→PICKED` (set `pickedAt`) and `PICKED→DELIVERED` (set `deliveredAt`, `completionTime`; for COD set `paymentStatus=PAID` / record cash collected). Reject anything else, with messages.
  - **UNVERIFIED**: upstream lets the rider mark PICKED before the store's `preparationTime`. Recommend allowing it but recording it.
  - On DELIVERED: post the earnings journal for restaurant, rider (delivery fee + tip) and platform, update the wallets, and close any chat.
  - Publish rider `subscriptionAssignRider(update)`, store `subscribePlaceOrder(update)`, `subscriptionOrder`, customer `orderStatusChanged`, and dispatcher.
  - Stop accepting location for that order once it is DELIVERED.

### 2.11 `order(id)`, `orders`, `reviewOrder`, `placeOrder`, `abortOrder`, `nearByRestaurants`

- **All defined, all unused** in the rider app:
  - `order` / `myOrders` (`R/lib/apollo/queries/order/order-1.query.ts:1-144`)
  - `orderFragment` / `recentOrderRestaurants*` (`order-2.query.ts`)
  - `reviewOrder(reviewInput:{order,rating,description})` (`order.mutation.ts:34-115`)
  - `placeOrder(...)` (`:117-192`)
  - `abortOrder(id){_id orderStatus}` (`:26-32`)
  - `nearByRestaurants` / `nearByRestaurantsPreview` (`R/lib/apollo/queries/resturant/resturant-2.query.ts:30-175`)
  - `SUBSCRIPTION_ORDERS` (`subscriptionOrder`, `subscriptions.ts:366-378`). It is imported but its use was removed (`R/lib/hooks/useOrder.ts:62-65`, `useDetail.tsx:85-88`).
- These are customer-app copies, so the rider has **no** abort/cancel action.
- Implement them for the customer app only. Riders must get FORBIDDEN on `placeOrder` / `reviewOrder` / `abortOrder`.

### 2.12 Chat: `chat`, `sendChatMessage`, `subscriptionNewMessage`

```graphql
# R/lib/apollo/queries/chat.query.ts:3-18 (multi; single omits image)
query Chat($order: ID!) {
  chat(order: $order) {
    id
    message
    image
    user {
      id
      name
    }
    createdAt
  }
}
# R/lib/apollo/mutations/chat.mutation.ts:3-22 (multi; single omits image)
mutation SendChatMessage($orderId: ID!, $messageInput: ChatMessageInput!) {
  sendChatMessage(message: $messageInput, orderId: $orderId) {
    success
    message
    data {
      id
      message
      image
      user {
        id
        name
      }
      createdAt
    }
  }
}
# R/lib/apollo/subscriptions.ts:3-18 (multi; single omits image)
subscription SubscriptionNewMessage($order: ID!) {
  subscriptionNewMessage(order: $order) {
    id
    message
    image
    user {
      id
      name
    }
    createdAt
  }
}
```

- The chat screen opens from ASSIGNED/PICKED orders (`R/lib/ui/useable-components/order/index.tsx:307-309`) with route params `{ id: order._id, orderId, phoneNumber }`.
- `chat(order: order._id)` is fetched `network-only` (`R/lib/hooks/useChat.tsx:69-77`).
- `messageInput = { message: string, image?: url, user: { id: rider._id, name: rider.name } }` (`:118-131,150-163`).
  - So `ChatMessageInput { message: String, image: String, user: ChatUserInput { id, name } }`.
  - **The server must ignore client-supplied `user`** and stamp the authenticated identity.
- If `sendChatMessage.success === false`, the client shows `message` in an Alert (`:86-93`).
- Image messages (multi only, `supportsImageMessages: !isSingleVendor` at `:234`): pick → `uploadImageToS3(image: "data:image/jpeg;base64,...")` → `imageUrl` → `sendChatMessage` with `message:""` and `image:url` (`:166-199`).
- Unread tracking: the client opens `subscriptionNewMessage` for **every processing order** and ignores messages where `user.id === me` (`R/lib/context/global/chat-notification.context.tsx:188-251`).
- Chat push payload: `data.type === "chat"`, `data._id` or `data.orderId` (order `_id`), `data.messageId` or `data.chatId`, `data.order` (human orderId). The body is used as the preview (`:52-53,163-185,284-296`).
- Server:
  - Only the assigned rider and the order's customer may read, send or subscribe. **UNVERIFIED** whether the restaurant joins the chat.
  - Reject chat after DELIVERED/CANCELLED. **UNVERIFIED**: upstream allows read-only.
  - Validate the length.
  - `image` must be a URL produced by our upload service (allow-listed host).
  - Publish to `subscriptionNewMessage(order)` and push to the counterparty.

### 2.13 Uploads: `uploadImageToS3`

```graphql
# R/lib/apollo/mutations/rider.mutation.ts:133-139
mutation UploadImageToS3($image: String!) {
  uploadImageToS3(image: $image) {
    imageUrl
  }
}
```

- Input is a **data URL** `data:image/jpeg;base64,<...>`, used for license images, vehicle images and chat images (`R/lib/ui/screen-components/profile/forms/liecense/index.tsx:129-150`, `.../vehicle/index.tsx`, `useChat.tsx:187`).
- Server:
  - Authenticated rider only.
  - Enforce a size cap and sniff the MIME type (jpeg/png only).
  - Strip EXIF/GPS.
  - Store in our bucket under a rider-scoped key and return a URL (signed or CDN).
  - The name says S3, but any storage works. The contract is only `{ imageUrl }`.
  - A missing storage provider is an infra blocker. It is not a reason to fake URLs.

### 2.14 Profile edits

| Op                            | Document                                                                                                                                                                                                                                                 | Variables                                                                                                                                                                                                                                                | Server rules                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editRider`                   | `mutation EditRider($riderInput: RiderInput!) { editRider(riderInput: $riderInput) { _id name username phone vehicleType zone { _id } } }` (`rider.mutation.ts:3-16`)                                                                                    | `riderInput = { _id, name, username, phone: String, zone: zone._id, vehicleType: "bicycle"\|"motorbike"\|"car"\|"pickup_truck"…, available }` (`R/lib/ui/screen-components/vehicle-type/main/index.tsx:98-108`, `R/lib/utils/constants/vehicle-type.ts`) | Used only to change `vehicleType`. Shares `RiderInput` with admin (admin also sends `password`). A **rider caller may change only `vehicleType`** (`_id` must equal self). Ignore or reject changes to `zone`, `available`, `username`, `name`, `phone` from a rider session, otherwise a rider could hop zones. |
| `updateRiderLicenseDetails`   | `(id: String!, licenseDetails: LicenseDetailsInput) { _id }` (`:68-80`)                                                                                                                                                                                  | `{ updateRiderLicenseDetailsId: riderId, licenseDetails: { number, expiryDate: Date→ISO string, image: url } }` (`liecense/index.tsx:228-233`)                                                                                                           | Self only. Expiry in the future. `image` must be our upload URL. **UNVERIFIED**: admin re-verification after change.                                                                                                                                                                                             |
| `updateRiderVehicleDetails`   | `(id: String!, vehicleDetails: VehicleDetailsInput) { _id }` (`:81-93`)                                                                                                                                                                                  | `{ updateRiderVehicleDetailsId, vehicleDetails: { number, image } }` (`vehicle/index.tsx:160-165`)                                                                                                                                                       | Self only.                                                                                                                                                                                                                                                                                                       |
| `updateRiderBussinessDetails` | `(bussinessDetails: BussinessDetailsInput, id: String!) { _id }` (`:94-106`); note the return differs from the restaurant variant                                                                                                                        | `{ updateRiderBussinessDetailsId, bussinessDetails: { bankName, accountName, accountNumber: Number(...), accountCode } }` (`R/lib/ui/screen-components/home/bank-management/view/main/index.tsx:112-122`)                                                | Self only. `accountNumber` is numeric (see §1.13). Shares `BussinessDetailsInput`.                                                                                                                                                                                                                               |
| `updateWorkSchedule`          | `mutation UpdateWorkSchedule($riderId: String!, $workSchedule: [DayScheduleInput!]!, $timeZone: String!) { updateWorkSchedule(riderId, workSchedule, timeZone) { _id timeZone workSchedule { day enabled slots { startTime endTime } } } }` (`:108-131`) | `{ riderId, timeZone: IANA, workSchedule: [{ day: "MON".."SUN", enabled: Boolean, slots: [{ startTime: "HH:MM", endTime: "HH:MM" }] }] }`, with `__typename` stripped (`R/lib/ui/screen-components/work-schedule/main/index.tsx:27,63-104,276-290`)      | Self only. Validate the format, `start < end`, no overlaps, and a valid IANA zone. **UNVERIFIED**: whether dispatch must respect the schedule (upstream likely informational).                                                                                                                                   |

### 2.15 Earnings and wallet

| Op                            | Document                                                                                                                                                                                                                                                                                                                                                                                 | Variables                                                                                                                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `riderEarningsGraph`          | `query RiderEarningsGraph($riderId: ID!, $page: Int, $limit: Int, $startDate: String, $endDate: String) { riderEarningsGraph(...) { totalCount earnings { _id earningsArray { tip orderDetails { orderType orderId paymentMethod } totalEarnings deliveryFee date } totalDeliveries totalEarningsSum totalHours totalTipsSum date } } }` (`R/lib/apollo/queries/earnings.query.ts:3-40`) | `{ riderId }` (`R/lib/ui/screen-components/earnings/view/main/index.tsx:46-52`, `earning-details/header/index.tsx:37-43`), and `{ riderId, startDate, endDate }` on filter (`earning-details/view/index.tsx:49-66,116-117`) | Grouped **per day** (`_id` = date key). `totalEarnings = deliveryFee + tip` per order. **UNVERIFIED**: the meaning of `totalHours` (online hours). Do not fabricate it; return 0 if it is not tracked, and log a blocker.                                                                                                                                                   |
| `transactionHistory`          | `query TransactionHistory { transactionHistory { data { status amountTransferred createdAt } } }` (`rider.query.ts:20-30`)                                                                                                                                                                                                                                                               | none                                                                                                                                                                                                                        | Caller inferred from the JWT (rider), same as the store.                                                                                                                                                                                                                                                                                                                    |
| `riderCurrentWithdrawRequest` | `query RiderCurrentWithdrawRequest($riderId: String) { riderCurrentWithdrawRequest(riderId: $riderId) { _id requestAmount status createdAt } }` (`:32-41`)                                                                                                                                                                                                                               | `{ riderId }`                                                                                                                                                                                                               | Open request or null.                                                                                                                                                                                                                                                                                                                                                       |
| `createWithdrawRequest`       | `mutation Mutation($requestAmount: Float!) { createWithdrawRequest(requestAmount: $requestAmount) { status } }` (`R/lib/apollo/mutations/withdraw-request.mutation.ts:3-9`)                                                                                                                                                                                                              | `{ requestAmount }`, **no userId** (`R/lib/ui/screen-components/wallet/view/main/index.tsx:145-171`)                                                                                                                        | **The same field as the store, but the store also sends `userId: String!`.** The schema arg must therefore be `userId: String` (nullable). The server derives the payee from the JWT and, if `userId` is given, requires it to equal the caller. The client validates `<= currentWalletAmount` and `>= 10`. Refetches use the wrong var names for `RIDER_BY_ID` (harmless). |

---

## A. Consolidated types and fields read by store and rider

All `_id` / `id` values are strings. Timestamps are ISO-8601 strings, except where noted. Money is a float in major units on the wire.

**Order**

- Identity and timestamps: `_id`, `id`, `orderId` (human), `createdAt`, `updatedAt` (memo key in the store card), `orderDate` (scheduled time), `acceptedAt`, `assignedAt`, `pickedAt`, `deliveredAt`, `cancelledAt`, `expectedTime`, `completionTime`, `preparationTime` (ISO absolute).
- Status and flags: `orderStatus` (`PENDING|ACCEPTED|ASSIGNED|PICKED|DELIVERED|CANCELLED`), `status` (Boolean, legacy), `orderState` (SINGLE only), `isActive`, `isPickedUp` (Boolean = takeaway), `isRinged` (Boolean), `isRiderRinged` (Boolean), `reason`, `instructions`.
- Money and payment: `paymentMethod` (string, e.g. `COD`/`CARD`/…; **UNVERIFIED** enum), `paymentStatus` (`PAID`/`PENDING`…), `paidAmount`, `orderAmount`, `tipping`, `taxationAmount`, `deliveryCharges`, `discountAmount`.
- `restaurant { _id name image address location{coordinates} }`
- `deliveryAddress { location{coordinates} deliveryAddress details label id }`
- `user { _id name phone email }`
- `rider { _id name username available phone }`
- `review { _id rating }`
- `items[] { _id id title food description image quantity specialInstructions isActive createdAt updatedAt variation { _id id title price discounted } addons[] { _id id title description quantityMinimum quantityMaximum options[] { _id id title description price } } }`
- `eta { phase source readyAt baseArrivalAt estimatedArrivalAt windowStartAt windowEndAt durationSeconds distanceMeters encodedPolyline calculatedAt lastLocationAt version }`. **UNVERIFIED**: `phase`/`source` enums. The store only formats `windowStartAt`/`windowEndAt` and may receive `eta: null`.

**Restaurant** (store-owner view)

- `_id`, `unique_restaurant_id`, `orderId` (counter), `orderPrefix`, `name`, `image`, `logo`, `address`, `username`, `minimumOrder`, `isActive`, `isAvailable`, `slug`, `commissionRate`, `tax`, `notificationToken`, `enableNotification`, `shopType`, `phone`, `hasBusinessDetails`, `deliveryTime`
- `location{coordinates}`, `zone{_id}`
- `openingTimes[]{ day times[]{ startTime:[String] endTime:[String] } }`
- `bussinessDetails{ bankName accountNumber accountName accountCode }`
- `totalWalletAmount`, `withdrawnWalletAmount`, `currentWalletAmount`
- The admin also sees `commissionRate`. Under FairBite's zero core-plan food commission it should be `0`.

**Rider**

- `_id`, `name`, `username`, `email`, `phone`, `image`, `isActive`, `available`, `assigned`, `vehicleType`, `accountNumber`, `createdAt`, `updatedAt`, `timeZone`
- `location{coordinates}`, `zone{_id}`
- `currentWalletAmount`, `totalWalletAmount`, `withdrawnWalletAmount`
- `bussinessDetails{...}`, `licenseDetails{ expiryDate image number }`, `vehicleDetails{ image number }`
- `workSchedule[]{ day enabled slots[]{ startTime endTime } }`

**Zone**: only `{ _id }` is read by store and rider.

**Earnings (graph)**

- `{ totalCount earnings[] { _id(date) date totalEarningsSum totalDeliveries totalHours totalTipsSum earningsArray[] { totalOrderAmount totalEarnings deliveryFee tip date orderDetails { orderId orderType paymentMethod } } } }`
- The store and rider variants each request a subset.
- Store `earnings{ message data { grandTotalEarnings { storeTotal } earnings { storeEarnings { totalEarnings } } } }`.

**WithdrawRequest**: `{ _id requestAmount status createdAt }`. The create returns `{ status }`. Statuses are `REQUESTED | TRANSFERRED | CANCELLED` (plus `PAID` seen in history).

**Transaction** (`transactionHistory.data[]`): `{ status amountTransferred createdAt }`.

**Chat message**: `{ id message image user { id name } createdAt }`. The send envelope is `{ success message data }`.

**Subscription envelopes**

- `subscribePlaceOrder` → `{ userId origin order }`
- `subscriptionZoneOrders` → `{ zoneId origin order }`
- `subscriptionAssignRider` → `{ order origin }`
- `subscriptionOrder` → `Order`
- `origin ∈ "new" | "update" | "remove"`

**Login payloads**

- `restaurantLogin` → `{ token restaurantId }`
- `riderLogin` → `{ userId token }`

---

## B. Order state machine (store + rider perspective)

```
                      store acceptOrder(time)                 rider assignOrder (self, zone)
 [placed] ─► PENDING ───────────────────────────► ACCEPTED ─────────────────────────────────► ASSIGNED
                │                                  │   │       admin assignRider + updateStatus("ASSIGNED")   │
                │ store cancelOrder("not available")│   │                                                 │ rider updateOrderStatusRider("PICKED")
                │ server auto-decline 120s (UNVERIF)│   │ store orderPickedUp (takeaway only)             ▼
                ▼                                  │   └──────────────────────────► DELIVERED ◄──────── PICKED
            CANCELLED ◄──── admin updateStatus / customer abortOrder (UNVERIFIED windows) ─┘   rider updateOrderStatusRider("DELIVERED")
```

| Transition                           | Trigger (auth)                                                                                                                                                                   | Guard                                                                    | Side effects                                                              | Subscriptions to fire (audience)                                                                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none) → PENDING                     | customer `placeOrder`                                                                                                                                                            | payment authorised (card) or COD                                         | `isRinged=true`; restaurant push                                          | `subscribePlaceOrder(restaurant, origin:"new")` (store); `subscriptionDispatcher` (admin); customer `orderStatusChanged(userId)` (customer)                                                                                               |
| PENDING → ACCEPTED                   | store `acceptOrder(_id,time)` (restaurant owner)                                                                                                                                 | status PENDING; within window                                            | `acceptedAt`, `preparationTime=now+time`, ETA, `isRinged=false`           | store `subscribePlaceOrder(update)`; `subscriptionOrder(id)` (customer/store/admin); customer `orderStatusChanged`; **if `!isPickedUp`: `subscriptionZoneOrders(zone, "new")` + push to available zone riders**; `subscriptionDispatcher` |
| PENDING → CANCELLED                  | store `cancelOrder(_id, reason)`; server timeout (UNVERIFIED); admin `updateStatus`; customer `abortOrder` (customer ref)                                                        | status PENDING (store path)                                              | `reason`, `cancelledAt`, refund/void journal                              | store update; `subscriptionOrder`; customer `orderStatusChanged`; dispatcher                                                                                                                                                              |
| ACCEPTED → ASSIGNED                  | rider `assignOrder(id)`, or admin `assignRider(id,riderId)` followed by `updateStatus(id,"ASSIGNED")` (`A/lib/ui/useable-components/table/columns/dispatch-columns.tsx:190-205`) | rider in zone, available, active; order unassigned, not takeaway; atomic | `rider`, `assignedAt`                                                     | `subscriptionAssignRider(riderId, "new")` (that rider); zone `"remove"` (other riders); store update; `subscriptionOrder`; customer `orderStatusChanged`; dispatcher; push to rider on admin assignment                                   |
| ASSIGNED → ASSIGNED (reassign)       | admin `assignRider` to a different rider                                                                                                                                         | not DELIVERED/CANCELLED                                                  | swap `rider`                                                              | old rider `subscriptionAssignRider(old,"remove")`; new rider `"new"`; store/customer/admin updates                                                                                                                                        |
| ASSIGNED → PICKED                    | rider `updateOrderStatusRider(id,"PICKED")`                                                                                                                                      | caller is `order.rider`                                                  | `pickedAt`; location tracking active                                      | rider `subscriptionAssignRider(update)`; store update; `subscriptionOrder`; customer `orderStatusChanged`; dispatcher; `subscriptionRiderLocation(riderId)` (customer/admin) continues                                                    |
| PICKED → DELIVERED                   | rider `updateOrderStatusRider(id,"DELIVERED")`                                                                                                                                   | caller is `order.rider`                                                  | `deliveredAt`, `completionTime`; COD collected; earnings journal; wallets | the same as for PICKED                                                                                                                                                                                                                    |
| ACCEPTED(takeaway) → DELIVERED       | store `orderPickedUp(_id)`                                                                                                                                                       | `isPickedUp=true`                                                        | `deliveredAt`; earnings journal (restaurant + platform only)              | store update; `subscriptionOrder`; customer; dispatcher                                                                                                                                                                                   |
| ACCEPTED/ASSIGNED/PICKED → CANCELLED | admin `updateStatus` (admin only)                                                                                                                                                | admin policy                                                             | refund journal; rider unassigned                                          | rider `subscriptionAssignRider(update)`, so the order lands in Delivered as CANCELLED (UNVERIFIED preference vs `"remove"`); zone `"remove"`; store update; customer; dispatcher                                                          |

Notes:

- The store never sees ASSIGNED/PICKED as actionable. It only displays them, plus the "Waiting for Rider" hint while ACCEPTED, unassigned and not takeaway.
- The rider never sees PENDING orders, and never sees takeaway orders.
- All transitions must go through one central, validated transition function (AGENTS.md). Each transition is idempotent per (order, target), with optimistic-concurrency on the order version.

---

## C. Dispatch model

1. **Primary: zone broadcast plus self-assignment.** When an order reaches ACCEPTED (non-takeaway), it is broadcast on `subscriptionZoneOrders(zoneId)` to riders who have `zone._id` set and `available=true`. The order also appears in each such rider's `riderOrders` results until it is taken.
   - The rider taps "Assign me" (`assignOrder`). The first atomic claim wins.
   - The ringtone loops while any unassigned ACCEPTED order is visible.
2. **Fallback: admin dispatcher.** The admin dispatch table uses `assignRider(id, riderId)` and then, separately, `updateStatus(id, "ASSIGNED")` (`A/lib/ui/useable-components/table/columns/dispatch-columns.tsx:190-205`; mutations at `A/lib/api/graphql/mutations/dispatch/index.ts:3-21`). It watches `subscriptionDispatcher` (`A/lib/api/graphql/subscription/order-subscription/index.ts:86-87`).
   - Server-side, `assignRider` should itself set ASSIGNED, so the follow-up `updateStatus` is idempotent.
   - The rider learns of it via `subscriptionAssignRider(riderId, "new")` and a push.
3. **Timeouts implied by the clients.** These are **UNVERIFIED** server behaviour; implement them as configurable server jobs and never as client logic.
   - Store accept window: 120 s from `createdAt` ("Auto decline in", `S/lib/utils/constants/general.ts:1`). Server auto-cancel of PENDING is implied.
   - Rider claim window: 120 s from `acceptedAt` (`R/lib/utils/constants/general.ts:1`, `R/lib/hooks/useOrder.ts:23-60`). The client only refetches when it ends.
     - Suggested server behaviour: after 120 s unclaimed, flag the order to the admin dispatcher (`subscriptionDispatcher`) and optionally widen the broadcast.
     - Do not auto-cancel a paid, accepted order without policy.
   - Scheduled orders: the store accept button appears 5 min before `orderDate` (`S/lib/utils/methods/gloabl.ts:36-39`). Broadcast to riders should be delayed relative to `preparationTime` / `orderDate` (**UNVERIFIED**).
4. **Provider independence (AGENTS.md).** Model "own rider fleet zone broadcast" as one routing strategy behind a delivery-routing interface. A third-party courier strategy would bypass zone broadcast but must still emit the same order/status events.
5. **Zone membership.** Riders get their zone from admin (`editRider` / `createRider`). Rider-side `editRider` must not change it. An order's zone is derived from the restaurant zone (`restaurant.zone._id`, `S/lib/apollo/queries/store.query.ts:6-8`). **UNVERIFIED**: point-in-polygon on the delivery address.

---

## D. Earnings and withdrawal model implied

- **Wallet balances shown**: `totalWalletAmount` (lifetime credited), `withdrawnWalletAmount` (paid out), `currentWalletAmount` (available). This holds for both Restaurant and Rider. The withdraw UI caps at `currentWalletAmount` with a minimum of 10.
  - Implement each as a derived balance of immutable, balanced journal entries. Never store them as mutable counters.
  - Convert to float major units only in GraphQL resolvers.
- **When credits happen**: on DELIVERED (rider via `updateOrderStatusRider`, takeaway via `orderPickedUp`). The rider client refetches profile and earnings exactly then (`R/lib/hooks/useDetail.tsx:106-125`).
  - Restaurant credit = food subtotal + tax. The policy for `commissionRate` is FairBite's zero core-plan food commission. Delivery and tip are excluded.
  - Rider credit = `deliveryFee` + `tip`. These are the per-order `earningsArray` fields.
  - The platform takes any delivery margin or fees.
  - **UNVERIFIED**: the exact upstream formula. FairBite must define it in contracts with server-owned prices.
- **COD**: the rider collects `orderAmount` in cash (the confirm text at delivery). This creates a rider cash-liability journal (rider owes the platform the cash minus their earnings). **UNVERIFIED** in upstream; the UI shows no rider cash balance.
- **Earnings graph** (`storeEarningsGraph` / `riderEarningsGraph`): aggregates journal lines per day for `[startDate, endDate]`.
  - `limit` = number of day-buckets, `page` = 1.
  - Each bucket contains per-order rows (`orderDetails{orderId orderType paymentMethod}`). `orderType` means delivery vs pickup (**UNVERIFIED** values).
- **Withdrawal lifecycle**:
  1. `createWithdrawRequest` → `REQUESTED`, reserving the funds with a journal entry from available to pending.
  2. Admin processes it, giving `TRANSFERRED` (settled: pending to paid-out, which increments `withdrawnWalletAmount`) or `CANCELLED` (reservation reversed).
  3. `storeCurrentWithdrawRequest` / `riderCurrentWithdrawRequest` return the single open request.
  4. `transactionHistory.data` lists payouts with `status ∈ {REQUESTED, TRANSFERRED, PAID, CANCELLED}` and `amountTransferred`.
  - **UNVERIFIED**: whether `PAID` is distinct from `TRANSFERRED` upstream.
- **Ownership**: every money query and mutation resolves the subject from the JWT. Any explicit id argument (`storeId`, `riderId`, `userId`) must match the caller, unless the caller is admin.
- **Bank details** (`bussinessDetails`): a payout requires `hasBusinessDetails`. **UNVERIFIED** whether the server blocks a withdraw without them; recommend it does, with a clear message (shown verbatim in the Alert).
- No raw card data ever reaches the store or rider apps. None is requested.

---

## E. Single-vendor mode code paths (brief)

- Both apps let the user (or the `EXPO_PUBLIC_VENDOR_MODE` env) choose `SINGLE`. The mode switches the endpoint and the document variants. Token and id keys are scoped per mode: `enatega-store-{multi|single}-token|id`, `enatega-rider-{multi|single}-token|id` (`S/lib/mode/store-mode.ts`, `R/lib/mode/rider-mode.ts`).
- Store SINGLE differences:
  - `restaurantOrders(offset, limit)` in pages of 50, with a richer `eta` and no `discountAmount` (`S/lib/apollo/queries/orders.ts:111-216`).
  - `STORE_PROFILE_SINGLE_VENDOR` adds `bussinessDetails`; `hasBusinessDetails` is derived client-side (`store.query.ts:101-138`).
  - `subscriptionOrder` is identical.
- Rider SINGLE differences:
  - `riderOrders(limit, offset)` plus the `orderState` field, which is authoritative: `ACCEPTED | READY_FOR_PICKUP | PICKED_UP | ON_ROUTE` (`R/lib/apollo/queries/rider.query.ts:207-305`, `R/lib/utils/order-state.ts`).
  - Zone and assign subscriptions add `orderState` (`subscriptions.ts:117-199,283-364`).
  - Chat has no `image` support (`chat.query.ts:20-32`, `chat.mutation.ts:24-43`, `subscriptions.ts:20-32`).
  - `riderOrders` is not polled.
  - `configuration` requires auth.
- Single-vendor still calls `updateOrderStatusRider` with `"PICKED"` / `"DELIVERED"` only. The pick-up and deliver guards use `orderState` (`order-state.ts:37-63`).
- If FairBite serves only MULTI, these documents are dormant. Serve SINGLE only if product decides to, and it would need the extra `orderState` field.
