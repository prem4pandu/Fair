# Merchant mobile foundation

Public service connection check only. Set `EXPO_PUBLIC_FAIRBITE_API_URL` to the own backend `/graphql` endpoint. HTTPS is required except HTTP loopback for local development; no provider or upstream-server fallback exists. Physical devices need a reachable HTTPS endpoint.

Expo 55 / React Native 0.83.2 / React 19.2 is the frozen foundation. Upstream customer/rider SDK 53 and merchant SDK 54 UI migration is staged and requires dependency/native validation, rather than importing their manifests. No authentication, commerce, delivery or payment integration is claimed.

Run package `test`, `typecheck`, and `build`; export Android/iOS separately. Exports verify bundling only. Signed iOS/Android builds, real device E2E, independent accessibility QA and release/security approval remain required.
