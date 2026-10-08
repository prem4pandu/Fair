# Rider mobile foundation

Public service connection check only. Set `EXPO_PUBLIC_FAIRBITE_API_URL` to the own backend `/graphql` endpoint. HTTPS is required except HTTP loopback for local development; no provider or upstream-server fallback exists. Physical devices need a reachable HTTPS endpoint.

Expo 55 / React Native 0.83.2 / React 19.2 is the frozen foundation. Upstream customer/rider SDK 53 and merchant SDK 54 UI migration is staged and requires dependency/native validation, rather than importing their manifests. The password identity candidate is described below; commerce, delivery and payment integration are not claimed.

Run package `test`, `typecheck`, and `build`; export Android/iOS separately. Exports verify bundling only. Signed iOS/Android builds, real device E2E, independent accessibility QA and release/security approval remain required.

## Password identity candidate

Native clients provide role-bound password sign-in, customer-only registration, secure refresh restoration, explicit account/refresh actions and logout. Access tokens remain in memory. Refresh credentials and original family expiry are scoped to the exact backend endpoint and fixed app in Expo SecureStore; no AsyncStorage fallback exists. Signing out cancels in-flight operations and clears local state; an offline failure explicitly leaves server revocation unconfirmed.

Authentication is disabled in Expo web exports because a browser BFF session transport is required. Public diagnostics remain available. Recovery, OTP and Google/Apple authentication are unavailable. Registration remains email UNVERIFIED unless the server says otherwise. Privileged production password access remains blocked by backend policy.

Injected-storage/fetch unit tests verify transport and session races; these do not replace real signed device validation of SecureStore, streaming, keyboard/autofill, process restart or server identity flows.
