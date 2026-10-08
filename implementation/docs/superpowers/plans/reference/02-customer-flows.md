# 02 — Customer app flows: the GraphQL contract the backend must satisfy

Status: read-only research reference, 2026-10-08. Audience: backend implementation agents.
Sources: the pinned, unchanged Enatega customer frontends:

- `APP` = `implementation/vendor/enatega-ui/enatega-multivendor-app/src` (Expo / React Native)
- `WEB` = `implementation/vendor/enatega-ui/enatega-multivendor-web` (Next.js)

Citations use `APP/...:line` or `WEB/...:line`. **UNVERIFIED** marks anything inferred and not proven by the client source. Single-vendor paths are out of scope (listed in §12).

> **Frontend boundary (owner directive 2026-10-08, AGENTS.md).** The product UI is the complete pinned Enatega frontend. The backend must implement the operations below with the same operation names, arguments and response shapes.
>
> - Do not change Enatega UI to suit the backend.
> - A capability the backend cannot support is an integration blocker. It is never a reason to fake data, return mock success, or fall back to the upstream production backend.
> - Any edit inside `implementation/enatega/` must be recorded in `SOURCE_PROVENANCE.json` under `allowedModifications`.

---

## 0. Cross-cutting transport rules

### 0.1 Endpoints and protocol

- **GraphQL over HTTP POST.**
  - App: `GRAPHQL_URL` (`enatega-multivendor-app/environment.config.js:8`).
  - Web: `NEXT_PUBLIC_SERVER_URL` + `graphql` (`WEB/lib/mode/environment.ts:21-38`).
- **Subscriptions** use the legacy `subscriptions-transport-ws` protocol.
  - App: `WebSocketLink` from `@apollo/client/link/ws` (`APP/apollo/index.js:16,169-193`).
  - Web: `SubscriptionClient` (`WEB/lib/hooks/useSetApollo.tsx:138-149`).
  - **The server must speak the `graphql-ws` legacy subprotocol** (subscriptions-transport-ws), not only `graphql-transport-ws`. UNVERIFIED: whether to support both.
- **REST base.**
  - App: `SERVER_REST_URL` (`environment.config.js:11`).
  - Web: `NEXT_PUBLIC_SERVER_URL` with a trailing slash. Used for Stripe (§5.7).
- **Extra variables.** Clients sometimes send variables the operation does not declare: `ip: null`, `picture`, `phone` and `password` in social login. The server must ignore them. graphql-js does this by default.
- **Argument nullability.** Where the two apps declare different variable nullability for the same argument, the server argument must be the _least strict_ of the two. The merged signatures in §11 already account for this.

### 0.2 Request headers

| Header          | App (`APP/apollo/index.js:208-219`)                                                 | Web (`WEB/lib/hooks/useSetApollo.tsx:204-213`) |
| --------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| `authorization` | `Bearer <userJWT>` or `""`                                                          | `Bearer <userJWT>` or `""`                     |
| `bop-auth`      | `Bearer <publicToken>` or `""`                                                      | same                                           |
| `nonce`         | device nonce `<modelId>-<ts>-<uuid>` (`APP/utils/publicAccessToken.js:13-20`)       | 16-byte hex nonce                              |
| other           | `user-agent: EnategaApp/<os>`, `accept-language: en-US`, `x-platform: ios\|android` | `userId`, `isAuth`, `X-Client-Type: web`       |

WebSocket `connectionParams`:

- App: `{authorization, 'x-platform', 'accept-language', 'user-agent'}` (`APP/apollo/index.js:177-191`).
- Web: `{authorization}` only (`WEB/lib/hooks/useSetApollo.tsx:144-148`).
- No `bop-auth` is sent on the WebSocket, so subscriptions must not require it.

The app sends operations `ForgotPassword`, `VerifyOtp` and `ResetPassword` **without** a user token (`APP/apollo/index.js:94,200-201`). They must work unauthenticated.

### 0.3 Public-access token: `metricsGeneral`

Called before other operations whenever the public token is missing or expiring:

- App: `APP/services/publicAcccessService.js:47-94`.
- Web: raw `fetch` in `WEB/lib/hooks/useSetApollo.tsx:55-92`.

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

(`APP/apollo/publicAccess.js:3-18`, `WEB/lib/api/graphql/mutations/metrics/index.ts:3-17`)

- **Request:** unauthenticated, with only the `nonce` header.
- **`experience`** = the public token, sent back as `bop-auth: Bearer <experience>`.
- **`hehe`** = expiry. It must be a `new Date()`-parsable string, e.g. ISO-8601.
- **Other 8 fields:** decoys, but they are selected, so they must resolve. Type String is UNVERIFIED.
- **Refresh timing.** App: 30 s before expiry, plus a 15 s skew (`publicAcccessService.js:19`, `publicAccessToken.js:55`). Web: 10 s before expiry.
- **Retry on matching error messages.** If any GraphQL error _message_ matches `/unauthorized|unauthenticated|jwt expired|invalid token|forbidden/i`, the app refreshes the public token and replays the operation once (`APP/apollo/index.js:255-318`). **Do not use those words in ordinary business error messages**, or every such error triggers a token refresh and a retry.

### 0.4 User session token

- **Must be a JWT with an `exp` claim.** The app decodes it locally, and a missing `exp` counts as expired, which triggers an instant logout (`APP/utils/decode-jwt.js:13-25`, `APP/apollo/index.js:202-206`).
- **Logout error codes.**
  - App logs out on `extensions.code ∈ {UNAUTHENTICATED, TOKEN_EXPIRED, INVALID_TOKEN}`, or HTTP 401, but only if the request carried a user JWT (`APP/apollo/index.js:246-278`).
  - Web clears the session on `TOKEN_EXPIRED` or `INVALID_TOKEN` (`WEB/lib/hooks/useSetApollo.tsx:152-181`).
- **Web `tokenExpiration`** accepts epoch seconds, epoch milliseconds, or a date string (`WEB/lib/utils/methods/auth.ts:52-69`).

### 0.5 Data format conventions the UI hard-codes

- **Point coordinates are GeoJSON `[longitude, latitude]`.** Every reader takes `coordinates[1]` as the latitude: `APP/screens/Checkout/Checkout.js:114-116`, `APP/context/User.js` (selected address), `WEB` address and checkout code. Values may be numbers or numeric strings; clients coerce with `Number()`, `parseFloat` or `+`. **Recommend returning numbers.** UNVERIFIED: the upstream schema type may be `[String]`.
- **Zone and `deliveryBounds` coordinates are GeoJSON Polygon rings** `[[[lng, lat], ...]]`. The client takes the ring from `coordinates[0]` and computes a centroid (`APP/utils/demoLocation.js:1-35`).
- **Opening times:** `openingTimes: [{ day: "MON"|"TUE"|"WED"|"THU"|"FRI"|"SAT"|"SUN", times: [{ startTime: ["HH","MM"], endTime: ["HH","MM"] }] }]`.
  - The app _requires_ the two-element array form. It reads `t.startTime[0]` as the hour and `[1]` as the minute (`APP/utils/customFunctions.js:100-122`).
  - Web accepts the arrays or `"HH:MM"` (`WEB/lib/utils/constants/isRestaurantOpen.ts:75-106`).
  - Both apps compare against **device-local** time, with inclusive bounds and no overnight slots.
- **Timestamps.**
  - Order lifecycle timestamps (`deliveredAt`, `cancelledAt`, `completionTime`, `orderDate`, `preparationTime`, ETA fields, chat `createdAt`) are parsed with `new Date(value)`, so they must be **ISO-8601 strings** (`APP/components/MyOrders/PastOrders.js:60-90`, `APP/components/Review/index.js:147`, `APP/screens/ChatWithRider/useChatScreen.js:52`). Web `parseBackendDate` accepts ISO or epoch.
  - Review `createdAt` and support ticket/message `createdAt`/`updatedAt` are parsed with `new Date(Number(x))` or `parseInt`, so they must be **epoch-millisecond strings**. Sources: `APP/utils/customFunctions.js:42-44`, `APP/screens/CustomerSupport/CustomerSupport.js:61-71`, `APP/components/Help/SupportChatModal.js:111-113`, and the web ticket list via `parseInt`.
  - These two conventions conflict. Both must be honoured per field.
- **Money:** GraphQL `Float` in major currency units on the wire. FairBite rules require integer minor units internally: convert at the API boundary and round to 2 dp.
- **Apollo type names the client cache depends on.** The server's `__typename` values must match:
  - `Food`: `client.readFragment({id: \`Food:${id}\`})` is used for popular and related items (`APP/screens/Restaurant/Restaurant.js:149-151`, `APP/ui/hooks/useRestaurantScreenData.js:66-73`, web cart and related items).
  - `Category`, `Item` and `RestaurantPreview` have type policies (`APP/apollo/index.js:96-162`).
  - Fragments sent to the server use type conditions `RestaurantPreview` (web) and `RestaurantCarouselPreview` (both apps). **These two type names must exist in the schema**, otherwise the server rejects the request with GRAPHQL_VALIDATION_FAILED.
  - The type policy also names `RestaurantDetail`. UNVERIFIED: this is assumed to be the type returned by `restaurant(...)`.
- **Client-only field.** `distanceWithCurrentLocation @client` is computed in the cache from `location` and the query variables (`APP/apollo/index.js:151-160`). The server never receives it.

---

## 1. Signup / login

### 1.1 Operations (exact documents)

| Op name                          | Root field and args                                                                                                                            | Selection                                                                                                                                                                                                       | Source                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Login` (app)                    | `login(email:String, password:String, type:String!, appleId:String, appleNonce:String, idToken:String, name:String, notificationToken:String)` | `userId token tokenExpiration isActive name email phone isNewUser`                                                                                                                                              | `APP/apollo/mutations.js:339-352`                                                    |
| `Login` (web)                    | `login(type:String!, email, password, appleId, idToken, name, notificationToken, isActive:Boolean)`                                            | `userId token tokenExpiration name phone phoneIsVerified email emailIsVerified picture addresses{location{coordinates} deliveryAddress} isNewUser userTypeId isActive`                                          | `WEB/lib/api/graphql/mutations/auth/index.ts:3-44`                                   |
| `AppleAuthNonce`                 | `appleAuthNonce` (scalar String)                                                                                                               | —                                                                                                                                                                                                               | `APP/screens/CreateAccount/CreateAccount.js:24-28`                                   |
| `EmailExist`                     | `emailExist(email:String!)` (scalar, read as boolean)                                                                                          | —                                                                                                                                                                                                               | `APP/apollo/mutations.js:308-311`, `WEB/.../auth/index.ts:46-50`                     |
| `PhoneExist`                     | `phoneExist(phone:String!)` (scalar boolean)                                                                                                   | —                                                                                                                                                                                                               | `APP/apollo/mutations.js:313-316`, `WEB/.../auth/index.ts:52-56`                     |
| `SendOtpToEmail`                 | `sendOtpToEmail(email:String!)`                                                                                                                | `result`                                                                                                                                                                                                        | `APP/apollo/mutations.js:318-324`                                                    |
| `SendOtpToPhoneNumber`           | `sendOtpToPhoneNumber(phone:String!)`                                                                                                          | `result`                                                                                                                                                                                                        | `APP/apollo/mutations.js:325-331`                                                    |
| `VerifyOtp`                      | `verifyOtp(otp:String!, email:String, phone:String)`                                                                                           | `result`                                                                                                                                                                                                        | `APP/apollo/mutations.js:456-462`, `WEB/.../auth/index.ts:168-174`                   |
| `CreateUser`                     | `createUser(userInput:{phone,email,password,name,notificationToken,appleId,emailIsVerified:Boolean,isPhoneExists:Boolean})`                    | app: `userId token tokenExpiration name email phone`. Web adds `phoneIsVerified emailIsVerified picture isNewUser userTypeId`                                                                                   | `APP/apollo/mutations.js:353-372`, `WEB/.../auth/index.ts:94-131`                    |
| `UpdateUser`                     | `updateUser(updateUserInput:{name:String!, phone:String, phoneIsVerified:Boolean, emailIsVerified:Boolean})`                                   | `_id name phone phoneIsVerified emailIsVerified`                                                                                                                                                                | `APP/apollo/mutations.js:374-383`, `WEB/.../auth/index.ts:133-155`                   |
| `ForgotPassword`                 | `forgotPassword(email:String!)`                                                                                                                | `result`                                                                                                                                                                                                        | `APP/apollo/mutations.js:113-117`                                                    |
| `ResetPassword` (app)            | `resetPassword(password:String!, email:String!, otp:String!)`                                                                                  | `result`                                                                                                                                                                                                        | `APP/apollo/mutations.js:119-123`                                                    |
| `ResetPassword` (web)            | `resetPassword(password:String!, email:String!)` **and** `resetPassword(password, email, token:String!)`                                       | `result`                                                                                                                                                                                                        | `WEB/.../auth/index.ts:79-93`                                                        |
| `ChangePassword`                 | `changePassword(oldPassword:String!, newPassword:String!)` (scalar)                                                                            | —                                                                                                                                                                                                               | `APP/apollo/mutations.js:192-194`                                                    |
| `deactivated` / `DeactivateUser` | `Deactivate(isActive:Boolean!, email:String!)`                                                                                                 | app: `isActive`; web: `_id name email isActive`                                                                                                                                                                 | `APP/apollo/mutations.js:332-338`, `WEB/.../auth/index.ts:157-166`                   |
| `PushToken`                      | `pushToken(token:String)`                                                                                                                      | `_id notificationToken`                                                                                                                                                                                         | `APP/apollo/mutations.js:106-111`                                                    |
| `SaveNotificationTokenWeb`       | `saveNotificationTokenWeb(token:String!)`                                                                                                      | `success message`                                                                                                                                                                                               | `WEB/lib/api/graphql/mutations/Notification/index.ts:3-8`                            |
| `UpdateNotificationStatus`       | `updateNotificationStatus(offerNotification:Boolean!, orderNotification:Boolean!)`                                                             | app: `_id notificationToken isOrderNotification isOfferNotification`; web: `name phone`                                                                                                                         | `APP/apollo/mutations.js:385-393`, `WEB/.../Notification/index.ts:9-15`              |
| (profile)                        | `profile`                                                                                                                                      | `_id name phone phoneIsVerified email emailIsVerified notificationToken isActive isOrderNotification isOfferNotification addresses{_id label deliveryAddress details location{coordinates} selected} favourite` | `APP/apollo/queries.js:388-411`, `WEB/lib/api/graphql/queries/profile/index.ts:3-25` |

**Merged server signatures:**

- `login(type: String!, email: String, password: String, appleId: String, appleNonce: String, idToken: String, name: String, notificationToken: String, isActive: Boolean)`
- `resetPassword(password: String!, email: String!, otp: String, token: String)`

### 1.2 Email + password

1. **App** (`APP/screens/Login/useLogin.js:64-221`):
   - `emailExist({email})` runs first. Truthy shows the password field; falsy navigates to `Register`.
   - Then `login({email, password, type:'default', notificationToken})`. `notificationToken` is an **Expo push token** (`ExponentPushToken[...]`) or `null` (`:186-212`).
   - `login.isActive == false` shows "account deactivated" and the token is not stored (`:144-146`).
2. **Web:** `handleUserLogin({type:"default", email, password})` (`WEB/lib/ui/.../enter-password/index.tsx:44-48`).
   - After login it routes on the result (`WEB/lib/context/auth/auth.context.tsx:381-410`): `!emailIsVerified` opens the "save email" panel, `!phoneIsVerified` opens the "save phone" panel, otherwise home.
   - `login` must therefore return accurate `emailIsVerified` and `phoneIsVerified`.

### 1.3 Registration (email OTP, then phone OTP)

**App flow:**

1. `Register` screen calls `phoneExist({phone: E.164})` (`APP/screens/Register/useRegister.js:118-124`).
   - If it exists: an "already exists" alert, and continuing passes `isPhoneExists: true` (`:126-158`).
2. `EmailOtp` screen:
   - Calls `sendOtpToEmail({email})` on mount, unless `configuration.skipEmailVerification` is set (`APP/screens/Otp/Email/useEmailOtp.js:212-218`).
   - On code entry it calls `verifyOtp({otp, email})`. **`if (data?.verifyOtp)` tests the object, not `.result`** (`:172-186`), and then calls `createUser`.
   - If verification is skipped, `createUser` runs with no OTP at all (`:173-176`).
3. `createUser` variables (`:153-166`): `{phone, email, password, name, picture:'', notificationToken, emailIsVerified: true, isPhoneExists}`.
4. After `createUser` (`:83-124`):
   - If `skipMobileVerification` is set and a token came back: store the token and go home.
   - Otherwise go to `PhoneOtp` with `{name, phone, token}`.
5. `PhoneOtp` screen:
   - Stores the token first (`APP/screens/Otp/Phone/usePhoneOtp.js:54-70`), so its OTP calls are authenticated.
   - Sends `sendOtpToPhoneNumber({phone})` unless verification is skipped or a demo OTP is set (`:236-241`). `TEST_OTP` comes from `configuration.testOtp`, which is never queried, so the default `'111111'` applies (`APP/environment.js:34`).
   - Then `verifyOtp({otp, phone})`, again with an object-truthiness check, and then `updateUser({name, phone, phoneIsVerified:true})` (`:153-198`).

**Web flow** (from traced call sites):

- Signup checks `emailExist`, then `phoneExist`, then sends both OTPs (`WEB/lib/ui/.../signup-with-email/index.tsx:115-173`).
- The `verifyOtp` result is checked correctly only in `email-verification/index.tsx:133-141`. The checks in `phone-verification:152-162`, `update-phone:66-72` and `change-password/email-otp:112-119` test object truthiness.
- The skip flags auto-fill `TEST_OTP` and submit without calling `verifyOtp`.

**Server rules (mandatory):**

- **R1-1.** `verifyOtp` with a wrong, expired or reused OTP **must throw a GraphQL error**. Returning `{result:false}` is read as success by four client paths. Return `{result:true}` only on success.
- **R1-2.** Never trust `emailIsVerified`, `phoneIsVerified` or `isPhoneExists` from the client.
  - Set `emailIsVerified` only when this server has a successful `verifyOtp(email)` for that email within a TTL, or when `skipEmailVerification` is on.
  - Set `phoneIsVerified` only after a successful `verifyOtp(phone)` for that phone by the same user/session, or when `skipMobileVerification` is on.
  - `isPhoneExists:true` must not allow taking over another account's phone. UNVERIFIED upstream semantics: treat it as "user acknowledged the conflict". The phone must still not be moved off another verified account without that account's OTP.
- **R1-3.** `sendOtpTo*` must be rate-limited. OTP values must never appear in responses or logs.
- **R1-4.** `emailExist` and `phoneExist` return a **Boolean scalar**, with no subselection.
  - These enable account enumeration; rate-limit them.
  - If `phoneExist` errors, web treats the phone as existing.
- **R1-5.** `createUser` returns a JWT `token` (with `exp`), `userId`, `tokenExpiration`, `phone` and `name`.
  - Return `phone: ""` (empty string, not null) when absent. The app tests `login.phone === ''` to route to phone capture (`APP/screens/CreateAccount/useCreateAccount.android.js:267`).
- **R1-6.** Normalise emails to lowercase. The app sends `email.toLowerCase().trim()` (`useRegister.js:148`) and phones in E.164.

### 1.4 Google

- **App (Android)** (`APP/screens/CreateAccount/useCreateAccount.android.js:88-145,184-225`): `@react-native-google-signin`, `webClientId = EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
  - It sends `login({type:'google', idToken, email, name, notificationToken, phone:'', password:'', picture})`.
- **App (iOS)**: expo-auth-session OAuth. `idToken` is taken from `authentication.idToken` or `params.id_token`, sent with `type:'google'` (`useCreateAccount.ios.js:75-154`).
- **Web**: Google Identity Services `credential` JWT. The client id is `configuration.webClientID` and must match `/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/`, otherwise Google login is disabled. It sends `{type:"google", email, idToken, name, notificationToken:""}` (`WEB/lib/ui/screen-components/un-protected/authentication/index.tsx:92-101,204-247`).
- **Server rules:**
  - Verify the `idToken` signature, `iss`, `exp` and `aud` (web client id, Android client id, iOS client id).
  - Take the email and name **from the verified token**, not from the variables.
  - Create the user if absent and set `isNewUser`.
  - Return `isActive:false` for deactivated users.
  - **Error message strings the clients map** (`useCreateAccount.android.js:310-335`, `WEB/lib/context/auth/auth.context.tsx:431-472`):
    - message containing "not configured": shown as not-configured
    - "idtoken", "identity token" or "missing token": shown as missing-token
    - "invalid token", "expired token", "jwt" or "token": shown as invalid-token

### 1.5 Apple (app only)

Source: `APP/screens/CreateAccount/CreateAccount.js:69-149`. Steps:

1. `query AppleAuthNonce { appleAuthNonce }`, run with `no-cache`. A falsy result aborts the login.
2. `AppleAuthentication.signInAsync({nonce: appleNonce, state})`.
3. `login({type:'apple', appleId: credential.user || jwt.sub, appleNonce, idToken: identityToken, email, name, phone:'', password:'', picture:''})`.
4. If the login returns an empty `name`, the app routes to the `EditName` screen (`useCreateAccount.android.js:263-280`).

**Server rules:**

- `appleAuthNonce` issues a single-use server-stored nonce.
- `login(type:'apple')` must:
  - verify the Apple identity token (`iss` = `https://appleid.apple.com`, `aud` = the iOS bundle id, `exp`);
  - verify the `nonce` claim equals the issued nonce, then consume it. UNVERIFIED: whether Apple returns the nonce raw or SHA-256-hashed with expo-apple-authentication; accept the documented form after testing on a device;
  - verify `sub === appleId`.
- Apple sends the name only on the first authorisation. Persist it whenever it is provided.
- Web never sends `type:"apple"`.

### 1.6 Forgot / reset password

**App** (`APP/screens/ForgotPassword/*`, `APP/screens/Otp/ForgotPassword/useForgotPasswordOtp.js`):

1. `forgotPassword({email})` sends the OTP by email.
2. `verifyOtp({otp, email})`. The success check is object truthiness (`:56-68`).
3. `resetPassword({password, email, otp})` with the same OTP (`useResetYourPassword.js:120-131`).
   - **So `verifyOtp` must not consume the reset OTP.** Alternatively, `resetPassword` must accept an OTP that was verified within a TTL. Pick one.

**Web:**

- **Link flow.** `/auth/reset?email=…&token=…` calls `resetPassword({email, password, token})` (`WEB/app/(localized)/auth/reset/page.tsx:15-52`).
  - Failure redirects to `/auth/forgot-password?error=invalid&email=…`.
  - **The reset email link must use exactly this path and these query names.**
  - UNVERIFIED: whether `forgotPassword` should send a link, an OTP, or both. Both clients call the same mutation; send both a token link and an OTP.
- **In-modal OTP flow.** `sendOtpToEmail` → `verifyOtp` → `resetPassword({password, email})` with **no OTP or token** (`WEB/lib/ui/.../change-password/index.tsx:34-39`).

**Server rules:**

- `resetPassword` with neither `otp` nor `token` must succeed **only** if this server recorded a successful `verifyOtp(email)` for a password-reset purpose within a short TTL. Otherwise reject. This is an account-takeover vector.
- `forgotPassword` always returns `{result:true}`, whether or not the account exists, to avoid enumeration. Web always shows a generic toast.

### 1.7 Profile, updateUser, Deactivate, notifications

- **`updateUser`.** Called from:
  - `EditName` with `{name}` (`APP/components/Account/EditName/EditName.js:21`);
  - `PhoneNumber` with `{name, phone, phoneIsVerified:true}` when `!configuration.twilioEnabled` (`APP/screens/PhoneNumber/usePhoneNumber.js:89-117`);
  - Web profile pages.
  - **R1-2 applies: ignore the client's `phoneIsVerified`.** If Twilio is disabled, decide by policy, with `skipMobileVerification` as the toggle. A phone change must reset `phoneIsVerified` to false until verified.
- **Checkout gate.** Checkout refuses to place an order unless `profile.phone` is non-empty and `profile.phoneIsVerified` is true (`APP/screens/Checkout/Checkout.js:523-533`; web `validateOrder` step 9). The server should enforce the same rule in `placeOrder`. UNVERIFIED as policy, but it is what the UI assumes.
- **`Deactivate(isActive:false, email)`**, called from `APP/screens/Account/Account.js:272-279` and web settings.
  - The server must act on the **authenticated user only**. Reject if `email` ≠ the caller's email.
  - After success the app logs out locally.
  - Subsequent `login` must return `isActive:false`. Recommend not issuing a usable token.
- **Push tokens.**
  - App: an Expo push token via `login`/`createUser` `notificationToken`, and `pushToken(token)` (`APP/mode/ModeNotificationRegistration.js:39-41`, `APP/screens/Account/Account.js:155`).
  - Web: an FCM token via `saveNotificationTokenWeb`. It is re-sent on every profile load (`WEB/lib/context/User/User.context.tsx:459-463,917-924`).
  - `updateNotificationStatus` toggles `isOrderNotification` and `isOfferNotification`. Web sends `true,true` when browser permission is granted.
  - Sending real pushes requires Expo/FCM credentials. **Blocker if they are absent.**
- **`profile.favourite`** is an array of restaurant id strings. Both clients call `favourite.includes(id)`.

---

## 2. Addresses

### 2.1 Operations

All address mutations return the `User` with `addresses{_id label deliveryAddress details location{coordinates} selected}`. `deleteAddress` and `deleteBulkAddresses` omit `selected`.

- `createAddress(addressInput: AddressInput!)` (`APP/apollo/mutations.js:164-176`; `WEB/lib/api/graphql/mutations/addresses/index.ts:21-37`)
- `editAddress(addressInput: AddressInput!)` (`APP/apollo/mutations.js:178-190`)
- `deleteAddress(id: ID!)` (`APP/apollo/mutations.js:138-149`)
- `deleteBulkAddresses(ids: [ID!]!)` (`APP/apollo/mutations.js:151-162`; app only, `APP/screens/Addresses/Addresses.js:194-195`)
- `selectAddress(id: String!)` (`APP/apollo/mutations.js:196-208`). Note the arg type is `String!`, not `ID!`.

**`AddressInput` fields as sent:**

| Field                   | Type sent  | Notes                                                                                                                                  |
| ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                   | String     | edit only                                                                                                                              |
| `label`                 | String     | `"House" \| "Office" \| "Apartment" \| "Other"` (`APP/screens/SaveAddress/SaveAddress.js:224-244`; web address modal)                  |
| `deliveryAddress`       | String     |                                                                                                                                        |
| `details`               | String     | web sends the _zone title_ chosen in the city dropdown, possibly undefined (`WEB/lib/ui/useable-components/address/index.tsx:341-355`) |
| `latitude`              | **String** | template string, e.g. `"33.69"`; web may send `"undefined"`                                                                            |
| `longitude`             | **String** | same                                                                                                                                   |
| `isDemoDefaultLocation` | Boolean    | only inside `placeOrder.address`                                                                                                       |
| `demoZoneId`            | String     | only inside `placeOrder.address`                                                                                                       |

Sources: `APP/screens/SaveAddress/SaveAddress.js:141-152`, `APP/screens/NewAddress/NewAddress.js:348-354`, `APP/screens/EditAddress/EditAddress.js:384-391`, `APP/screens/Checkout/Checkout.js:581-610`.

### 2.2 Server rules

- **Coordinates.** Parse `latitude`/`longitude` from strings. Reject non-finite values or values outside ±90/±180. Store as GeoJSON Point `[lng, lat]` and return it the same way.
- **New/edited address becomes selected.** `createAddress`/`editAddress` must make the created or edited address the **selected** one (`selected:true`, all others false).
  - Both clients find it with `addresses.find(a => a.selected)`, and web crashes otherwise (`APP/screens/SaveAddress/SaveAddress.js:62-71`; `WEB/.../address/index.tsx:358-366`).
  - Web then also calls `selectAddress` on it.
- **`selectAddress(id)`** sets exactly one selected address.
- **Ownership.** All address mutations operate only on the authenticated user's own addresses. `deleteBulkAddresses` must ignore or reject ids not owned by the caller.
- **Optional zone check.** UNVERIFIED: whether to reject addresses outside every active zone. Neither client checks; `placeOrder` does (§5).

---

## 3. Discovery

### 3.1 Operations actually called

| Op                                                 | Root field (args)                                                                                                                                                                                       | Variables used                                                                                                                                                   | Source                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Restaurants`                                      | `nearByRestaurantsPreview(latitude:Float, longitude:Float, shopType:String, page:Int, limit:Int)` → `{offers{_id name tag restaurants} sections{_id name restaurants} restaurants{…RestaurantPreview}}` | see §3.2                                                                                                                                                         | `APP/apollo/queries.js:800-840`; `WEB/lib/api/graphql/queries/restaurants/index.ts:115-136` (web selects only `restaurants`)                        |
| `GetMostOrderedRestaurants`                        | `mostOrderedRestaurantsPreview(latitude:Float!, longitude:Float!, shopType:String, page:Int, limit:Int)` → `[RestaurantCarouselPreview]`                                                                | app: `{lat, lng, page:1, limit:15}` and `{…, shopType:'grocery', limit:10}` (`APP/ui/hooks/useRestaurantOrderInfo.js:14-37`); web: page 1, limit 15              | `APP/apollo/queries.js:1193-1200`; `WEB/.../restaurants/index.ts:94-113`                                                                            |
| `GetRecentOrderRestaurants`                        | `recentOrderRestaurantsPreview(latitude:Float!, longitude:Float!)` → `[RestaurantCarouselPreview]`                                                                                                      | app: skipped when logged out; web: **hard-coded** `{33.5831583, 73.0810976}` (`WEB/lib/hooks/useRecentOrderRestaurants.tsx:15-18`)                               | `APP/apollo/queries.js:1159-1166`; `WEB/.../restaurants/index.ts:85-92`                                                                             |
| `TopRatedVendors`                                  | `topRatedVendorsPreview(latitude:Float!, longitude:Float!)` → `[RestaurantCarouselPreview]`                                                                                                             | web passes `LocationContext` coordinates, in practice `0,0` (`WEB/lib/hooks/useTopRatedVendors.tsx:11-21`)                                                       | `APP/apollo/queries.js:841-848`; `WEB/lib/api/graphql/queries/vendors/index.ts:6-13`                                                                |
| `NearByRestaurantsCuisines` / `RestaurantCuisines` | `nearByRestaurantsCuisines(latitude:Float, longitude:Float, shopType:String)` → `[Cuisine{_id name description image shopType}]`                                                                        | app declares all three non-null (`APP/apollo/queries.js:1344-1362`); web nullable (`WEB/lib/api/graphql/queries/cuisines/index.ts:15-29`). **Server: nullable.** | `APP/screens/Menu/Menu.js:177-181`                                                                                                                  |
| `Cuisines` (app)                                   | `cuisines` → `[Cuisine{_id name description image shopType}]`                                                                                                                                           | —                                                                                                                                                                | `APP/apollo/queries.js:948-956`; `APP/screens/Main/Main.js:166` (filtered by `shopType.toLowerCase()` of `'restaurant'` or `'grocery'`, `:378-383`) |
| `Cuisines` (web)                                   | `attachedCuisines` → same shape                                                                                                                                                                         | defined but never called (import commented out, `WEB/lib/hooks/useGetCuisines.tsx:3`)                                                                            | `WEB/.../cuisines/index.ts:3-13`                                                                                                                    |
| `Banners`                                          | `banners` → `{_id title description action screen file parameters slug shopType}` (`slug` and `shopType` are web only)                                                                                  | —                                                                                                                                                                | `APP/apollo/queries.js:1256-1266`; `WEB/lib/api/graphql/queries/banner/index.ts:3-17`                                                               |
| `FetchAllShopTypes`                                | `fetchAllShopTypes` → `{data{_id image name slug}}`                                                                                                                                                     | —                                                                                                                                                                | `APP/apollo/queries.js:1317-1328`; `WEB/.../shop-type/index.ts:2-14`                                                                                |
| `Zones`                                            | `zones` → `[{_id title description location{coordinates} isActive}]`                                                                                                                                    | —                                                                                                                                                                | `APP/apollo/queries.js:1268-1276`; `APP/context/Location.js:30-35`; `WEB/lib/context/Location/Location.context.tsx:30-77`                           |
| `getCountries` / `getCitiesByCountry(id:ID)`       | `{_id name flag}` / `{id name cities{id name latitude longitude}}`                                                                                                                                      | web component appears **unused** (no import of `Cities` found)                                                                                                   | `WEB/lib/api/graphql/queries/Countries/index.ts:3-27`                                                                                               |
| `GetCountryByIso`                                  | `getCountryByIso(iso:String!){cities{id name latitude longitude}}`                                                                                                                                      | **defined, never imported** in the multivendor app                                                                                                               | `APP/apollo/queries.js:413-422`                                                                                                                     |
| `UserFavourite`                                    | `userFavourite(latitude:Float, longitude:Float)` → restaurants (full menu shape)                                                                                                                        | app: `{lat, lng}` (`APP/screens/Favourite/Favourite.js:50-58`); web: `{}`                                                                                        | `APP/apollo/queries.js:981-1039`; `WEB/.../profile/index.ts:27-107`                                                                                 |

Defined in the app but **not used** (low priority; implement for schema completeness):

- `nearByRestaurants` (`queries.js:709-799`)
- `topRatedVendors`, `recentOrderRestaurants`, `mostOrderedRestaurants` (non-preview forms, `:850-871, 1168-1191, 1202-1225`)
- `taxes` (`:965-971`)
- `subCategoriesByParentId` (`:1308-1316`)
- `users` (`:3-9`)
- the `Restaurant`/`Order` fragments (`:114-352, 1041-1113`)

### 3.2 How lat/lng and shopType are passed

- **App latitude/longitude** come from `LocationContext.location.{latitude, longitude}` (numbers). They are `|| null` when unset (`APP/screens/Main/Main.js:110-116`, `APP/ui/hooks/useRestaurantQueries.js:101-123`).
  - **The app can send `latitude:null` to `topRatedVendorsPreview` and `mostOrderedRestaurantsPreview`**, whose variables are declared `Float!`. Apollo will error client-side. Nothing to do server-side.
  - The Main screen gating query uses `{shopType:null, page:1, limit:1}` (`Main.js:110-126`). An empty result shows "We are currently not available in your location" (`:540-556`).
  - Rails use `limit: 20` pages (`useRestaurantQueries.js:80`).
  - Search uses **no page/limit** (`APP/screens/Search/SearchScreen.js:90-98`). The server must apply a sane default and maximum.
- **Web latitude/longitude** come from `userAddress.location.coordinates` (`[0]` = longitude, `[1]` = latitude), defaulting to 0.
  - Limits used: 6 (discovery), 10 (lists and infinite scroll), 100 (search), 109 (cuisine filter), 110 (map).
- **`shopType`** is either:
  - `null` (all types);
  - `'restaurant'` or `'grocery'` (the app's built-in rails, `Main.js:189`, `useRestaurantOrderInfo.js:36`);
  - **a `ShopType.slug`** (shop-type rail: `navigation.navigate('Store', {collection: item.slug, isShopType:true})`, `Main.js:425-431`; web `/shop-type/[slug]`).
  - **The server must match `restaurant.shopType` against these slugs, case-insensitively.** UNVERIFIED: whether `shopType` on a restaurant holds the slug or the display name. The clients compare `cuisine.shopType.toLowerCase()` against `'restaurant'`/`'grocery'`.
- **Cuisine filter (web).** A cuisine page filters `restaurant.cuisines` (an array of cuisine **name strings**) client-side (`WEB/lib/ui/.../cuisine-selection/main/index.tsx:41-47`). `cuisines` on restaurants must be `[String]` names.

### 3.3 Restaurant preview shapes (fields the server must return)

**`RestaurantPreview`** (items of `nearByRestaurantsPreview.restaurants`):

- `_id name image logo deliveryTime minimumOrder isAvailable isActive tax shopType cuisines tags reviewCount reviewAverage freeDelivery acceptVouchers slug location{coordinates} openingTimes{day times{startTime endTime}}`
- App: `APP/apollo/queries.js:813-838`. Web: `WEB/.../restaurants/index.ts:27-52`.

**`RestaurantCarouselPreview`:**

- `_id name image logo slug deliveryTime minimumOrder tax isAvailable isActive shopType tags cuisines reviewCount reviewAverage location{coordinates} openingTimes{…}`
- App: `APP/apollo/queries.js:361-386`. Web: `WEB/.../restaurants/index.ts:58-83`.

**`offers` / `sections`:** `{_id name tag restaurants}` / `{_id name restaurants}`, where `restaurants` is `[String]` ids (`APP/apollo/queries.js:802-812`). Not rendered on the paths traced. Returning empty arrays is acceptable.

### 3.4 Semantics

- **Open status** is computed client-side as `isOpen(r) = r.isAvailable && openingTimes non-empty && now within a slot for today` (`APP/utils/customFunctions.js:100-122`). Web also requires `isActive !== false`.
  - Open restaurants are sorted first (`sortRestaurantsByOpenStatus`, `:125-131`).
  - The server should not hide closed restaurants. It should hide `isActive:false` restaurants and restaurants outside the customer's zone or `deliveryBounds`. UNVERIFIED policy; recommended.
- **`isAvailable`** is the store's "accepting orders" toggle. **`isActive`** is admin/platform enablement.
- **Distance is never read from the server.**
  - App: `distanceWithCurrentLocation` is computed on the client.
  - Web shows no distance. Checkout recomputes a haversine distance (§5.4).
- **`deliveryTime`** is shown as "N min" (an integer number of minutes). It also sets the minimum scheduled time (`APP/components/Pickup/index.js:36`).
- **Ratings:**
  - `reviewAverage` (Float) and `reviewCount` (Int) are shown raw on cards (`APP/components/Main/RestaurantCard/NewRestaurantCard.js:193,226`; `APP/components/Main/TopBrands/BrandCard.js:61`).
  - `reviewData.ratings` is the **average rating** and `reviewData.total` the **count** (`APP/components/Restaurant/ImageHeader/ImageHeader.js:127-135`).
- **Banners:**
  - App: `action === 'Navigate Specific Restaurant'` navigates to `Restaurant {_id: banner.screen}`, so **`screen` holds the restaurant `_id`**. Otherwise `screen ∈ {'Near By Restaurants','Grocery List','Top Brands'}` maps to a list screen (`APP/components/Main/Banner/Banner.js:14-28`; `APP/utils/banner-routes.js:1-17`).
  - Web: same, plus `/${shopType==='restaurant'?'restaurant':'store'}/${slug}/${screen}`. `file` containing `.mp4`, `.webm` or `video` is rendered as video. `parameters` is ignored.
- **Zones:** clients compute a centroid of `coordinates[0]` to list zones as "cities". Web uses `zone.title` as the address `details`. No client does point-in-polygon; the server must (§5).
- **Demo mode.** `configuration.enableCustomerDemoMode` and `customerDemoZoneId` make the app build a fake location at the demo zone's centroid, with `_id: "demo-zone:<zoneId>"` (`APP/utils/demoLocation.js:37-53`; `APP/context/Location.js:91-99`). See §5.3 for its effect on `placeOrder`.

---

## 4. Restaurant menu

### 4.1 Operations

| Op                                           | Root field (args)                                                                                                                                                                                                 | Selection                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Restaurant` (app)                           | `restaurant(id:String)`                                                                                                                                                                                           | `_id orderId orderPrefix name image logo address location{coordinates} deliveryTime minimumOrder tax reviewCount reviewData{total ratings} categories{_id title foods{_id title image subCategory description isOutOfStock variations{_id title price discounted addons}}} options{_id title description price} addons{_id options title description quantityMinimum quantityMaximum} zone{_id title tax} rating isAvailable openingTimes{day times{startTime endTime}} phone restaurantUrl cuisines stripeDetailsSubmitted shopType` | `APP/apollo/queries.js:873-946`; `APP/ui/hooks/useRestaurant.js:9-20`                                                                                                   |
| `RestaurantByIdAndSlug` (web)                | `restaurant(id:String, slug:String)` (both passed; slug from the URL, decoded)                                                                                                                                    | as the app, plus `isActive slug username phone`, `reviewData.reviews{_id order{user{_id name email}} rating description createdAt}`, `variations.isOutOfStock`, `options.isOutOfStock`                                                                                                                                                                                                                                                                                                                                                | `WEB/.../restaurants/index.ts:138-228`                                                                                                                                  |
| `popularItems`                               | `popularItems(restaurantId:String!)` → `[{id count}]`, **`id` = food `_id`**                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `APP/apollo/queries.js:1248-1254`; `APP/screens/Restaurant/Restaurant.js:104-151`; `WEB/.../restaurants/index.ts:277-284`                                               |
| `popularFoodItems`                           | `popularFoodItems(restaurantId:String!)` → `[Food{_id title description image subCategory isActive createdAt isOutOfStock variations{_id title price discounted addons isOutOfStock}}]`                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `APP/apollo/queries.js:1125-1144`; `APP/ui/hooks/useRestaurantScreenNewDesign.js:13-33`                                                                                 |
| `RelatedItems`                               | `relatedItems(itemId:String!, restaurantId:String!)` → `[String]` food ids                                                                                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `APP/apollo/queries.js:1227-1229`; `APP/components/ItemDetail/Section.js:27-46`; web cart `WEB/lib/ui/useable-components/cart/index.tsx:62-68` (`itemId = cart[0]._id`) |
| `fetchCategoryDetailsByStoreIdForMobile`     | `fetchCategoryDetailsByStoreIdForMobile(storeId:String!)` → `[{id category_name url food_id}]`                                                                                                                    | the app's mapper also tolerates `foods`/`items` arrays (`useRestaurantScreenNewDesign.js:35-44`)                                                                                                                                                                                                                                                                                                                                                                                                                                      | `APP/apollo/queries.js:1116-1123`                                                                                                                                       |
| `FetchCategoryDetailsByStoreId` (web stores) | `fetchCategoryDetailsByStoreId(storeId:String!)` → `[{id label url items{id label url}}]`                                                                                                                         | `url` must be `#<slug>`; parents are matched by `toSlug(label) === category id`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `WEB/.../restaurants/index.ts:260-275`                                                                                                                                  |
| `subCategories`                              | `subCategories` → `[{_id title parentCategoryId}]`, all subcategories, no args                                                                                                                                    | foods are grouped by `food.subCategory === sub._id`; subcategories by `parentCategoryId === category._id`                                                                                                                                                                                                                                                                                                                                                                                                                             | `APP/apollo/queries.js:1298-1306`; `WEB/.../restaurants/index.ts:286-294`                                                                                               |
| `GetReviewsByRestaurant`                     | `reviewsByRestaurant(restaurant:String!)` → `{reviews{_id rating description comments isActive createdAt updatedAt order{_id user{_id name email}} restaurant{_id name}} ratings total}` (`comments` is web only) | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `APP/apollo/queries.js:11-38`; `WEB/.../restaurants/index.ts:230-258`                                                                                                   |
| `AddFavourite`                               | `addFavourite(id:String!)` → User `{_id addresses{…}}`; **acts as a toggle**                                                                                                                                      | the clients refetch `profile` afterwards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `APP/apollo/mutations.js:294-306`; `APP/components/FavButton/useFavorite.js:16-31`; `WEB/lib/api/graphql/mutations/restaurant/index.ts:3-15`                            |

### 4.2 Menu data model as the UI uses it

- **`Food`**: `variations[]`. `variation.addons` is `[String]`, ids into `restaurant.addons`.
- **`Addon`**: `options` is `[String]`, ids into `restaurant.options`. It carries `quantityMinimum` and `quantityMaximum` (Int).
  - Item detail resolves the ids: `APP/screens/ItemDetail/ItemDetail.js:38-50`; web `item-detail/index.tsx:68-77`.
- **`Option`**: `{_id title description price isOutOfStock}`.
- **`variation.price`** is the **selling price**. **`variation.discounted`** is the _discount amount_: the strikethrough price is `price + discounted` (`APP/screens/Restaurant/Restaurant.js:807-809`).
- **Addon validation on the client:**
  - When `quantityMinimum === 0`, no selection is allowed.
  - Otherwise the count must be between `quantityMinimum` and `quantityMaximum`.
  - `quantityMaximum === 1` renders as single-select.
  - Sources: `APP/screens/ItemDetail/ItemDetail.js:145-156,307-325`; web `item-detail/index.tsx:97-128,363`.
- **Out of stock.** `isOutOfStock` foods cannot be opened (`APP/screens/Restaurant/Restaurant.js:470`; web `restaurant/index.tsx:315`).
- **Server rules:**
  - Ids must be globally unique, because the cache key is `Food:<_id>`.
  - `popularItems` and `relatedItems` must return only food ids that belong to that restaurant and are currently active. The client renders them via cache reads, so the foods must also appear in the `restaurant` query.
  - `addFavourite` toggles the caller's `favourite` set.
  - `reviewsByRestaurant` returns only active reviews. `ratings` is the average and `total` the count.

---

## 5. Cart and checkout

### 5.1 Client cart structure (never sent as-is)

- **App** (`APP/context/User.js`, `addCartItem`):
  - Item: `{key: uuidv1, _id: foodId, quantity, variation:{_id}, addons:[{_id: addonId, options:[{_id}]}], specialInstructions}`.
  - Stored in AsyncStorage under the mode-scoped keys `cartItems`, `restaurant` and `coupon`.
  - `populateCart` adds display `price` = variation price + sum of option prices, `toFixed(2)` (`APP/utils/populateCart.js:1-46`). It drops items whose food or variation no longer exists.
- **Web** (`WEB/lib/context/User/User.context.tsx:64-88,751-761`):
  - Same shape, with a `v4` key and `specialInstructions: ""`.
  - Stored under `@enatega/multi/cartItems` and `@enatega/multi/restaurant`.
  - Price comes from `transformCartWithFoodInfo` (`:327-394`).
- **One restaurant per cart.** Adding an item from another restaurant clears the cart.

### 5.2 `placeOrder` — the exact document (both apps)

```graphql
mutation PlaceOrder($restaurant:String!, $orderInput:[OrderInput!]!, $paymentMethod:String!, $couponCode:String,
  $tipping:Float!, $taxationAmount:Float!, $address:AddressInput!, $orderDate:String!, $isPickedUp:Boolean!,
  $deliveryCharges:Float!, $instructions:String) {
  placeOrder(restaurant:$restaurant, orderInput:$orderInput, paymentMethod:$paymentMethod, couponCode:$couponCode,
    tipping:$tipping, taxationAmount:$taxationAmount, address:$address, orderDate:$orderDate, isPickedUp:$isPickedUp,
    deliveryCharges:$deliveryCharges, instructions:$instructions) { ... }
}
```

- **App** (`APP/apollo/mutations.js:27-104`) selects:
  - `_id orderId`
  - `restaurant{_id name image address location{coordinates}}`
  - `deliveryAddress{location{coordinates} deliveryAddress id}`
  - `items{_id title food description image quantity variation{_id title price discounted} addons{_id options{_id title description price} title description quantityMinimum quantityMaximum}}`
  - `user{_id name phone}`, `rider{_id name}`, `review{_id}`
  - `paymentMethod paidAmount orderAmount orderStatus orderDate expectedTime isPickedUp tipping taxationAmount createdAt completionTime preparationTime deliveryCharges acceptedAt pickedAt deliveredAt cancelledAt assignedAt instructions discountAmount`
- **Web** (`WEB/lib/api/graphql/mutations/orders/index.ts:3-106`) selects the same core, plus `restaurant.slug` and `eta{…}`, minus `instructions` and `discountAmount`.
- Note: the app's `onCompleted` reads `placeOrder.user.email` for analytics and Stripe (`Checkout.js:404-407,447`), but `email` is not selected, so it is undefined.

**Variables as built:**

- App: `APP/screens/Checkout/Checkout.js:547-615`.
- Web: `WEB/lib/ui/screens/protected/order/checkout/index.tsx:488-503,737-764`.

| Variable          | App value                                                                                                                                                                                                                                            | Web value                                                                                                                 | Server must                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restaurant`      | cart restaurant id                                                                                                                                                                                                                                   | `useUser().restaurant`                                                                                                    | validate: exists, active, `isAvailable`, open now (or at `orderDate`), in zone                                                                                                                                                                                                                                                                |
| `orderInput`      | `[{food, quantity, variation, addons:[{_id, options:[optionId]}], specialInstructions}]`                                                                                                                                                             | identical shape                                                                                                           | validate every id belongs to this restaurant; food active and not out of stock; variation belongs to food; addon is in `variation.addons`; option is in `addon.options`; option count within `[quantityMinimum, quantityMaximum]`; required addons present; `quantity` is a positive integer; **build item snapshots and prices from the DB** |
| `paymentMethod`   | `'COD' \| 'PAYPAL' \| 'STRIPE'` (`Checkout.js:109,815-845`; STRIPE only if `restaurant.stripeDetailsSubmitted`)                                                                                                                                      | `'COD' \| 'STRIPE'` (`WEB/lib/utils/constants/global.ts:56-67`)                                                           | allow-list; STRIPE requires the restaurant to be Stripe-enabled; currency in the allowed list                                                                                                                                                                                                                                                 |
| `couponCode`      | **`coupon.title`** (not the typed code) (`Checkout.js:575`)                                                                                                                                                                                          | `coupon.title`                                                                                                            | look up by title/code (upstream coupons use title == code. UNVERIFIED); re-validate enabled, restaurant scope, expiry, usage limits                                                                                                                                                                                                           |
| `tipping`         | selected `tipVariations` value or custom positive amount; 0 for pickup                                                                                                                                                                               | `+selectedTip`. **"Other" sends `NaN`, which serialises as null and fails `Float!`** (agent trace, `index.tsx:1270-1290`) | validate ≥ 0 and below a cap; tip is the customer's choice, so it is accepted but bounded                                                                                                                                                                                                                                                     |
| `taxationAmount`  | client-computed (§5.4)                                                                                                                                                                                                                               | client-computed                                                                                                           | **recompute; ignore the client value**                                                                                                                                                                                                                                                                                                        |
| `address`         | `{label, deliveryAddress, details, latitude:"<num>", longitude:"<num>", isDemoDefaultLocation, demoZoneId}`; pickup: `{label:'Current Location', deliveryAddress:'Pickup', details:'User will pick up the order', lat, lng}` (`Checkout.js:581-610`) | `{label, deliveryAddress, details, longitude:"<coords[0]>", latitude:"<coords[1]>"}`                                      | parse coordinates; for delivery, point-in-zone and within `deliveryBounds`; **ignore `isDemoDefaultLocation`/`demoZoneId` unless server-side demo mode is enabled and `demoZoneId === configuration.customerDemoZoneId`**                                                                                                                     |
| `orderDate`       | JS `Date` (ISO via JSON). Default now; user can pick a time ≥ now + `restaurant.deliveryTime` min (`APP/components/Pickup/index.js:36-49`)                                                                                                           | `new Date()` (no scheduling UI)                                                                                           | parse ISO; reject past or too-far-future; treat > now + threshold as scheduled (UNVERIFIED threshold)                                                                                                                                                                                                                                         |
| `isPickedUp`      | Boolean (pickup)                                                                                                                                                                                                                                     | Boolean                                                                                                                   | pickup ⇒ deliveryCharges = 0, tip optional; app forces tip to 0 for pickup                                                                                                                                                                                                                                                                    |
| `deliveryCharges` | client-computed; 0 if pickup                                                                                                                                                                                                                         | client-computed                                                                                                           | **recompute; ignore the client value**                                                                                                                                                                                                                                                                                                        |
| `instructions`    | free text (`UserContext.instructions`)                                                                                                                                                                                                               | always `""` in practice (localStorage key mismatch)                                                                       | sanitise; length cap                                                                                                                                                                                                                                                                                                                          |

The web "leave at door" checkbox is never sent (`index.tsx:99,1118-1124`).

### 5.3 Error strings the client matches

- The app opens the "wrong address" modal **only** for these exact messages (`APP/screens/Checkout/Checkout.js:454-458`):
  - `"Sorry! we can't deliver to your address."`
  - `"Delivery zone not found"`
  - Use exactly these strings for out-of-zone or out-of-bounds failures.
- Other GraphQL errors are not shown by the app (the `else` branch handles only non-GraphQL errors).
- Web shows `graphQLErrors[0].message` verbatim.

### 5.4 Client-side computations the server must reproduce authoritatively

App: `APP/utils/orderPricing.js:1-15`, `APP/screens/Checkout/Checkout.js:260-311`. Web: `index.tsx:461-482,847-891`.

```
lineUnit       = variation.price + Σ selected option.price           (NOT `discounted`)
subtotal       = Σ lineUnit × quantity
discountAmount = subtotal × coupon.discount / 100                     (coupon.discount is a PERCENT; items only)
discounted     = subtotal − discountAmount
distanceKm     = haversine(R=6371) between restaurant [lng,lat] and delivery point    (straight line)
delivery       = costType === 'fixed' ? deliveryRate : ceil(distanceKm) × deliveryRate
delivery       = delivery > 0 ? delivery : deliveryRate                (app fallback, Checkout.js:304)
delivery       = isPickedUp ? 0 : delivery
taxationAmount = round2((discounted + delivery) × restaurant.tax / 100)   (tip excluded; uses restaurant.tax only, NOT zone.tax or `taxes`)
total          = discounted + delivery + taxationAmount + tip
minimum-order check: (discounted + delivery) >= restaurant.minimumOrder   (Checkout.js:505)
```

- **Delivery-fee source.** `configuration.costType` and `deliveryRate` drive the client figure. FairBite's provider-independent delivery routing may produce a different fee. **Server rule:** compute `deliveryCharges` server-side, store it, and return it.
  - UNVERIFIED decision for the lead: either reject when the client value differs beyond a tolerance, or accept and override. The order detail screen shows the server values, so overriding is UI-safe, but the customer saw a different total at checkout.
- **Display rounding.** Web shows delivery rounded to whole units (`toFixed()`); the app shows 2 dp.
- **Taxes query.** `taxes{_id taxationCharges enabled}` is defined but unused (`APP/apollo/queries.js:965-971`). Tax comes from `restaurant.tax`, a percent.
- **Tips.** `tips{_id tipVariations enabled}`; web selects only `tipVariations` (`APP/apollo/queries.js:973-979`, `WEB/.../tipping/index.ts:3-9`).
  - **`tipVariations` are fixed currency amounts**, rendered as `{currencySymbol} {value}` (`Checkout.js:912-934`), not percentages.
  - The app cart preselects `tipVariations[1]` (`APP/screens/Cart/Cart.js:94-102`).
  - `enabled` is ignored by the UI.

### 5.5 Coupon

- **Document:** `coupon(coupon:String!, restaurantId:ID!) { success message coupon{_id title discount enabled} }` (`APP/apollo/mutations.js:125-136`; `WEB/.../coupon/index.ts:3-17`).
- **App handling** (`Checkout.js:200-235`):
  - `coupon.coupon.enabled` true: applied and stored.
  - `coupon.coupon` present but disabled: "coupon failed".
  - No `coupon.coupon`: shows `coupon.message`.
- **Web** requires `success && coupon.enabled`.
- **Server:**
  - Return `success:false` with a human `message` and `coupon:null` for invalid, expired, other-restaurant or limit-reached coupons.
  - Return `discount` as a percent.
  - Re-validate at `placeOrder`. Never trust the client's applied state.

### 5.6 What the server must RECOMPUTE (never trust)

Every money field: line prices, `subtotal`, `discountAmount`, `taxationAmount`, `deliveryCharges`, `orderAmount`.

`tipping` is accepted from the client but bounded. Recomputed or derived values:

- `orderAmount` = grand total, _including_ tip, tax and delivery, minus discount. The app derives the subtotal as `orderAmount − tipping − taxationAmount − deliveryCharges + discountAmount` (`APP/screens/OrderDetail/OrderDetail.js:367`).
- `paidAmount`: 0 for COD or unpaid; equals the captured amount after a Stripe or PayPal capture.
- `paymentStatus`: `'PENDING'` (UNVERIFIED literal) to `'PAID'`.
- Item snapshot titles and prices; `orderId` (human id, with `orderPrefix`); `orderStatus = 'PENDING'`; `createdAt`, `orderDate`, `expectedTime`, `preparationTime`, `completionTime`, `eta`.
- Open/available/zone checks, minimum order, phone verification (§1.7), user `isActive`.

### 5.7 Stripe and PayPal handoff

**After `placeOrder` resolves** (`APP/screens/Checkout/Checkout.js:398-451`; web `index.tsx:774-816`):

- **COD:**
  - App: navigates to `OrderDetail {_id, order}`, clears the cart, starts a Live Activity (if not pickup).
  - Web: `router.replace('/order/<_id>/tracking')`, clears the cart.
- **STRIPE (app)** (`APP/screens/Stripe/StripeCheckout.js:39-190`):
  - Opens a WebView at `GET ${SERVER_REST_URL}stripe/create-checkout-session?id=<placeOrder.orderId>`, with header `Authorization: Bearer <userJWT>`. The `id` is the **human `orderId`**, not `_id`.
  - Navigation is allowed only to Stripe hosts and the **backend host**.
  - Success is detected when the URL contains `stripe/success`; cancel when it contains `stripe/cancel` (`:135-145`).
  - On success it polls `orders` (no args, network-only) every 3 s, up to 20 times. It looks for `order.orderId === id` with `paymentStatus.toUpperCase() === 'PAID' || paidAmount > 0` (`:85-128`), then clears the cart and opens `OrderDetail`.
- **STRIPE (web):**
  - Top-level browser navigation (**no Authorization header**) to `new URL('stripe/create-checkout-session?id=<orderId>&platform=web', SERVER_URL)`.
  - The cart is not cleared. It stores raw `localStorage` `pending_stripe_order_id` and `pending_stripe_started_at`.
  - The success page `/stripe/success` (on the web origin) reads `?id|orderId|reference`. It polls `orders(page:1, limit:300)` every 3 s for 60 s, matching `orderId` or `_id` (`WEB/lib/ui/screens/protected/order/stripe-success/index.tsx:37-153`).
  - `/stripe/cancel` is static.
- **Backend REST contract for Stripe** (from the above):
  1. `GET /stripe/create-checkout-session?id=<orderId>[&platform=web]` creates a Stripe Checkout Session for the server-computed `orderAmount` and responds with a 302 to the session URL.
     - It must authenticate the caller. The app sends a bearer header; **web sends none**, so web needs another binding: a short-lived signed checkout token. UNVERIFIED design; the current client sends only `id`. Either accept the risk that the order id identifies the order and the server then only redirects to a payment for that order's fixed amount, or flag it as a blocker.
     - It must check that the order belongs to the caller, is unpaid, and has `paymentMethod: STRIPE`.
  2. `success_url`:
     - `platform=web`: `<WEB_ORIGIN>/stripe/success?id=<orderId>`.
     - App: a **backend-host** URL containing `stripe/success`, because the WebView blocks other hosts.
     - `cancel_url` is analogous, with `stripe/cancel`.
  3. A Stripe **webhook** (not the redirect) marks the order `paymentStatus:'PAID'` and `paidAmount` = the amount, then releases it to the store and fires the subscriptions (§6.4).
  4. `subscriptionPaymentSuccess` is **not used** by either customer app (searched; no hits outside docs).
- **PAYPAL (app only)** (`APP/screens/Paypal/Paypal.js:39-160`):
  - WebView at `${SERVER_URL}paypal?id=<placeOrder.orderId>`.
  - **`SERVER_URL` is configured as `https://…/graphql` in `enatega-multivendor-app/environment.config.js:10`, so the literal URL is `…/graphqlpaypal?id=…`.** Fix through configuration: set `SERVER_URL` to the REST base with a trailing slash, an allowed config change recorded in provenance. Do not make the server serve `/graphqlpaypal`.
  - Allowed hosts: PayPal domains and the backend host.
  - Success when the URL contains `paypal/success`; cancel when it contains `paypal/cancel`.
  - It then runs the same `orders` polling as Stripe.
  - Web never offers PayPal; its post-order PayPal branch routes to `/paypal`, which does not exist.
- **Client currency allow-lists:** `stripeCurrencies` and `paypalCurrencies` (`APP/utils/currencies`; `WEB/lib/utils/constants/currencies.ts`). The server should apply the same check.
- **Unpaid orders are hidden.** The app's Active Orders strip shows an order only if `paymentStatus === 'PAID' || paymentMethod === 'COD'` (`APP/components/Main/ActiveOrders/ActiveOrders.js:60-66`). So an unpaid STRIPE/PAYPAL order must not be treated as live by stores until paid. UNVERIFIED policy, implied by the UI.
- **Live Activities** start for COD immediately, and for card payments after the paid poll succeeds.
- Missing Stripe/PayPal credentials and webhook secrets are **blockers**, not grounds for mock success.

---

## 6. Order tracking

### 6.1 Queries

| Op                                            | Root field (args)                                                                      | Selection                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Used by                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Orders` (app)                                | `orders(offset:Int)`                                                                   | full order body incl. `paymentStatus discountAmount instructions eta` (`APP/apollo/queries.js:501-587`)                                                                                                                                                                                                                                                                                                                                                                | Stripe/PayPal polling only (no args)                                                                                    |
| `Orders` (web)                                | `orders(page:Int, limit:Int)`                                                          | same + `restaurant{slug shopType}` (`WEB/.../orders/index.ts:3-99`)                                                                                                                                                                                                                                                                                                                                                                                                    | user context `{page:1, limit:300}`; `fetchMore {offset}` is sent but undeclared                                         |
| `GetUsersActiveOrders` / `GetUsersPastOrders` | `getUsersActiveOrders(page:Int!, limit:Int!, offset:Int!)` / `getUsersPastOrders(...)` | same body (`APP/apollo/queries.js:594-687`; `WEB/.../orders/index.ts:102-296`)                                                                                                                                                                                                                                                                                                                                                                                         | app `{page, limit:10, offset:0}` (`APP/context/Orders.js:31,70-96`); web limit 5                                        |
| `Order`                                       | `order(id:String!)`                                                                    | `_id orderId deliveryAddress{location{coordinates} deliveryAddress details label id} restaurant{_id name image address location{coordinates}} items{title food description image quantity variation{title price discounted} addons{title options{title description price}}} user{_id name email} paymentMethod orderAmount orderDate expectedTime isPickedUp deliveryCharges acceptedAt pickedAt deliveredAt cancelledAt assignedAt` (`APP/apollo/queries.js:424-480`) | review sheet (`APP/components/Review/index.js:58-75`)                                                                   |
| `OrderDetails` (web)                          | `orderDetails(id:String!)`                                                             | full body + `restaurant{slug shopType}`, `selectedPrepTime`, `eta{… origin{latitude longitude} destination{latitude longitude}}` (`WEB/.../order-tracking/index.ts:3-111`)                                                                                                                                                                                                                                                                                             | web tracking page                                                                                                       |
| `OrderTracking`                               | `orderTracking(id:ID!)`                                                                | `orderId status riderLocation{latitude longitude accuracy heading speed recordedAt} eta{phase source readyAt baseArrivalAt estimatedArrivalAt windowStartAt windowEndAt durationSeconds distanceMeters encodedPolyline [origin{latitude longitude} destination{latitude longitude}] calculatedAt lastLocationAt version}` (`APP/apollo/queries.js:490-499`; `WEB/.../order-tracking/index.ts:113-145`)                                                                 | app when status ∈ {ASSIGNED, PICKED} (`APP/screens/OrderDetail/OrderDetail.js:237-248`); web when ∈ {PICKED, ON_ROUTE}  |
| `Rider`                                       | `rider(id:String)` (web `String!`; server: nullable)                                   | `_id location{coordinates}`                                                                                                                                                                                                                                                                                                                                                                                                                                            | `APP/components/OrderDetail/TrackingRider/TrackingRider.js` (component not mounted anywhere found); web `queries/rider` |

**Order "full body"** = the union of the selections above:

- `_id orderId id`
- `restaurant{_id name image slug shopType address location{coordinates}}`
- `deliveryAddress{location{coordinates} deliveryAddress details label id}`
- `items{_id id title food description quantity image variation{_id id title price discounted} addons{_id id options{_id id title description price} title description quantityMinimum quantityMaximum}}`
- `user{_id name phone email}`, `rider{_id name phone}`, `review{_id rating description}`
- `paymentMethod paidAmount orderAmount orderStatus paymentStatus tipping taxationAmount discountAmount createdAt completionTime preparationTime selectedPrepTime orderDate expectedTime isPickedUp deliveryCharges acceptedAt pickedAt deliveredAt cancelledAt assignedAt instructions reason`
- `eta{…}`

### 6.2 Active vs past (server splits; clients re-filter)

- **App:**
  - `ACTIVE_ORDER_STATUSES = {PENDING, ACCEPTED, ASSIGNED, PICKED, ON_ROUTE}`. Everything else is past (`APP/context/Orders.js:32,112-123`).
  - Pagination stops when a page returns fewer than `page*limit` items.
- **Web:** terminal = `{DELIVERED, COMPLETED, CANCELLED}`; everything else is active (order-history `index.tsx:102-132`).
- **Server:**
  - `getUsersActiveOrders` returns the caller's orders with status in `{PENDING, ACCEPTED, ASSIGNED, PICKED, ON_ROUTE}`.
  - `getUsersPastOrders` returns `{DELIVERED, COMPLETED, CANCELLED, CANCELLEDBYREST}`.
  - Both are sorted newest first, with `page` 1-based and `offset` 0 as sent.
  - `orders` with no args must include the newest orders, so payment polling finds the just-placed order. Recommend a default limit of 50 or more, newest first.

### 6.3 Status values and what the UI shows

| Status            | App (`OrderDetail.js:97-116`, `OrderStatusTimeline.js:10-35`, `ActiveOrders/ProgressBar.js:10-51`)                                               | Web (`tracking-status-card.tsx:32-146`, `order-card/index.tsx:34-50`) |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `PENDING`         | "Waiting for the store to confirm your order."; **cancel button shown**                                                                          | "Waiting for store confirmation"; **cancel allowed**                  |
| `ACCEPTED`        | "being prepared — expected ready by `eta.readyAt`"                                                                                               | minutes until `eta.readyAt`                                           |
| `ASSIGNED`        | "rider has been assigned"; tracking query and subscription on; chat card if `rider`                                                              | "Rider assigned · window"                                             |
| `PICKED`          | "on the way" / "Rider location temporarily unavailable" if `riderLocation.recordedAt` is older than 90 s; tracking on                            | same; live map; **chat button appears**                               |
| `ON_ROUTE`        | counted as active only; no specific text (falls to "no longer active")                                                                           | same as PICKED; progress step between PICKED and DELIVERED            |
| `DELIVERED`       | "delivered"; triggers the review prompt if `!order.review`                                                                                       | all steps complete; rating modal after 4 s                            |
| `COMPLETED`       | delivery: treated as delivered (last step). **Pickup timeline: "Ready for collection" step _before_ DELIVERED** (`OrderStatusTimeline.js:17-22`) | terminal, all complete                                                |
| `CANCELLED`       | timeline reset; "cancelledOn `cancelledAt \|\| completionTime`"                                                                                  | shows `reason`                                                        |
| `CANCELLEDBYREST` | app only: treated as cancelled                                                                                                                   | unknown to web (renders inactive/"Processing")                        |

**ETA usage:**

- App: `eta.estimatedArrivalAt`, falling back to `completionTime`, for the remaining-minutes counter (`APP/utils/customFunctions.js:36-45`); `windowStartAt`–`windowEndAt` are shown for non-terminal, non-pending statuses (`OrderDetail.js:432-437`); `readyAt` for preparation text; `encodedPolyline` is decoded and trimmed to the rider (`:264-269`).
- Web: `windowStartAt`/`windowEndAt`, `readyAt`, `lastLocationAt`, and `encodedPolyline` (precision 1e5).

### 6.4 Subscriptions (server must publish)

| Subscription                | Args                                        | Payload selection                                                                                                                                                                                                                             | Fire when                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscriptionOrder`         | `(id:String!)` (order `_id`)                | `_id orderStatus rider{_id} completionTime preparationTime isPickedUp acceptedAt assignedAt pickedAt deliveredAt cancelledAt eta{… origin destination …}` (`APP/apollo/subscriptions.js:1-16`; `WEB/.../subscription/orders/index.ts:90-116`) | any status or timestamp change, rider assignment, ETA recalculation of that order                                                                                                                                                                                                                    |
| `orderStatusChanged`        | `(userId:String!)`                          | `userId origin order{full body}` (`APP/apollo/subscriptions.js:40-128`; `WEB/.../subscription/orders/index.ts:3-88`)                                                                                                                          | new order (`origin: "new"`: web inserts it at the top) and every status change (`origin` any other value, e.g. `"update"`; merged in place). App refetches both lists on any payload (`APP/context/Orders.js:217-243`). **Only deliver to the user whose id matches the authenticated socket user.** |
| `subscriptionOrderTracking` | `(id:String!)` (note: the query uses `ID!`) | `orderId status riderLocation{…} eta{…}`                                                                                                                                                                                                      | rider location update or ETA change while ASSIGNED/PICKED/ON_ROUTE                                                                                                                                                                                                                                   |
| `subscriptionRiderLocation` | `(riderId:String!)`                         | `_id location{coordinates}`                                                                                                                                                                                                                   | rider location (component unmounted in the app; implement for completeness)                                                                                                                                                                                                                          |
| `subscriptionNewMessage`    | `(order:ID!)`                               | `id message image user{id name} createdAt`                                                                                                                                                                                                    | each chat message on the order                                                                                                                                                                                                                                                                       |

- **Status-rank merge.** The app ignores out-of-order regressions using the rank PENDING 1, ACCEPTED 2, ASSIGNED 3, PICKED 4, DELIVERED 5, COMPLETED 6, CANCELLED/CANCELLEDBYREST 7 (`OrderDetail.js:60-87`). The server must never move a status backwards.
- **Socket authorisation.** Every subscription must check that the authenticated socket user owns the order (or is its rider). The `authorization` connection param is the only credential.

### 6.5 `abortOrder` (customer cancel)

- **Documents:**
  - App: `mutation($abortOrderId:String!){ abortOrder(id:$abortOrderId){_id orderStatus} }`. This operation is **anonymous** (`APP/apollo/mutations.js:395-401`).
  - Web: `AbortOrder($id:String!)` selecting `_id orderId orderStatus cancelledAt reason eta{…} restaurant{_id name} user{_id name} rider{_id name}` (`WEB/.../mutations/orders/index.ts:208-235`).
- **UI rule:** cancel is offered **only when `orderStatus === 'PENDING'`**, in both apps (`APP/screens/OrderDetail/OrderDetail.js:369-370`; web `tracking-order-details.tsx:133-136`).
- **Server rules:**
  - The caller must own the order, and the status must be PENDING. Otherwise throw with a human message; both apps show `error.message`.
  - Set `orderStatus: 'CANCELLED'`, `cancelledAt`, and `reason` (e.g. "Cancelled by customer").
  - If paid, start a refund. Provider-dependent; blocker without credentials.
  - Publish `subscriptionOrder` and `orderStatusChanged`, and notify the store and rider.

### 6.6 `reviewOrder`

- **Document:** `reviewOrder(reviewInput:{order:String!, rating:Int!, description:String, comments:String})`. Returns the order with `review{_id rating description}` and the full body (`APP/apollo/mutations.js:210-292`; `WEB/.../mutations/orders/index.ts:108-206`).
- **When:**
  - App: on `DELIVERED`/`COMPLETED` without a review (live subscription, or a foreground reconcile, `APP/context/Orders.js:131-180,237-239`), or from the RateAndReview screen.
  - Web: on `DELIVERED` in tracking and order history.
- **Ratings:** app 1–5 (`RateAndReview.js:93`). Web 1–5, plus `comments` = joined aspect tags and `description` ≤ 200 characters.
- **Server:**
  - The caller owns the order; the status is `DELIVERED` or `COMPLETED`; there is no existing review (one per order); the rating is an integer 1–5.
  - Update the restaurant aggregates: `reviewData.ratings` (average), `total`, `reviewCount`, `reviewAverage`, `rating`.

### 6.7 Chat with rider

- `chat(order:ID!)` → `[{id message image user{id name} createdAt}]`, **newest first**. The app prepends live messages; web reverses then appends (`APP/apollo/queries.js:1146-1157`; `APP/screens/ChatWithRider/useChatScreen.js:22-63,128-143`).
- `sendChatMessage(message:ChatMessageInput!, orderId:ID!)` → `{success message data{id message image user{id name} createdAt}}` (`APP/apollo/mutations.js:9-25`).
  - **`ChatMessageInput` = `{message:String, image:String, user:{id:String, name:String}}`.** Web hard-codes `name:"You"`.
  - **The server must ignore `user` and use the authenticated identity.**
  - `success:false` with `message` shows an error alert.
- `subscriptionNewMessage(order:ID!)` fires for both parties. The app marks a message unread when `msg.user.id !== profile._id` (`OrderDetail.js:207-216`), so **`user.id` must be the sender's user `_id`**.
- **Availability:**
  - App: shows the chat card when `rider` is set and the status is not DELIVERED or CANCELLED (`APP/components/OrderDetail/Detail/Detail.js:19`).
  - Web: from PICKED onward.
  - Server: only the order's customer and assigned rider may read or send, and only while the order is active.
- **Image messages:** `uploadImageToS3(image:"data:image/jpeg;base64,…")` → `{imageUrl}`, then `sendChatMessage` with `image: imageUrl` (`APP/screens/ChatWithRider/useChatScreen.js:206-239`). See §8.

---

## 7. Support tickets

| Op                            | Document                                                                                                                                                                            | Source                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateSupportTicket`         | `createSupportTicket(ticketInput:SupportTicketInput!)` → `{_id title description status category orderId otherDetails createdAt updatedAt user{_id name email}}`                    | `APP/apollo/mutations.js:421-440`; `WEB/.../SupportTickets/index.ts:3-22`                                                                                         |
| `GetSingleUserSupportTickets` | `getSingleUserSupportTickets(input:SingleUserSupportTicketsInput!)` → `{tickets{…same, user{_id name email}} docsCount totalPages currentPage}`                                     | `APP/apollo/queries.js:40-64`                                                                                                                                     |
| `GetSingleSupportTicket`      | `getSingleSupportTicket(ticketId:ID!)` → ticket + `user{_id name email phone}`                                                                                                      | `APP/apollo/queries.js:66-86`                                                                                                                                     |
| `GetTicketMessages`           | `getTicketMessages(input:TicketMessagesInput!)` → `{messages{_id content senderType isRead createdAt updatedAt} ticket{_id title status user{_id name}} page totalPages docsCount}` | `APP/apollo/queries.js:88-113`                                                                                                                                    |
| `CreateMessage`               | `createMessage(messageInput:MessageInput!)` → `{_id content senderType isRead ticket createdAt updatedAt}`, where `ticket` is a scalar id                                           | `APP/apollo/mutations.js:442-454`                                                                                                                                 |
| `UpdateSupportTicketStatus`   | `updateSupportTicketStatus(input:UpdateSupportTicketInput!)` → `{_id status updatedAt}`                                                                                             | web only, **defined but never called** (`WEB/.../SupportTickets/index.ts:38-46`). Input fields UNVERIFIED. Likely `{ticketId, status}`; it is an admin operation. |

**Inputs as sent:**

- **`SupportTicketInput`** = `{title, description, category: "order related" | "others", userType: "User", orderId?, otherDetails?}`.
  - Order-related: `title = "Order Issue - <orderId>"`, `description = "Order ID: <orderId>\n\n<text>"`, `orderId` set.
  - Others: `otherDetails = title`.
  - Sources: `APP/components/Help/SupportTicketModal.js:85-114`; web `get-help/main/index.tsx:131-170`.
- **`SingleUserSupportTicketsInput`** = `{userId: profile._id, filters:{page:1, limit:10}}` (`APP/screens/CustomerSupport/CustomerSupport.js:37-46`).
- **`TicketMessagesInput`** = `{ticket: ticketId, page:1, limit:50}`. Polled every 3 s while open (app, `APP/components/Help/SupportChatModal.js:37-47`); web polls every 3 s plus a 5 s backup interval.
- **`MessageInput`** = `{content, ticket}`. No `senderType` is sent (`SupportChatModal.js:124-131`).

**Statuses and senders:**

- Status values: `"open"`, `"inProgress"`, `"closed"`. A closed ticket disables sending (`SupportChatModal.js:109,164`; `CustomerSupport.js:67,220-237`).
- `senderType`: `"user"` (customer) or `"admin"` (support), compared lowercased (`SupportChatModal.js:218-220`).

**Server rules:**

- Ignore `input.userId` and `userType`; use the authenticated user.
- One open or inProgress ticket per user. On a duplicate, throw a message matching `/already.*open ticket/i`, e.g. "You already have an open ticket". The app maps that regex (`SupportTicketModal.js:35-41`).
- If `orderId` is given, validate that the caller owns the order. UNVERIFIED whether `orderId` is the human `orderId` or `_id`; the user types it, so accept the human `orderId`.
- `createMessage` sets `senderType:'user'` server-side, checks ownership, and rejects when the ticket is closed.
- `createdAt`/`updatedAt` must be **epoch-ms strings** (§0.5).
- **Message ordering:** the app reverses the list (`SupportChatModal.js:105-108`), so return messages newest first.
- **Initial message (implied):** the app filters out any message whose content equals the ticket description. This suggests the server stores the description as the first message. UNVERIFIED; recommended.

---

## 8. Misc

- **`createActivity(groupId:String!, module:String!, screenPath:String!, type:String!, details:String!)`** → scalar (`APP/apollo/mutations.js:403-419`). **Defined, never called** by the customer apps. Implement as an authenticated, rate-limited audit insert, or leave it unimplemented. Low priority.
- **`registerLiveActivitySession(orderId:ID!, activityId:String!, platform:String!, pushToken:String!, schemaVersion:Int, language:String)`** and **`removeLiveActivitySession(orderId:ID!, activityId:String!)`** → `{success message}` (`APP/utils/liveActivityService.js:13-43`).
  - `platform` is `'IOS'` (an ActivityKit push token) or `'ANDROID'` (an FCM token from `messaging().getToken()`); `schemaVersion: 2`; `language` is `'ar'`, `'he'` or `'en'` (`:76-79,239-282`).
  - A GraphQL error stops the retries; network or 5xx errors retry at 0.75 s, 2 s and 5 s.
  - Content-state the app initialises (`:182-190`): `{schemaVersion:2, status:'PENDING', estimatedArrivalEpoch, etaUpdatedAtEpoch, riderName, riderPhone, language}`. The server should push updates in this shape.
  - **Server:** the caller must own the order. Store the session and push on status or ETA changes via APNs (liveactivity push type) or FCM. Remove the session at terminal statuses. APNs and FCM credentials are **blockers**.
- **`getVersions`** → `{customerAppVersion{android ios}}` (`APP/apollo/queries.js:1287-1296`; `APP/components/Update/ForceUpdate.js:20-75`). If the installed version is lower, a force-update modal appears. The `versions` query shape at `:1278-1284`, which selects scalar `customerAppVersion`, is unused; implement the object form. Web does not call it.
- **`configuration` vs `publicConfiguration`:**
  - Multivendor uses `configuration`. `publicConfiguration` is used only by the single-vendor branch (`APP/context/Configuration.js:13-31`).
  - **Union of fields read by the customer apps** (`APP/apollo/queries.js:689-707`; `WEB/lib/api/graphql/queries/config.ts:3-29`):
    - `_id currency currencySymbol deliveryRate costType ('fixed'|other=perKM)`
    - `twilioEnabled skipMobileVerification skipEmailVerification`
    - `appAmplitudeApiKey customerAppSentryUrl termsAndConditions privacyPolicy`
    - `publishableKey enableCustomerDemoMode customerDemoZoneId`
    - `webClientID webAmplitudeApiKey googleMapLibraries googleColor webSentryUrl clientId`
    - `firebaseKey authDomain projectId storageBucket msgSenderId appId`
  - Read but never queried (always undefined): `testOtp`, `googlePlacesApiBaseUrl`, `vapidKey`, `measurementId`.
  - The app's fallback when the query fails is `{deliveryRate:10, costType:'perKM'}` (`APP/context/Configuration.js:35-43`). Ensure `configuration` never fails for anonymous callers.
  - **`configuration` is fetched anonymously.** It must contain **only public values**: no secrets, no provider private keys. `publishableKey`, `clientId` and Firebase web config are public by design.
- **`uploadImageToS3(image:String!)`** → `{imageUrl}`. Input is a `data:image/jpeg;base64,…` string (`APP/apollo/mutations.js:3-7`).
  - The server must authenticate, validate MIME and magic bytes, cap the size, and store under a non-guessable key.
  - Return a URL the rider app can load.
  - Storage credentials are a blocker if absent.
- **`zones`, `banners`, `cuisines`, `fetchAllShopTypes`, `configuration`, `metricsGeneral`, and the discovery queries are called logged-out.** They must be readable with only the public token.

---

## 9. (a) Domain types and fields the customer apps read

Type names follow client fragments and type policies where known. Others are UNVERIFIED names.

- **AuthData** (`login`/`createUser`): `userId token tokenExpiration isActive name email phone phoneIsVerified emailIsVerified picture addresses{location{coordinates} deliveryAddress} isNewUser userTypeId`
- **User** (`profile` and mutations): `_id name phone phoneIsVerified email emailIsVerified notificationToken isActive isOrderNotification isOfferNotification addresses[Address] favourite[String]`
- **Address**: `_id label deliveryAddress details location{coordinates:[lng,lat]} selected`
- **Configuration**: see §8.
- **Zone**: `_id title description tax location{coordinates: Polygon} isActive`
- **Cuisine**: `_id name description image shopType`
- **ShopType** (wrapped in `{data:[…]}`): `_id image name slug`
- **Banner**: `_id title description action screen file parameters slug shopType`
- **RestaurantPreview**: §3.3
- **RestaurantCarouselPreview**: §3.3
- **Restaurant / RestaurantDetail**: `_id orderId orderPrefix name image logo address slug username phone restaurantUrl shopType isActive isAvailable location{coordinates} deliveryTime minimumOrder tax rating reviewCount reviewAverage reviewData{total ratings reviews[Review]} categories[Category] options[Option] addons[Addon] zone{_id title tax} openingTimes[OpeningTimes] cuisines[String] stripeDetailsSubmitted`
  - Also in `userFavourite`: `isActive`.
  - In the unused fragment: `owner{_id email} deliveryBounds{coordinates} notificationToken enableNotification sections`.
- **OpeningTimes**: `day times{startTime:[String] endTime:[String]}`
- **Category**: `_id title foods[Food]` (plus `createdAt updatedAt` in the unused fragment)
- **Food**: `_id title description image subCategory isActive isOutOfStock createdAt variations[Variation]`
- **Variation**: `_id title price discounted addons[String] isOutOfStock`
- **Addon**: `_id title description options[String] quantityMinimum quantityMaximum`
- **Option**: `_id title description price isOutOfStock`
- **SubCategory**: `_id title parentCategoryId`
- **PopularItem**: `id count`
- **CategoryDetails** (web): `id label url items{id label url}`
- **CategoryDetailsMobile**: `id category_name url food_id`
- **ReviewsResult**: `reviews[Review] ratings total`
- **Review**: `_id rating description comments isActive createdAt(epoch-ms) updatedAt order{_id user{_id name email}} restaurant{_id name}`
- **Tipping**: `_id tipVariations[Float] enabled`
- **Taxation** (unused): `_id taxationCharges enabled`
- **CouponResult**: `success message coupon{_id title discount enabled}`
- **Order**: the full body in §6.1.
- **OrderItem** (`Item`): `_id id title food description image quantity specialInstructions variation{_id id title price discounted} addons{_id id title description quantityMinimum quantityMaximum options{_id id title description price}}`
- **OrderEta**: `phase source readyAt baseArrivalAt estimatedArrivalAt windowStartAt windowEndAt durationSeconds distanceMeters encodedPolyline origin{latitude longitude} destination{latitude longitude} calculatedAt lastLocationAt version`
  - The values of `phase` and `source` are not interpreted by the customer UIs.
- **OrderTracking**: `orderId status riderLocation{latitude longitude accuracy heading speed recordedAt} eta[OrderEta]`
- **OrderStatusChangedPayload**: `userId origin order[Order]`
- **Rider** (in an order): `_id name phone`. The `rider` query adds `location{coordinates}`.
- **ChatMessage**: `id message image user{id name} createdAt`
- **ChatSendResult**: `success message data[ChatMessage]`
- **SupportTicket**: `_id title description status category orderId otherDetails createdAt updatedAt user{_id name email phone}`
- **SupportTicketsPage**: `tickets docsCount totalPages currentPage`
- **TicketMessage**: `_id content senderType isRead ticket createdAt updatedAt`
- **TicketMessagesPage**: `messages ticket{_id title status user{_id name}} page totalPages docsCount`
- **Versions**: `customerAppVersion{android ios}`
- **MetricsGeneral**: §0.3
- **Upload**: `imageUrl`
- **LiveActivityResult**: `success message`
- **Country / City** (unused paths): `_id name flag`; `id name cities{id name latitude longitude}`
- **Scalars:** `emailExist`, `phoneExist` and `changePassword` return Boolean; `appleAuthNonce` returns String; `createActivity` returns Boolean (UNVERIFIED type); `relatedItems` returns [String].

## 10. (b) Order status state machine as the customer apps assume it

```
                 abortOrder (customer, PENDING only)
   ┌──────────────────────────────────────────────► CANCELLED
   │                                                    ▲
PENDING ──store accepts──► ACCEPTED ──rider assigned──► ASSIGNED ──rider picks up──► PICKED ──(optional)──► ON_ROUTE ──► DELIVERED ──(optional)──► COMPLETED
   │                         │                                                                                  ▲
   └──store rejects──► CANCELLEDBYREST (app only; web unaware) / CANCELLED                                       │
                                                                                                                │
Pickup orders (isPickedUp = true): PENDING ──► ACCEPTED ──► [COMPLETED = "Ready for collection"] ──► DELIVERED ("Collected")
```

- **Monotonic.** The app ignores regressions (rank table in §6.4). The server must validate transitions centrally and never go backwards.
- **Active vs terminal.**
  - Active: `PENDING ACCEPTED ASSIGNED PICKED ON_ROUTE`.
  - Terminal: `DELIVERED COMPLETED CANCELLED CANCELLEDBYREST`.
  - Live tracking is on for `ASSIGNED PICKED` (app) and `PICKED ON_ROUTE` (web).
- **CONFLICT: pickup `COMPLETED`.**
  - The app's pickup timeline draws `COMPLETED` as an intermediate "ready" step before `DELIVERED`.
  - But both apps treat `COMPLETED` as terminal and past, and the app fires the review prompt on it.
  - **Recommendation (UNVERIFIED):** for pickup, go `ACCEPTED → DELIVERED`, or accept that "ready" moves the order into past orders. The lead must decide.
- **`ON_ROUTE` vs `CANCELLEDBYREST`.**
  - `ON_ROUTE` is optional. The app has no text for it ("This order is no longer active"), but counts it as active.
  - `CANCELLEDBYREST` is unknown to web. **Prefer `CANCELLED` + `reason` for store rejection** so both apps render it correctly.
- **Timestamps per transition:** `acceptedAt`, `assignedAt`, `pickedAt`, `deliveredAt`, `cancelledAt`, and `completionTime` (expected completion, the ETA fallback).
- **Payment gate.** `paymentStatus:'PAID'` must precede store visibility for STRIPE/PAYPAL (§5.7).
- **On every transition:** publish `subscriptionOrder(id)`, `orderStatusChanged(userId)` with `origin` ≠ `'new'`, and the tracking or live-activity updates. Placement publishes `orderStatusChanged` with `origin:'new'`.

## 11. (c) Values the server must compute (never accept from the client)

| Value                                                                               | Rule / source the UI assumes                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Item unit price                                                                     | `variation.price` + Σ option `price` from the DB; snapshot into `items[].variation.price` and `addons[].options[].price`                                                                   |
| `discounted` (menu)                                                                 | discount amount; display only                                                                                                                                                              |
| Subtotal                                                                            | Σ unit × quantity                                                                                                                                                                          |
| `discountAmount`                                                                    | coupon percent × item subtotal; 0 if none                                                                                                                                                  |
| `deliveryCharges`                                                                   | FairBite delivery routing. The client approximation is `fixed ? rate : ceil(haversineKm) × rate`, falling back to `rate`. 0 for pickup.                                                    |
| `taxationAmount`                                                                    | `restaurant.tax`% × (discounted subtotal + delivery), 2 dp                                                                                                                                 |
| `tipping`                                                                           | client choice, validated (≥ 0, capped, 0 if pickup)                                                                                                                                        |
| `orderAmount`                                                                       | discounted subtotal + delivery + tax + tip                                                                                                                                                 |
| `paidAmount`, `paymentStatus`                                                       | from payment-provider webhook only                                                                                                                                                         |
| `orderId`                                                                           | human id (`orderPrefix` + sequence), used in Stripe/PayPal URLs and support tickets                                                                                                        |
| Minimum order                                                                       | (discounted subtotal + delivery) ≥ `minimumOrder`                                                                                                                                          |
| Open/available                                                                      | `isActive && isAvailable && within openingTimes` in the **restaurant's** timezone (clients use device time; UNVERIFIED tz source)                                                          |
| Zone/bounds membership                                                              | point-in-polygon for the delivery address; error strings in §5.3                                                                                                                           |
| `expectedTime`, `preparationTime`, `completionTime`, `selectedPrepTime`             | from the store's prep time and delivery ETA                                                                                                                                                |
| `eta.*`                                                                             | FairBite ETA engine: `readyAt`, `estimatedArrivalAt`, window bounds, `encodedPolyline` (Google 1e5 polyline), `distanceMeters`, `durationSeconds`, `lastLocationAt`, `version` (monotonic) |
| `riderLocation`                                                                     | from rider app updates, with `recordedAt`                                                                                                                                                  |
| Restaurant `rating`, `reviewAverage`, `reviewCount`, `reviewData.ratings`/`total`   | aggregates over active reviews                                                                                                                                                             |
| `deliveryTime`                                                                      | minutes; store config or computed estimate                                                                                                                                                 |
| `popularItems.count`, `mostOrdered*`, `topRatedVendors*`, `recentOrderRestaurants*` | aggregates over orders and reviews; `recentOrder*` is the caller's history (requires auth; returns `[]` for anonymous)                                                                     |
| Distance                                                                            | not returned; clients compute it for display                                                                                                                                               |
| `isNewUser`, `emailIsVerified`, `phoneIsVerified`                                   | server state only                                                                                                                                                                          |
| `profile.favourite`                                                                 | toggled set                                                                                                                                                                                |
| `selected` (address)                                                                | exactly one per user; the newest create/edit is selected                                                                                                                                   |
| Ticket `status`, `senderType`, `isRead`                                             | server                                                                                                                                                                                     |
| Chat `user{id name}`                                                                | from the authenticated sender                                                                                                                                                              |

---

## 12. Merged root-field signatures (what the schema must declare)

**Query:**

- `profile`
- `configuration`
- `publicConfiguration` (single-vendor only)
- `zones`, `banners`, `cuisines`, `attachedCuisines`
- `fetchAllShopTypes`
- `nearByRestaurantsPreview(latitude:Float, longitude:Float, shopType:String, page:Int, limit:Int)`
- `nearByRestaurants(latitude:Float, longitude:Float, shopType:String)`
- `nearByRestaurantsCuisines(latitude:Float, longitude:Float, shopType:String)`
- `mostOrderedRestaurantsPreview(latitude:Float!, longitude:Float!, shopType:String, page:Int, limit:Int)`
- `mostOrderedRestaurants(latitude:Float!, longitude:Float!)`
- `recentOrderRestaurantsPreview(latitude:Float!, longitude:Float!)`
- `recentOrderRestaurants(latitude:Float!, longitude:Float!)`
- `topRatedVendorsPreview(latitude:Float!, longitude:Float!)`
- `topRatedVendors(latitude:Float!, longitude:Float!)`
- `restaurant(id:String, slug:String)`
- `userFavourite(latitude:Float, longitude:Float)`
- `popularItems(restaurantId:String!)`
- `popularFoodItems(restaurantId:String!)`
- `relatedItems(itemId:String!, restaurantId:String!)`
- `fetchCategoryDetailsByStoreId(storeId:String!)`
- `fetchCategoryDetailsByStoreIdForMobile(storeId:String!)`
- `subCategories`
- `subCategoriesByParentId(parentCategoryId:String!)`
- `reviewsByRestaurant(restaurant:String!)`
- `taxes`, `tips`
- `orders(offset:Int, page:Int, limit:Int)`
- `order(id:String!)`
- `orderDetails(id:String!)`
- `orderTracking(id:ID!)`
- `getUsersActiveOrders(page:Int!, limit:Int!, offset:Int!)`
- `getUsersPastOrders(page:Int!, limit:Int!, offset:Int!)`
- `rider(id:String)`
- `chat(order:ID!)`
- `getSingleUserSupportTickets(input:SingleUserSupportTicketsInput!)`
- `getSingleSupportTicket(ticketId:ID!)`
- `getTicketMessages(input:TicketMessagesInput!)`
- `getVersions`
- `appleAuthNonce`
- `getCountries`
- `getCitiesByCountry(id:ID)`
- `getCountryByIso(iso:String!)`
- `users`

**Mutation:**

- `metricsGeneral`
- `login(type:String!, email:String, password:String, appleId:String, appleNonce:String, idToken:String, name:String, notificationToken:String, isActive:Boolean)`
- `createUser(userInput:UserInput!)`
- `updateUser(updateUserInput:UpdateUser!)`
- `emailExist(email:String!)`
- `phoneExist(phone:String!)`
- `sendOtpToEmail(email:String!)`
- `sendOtpToPhoneNumber(phone:String!)`
- `verifyOtp(otp:String!, email:String, phone:String)`
- `forgotPassword(email:String!)`
- `resetPassword(password:String!, email:String!, otp:String, token:String)`
- `changePassword(oldPassword:String!, newPassword:String!)`
- `Deactivate(isActive:Boolean!, email:String!)`
- `pushToken(token:String)`
- `saveNotificationTokenWeb(token:String!)`
- `updateNotificationStatus(offerNotification:Boolean!, orderNotification:Boolean!)`
- `createAddress(addressInput:AddressInput!)`
- `editAddress(addressInput:AddressInput!)`
- `deleteAddress(id:ID!)`
- `deleteBulkAddresses(ids:[ID!]!)`
- `selectAddress(id:String!)`
- `addFavourite(id:String!)`
- `coupon(coupon:String!, restaurantId:ID!)`
- `placeOrder(restaurant:String!, orderInput:[OrderInput!]!, paymentMethod:String!, couponCode:String, tipping:Float!, taxationAmount:Float!, address:AddressInput!, orderDate:String!, isPickedUp:Boolean!, deliveryCharges:Float!, instructions:String)`
- `abortOrder(id:String!)`
- `reviewOrder(reviewInput:ReviewInput!)`
- `sendChatMessage(message:ChatMessageInput!, orderId:ID!)`
- `uploadImageToS3(image:String!)`
- `createSupportTicket(ticketInput:SupportTicketInput!)`
- `createMessage(messageInput:MessageInput!)`
- `updateSupportTicketStatus(input:UpdateSupportTicketInput!)`
- `createActivity(groupId:String!, module:String!, screenPath:String!, type:String!, details:String!)`
- `registerLiveActivitySession(orderId:ID!, activityId:String!, platform:String!, pushToken:String!, schemaVersion:Int, language:String)`
- `removeLiveActivitySession(orderId:ID!, activityId:String!)`

**Subscription:**

- `subscriptionOrder(id:String!)`
- `orderStatusChanged(userId:String!)`
- `subscriptionOrderTracking(id:String!)`
- `subscriptionRiderLocation(riderId:String!)`
- `subscriptionNewMessage(order:ID!)`

**Input types:**

- `OrderInput{food:String!, quantity:Int!, variation:String!, addons:[{_id:String!, options:[String!]}], specialInstructions:String}`
- `AddressInput{_id, label, deliveryAddress, details, latitude:String, longitude:String, isDemoDefaultLocation:Boolean, demoZoneId:String}`
- `UserInput{phone, email, password, name, notificationToken, appleId, emailIsVerified, isPhoneExists}`
- `UpdateUser{name:String!, phone, phoneIsVerified, emailIsVerified}`
- `ReviewInput{order:String!, rating:Int!, description, comments}`
- `ChatMessageInput{message, image, user{id, name}}`
- `SupportTicketInput{title, description, category, userType, orderId, otherDetails}`
- `MessageInput{content, ticket}`
- `SingleUserSupportTicketsInput{userId, filters{page, limit}}`
- `TicketMessagesInput{ticket, page, limit}`

Exact non-null markers inside input types are UNVERIFIED. Clients always send the fields listed, but `quantity`, `food` and `variation` are always present.

---

## 13. Single-vendor code paths (out of scope; listed only)

- App: `APP/singlevendor/**`, including `apollo/{queries,mutations,subscriptions}.js`, plus the single-vendor branches in:
  - `APP/context/Configuration.js:13-31` (`publicConfiguration`)
  - `APP/context/User.js:32-54` (`SingleVendorProfile`)
  - `APP/context/Orders.js:8-12,217-235`
  - `APP/screens/Login/useLogin.js:42-47`
- Web: `WEB/lib/ui/single-vendor/**` and `WEB/lib/api/graphql/single-vendor/index.ts` (39 `gql` documents), plus the single-vendor branches in `WEB/lib/context/User/User.context.tsx` (`SINGLE_VENDOR_*` imports).

## 14. Client defects observed (do not fix in the UI; recorded for integration planning)

1. **App `placeOrder` / `user.email`.** The app reads `placeOrder.user.email` without selecting it (`Checkout.js:404-407,447`).
2. **App PayPal URL.** `${SERVER_URL}paypal` with `SERVER_URL` ending `/graphql` (`environment.config.js:10`). This is a configuration fix.
3. **Web PayPal.** Unreachable; the `/paypal` route is missing.
4. **Web "Other" tip.** Sends `NaN`.
5. **Web instructions and Stripe recovery.** Instructions and the Stripe recovery use mismatched (prefixed vs raw) `localStorage` keys, so `instructions` is effectively `""`.
6. **Web hard-coded or zero coordinates.** `recentOrderRestaurantsPreview` uses hard-coded coordinates; `topRatedVendorsPreview` effectively uses `0,0`.
7. **Web `orders` `fetchMore`.** Sends an undeclared `offset`.
8. **`verifyOtp` checks.** Object-truthiness checks in four places, so the server must throw on failure (R1-1).
9. **Unauthenticated web Stripe redirect.** The web Stripe redirect carries no credential (§5.7).
