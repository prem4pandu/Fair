# Lane L12 — Single-vendor (Wave 5, gated on D1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `00-master-plan.md` §1, §2, §4, §6 first. Gate G1 must have passed.

**Goal:** Serve the 70 single-vendor root operations (lane `L12` in `docs/OPERATION_LANES.json`) that the unchanged single-vendor admin and the single-vendor code paths of the multivendor customer app, customer web, store and rider apps call, with the same names, arguments and response shapes, backed by server-owned prices, balanced journals for credits and honest `NOT_IMPLEMENTED` / `PROVIDER_UNAVAILABLE` answers where an input is missing. Wave 5 does not start until the owner approves D1. Until then every L12 root returns `NOT_IMPLEMENTED`.

**Architecture:** Single-vendor is served by the **same** NestJS API instance and the **same** PostgreSQL database as multivendor. A platform-level `vendorMode` flag plus one designated restaurant (`SvSettings.storeRestaurantId`) define "the store". L12 adds one module (`src/modules/singlevendor`) that owns only single-vendor state: the server cart, checkout quotes, deals, store banners, scheduled-order slots, favourite foods, credits, referral codes, membership plans, feedback and a snapshot of every single-vendor order. Everything else (catalog, coupons, orders, riders, users, addresses, configuration, notifications, ledger, payments) is reused from the multivendor lanes through `kernel/ports.ts`. Orders placed in single-vendor mode are created by L5 (`OrdersPort.createPriced`) so that the store app, rider app, dispatch, ledger and notifications behave exactly as in multivendor.

**Tech stack:** as master plan — Node 24, TypeScript 5.9, NestJS 12 schema-first GraphQL (`@nestjs/graphql` 14, Apollo Server 5), `pg` pool with SQL, Prisma 7 multi-file schema for migrations, zod 4, Vitest 4, Testcontainers 11 (PostGIS 17 + Redis 7), Playwright 1.63.

---

## Frontend boundary (master §1, verbatim)

> The product UI MUST be the complete pinned Enatega frontend in `implementation/vendor/enatega-ui/`. FairBite owns the backend and integration layer only. Do not create, redesign, simplify or replace Enatega layouts, navigation, screens, components, styling, assets or interaction flows. Allowed frontend changes are limited to transport/adapters, secure session handling, validated data mapping, configuration and centralized display-name imports. Every edit inside `implementation/vendor/enatega-ui/` must be recorded in the root `SOURCE_PROVENANCE.json` under `allowedModifications`, and `node tools/manifest-enatega-ui.mjs` must be re-run so `SOURCE_MANIFEST.json` matches. An unsupported backend capability is an integration blocker: return a `NOT_IMPLEMENTED` error, never fake success, never fabricate data, never call the upstream Enatega production backend.

L12 makes **no** edit inside `vendor/enatega-ui/`. Single-vendor mode is selected only through each app's environment variables (see "SINGLE mode endpoints" below). This rule must be included in every frontend/mobile implementation handoff that this plan produces (the Playwright and journey handoffs to L10 in §9 repeat it).

---

## Single-vendor design decisions (binding for L12)

| # | Decision | Default chosen | Why |
|---|---|---|---|
| SV1 | Same API, same database | One API process serves MULTI and SINGLE documents. No second deployment, no second database. SINGLE app variants point their SINGLE endpoint variables at the same `/graphql`, WebSocket `/graphql` and REST base. | The apps already isolate tokens and caches per mode (`@enatega/single/*` keys in web `lib/mode/storage.ts:35-36`; `enatega-store-{multi\|single}-token`, `enatega-rider-{multi\|single}-token`, reference/03 §E). One identity and one catalog avoid duplicate data. |
| SV2 | The store | `SvSettings` is a singleton row (`id = 1`). `storeRestaurantId` names the one restaurant the customer single-vendor documents operate on. `saveVendorTypeToggle({ isMultiVendor: false })` designates it and fails unless exactly one restaurant is active. `vendorMode` (`MULTI`/`SINGLE`) is what `Configuration.isMultiVendor` reports to the single-vendor admin (sidebar items depend on it: `super-admin-layout/side-bar/index.tsx:104-190`). Multivendor operations are never affected by `vendorMode`. | reference/04 §6 ("reads mode flags `isMultiVendor`, `restaurantCount` and `isAppLaunched`"). |
| SV3 | Gate | `SINGLE_VENDOR_ENABLED` (config, default `false`). While false every L12 root throws `NOT_IMPLEMENTED` "`<operation>` is not available yet" before any auth check. | D1. |
| SV4 | Reuse | Catalog (categories, sub-categories, foods, variations, addons, options) stays in L3 and is read through the new `CATALOG_PORT`. L12 stores only single-vendor extras (`SvFoodDetail`: ingredients, usage, nutrition, UOM, inventory, order-quantity limits). Orders are created by L5 through `OrdersPort.createPriced`; L12 keeps a snapshot (`SvOrder`) of the lines, amounts, schedule slot and address. | AGENTS.md ownership; one order pipeline for store, rider, ledger and notifications. |
| SV5 | Server cart | Cart lives in the database per customer (`SvCart`, `SvCartLine`). Prices are never stored in the cart; every response re-prices from `CATALOG_PORT` and live deals. Each mutation increments `SvCart.revision` (`cartRevision`). | App and web read every money figure from the cart responses (`useAddToCart.js:47-56`, `User.context.tsx:255-290`). |
| SV6 | Checkout quote | `calculateCheckout` persists an `SvCheckoutQuote` (TTL `SvSettings.quoteTtlSeconds`, default 600 s) and returns its id. `placeOrder` without `orderInput` (the single-vendor document) must reference a live quote of the same cart revision and pickup choice; the server recomputes and rejects any difference. | `checkoutQuoteId`/`cartRevision` are sent by both apps (`useCheckout.js:154`, web `Checkout.tsx:113`). |
| SV7 | Deals | Per-variation deals (`SvDeal`: `PERCENTAGE` in basis points or `FIXED` in minor units, start/end, active). A deal reduces the variation base price only, never addon prices. Sections: `LIMITED_TIME` = live and ending within 72 h; `WEEKLY` = live and lasting at most 7 days; `NEW_OFFERS` = live and started within the last 7 days (UNVERIFIED upstream semantics; deterministic and documented). | `discountType` values `PERCENTAGE`/`FIXED` (`deals/form/index.tsx:219-222`). |
| SV8 | Commission | Single-vendor orders are core-plan orders: L5 applies its 0 % commission rule unchanged (D4). L12 never computes commission. | AGENTS.md zero core-plan food commission. |
| SV9 | Credits | Credits are a customer liability. Every grant, debit or edit posts a balanced, immutable journal through `LEDGER_PORT.post` (`Dr PLATFORM:PROMOTIONS_EXPENSE` / `Cr CUSTOMER_CREDIT:<userId>` for a grant, reversed for a debit). `SvCreditRecord` is the display projection; `SvCreditAdjustment` is its append-only history. Credits are **not** redeemed at checkout (`creditsUsed = 0`) until the owner defines a redemption policy (open question Q3). | AGENTS.md immutable balanced journals; no fabricated policy. |
| SV10 | Membership | Plans and member subscriptions need Stripe Billing. Plans are read from `SvSubscriptionPlan` (empty until a provider exists). `createPriceForProduct`, `deactivatePrice`, `createSubscription`, `updateSubscription` validate their input and then answer `PROVIDER_UNAVAILABLE` (no Stripe keys) or `NOT_IMPLEMENTED` (keys present, billing adapter not built). `cancelSubscription`/`updateSubscription` without an active membership answer `BAD_USER_INPUT` "You have no active membership". | reference/04 §B "provider blocker until Stripe Billing exists"; D12. |
| SV11 | Free deliveries, referrals | `getMyFreeDeliveries` counts unused `SvFreeDeliveryGrant` rows (no grant path exists until the owner defines membership benefits). `getMyReferralCode` issues a stable 8-character code per customer; `checkReferralCodeExists` checks it. No referral reward is paid (Q4). | No fabricated policy. |
| SV12 | Scheduled orders | Scheduled-order slots (`SvScheduleDay`, `SvScheduleSlot`, with `maxOrder` capacity) are separate from L3 opening hours. `scheduleData { dayId, scheduleTimeId }` on `placeOrder` books the next future occurrence of that slot in the store time zone; capacity is checked under a row lock. | `schedule-order-management/view/main/index.tsx:143-262`, web `Checkout.tsx:369-388`. |
| SV13 | Order state | `Order.orderState` (selected only by single-vendor documents) is derived from the D5 status: `PENDING→PENDING`, `ACCEPTED→ACCEPTED`, `ASSIGNED→ACCEPTED`, `PICKED→PICKED_UP`, `DELIVERED→COMPLETED`, `CANCELLED→CANCELLED`. The server never emits `READY_FOR_PICKUP` or `ON_ROUTE`. | Rider `lib/utils/order-state.ts:4-63`, web `orderTrackingStatus.ts:28-46`, app `singlevendor/utils/orderTrackingStatus.js:18-38` all render these. |
| SV14 | Fees | `serviceFee`, the small-order threshold/fee (`maximumOrderAmount`/`minimumOrderFee`, `maxOrderAmount`/`lowOrderFees`) and the priority-delivery fee come from `SvSettings` and default to 0 (no fee). The hard minimum order is the restaurant's `minimumOrder`. | App semantics: `minimumOrderFee={isBelowMaximumOrder ? minimumOrderFee : 0}` (`singlevendor/screens/Checkout/Checkout.js:423`). |
| SV15 | Payments | COD works end to end. Card checkout uses `PAYMENTS_PORT.createCheckoutSession`; without Stripe keys `placeOrder` with `STRIPE` answers `BAD_USER_INPUT` "Card payments are not available" (D12) and `POST /stripe/create-web-checkout-session` answers 503 `{ "error": "Card payments are not available" }`. PayPal is rejected with "PayPal payments are not available". | reference/01 §5.2 P5, P8. |

### What each single-vendor-only feature means

| Feature | Operations | Meaning in FairBite |
|---|---|---|
| Server cart | `getUserCart`, `userCartData`, `updateUserCartCount`, `editSingleVendorCartItem`, `clearCart` | Per-customer cart lines `(food, variation, addon selection)`; quantities merged by identical configuration; re-priced on every read (SV5). |
| Checkout | `calculateCheckout` (+ `placeOrder` single-vendor document, owned by L5, delegating to L12) | Quote with deal, coupon, delivery, fees, tax; persisted quote id (SV6). |
| Deals | `getWeeklyFoodsDeals`, `getLimitedTimeFoodsDeals`, `getNewOffersFoodsDeals`, `singleVendorDeals`, `getAllFoodDealsAdmin`, `createFoodDeal`, `updateFoodDeal`, `deleteFoodDeal` | Variation-level price reductions (SV7). |
| Subscriptions | `getAllSubscriptionPlans`, `createPriceForProduct`, `deactivatePrice`, `createSubscription`, `updateSubscription`, `cancelSubscription`, `subscriptionPaymentSuccess` (order payments, not memberships) | Stripe Billing — provider blocker (SV10). `subscriptionPaymentSuccess` is the order-payment confirmation for single-vendor card orders (SV15). |
| Credits and referrals | `getAllCreditsRecords`, `getAllUsersDropDownSearch`, `giveUserCredits`, `editUserCreditsHistory`, `getAllUserCredits`, `getUserCreditsHistory`, `getMyReferralCode`, `checkReferralCodeExists` | Ledger-backed credits (SV9); referral codes without rewards (SV11). |
| Schedules | `getRestaurantSchedule`, `updateScheduleTimings`, `getScheduleByDay`, `getScheduleUntilNextDayOff` | Scheduled-order slot table (SV12). |
| Scheduled orders | `scheduledOrders` | The caller's single-vendor orders with a booked slot that are not delivered or cancelled. |
| Recommended / similar | `getRecommendedFoods`, `getSimilarFoods` | Recommended = foods most often ordered together with the food in single-vendor orders, then other foods of the same category; similar = same sub-category, then same category (UNVERIFIED upstream semantics). |
| Search | `searchFood`, `searchSingleVendorFoods` | Case-insensitive substring match on title and description over visible foods. |
| Free deliveries | `getMyFreeDeliveries` | Unused grants (none can be issued until Q2). |
| Feedback | `giveFeedback` | Stored app feedback (`rating` 1–5, `comments`). |

### SINGLE mode endpoints (reference/01 §7)

The SINGLE endpoint variables of every app point at **our** API; nothing contacts the upstream railway host. These are configuration values, not source edits.

| App | Variables (development values) | Notes |
|---|---|---|
| Customer web | `NEXT_PUBLIC_VENDOR_MODE=SINGLE`, `NEXT_PUBLIC_SINGLE_VENDOR_SERVER_URL=http://localhost:4100/`, `NEXT_PUBLIC_SINGLE_VENDOR_WS_SERVER_URL=ws://localhost:4100/`, `NEXT_PUBLIC_SINGLE_VENDOR_REST_URL=http://localhost:4100/` | `lib/mode/environment.ts:20-41` appends `/graphql`; REST falls back to the server URL. Home route becomes `/discovery` (`lib/mode/routes.ts:21-22`). |
| Customer app | `EXPO_PUBLIC_VENDOR_MODE=SINGLE`, `EXPO_PUBLIC_SINGLE_VENDOR_ENABLED=true`, `EXPO_PUBLIC_SINGLE_VENDOR_GRAPHQL_URL=http://<host>:4100/graphql`, `EXPO_PUBLIC_SINGLE_VENDOR_WS_GRAPHQL_URL=ws://<host>:4100/graphql`, `EXPO_PUBLIC_SINGLE_VENDOR_REST_URL=http://<host>:4100/` | All three URLs are required, else the app falls back to the railway host (`environment.config.js:59-87`). In MULTI-only deployments keep `EXPO_PUBLIC_VENDOR_MODE=MULTI` so `App.js:129-148` never pre-warms a SINGLE client. |
| Store app | `EXPO_PUBLIC_VENDOR_MODE=SINGLE`, `EXPO_PUBLIC_SINGLE_VENDOR_GRAPHQL_URL`, `EXPO_PUBLIC_SINGLE_VENDOR_WS_GRAPHQL_URL` | Release builds require https/wss (`environment.ts:27-34`). |
| Rider app | same two variables | `environment.ts:19-32`. |
| Single-vendor admin | `NEXT_PUBLIC_SERVER_URL=http://localhost:4100/`, `NEXT_PUBLIC_WS_SERVER_URL=ws://localhost:4100/` | `requireBaseUrl` throws when missing (reference/01 §1.2). Run on port 3002. Multivendor admin links to it via `NEXT_PUBLIC_SINGLE_VENDOR_ADMIN_URL=http://localhost:3002/`. |

API side: `SINGLE_VENDOR_ENABLED=true`, `CORS_ORIGINS` must include the single-vendor admin origin (`http://localhost:3002`) and the SINGLE web origin.

---

## Operations

`OPERATION_LANES.json` lists **70** operations with `lane: "L12"` (44 queries, 25 mutations, 1 subscription). All 70 are below; count checked with `node -e 'console.log(require("./docs/OPERATION_LANES.json").operations.filter(o=>o.lane==="L12").length)'` → `70`.

Abbreviations: `SV` = `enatega-singlevendor-admin`, `APP` = `enatega-multivendor-app`, `WEB` = `enatega-multivendor-web`. Document files: `SVQ` = `SV:lib/api/graphql/queries/…`, `SVM` = `SV:lib/api/graphql/mutations/…`, `AQ` = `APP:src/singlevendor/apollo/queries.js`, `AM` = `APP:src/singlevendor/apollo/mutations.js`, `AS` = `APP:src/singlevendor/apollo/subscriptions.js`, `W` = `WEB:lib/api/graphql/single-vendor/index.ts`. Every export name below was verified by parsing the files (they are all `export const`). Callers: **pub** = anonymous allowed (personalised when a customer token is present); **C** = CUSTOMER (own data only); **A** = ADMIN; **S(x)** = STAFF with permission `x`; **V/R(own)** = VENDOR/RESTAURANT owning the restaurant (reference/04 §B).

| # | Type | Operation | Apps | Who may call | Test documents (`app`, `file`, `export`) | Ref |
|---|---|---|---|---|---|---|
| 1 | query | `adminConfiguration` | SV | A, S(Configuration) | SV `queries/configuration/index.ts` `GET_CONFIGURATION` (aliased `configuration:`) | 04 §6.1, §B |
| 2 | query | `bannerRestaurant` | SV | A, S(Stores), V/R(own) | SV `queries/bannerRestaurant/index.tsx` `GET_BANNER_RESTAURANT` | 04 §6.1 |
| 3 | query | `bannerRestaurants` | SV | A, S(Stores), V/R(own) | SV `queries/bannerRestaurant/index.tsx` `GET_BANNER_RESTAURANTS` | 04 §6.1 |
| 4 | query | `calculateCheckout` | APP, WEB | C | AQ `CALCULATE_CHECKOUT`; W `SINGLE_VENDOR_CALCULATE_CHECKOUT` | 02 §13 |
| 5 | query | `couponsbyRestaurant` | APP, WEB | pub | AQ `COUPONS_BY_RESTAURANT_SINGLE_VENDOR`; W `SINGLE_VENDOR_VOUCHERS` | 02 §13 |
| 6 | query | `getAllCategoriesWithSubCategoriesDataSeeAllSingleVendor` | APP, WEB | pub | AQ `GET_ALL_CATEGORIES_WITH_SUBCATEGORIES_DATA`; W `SINGLE_VENDOR_CATALOG` | 02 §13 |
| 7 | query | `getAllCategoriesWithSubCategoriesOnlySeeAllSingleVendor` | APP | pub | AQ `GET_ALL_CATEGORIES_WITH_SUBCATEGORIES_ONLY_SEE_ALL_SINGLE_VENDOR` | 02 §13 |
| 8 | query | `getAllCreditsRecords` | SV | A, S(Users) | SV `queries/user-credits.ts` `GET_ALL_CREDITS_RECORDS` | 04 §6.1, §B |
| 9 | query | `getAllFoodDealsAdmin` | SV | A, S(Stores), V/R(own) | SV `queries/food/index.ts` `GET_ALL_FOOD_DEALS_ADMIN` | 04 §6.1 |
| 10 | query | `getAllSubscriptionPlans` | APP, SV, WEB | A, C | AQ `GET_ALL_SUBSCRIPTION_PLANS`; W `SINGLE_VENDOR_MEMBERSHIP_PLANS`; SV `queries/subscription/index.ts` `GET_ALL_SUBSCRIPTION_PLANS` | 04 §6.1, §B |
| 11 | query | `getAllUserCredits` | APP, WEB | C | AQ `GET_ALL_USER_CREDITS`; W `SINGLE_VENDOR_CREDITS` | 02 §13 |
| 12 | query | `getAllUsersDropDownSearch` | SV | A, S(Users) | SV `queries/user-credits.ts` `GET_ALL_USERS_DROPDOWN_SEARCH` | 04 §6.1 |
| 13 | query | `getAllfoods` | SV | A, S(Stores), V/R(own) | SV `queries/food/index.ts` `GET_ALL_FOODS` | 04 §6.1 |
| 14 | query | `getAllfoodsPaginated` | SV | A, S(Stores), V/R(own) | SV `queries/food/index.ts` `GET_ALL_FOODS_PAGINATED` | 04 §6.1 |
| 15 | query | `getCategoryItemsSingleVendor` | APP, WEB | pub | AQ `GET_CATEGORY_ITEMS_SINGLE_VENDOR`; W `SINGLE_VENDOR_CATEGORY` | 02 §13 |
| 16 | query | `getCategoryProducts` | APP | pub | AQ `GET_CATEGORY_PRODUCTS` | 02 §13 |
| 17 | query | `getDashboardOrderSalesDetailsByPaymentMethod` | SV | A, S(Stores), V/R(own) | SV `queries/dashboard/index.ts` `GET_DASHBOARD_ORDER_SALES_DETAILS_BY_PAYMENT_METHOD` | 04 §6.1, §B |
| 18 | query | `getEstimatedDeliveryTime` | APP | C (own address) | AQ `GET_ESTIMATED_DELIVERY_TIME` | 02 §13 |
| 19 | query | `getFavoriteFoodsSingleVendor` | APP, WEB | C | AQ `GET_FAVORITE_FOODS_SINGLE_VENDOR`; W `SINGLE_VENDOR_FAVORITES` | 02 §13 |
| 20 | query | `getFavoriteFoodsStatus` | APP | C | AQ `GET_FAVORITE_FOODS_STATUS` | 02 §13 |
| 21 | query | `getFoodDetails` | APP, WEB | pub | AQ `GET_FOOD_DETAILS`; W `SINGLE_VENDOR_PRODUCT` | 02 §13 |
| 22 | query | `getLimitedTimeFoodsDeals` | APP, WEB | pub | AQ `GET_LIMITED_TIME_FOODS_DEALS`; W `SINGLE_VENDOR_LIMITED_DEALS` | 02 §13 |
| 23 | query | `getMyFreeDeliveries` | APP | C | AQ `GET_MY_FREE_DELIVERIES` | 02 §13 |
| 24 | query | `getMyReferralCode` | APP, WEB | C | AQ `GET_MY_REFERRAL_CODE`; W `SINGLE_VENDOR_REFERRAL` | 02 §13 |
| 25 | query | `getNewOffersFoodsDeals` | APP | pub | AQ `GET_NEW_OFFERS_FOODS_DEALS` | 02 §13 |
| 26 | query | `getRecommendedFoods` | APP | pub | AQ `GET_RECOMMENDED_FOODS` | 02 §13 |
| 27 | query | `getRestaurantCategoriesSingleVendor` | APP, WEB | pub | AQ `GET_RESTAURANT_CATEGORIES_SINGLE_VENDOR`; W `SINGLE_VENDOR_CATEGORIES` | 02 §13 |
| 28 | query | `getRestaurantSchedule` | SV | A, S(Stores), V/R(own) | SV `queries/restaurants/index.ts` `GET_RESTAURANT_SCHEDULE` | 04 §6.1, §B |
| 29 | query | `getScheduleByDay` | APP, WEB | pub | AQ `GET_SCHEDULE_BY_DAY`; W `SINGLE_VENDOR_SCHEDULE` | 02 §13 |
| 30 | query | `getScheduleUntilNextDayOff` | APP | pub | AQ `GET_SCHEDULE_UNTIL_NEXT_DAY_OFF` | 02 §13 |
| 31 | query | `getSimilarFoods` | APP, WEB | pub | AQ `GET_SIMILAR_FOODS`; W `SINGLE_VENDOR_SIMILAR_PRODUCTS` | 02 §13 |
| 32 | query | `getUserCart` | APP, WEB | C | AQ `GET_USER_CART`; W `SINGLE_VENDOR_CART` | 02 §13 |
| 33 | query | `getUserCreditsHistory` | APP | C | AQ `GET_USER_CREDITS_HISTORY` | 02 §13 |
| 34 | query | `getWeeklyFoodsDeals` | APP, WEB | pub | AQ `GET_WEEKLY_FOODS_DEALS`; W `SINGLE_VENDOR_WEEKLY_DEALS` | 02 §13 |
| 35 | query | `orderDetailsPage` | APP, WEB | C (own order) | AQ `ORDER_DETAILS_PAGE`; W `SINGLE_VENDOR_ORDER_DETAILS` | 02 §13 |
| 36 | query | `pastNotificationsByToken` | APP | C | AQ `GET_PAST_NOTIFICATIONS_BY_TOKEN` | 02 §13 |
| 37 | query | `recentActiveOrder` | APP, WEB | C | AQ `Recent_ActiveOrder`; W `SINGLE_VENDOR_RECENT_ACTIVE_ORDER` | 02 §13 |
| 38 | query | `scheduledOrders` | APP | C | AQ `GET_SCHEDULED_ORDERS` | 02 §13 |
| 39 | query | `searchFood` | APP | pub | AQ `SEARCH_FOOD` | 02 §13 |
| 40 | query | `searchSingleVendorFoods` | APP, WEB | pub | AQ `SEARCH_SINGLE_VENDOR_FOODS`; W `SINGLE_VENDOR_SEARCH` | 02 §13 |
| 41 | query | `singleVendorBanners` | APP | pub | AQ `GET_SINGLE_VENDOR_BANNERS` | 02 §13 |
| 42 | query | `singleVendorDeals` | APP | pub | AQ `GET_SINGLE_VENDOR_DEALS_SECTION` | 02 §13 |
| 43 | query | `singleVendorDiscovery` | APP, WEB | pub | AQ `GET_SINGLE_VENDOR_DISCOVERY`; W `SINGLE_VENDOR_DISCOVERY` | 02 §13 |
| 44 | query | `todayNotificationsByToken` | APP | C | AQ `GET_TODAY_NOTIFICATIONS_BY_TOKEN` | 02 §13 |
| 45 | mutation | `cancelSubscription` | APP, WEB | C | AM `CANCEL_SUBSCRIPTION`; W `SINGLE_VENDOR_CANCEL_MEMBERSHIP` | 02 §13 |
| 46 | mutation | `checkReferralCodeExists` | APP | pub | AM `CHECK_REFERRAL_CODE_EXISTS` | 02 §13 |
| 47 | mutation | `clearCart` | APP, WEB | C | AM `CLEAR_CART`; W `SINGLE_VENDOR_CLEAR_CART` | 02 §13 |
| 48 | mutation | `createBannerRestaurant` | SV | A, S(Stores), V/R(own) | SV `mutations/bannerRestaurant/index.ts` `CREATE_BANNER_RESTAURANT` | 04 §6.1 |
| 49 | mutation | `createFoodDeal` | SV | A, S(Stores), V/R(own) | SV `mutations/food-deal/index.ts` `CREATE_FOOD_DEAL` | 04 §6.1 |
| 50 | mutation | `createFoodSingleVendor` | SV | A, S(Stores), V/R(own) | SV `mutations/food/index.ts` `CREATE_FOOD_SINGLE_VENDOR` | 04 §6.1 |
| 51 | mutation | `createPriceForProduct` | SV | A | SV `mutations/subscription/index.ts` `CREATE_SUBSCRIPTION_PLAN` | 04 §6.1, §B |
| 52 | mutation | `createSubscription` | APP, WEB | C | AM `CREATE_SUBSCRIPTION`; W `SINGLE_VENDOR_CREATE_MEMBERSHIP` | 02 §13 |
| 53 | mutation | `deactivatePrice` | SV | A | SV `mutations/subscription/index.ts` `DEACTIVATE_SUBSCRIPTION_PLAN` | 04 §6.1 |
| 54 | mutation | `deleteBannerRestaurant` | SV | A, S(Stores), V/R(own) | SV `mutations/bannerRestaurant/index.ts` `DELETE_BANNER_RESTAURANT` | 04 §6.1 |
| 55 | mutation | `deleteFoodDeal` | SV | A, S(Stores), V/R(own) | SV `mutations/food-deal/index.ts` `DELETE_FOOD_DEAL` | 04 §6.1 |
| 56 | mutation | `editBannerRestaurant` | SV | A, S(Stores), V/R(own) | SV `mutations/bannerRestaurant/index.ts` `EDIT_BANNER_RESTAURANT` | 04 §6.1 |
| 57 | mutation | `editSingleVendorCartItem` | APP | C (own line) | AM `EDIT_SINGLE_VENDOR_CART_ITEM` | 02 §13 |
| 58 | mutation | `editUserCreditsHistory` | SV | A, S(Users) | SV `mutations/user-credits/index.ts` `EDIT_USER_CREDITS_HISTORY` | 04 §6.1, §B |
| 59 | mutation | `giveFeedback` | APP | C | AM `GIVE_FEEDBACK` | 02 §13 |
| 60 | mutation | `giveUserCredits` | SV | A, S(Users) | SV `mutations/user-credits/index.ts` `GIVE_USER_CREDITS` | 04 §6.1, §B |
| 61 | mutation | `saveGeneralConfiguration` | SV | A, S(Configuration) | SV `mutations/configuration/index.ts` `SAVE_GENERAL_CONFIGURATION` | 04 §6.1, §B |
| 62 | mutation | `saveVendorTypeToggle` | SV | A, S(Configuration) | SV `mutations/configuration/index.ts` `TOGGLE_VENDOR_TYPE_CONFIGURATION` (operation name `SAVE_VERIFICATIONS_TOGGLE`) | 04 §6.1 |
| 63 | mutation | `toggleFavoriteFoodSingleVendor` | APP, WEB | C | AM `TOGGLE_FAVORITE_ITEM_SINGLE_VENDOR` (variable `toggleFavoriteFoodSingleVendorId`); W `SINGLE_VENDOR_TOGGLE_FAVORITE` (variable `id`) | 02 §13 |
| 64 | mutation | `updateFoodDeal` | SV | A, S(Stores), V/R(own) | SV `mutations/food-deal/index.ts` `UPDATE_FOOD_DEAL` | 04 §6.1 |
| 65 | mutation | `updateFoodSingleVendor` | SV | A, S(Stores), V/R(own) | SV `mutations/food/index.ts` `UPDATE_FOOD_SINGLE_VENDOR` | 04 §6.1 |
| 66 | mutation | `updateScheduleTimings` | SV | A, S(Stores), V/R(own) | SV `mutations/restaurant/index.ts` `UPDATE_RESTAURANT_SCHEDULE` | 04 §6.1, §B |
| 67 | mutation | `updateSubscription` | APP, WEB | C | AM `UPDATE_SUBSCRIPTION`; W `SINGLE_VENDOR_UPDATE_MEMBERSHIP` | 02 §13 |
| 68 | mutation | `updateUserCartCount` | APP, WEB | C (own line) | AM `UPDATE_USER_CART_COUNT`; W `SINGLE_VENDOR_UPDATE_CART_COUNT` | 02 §13 |
| 69 | mutation | `userCartData` | APP, WEB | C | AM `UPDATE_USER_CART`; W `SINGLE_VENDOR_UPDATE_CART` | 02 §13 |
| 70 | subscription | `subscriptionPaymentSuccess` | APP, WEB | C (`userId` = socket user) | AS `paymentSuccess`; W `SINGLE_VENDOR_PAYMENT_SUCCESS` | 01 §5.2 P8 |

Plus one REST route owned by L12: `POST /stripe/create-web-checkout-session` (WEB `lib/ui/single-vendor/Checkout.tsx:136-157`; reference/01 §5.2 P5).

### Shared operations whose single-vendor shapes differ

These roots belong to other lanes. L12 does **not** implement their resolvers; it (a) states the required behaviour, (b) supplies field resolvers for single-vendor-only fields from its own module, and (c) proves both with replay tests in `test/integration/singlevendor/shared-modes.integration.spec.ts` (Task 22). The owning-lane changes are listed in Task 0 (P2–P6) and are made by the owners.

| Root (owner) | SINGLE document | Difference | Who provides it |
|---|---|---|---|
| `placeOrder` (L5) | APP `src/singlevendor/apollo/mutations.js` `PLACE_ORDER`; WEB `W` `SINGLE_VENDOR_PLACE_ORDER` | No `restaurant`, `orderInput`, `taxationAmount`, `deliveryCharges`; adds `specialInstructions`, `scheduleData: ScheduleData` (`isScheduled`, `dayId`, `scheduleTimeId`), `isPriority`, `idempotencyKey`, `checkoutQuoteId`. The cart is on the server. | L5 resolver delegates to `SINGLE_VENDOR_CHECKOUT_PORT.placeOrder` when `orderInput` and `restaurant` are both absent (P2). L12 implements the port (Task 14). |
| `riderOrders` (L6) | RIDER `lib/apollo/queries/rider.query.ts` `SINGLE_VENDOR_RIDER_ORDERS` | `riderOrders(limit, offset)`, pages of 50, not polled; selects `orderState`. | L6 honours `limit`/`offset` (P3); L12 resolves `Order.orderState` (Task 15). |
| `subscriptionZoneOrders`, `subscriptionAssignRider` (L6) | RIDER `lib/apollo/subscriptions.ts` `SINGLE_VENDOR_SUBSCRIPTION_ZONE_ORDERS`, `SINGLE_VENDOR_SUBSCRIPTION_ASSIGNED_RIDER` | add `orderState` | L12 `Order.orderState` field resolver. |
| `restaurantOrders` (L5) | STORE `lib/apollo/queries/orders.ts` `GET_ORDERS_SINGLE_VENDOR` | `restaurantOrders(offset, limit)`, pages of 50, richer `eta`, no `discountAmount` (reference/03 §1.4). | L5 honours `offset`/`limit` (P2). |
| `restaurant` (L3) | STORE `lib/apollo/queries/store.query.ts` `STORE_PROFILE_SINGLE_VENDOR` | adds `bussinessDetails` (owner-only field rule). | L3, unchanged rule. |
| `publicConfiguration` (L2) | WEB `W` `SINGLE_VENDOR_CONFIGURATION` (APP `src/context/Configuration.js:13` is the same selection but not exported) | aliased `configuration: publicConfiguration`; public subset incl. `publishableKey`. | L2, unchanged. |
| `profile` (L1) | WEB `W` `SINGLE_VENDOR_PROFILE` (APP `src/context/User.js:32` identical, not exported) | adds `favourite`, `stripe_plan_id`. | L12 resolves `User.stripe_plan_id` (Task 17); `favourite` is L4. |
| `login`, `emailExist`, `phoneExist`, `changePassword`, `pushToken` (L1) | AM `LOGIN_SINGLE_VENDOR`, `EMAIL_EXIST_SINGLE_VENDOR`, `PHONE_EXIST_SINGLE_VENDOR`, `CHANGE_PASSWORD`, `PUSH_NOTIFICATION_TOKEN`; W `SINGLE_VENDOR_LOGIN`, … | same shapes as MULTI | L1, unchanged. |
| `getUsersActiveOrders`, `getUsersPastOrders`, `orderStatusChanged`, `reviewOrder`, `coupon` (L5) | AQ `GET_USERS_ACTIVE_ORDERS`, `GET_USERS_PAST_ORDERS`; AS `orderStatusChanged`; AM `REVIEW_ORDER_SINGLE_VENDOR`, `COUPON`; W `SINGLE_VENDOR_ACTIVE_ORDERS`, `SINGLE_VENDOR_PAST_ORDERS`, `SINGLE_VENDOR_ORDER_STATUS` | select `orderState` where present | L5 roots; L12 `Order.orderState`. |
| `orderTracking`, `subscriptionOrderTracking`, `chat`, `sendChatMessage`, `subscriptionNewMessage` (L6) | AS `orderTracking`, `subscriptionOrderTracking`; W `SINGLE_VENDOR_TRACKING`, `SINGLE_VENDOR_TRACKING_UPDATED`; RIDER `SINGLE_VENDOR_CHAT`, `SINGLE_VENDOR_SEND_CHAT_MESSAGE`, `SINGLE_VENDOR_SUBSCRIPTION_NEW_MESSAGE` | chat without `image` | L6, unchanged. |
| `banners` (L2), `getSingleUserSupportTickets`, `getTicketMessages`, `createSupportTicket`, `createMessage` (L4) | AQ `GET_BANNERS`, `GET_SINGLE_USER_SUPPORT_TICKETS`, `GET_TICKET_MESSAGES`; AM `CREATE_SUPPORT_TICKET`, `CREATE_MESSAGE`; W `SINGLE_VENDOR_BANNERS` | same shapes | owners, unchanged. |
| `configuration` (L2) | SV `GET_CONFIGURATION` via `adminConfiguration` | adds `isMultiVendor`, `restaurantCount`, `isAppLaunched` (L12 field resolvers) and `googleApiKey`, `has*Configured` (L2, P5). | L12 + L2. |

---

## Contract notes

L12 owns `contracts/enatega/L12-single-vendor.graphql`. The SDL below replaces whatever W1-0.3 generated for L12 roots; type names that a fragment fixes are kept (`HomeFoodItem` for `fragment SingleVendorDiscoveryProduct on HomeFoodItem`, `CategoryProduct` for `fragment SingleVendorDiscoveryDealProduct on CategoryProduct`, `AQ:4,25`). All other L12 type names are L12's choice; no client reads `__typename` for them.

Conventions used by every L12 type:

- **Ids** are UUID strings (D2). Types that the apps read as `id` expose `id: ID!`; types read as `_id` expose `_id: ID!`; product and variation types expose both.
- **Money** is `Float` in major units at the boundary (`toMajor(minor, exponent)`), integer minor units everywhere else. `discountValue` is a percent (e.g. `10`) for `PERCENTAGE` deals and major units for `FIXED` deals. `Voucher.discount` is a percent.
- **Timestamps** are ISO-8601 strings (`isoString`). The single-vendor admin also accepts epoch strings for deal dates (`deals/view/main/index.tsx:229-238`), but ISO is what we send. Schedule times are `"HH:MM"`: `[String]` (one element) in the admin types, `String` in the customer types.
- **Misspellings/odd names kept:** `getAllfoods`, `getAllfoodsPaginated`, `hasnext`, `hasprev`, `outofstock`, `UOM`, `couponsbyRestaurant`, `deliverChargesAmount`, `isBelowMaximumOrder` (true means "below the small-order threshold", SV14), `stripe_plan_id`, `variation_id`, `_type`, snake_case dashboard fields, `inputCreateFood`/`inputUpdateFood`, lowercase `CreditRecordType` values.
- **Field restrictions:** `Configuration.restaurantCount` resolves to `null` for anyone but A/S(Configuration) (reference/04 §C). `User.stripe_plan_id` resolves to `null` unless the caller is that user or ADMIN.
- **Variable types** match the documents exactly (GraphQL rejects `String!` variables in `ID` positions): `getAllfoods(restaurantId: String!)`, `getFavoriteFoodsStatus(foodId: String)`, `orderDetailsPage(orderId: String!)`, `deleteBannerRestaurant(id: String!)`, `bannerRestaurant(banner: String!, restaurantId: ID!)`, `subscriptionPaymentSuccess(userId: String!)`, all others as declared below.
- Variables the apps send but do not declare (`dateKeyword` on the dashboard query, `input` on `cancelSubscription`) are ignored by GraphQL and need no argument.

Fields on other lanes' types that L12 resolves (they are declared by their owners in W1 because the single-vendor documents validate at G1; Task 1 Step 3 verifies and adds an `extend type` here only if a field is missing):

| Type (owner) | Field | Type | Resolver |
|---|---|---|---|
| `Order` (L5) | `orderState` | `String` | L12 `OrderStateResolver` |
| `User` (L1) | `stripe_plan_id` | `String` | L12 `UserMembershipResolver` |
| `Configuration` (L2) | `isMultiVendor`, `isAppLaunched` | `Boolean` | L12 `ConfigurationModeResolver` |
| `Configuration` (L2) | `restaurantCount` | `Int` | L12 `ConfigurationModeResolver` (admin-only) |

```graphql
# contracts/enatega/L12-single-vendor.graphql
# Lane L12 — single-vendor. Every root is gated by SINGLE_VENDOR_ENABLED (master D1):
# while disabled it returns NOT_IMPLEMENTED "<operation> is not available yet".
# Money: Float major units. Timestamps: ISO-8601 strings. Ids: UUID strings.

enum CreditRecordType {
  credit
  debit
}

# ---------- inputs ----------
input CartAddonInput {
  _id: ID!
  options: [ID]
}
input CartVariationInput {
  _id: ID!
  addons: [CartAddonInput]
  count: Int!
}
input CartFoodInput {
  _id: ID!
  "Ignored: web sends the restaurant id here (User.context.tsx:734). The category is read from the catalog."
  categoryId: String
  specialInstructions: String
  variation: CartVariationInput!
}
input CartInput {
  food: [CartFoodInput!]!
}
input UpdateCartCountInput {
  "Cart line id (CartVariation._id)."
  variation_id: ID!
  foodId: ID!
  categoryId: String
  variationId: ID
  "increase | decrease | delete"
  action: String!
  "New absolute quantity."
  count: Int
}
input EditSingleVendorCartItemInput {
  cartItemId: ID!
  foodId: ID!
  categoryId: String
  variationId: ID!
  addons: [CartAddonInput]
  quantity: Int!
  specialInstructions: String
  expectedCartRevision: Int
}
input OffsetPaginationInput {
  offset: Int
  limit: Int
}
input FeedbackInput {
  rating: Float!
  comments: String!
}
input CreateDealInput {
  title: String!
  "PERCENTAGE | FIXED (percentage_off / fixed_amount_off accepted and normalised)"
  discountType: String!
  food: ID!
  variation: ID!
  restaurant: ID!
  discountValue: Float!
  startDate: String!
  endDate: String!
  isActive: Boolean
}
input UpdateDealInput {
  title: String
  discountType: String
  food: ID
  variation: ID
  restaurant: ID
  discountValue: Float
  startDate: String
  endDate: String
  isActive: Boolean
}
input NutritionInput {
  name: String!
  quantity: String!
}
input OrderQuantityInput {
  min: Int
  max: Int
}
input VariationDealInput {
  title: String
  discountType: String
  startDate: String
  endDate: String
  discountValue: Float
  isActive: Boolean
}
input SingleVendorVariationInput {
  id: ID
  title: String!
  price: Float!
  discounted: Float
  addons: [ID]
  isOutOfStock: Boolean
  deal: VariationDealInput
}
input SingleVendorFoodFieldsInput {
  restaurant: ID
  category: ID!
  subCategory: ID
  title: String!
  description: String
  ingredients: String
  usage: String
  nutritionDetail: String
  nutritions: [NutritionInput]
  image: String
  isActive: Boolean
  isOutOfStock: Boolean
  inventory: Int
  UOM: String
  orderQuantity: OrderQuantityInput
}
input inputCreateFood {
  food: SingleVendorFoodFieldsInput!
  variations: [SingleVendorVariationInput!]!
}
input inputUpdateFood {
  food: SingleVendorFoodFieldsInput!
  variations: [SingleVendorVariationInput!]!
}
input BannerRestaurantInput {
  "Empty string on create (banners/add-form/index.tsx:96)."
  _id: String
  title: String!
  description: String
  file: String
  foodId: ID
  restaurant: ID!
}
input ScheduleTimeInput {
  _id: ID
  "One element, \"HH:MM\". Empty arrays together with an _id delete the slot (view/main/index.tsx:167-176)."
  startTime: [String]
  endTime: [String]
  maxOrder: Int
}
input ScheduleTypeInput {
  _id: ID
  day: String
  isOpen: Boolean
  times: [ScheduleTimeInput]
}
input CreatePriceInput {
  amount: Float!
  "month | year"
  interval: String!
  intervalCount: Int!
}
input DeactivatePriceInput {
  priceId: ID!
}
input CreateSubscriptionInput {
  stripePriceId: String!
  paymentMethodId: String!
}
input UpdateSubscriptionInput {
  newStripePriceId: String
}
input VendorTypeConfigurationInput {
  isMultiVendor: Boolean!
}
input GeneralConfigurationInput {
  isAppLaunched: Boolean!
}

# ---------- catalog ----------
type DealSummary {
  id: ID!
  title: String
  "PERCENTAGE | FIXED"
  discountType: String
  "percent for PERCENTAGE, major units for FIXED"
  discountValue: Float
  isActive: Boolean
}
type ProductVariation {
  id: ID!
  _id: ID!
  title: String
  "same as title (searchFood selects name)"
  name: String
  price: Float
  discounted: Float
  isOutOfStock: Boolean
  outofstock: Boolean
  "addon ids"
  addons: [String]
  deal: DealSummary
}
type CategoryProduct {
  id: ID!
  _id: ID!
  categoryId: ID
  "sub-category id"
  subCategory: String
  title: String
  description: String
  image: String
  isOutOfStock: Boolean
  isFavourite: Boolean
  isActive: Boolean
  createdAt: String
  updatedAt: String
  variations: [ProductVariation]
}
type HomeFoodItem {
  id: ID!
  _id: ID!
  categoryId: ID
  subCategory: String
  title: String
  description: String
  image: String
  isOutOfStock: Boolean
  isFavourite: Boolean
  isActive: Boolean
  createdAt: String
  updatedAt: String
  variations: [ProductVariation]
}
type ItemsPagination {
  currentPage: Int
  totalPages: Int
  totalItems: Int
  hasMore: Boolean
}
type ProductPage {
  items: [CategoryProduct]
  totalCount: Int
  hasMore: Boolean
  pagination: ItemsPagination
}
type SingleVendorCategory {
  id: ID!
  name: String
  "category image (no separate icon exists in L3)"
  icon: String
  image: String
  description: String
  itemCount: Int
  "see-all when the category has sub-categories, list otherwise"
  viewType: String
  items: [HomeFoodItem]
  pagination: ItemsPagination
}
type DiscoveryBanner {
  _id: ID!
  title: String
  description: String
  action: String
  screen: String
  file: String
  parameters: String
  buttonText: String
}
type DiscoveryDeals {
  limitedTime: ProductPage
  weekly: ProductPage
  newOffers: ProductPage
}
type SingleVendorDiscovery {
  catalogVersion: String
  banners: [DiscoveryBanner]
  categories: [SingleVendorCategory]
  deals: DiscoveryDeals
}
type SubCategoryItems {
  subCategoryId: ID
  subCategoryName: String
  items: [CategoryProduct]
}
type CategoryWithSubCategories {
  categoryId: ID
  categoryName: String
  "foods of the category that have no sub-category"
  items: [CategoryProduct]
  subCategories: [SubCategoryItems]
}
type CategoryItemsResult {
  categoryId: ID
  categoryName: String
  items: [CategoryProduct]
  pagination: ItemsPagination
}
type AddonOptionDetail {
  id: ID!
  title: String
  description: String
  price: Float
  isSelected: Boolean
}
type AddonDetail {
  id: ID!
  title: String
  description: String
  isSelected: Boolean
  quantityMinimum: Int
  quantityMaximum: Int
  options: [AddonOptionDetail]
}
type DetailedVariation {
  id: ID!
  title: String
  price: Float
  isOutOfStock: Boolean
  addons: [AddonDetail]
  cartQuantity: Int
  isSelected: Boolean
  actualUnitPrice: Float
  discountedUnitPrice: Float
  deal: DealSummary
}
type SelectedAddon {
  _id: ID!
  options: [ID]
}
type Nutrition {
  name: String
  quantity: String
}
type FoodDetails {
  id: ID!
  title: String
  description: String
  image: String
  isPopular: Boolean
  isOutOfStock: Boolean
  cartQuantity: Int
  usage: String
  ingredients: String
  nutritionDetail: String
  categoryId: ID
  selectedAddonsId: [SelectedAddon]
  selectedVariationsIds: [ID]
  nutritions: [Nutrition]
  variations: [DetailedVariation]
}
type Voucher {
  _id: ID!
  title: String
  "percent"
  discount: Float
  enabled: Boolean
  couponType: String
}
type FavoriteFoodsResult {
  success: Boolean
  message: String
  data: [CategoryProduct]
}
type FavoriteResult {
  success: Boolean
  message: String
  isFavorite: Boolean
}

# ---------- admin catalog ----------
type AdminVariationDeal {
  id: ID!
  name: String
  type: String
  value: Float
  startDate: String
  endDate: String
  isActive: Boolean
}
type AdminVariationAddon {
  title: String
  description: String
  isActive: Boolean
}
type AdminFoodVariation {
  id: ID!
  title: String
  price: Float
  outofstock: Boolean
  deal: AdminVariationDeal
  addons: [AdminVariationAddon]
}
type OrderQuantity {
  min: Int
  max: Int
}
type AdminFood {
  id: ID!
  title: String
  description: String
  subCategory: String
  ingredients: String
  usage: String
  nutritions: [Nutrition]
  nutritionDetail: String
  image: String
  isActive: Boolean
  isOutOfStock: Boolean
  UOM: String
  inventory: Int
  orderQuantity: OrderQuantity
  variations: [AdminFoodVariation]
}
type AdminFoodCategory {
  id: ID!
  title: String
}
type AdminFoodEntry {
  category: AdminFoodCategory
  food: AdminFood
}
type AdminFoodPage {
  page: Int
  limit: Int
  hasnext: Boolean
  hasprev: Boolean
  totalFoods: Int
  foods: [AdminFoodEntry]
}
type SavedFood {
  _id: ID!
  title: String
  description: String
  subCategory: String
  variations: [ProductVariation]
  image: String
  isActive: Boolean
}
type SavedFoodCategory {
  _id: ID!
  title: String
  foods: [SavedFood]
  createdAt: String
  updatedAt: String
}
type SavedFoodRestaurant {
  _id: ID!
  categories: [SavedFoodCategory]
}
type FoodDeal {
  id: ID!
  title: String
  discountType: String
  food: ID
  variation: ID
  restaurant: ID
  startDate: String
  endDate: String
  discountValue: Float
  isActive: Boolean
  createdAt: String
  updatedAt: String
  foodTitle: String
  variationTitle: String
}
type FoodDealPage {
  total: Int
  page: Int
  limit: Int
  deals: [FoodDeal]
}
type MessageResult {
  message: String
}
type SimpleResult {
  success: Boolean
  message: String
}
type RestaurantBanner {
  _id: ID!
  title: String
  description: String
  file: String
  foodId: ID
  restaurant: ID
  foodImage: String
  foodTitle: String
  "file, else the linked food's image"
  displayImage: String
  isActive: Boolean
}

# ---------- schedules ----------
type ScheduleSlot {
  _id: ID!
  startTime: [String]
  endTime: [String]
  maxOrder: Int
}
type ScheduleDay {
  _id: ID!
  "MON..SUN"
  day: String
  isOpen: Boolean
  times: [ScheduleSlot]
}
type RestaurantScheduleResult {
  name: String
  scheduleTimings: [ScheduleDay]
}
type ScheduleTimeSlot {
  id: ID!
  startTime: String
  endTime: String
  maxOrder: Int
}
type ScheduleTimingGroup {
  id: ID!
  times: [ScheduleTimeSlot]
}
type ScheduleByDay {
  "YYYY-MM-DD in the store time zone"
  date: String
  day: String
  dayId: ID
  timings: [ScheduleTimingGroup]
}
type ScheduleSummary {
  "e.g. \"MON-WED 09:00-17:00; FRI 10:00-16:00\" (Saturday excluded)"
  openDaysTimes: String
  "e.g. \"MON-WED, FRI\""
  openDaysString: String
  "e.g. \"10:00-14:00\"; empty when Saturday is closed"
  saturdaySlotString: String
}

# ---------- cart and checkout ----------
type CartAddon {
  addonId: ID
  optionId: ID
  "option title"
  title: String
  price: Float
}
type CartDealInfo {
  id: ID
  dealId: ID
  title: String
  dealTitle: String
  discountValue: Float
  discountType: String
}
type CartVariation {
  "cart line id"
  _id: ID!
  variationId: ID
  variationTitle: String
  unitPrice: Float
  quantity: Int
  addons: [CartAddon]
  addonsTotal: Float
  actualUnitPrice: Float
  discountedUnitPrice: Float
  actualItemTotal: Float
  discountedItemTotal: Float
  itemTotal: Float
  dealId: ID
  dealInfo: CartDealInfo
  specialInstructions: String
}
type CartFood {
  categoryId: ID
  foodId: ID
  foodTitle: String
  foodImage: String
  variations: [CartVariation]
  actualFoodTotal: Float
  discountedFoodTotal: Float
  foodTotal: Float
}
type CartDeal {
  variationId: ID
  variationTitle: String
  foodId: ID
  foodTitle: String
  quantity: Int
  dealId: ID
  dealTitle: String
  discountType: String
  discountValue: Float
  originalPrice: Float
  discountedPrice: Float
  savingsPerUnit: Float
  totalSavings: Float
}
type SingleVendorCart {
  success: Boolean
  message: String
  grandTotal: Float
  actualGrandTotal: Float
  discountedGrandTotal: Float
  totalDiscount: Float
  hasDeals: Boolean
  isBelowMinimumOrder: Boolean
  lowOrderFees: Float
  maxOrderAmount: Float
  minOrderAmount: Float
  cartId: ID
  cartRevision: Int
  foods: [CartFood]
  deals: [CartDeal]
}
type CartCountResult {
  success: Boolean
  message: String
  quantity: Int
  itemTotal: Float
  foodTotal: Float
  grandTotal: Float
  isBelowMinimumOrder: Boolean
}
type CheckoutAddon {
  "option id"
  id: ID
  title: String
  price: Float
  addonId: ID
}
type CheckoutItem {
  foodId: ID
  foodTitle: String
  categoryId: ID
  variationId: ID
  variationTitle: String
  quantity: Int
  unitPrice: Float
  addons: [CheckoutAddon]
  addonsTotal: Float
  itemTotal: Float
}
type CheckoutDiscountDetails {
  subscriptionDiscount: Float
  freeDeliveryApplied: Boolean
  couponDiscount: Float
  dealDiscount: Float
}
type CheckoutSummary {
  success: Boolean
  message: String
  cartId: ID
  items: [CheckoutItem]
  subtotal: Float
  deliveryCharges: Float
  originalDeliveryCharges: Float
  deliveryDiscount: Float
  serviceFee: Float
  minimumOrderFee: Float
  taxAmount: Float
  taxPercentage: Float
  grandTotal: Float
  totalDiscount: Float
  discountDetails: CheckoutDiscountDetails
  hasActiveSubscription: Boolean
  freeDeliveriesRemaining: Int
  appliedFreeDelivery: Boolean
  minimumOrderAmount: Float
  isBelowMinimumOrder: Boolean
  isBelowMaximumOrder: Boolean
  couponDiscountAmount: Float
  couponApplied: Boolean
  priorityDeliveryFees: Float
  creditsUsed: Float
  maximumOrderAmount: Float
  checkoutQuoteId: ID
  checkoutQuoteExpiresAt: String
  cartRevision: Int
}

# ---------- single-vendor order views ----------
type SingleVendorOrderRider {
  phone: String
}
type SingleVendorOrderAddress {
  _id: ID
  id: ID
  deliveryAddress: String
  details: String
  label: String
  location: Location
}
type SingleVendorOrderVariation {
  _id: ID
  title: String
  image: String
  price: Float
  discounted: Float
  createdAt: String
  updatedAt: String
}
type SingleVendorOrderOption {
  title: String
  description: String
  price: Float
  isActive: Boolean
}
type SingleVendorOrderAddon {
  title: String
  description: String
  quantityMinimum: Int
  quantityMaximum: Int
  isActive: Boolean
  options: [SingleVendorOrderOption]
}
type SingleVendorOrderItem {
  _id: ID!
  food: ID
  title: String
  description: String
  image: String
  quantity: Int
  specialInstructions: String
  isActive: Boolean
  foodImage: String
  foodTitle: String
  variationImage: String
  variationTitle: String
  variationTotal: Float
  foodQuantity: Int
  variation: SingleVendorOrderVariation
  addons: [SingleVendorOrderAddon]
}
type SingleVendorOrderData {
  _id: ID!
  orderId: String
  paidAmount: Float
  orderAmount: Float
  orderStatus: String
  paymentStatus: String
  deliveryCharges: Float
  deliveryDiscount: Float
  couponDiscount: Float
  tipping: Float
  taxationAmount: Float
  orderDate: String
  isPriority: Boolean
  isPickedUp: Boolean
  completionTime: String
  instructions: String
  itemsSubTotal: Float
  minimumOrderFee: Float
  minimumOrderAmount: Float
  isBelowMinimumOrder: Boolean
  isBelowMaximumOrder: Boolean
  freeDeliveriesRemaining: Int
  priorityDeliveryFees: Float
  deliverChargesAmount: Float
  couponDiscountApplied: Boolean
  creditsApplied: Float
  rider: SingleVendorOrderRider
  deliveryAddress: SingleVendorOrderAddress
  items: [SingleVendorOrderItem]
}
type SingleVendorOrderPage {
  success: Boolean
  message: String
  rawOrder: Order
  data: SingleVendorOrderData
}

# ---------- credits, membership, notifications, dashboard, payments ----------
type CreditUser {
  _id: ID!
  name: String
  email: String
}
type CreditRecord {
  _id: ID!
  userId: CreditUser
  amount: Float
  "order reference entered by the admin (human order id)"
  orderId: String
  recordType: CreditRecordType
  createdAt: String
  updatedAt: String
}
type UserCredits {
  credits: Float
}
type SubscriptionPlan {
  id: ID!
  amount: Float
  interval: String
  intervalCount: Int
  productName: String
  productId: String
  discountPercent: Float
}
type SubscriptionPlans {
  plans: [SubscriptionPlan]
}
type PriceResult {
  success: Boolean
  message: String
  price: SubscriptionPlan
}
type FeedNotification {
  _id: ID!
  title: String
  body: String
  creator: String
  updatedAt: String
  createdAt: String
}
type NotificationFeed {
  total: Int
  skip: Int
  limit: Int
  hasMore: Boolean
  notifications: [FeedNotification]
}
type SalesTotals {
  total_orders: Int
  total_sales: Float
  total_sales_without_delivery: Float
  total_delivery_fee: Float
}
type SalesByType {
  "all | isPickedUp | isNotPickedUp (svadmin lib/utils/constants/dashboard.ts:7-11)"
  _type: String
  data: SalesTotals
}
type PaymentMethodSales {
  all: [SalesByType]
  cod: [SalesByType]
  card: [SalesByType]
}
type PaymentSuccess {
  userId: String
  "human order id"
  orderId: String
  orderObjId: ID
  orderStatus: String
  paymentStatus: String
  paymentMethod: String
}

extend type Query {
  "SV. A, S(Configuration). L2 Configuration plus L12 mode flags."
  adminConfiguration: Configuration
  "SV. A, S(Stores), V/R(own). Defined but unused by the UI."
  bannerRestaurant(banner: String!, restaurantId: ID!): RestaurantBanner
  "SV. A, S(Stores), V/R(own). Null restaurantId means the designated store."
  bannerRestaurants(restaurantId: ID): [RestaurantBanner]
  "APP, WEB. CUSTOMER."
  calculateCheckout(isPickup: Boolean, latDestination: Float, longDestination: Float, coupon: String): CheckoutSummary
  "APP, WEB. Public."
  couponsbyRestaurant: [Voucher]
  getAllCategoriesWithSubCategoriesDataSeeAllSingleVendor: [CategoryWithSubCategories]
  getAllCategoriesWithSubCategoriesOnlySeeAllSingleVendor: [CategoryWithSubCategories]
  "SV. A, S(Users)."
  getAllCreditsRecords(searchTerm: String): [CreditRecord]
  "SV. A, S(Stores), V/R(own)."
  getAllFoodDealsAdmin(page: Int!, limit: Int!, isActive: Boolean, search: String, restaurantId: ID!): FoodDealPage
  "APP, WEB: CUSTOMER. SV: ADMIN."
  getAllSubscriptionPlans: SubscriptionPlans
  "CUSTOMER."
  getAllUserCredits: UserCredits
  "SV. A, S(Users)."
  getAllUsersDropDownSearch(searchTerm: String): [CreditUser]
  getAllfoods(restaurantId: String!): [AdminFood]
  getAllfoodsPaginated(restaurantId: ID!, page: Int, limit: Int, search: String): AdminFoodPage
  getCategoryItemsSingleVendor(categoryId: ID!, skip: Int, limit: Int, search: String): CategoryItemsResult
  getCategoryProducts(categoryId: ID!, pagination: OffsetPaginationInput!): ProductPage
  getDashboardOrderSalesDetailsByPaymentMethod(restaurant: String!, starting_date: String!, ending_date: String!): PaymentMethodSales
  "CUSTOMER. Minutes."
  getEstimatedDeliveryTime(addressId: ID!): Int
  getFavoriteFoodsSingleVendor(limit: Int, skip: Int): FavoriteFoodsResult
  getFavoriteFoodsStatus(foodId: String): FavoriteResult
  getFoodDetails(foodId: ID!, categoryId: ID): FoodDetails
  getLimitedTimeFoodsDeals: ProductPage
  getMyFreeDeliveries: Int
  getMyReferralCode: String
  getNewOffersFoodsDeals: ProductPage
  getRecommendedFoods(foodId: ID!, skip: Int, limit: Int): ProductPage
  getRestaurantCategoriesSingleVendor: [SingleVendorCategory]
  getRestaurantSchedule(restaurantId: ID!): [ScheduleDay]
  getScheduleByDay: [ScheduleByDay]
  getScheduleUntilNextDayOff: ScheduleSummary
  getSimilarFoods(foodId: ID!, skip: Int, limit: Int): ProductPage
  getUserCart: SingleVendorCart
  getUserCreditsHistory: [CreditRecord]
  getWeeklyFoodsDeals: ProductPage
  "CUSTOMER, own order. Accepts the human order id or the order _id."
  orderDetailsPage(orderId: String!): SingleVendorOrderPage
  pastNotificationsByToken(skip: Int, limit: Int): NotificationFeed
  recentActiveOrder: SingleVendorOrderPage
  scheduledOrders(offset: Int, limit: Int): [Order]
  searchFood(search: String): [CategoryProduct]
  searchSingleVendorFoods(search: String!, skip: Int, limit: Int): ProductPage
  singleVendorBanners(page: Int, limit: Int): [DiscoveryBanner]
  "section: LIMITED_TIME | WEEKLY | NEW_OFFERS"
  singleVendorDeals(section: String!, skip: Int, limit: Int): ProductPage
  singleVendorDiscovery(previewLimit: Int, dealLimit: Int): SingleVendorDiscovery
  todayNotificationsByToken(skip: Int, limit: Int): NotificationFeed
}

extend type Mutation {
  cancelSubscription: MessageResult
  checkReferralCodeExists(referralCode: String!): Boolean
  clearCart: SimpleResult
  createBannerRestaurant(bannerInput: BannerRestaurantInput!): RestaurantBanner
  createFoodDeal(input: CreateDealInput!): FoodDeal
  createFoodSingleVendor(foodInput: inputCreateFood!): SavedFoodRestaurant
  createPriceForProduct(input: CreatePriceInput!): PriceResult
  createSubscription(input: CreateSubscriptionInput!): MessageResult
  deactivatePrice(input: DeactivatePriceInput!): SimpleResult
  deleteBannerRestaurant(id: String!): Boolean
  deleteFoodDeal(id: ID!): MessageResult
  editBannerRestaurant(bannerInput: BannerRestaurantInput!): RestaurantBanner
  editSingleVendorCartItem(input: EditSingleVendorCartItemInput!): SingleVendorCart
  editUserCreditsHistory(id: ID!, amount: Float!): CreditRecord
  giveFeedback(feedbackInput: FeedbackInput!): SimpleResult
  giveUserCredits(userId: ID!, amount: Float!, orderId: String!, recordType: CreditRecordType!): CreditRecord
  saveGeneralConfiguration(configurationInput: GeneralConfigurationInput!): Configuration
  saveVendorTypeToggle(configurationInput: VendorTypeConfigurationInput!): Configuration
  toggleFavoriteFoodSingleVendor(id: ID!): FavoriteResult
  updateFoodDeal(id: ID!, input: UpdateDealInput!): FoodDeal
  updateFoodSingleVendor(foodId: ID!, foodInput: inputUpdateFood!): SavedFoodRestaurant
  updateScheduleTimings(id: ID!, scheduleTimings: [ScheduleTypeInput]): RestaurantScheduleResult
  updateSubscription(input: UpdateSubscriptionInput!): MessageResult
  updateUserCartCount(input: UpdateCartCountInput!): CartCountResult
  userCartData(input: CartInput!): SingleVendorCart
}

extend type Subscription {
  "APP, WEB. The socket user must be userId. Fires when a single-vendor card order is paid."
  subscriptionPaymentSuccess(userId: String!): PaymentSuccess
}
```

`ScheduleData` (the `placeOrder` argument type, declared by L5) must be `input ScheduleData { isScheduled: Boolean dayId: ID scheduleTimeId: ID }` (web `Checkout.tsx:116-122`). L5 also declares `placeOrder` arguments `specialInstructions: String`, `scheduleData: ScheduleData`, `isPriority: Boolean`, `idempotencyKey: String`, `checkoutQuoteId: String` and makes `restaurant`, `orderInput`, `taxationAmount`, `deliveryCharges` nullable (least-strict rule, W1-0.3).

---

## Data model

L12 owns `services/api/prisma/schema/L12-single-vendor.prisma` and migration `20261020120_L12_init`. References to other lanes are scalar columns (no Prisma relations).

```prisma
// services/api/prisma/schema/L12-single-vendor.prisma

model SvSettings {
  id                       Int      @id @default(1)
  vendorMode               String   @default("MULTI") @db.VarChar(8)
  storeRestaurantId        String?  @db.Uuid
  isAppLaunched            Boolean  @default(false)
  serviceFeeMinor          BigInt   @default(0)
  smallOrderThresholdMinor BigInt   @default(0)
  smallOrderFeeMinor       BigInt   @default(0)
  priorityFeeMinor         BigInt   @default(0)
  quoteTtlSeconds          Int      @default(600)
  version                  Int      @default(1)
  updatedAt                DateTime @default(now()) @db.Timestamptz(3)
}

model SvFoodDetail {
  foodId          String   @id @db.Uuid
  restaurantId    String   @db.Uuid
  ingredients     String?  @db.VarChar(2000)
  usage           String?  @db.VarChar(2000)
  nutritionDetail String?  @db.VarChar(2000)
  nutritions      Json     @default("[]") @db.JsonB
  uom             String?  @db.VarChar(32)
  inventory       Int?
  orderMin        Int      @default(0)
  orderMax        Int      @default(0)
  updatedAt       DateTime @default(now()) @db.Timestamptz(3)
  @@index([restaurantId])
}

model SvDeal {
  id                  String    @id @db.Uuid
  restaurantId        String    @db.Uuid
  foodId              String    @db.Uuid
  variationId         String    @db.Uuid
  title               String    @db.VarChar(120)
  discountType        String    @db.VarChar(10)
  discountBasisPoints Int?
  discountMinor       BigInt?
  startsAt            DateTime  @db.Timestamptz(3)
  endsAt              DateTime  @db.Timestamptz(3)
  isActive            Boolean   @default(true)
  createdAt           DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime  @default(now()) @db.Timestamptz(3)
  deletedAt           DateTime? @db.Timestamptz(3)
  version             Int       @default(1)
  @@index([restaurantId, deletedAt])
  @@index([variationId, isActive])
}

model SvStoreBanner {
  id           String    @id @db.Uuid
  restaurantId String    @db.Uuid
  title        String    @db.VarChar(100)
  description  String?   @db.VarChar(500)
  file         String?   @db.VarChar(1000)
  foodId       String?   @db.Uuid
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime  @default(now()) @db.Timestamptz(3)
  deletedAt    DateTime? @db.Timestamptz(3)
  @@index([restaurantId, deletedAt])
}

model SvScheduleDay {
  id           String  @id @db.Uuid
  restaurantId String  @db.Uuid
  day          String  @db.VarChar(3)
  isOpen       Boolean @default(false)
  @@unique([restaurantId, day])
}

model SvScheduleSlot {
  id        String    @id @db.Uuid
  dayId     String    @db.Uuid
  startTime String    @db.VarChar(5)
  endTime   String    @db.VarChar(5)
  maxOrder  Int
  createdAt DateTime  @default(now()) @db.Timestamptz(3)
  deletedAt DateTime? @db.Timestamptz(3)
  day       SvScheduleDay @relation(fields: [dayId], references: [id], onDelete: Restrict)
  @@index([dayId, deletedAt])
}

model SvCart {
  id           String       @id @db.Uuid
  userId       String       @unique @db.Uuid
  restaurantId String       @db.Uuid
  revision     Int          @default(0)
  createdAt    DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime     @default(now()) @db.Timestamptz(3)
  lines        SvCartLine[]
}

model SvCartLine {
  id                  String   @id @db.Uuid
  cartId              String   @db.Uuid
  foodId              String   @db.Uuid
  variationId         String   @db.Uuid
  addonsKey           String   @default("") @db.VarChar(2000)
  addons              Json     @default("[]") @db.JsonB
  quantity            Int
  specialInstructions String   @default("") @db.VarChar(500)
  createdAt           DateTime @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime @default(now()) @db.Timestamptz(3)
  cart                SvCart   @relation(fields: [cartId], references: [id], onDelete: Cascade)
  @@unique([cartId, foodId, variationId, addonsKey])
}

model SvCheckoutQuote {
  id           String    @id @db.Uuid
  userId       String    @db.Uuid
  cartId       String    @db.Uuid
  cartRevision Int
  restaurantId String    @db.Uuid
  isPickup     Boolean
  latitude     Float?
  longitude    Float?
  couponId     String?   @db.Uuid
  amounts      Json      @db.JsonB
  totalMinor   BigInt
  currency     String    @db.VarChar(3)
  expiresAt    DateTime  @db.Timestamptz(3)
  consumedAt   DateTime? @db.Timestamptz(3)
  orderId      String?   @db.Uuid
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  @@index([userId, createdAt])
}

model SvOrder {
  orderId        String    @id @db.Uuid
  humanOrderId   String    @db.VarChar(32)
  userId         String    @db.Uuid
  restaurantId   String    @db.Uuid
  quoteId        String    @db.Uuid
  idempotencyKey String    @db.VarChar(100)
  paymentMethod  String    @db.VarChar(10)
  isPickedUp     Boolean
  isPriority     Boolean   @default(false)
  scheduleSlotId String?   @db.Uuid
  scheduledFor   DateTime? @db.Date
  scheduledAt    DateTime? @db.Timestamptz(3)
  address        Json?     @db.JsonB
  lines          Json      @db.JsonB
  amounts        Json      @db.JsonB
  instructions   String    @default("") @db.VarChar(500)
  orderDate      DateTime  @db.Timestamptz(3)
  lastStatus     String    @default("PENDING") @db.VarChar(12)
  createdAt      DateTime  @default(now()) @db.Timestamptz(3)
  cancelledAt    DateTime? @db.Timestamptz(3)
  @@unique([userId, idempotencyKey])
  @@index([userId, createdAt(sort: Desc)])
  @@index([scheduleSlotId, scheduledFor])
  @@index([restaurantId, createdAt])
}

model SvFavoriteFood {
  userId    String   @db.Uuid
  foodId    String   @db.Uuid
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@id([userId, foodId])
}

model SvCreditRecord {
  id             String   @id @db.Uuid
  userId         String   @db.Uuid
  recordType     String   @db.VarChar(6)
  orderReference String   @db.VarChar(64)
  amountMinor    BigInt
  currency       String   @db.VarChar(3)
  createdBy      String   @db.Uuid
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime @default(now()) @db.Timestamptz(3)
  version        Int      @default(1)
  @@index([userId, createdAt])
}

model SvCreditAdjustment {
  id            String   @id @db.Uuid
  recordId      String   @db.Uuid
  previousMinor BigInt
  newMinor      BigInt
  journalId     String   @db.Uuid
  actorId       String   @db.Uuid
  createdAt     DateTime @default(now()) @db.Timestamptz(3)
  @@index([recordId, createdAt])
}

model SvReferralCode {
  userId    String   @id @db.Uuid
  code      String   @unique @db.VarChar(16)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
}

model SvSubscriptionPlan {
  id                String   @id @db.Uuid
  providerPriceId   String   @unique @db.VarChar(100)
  providerProductId String   @db.VarChar(100)
  productName       String   @db.VarChar(120)
  amountMinor       BigInt
  currency          String   @db.VarChar(3)
  interval          String   @db.VarChar(5)
  intervalCount     Int
  discountPercent   Float?
  isActive          Boolean  @default(true)
  createdAt         DateTime @default(now()) @db.Timestamptz(3)
}

model SvUserSubscription {
  userId                 String    @id @db.Uuid
  planId                 String    @db.Uuid
  providerSubscriptionId String    @unique @db.VarChar(100)
  status                 String    @db.VarChar(20)
  currentPeriodEnd       DateTime? @db.Timestamptz(3)
  updatedAt              DateTime  @default(now()) @db.Timestamptz(3)
}

model SvFreeDeliveryGrant {
  id          String    @id @db.Uuid
  userId      String    @db.Uuid
  grantedAt   DateTime  @default(now()) @db.Timestamptz(3)
  usedOrderId String?   @db.Uuid
  usedAt      DateTime? @db.Timestamptz(3)
  @@index([userId, usedOrderId])
}

model SvFeedback {
  id        String   @id @db.Uuid
  userId    String   @db.Uuid
  rating    Int      @db.SmallInt
  comments  String   @db.VarChar(1000)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@index([userId, createdAt])
}
```

Raw SQL appended to the generated migration (`prisma/migrations/20261020120_L12_init/migration.sql`, after the generated `CREATE TABLE` statements):

```sql
ALTER TABLE "SvSettings" ADD CONSTRAINT "SvSettings_singleton" CHECK (id = 1);
ALTER TABLE "SvSettings" ADD CONSTRAINT "SvSettings_mode" CHECK ("vendorMode" IN ('MULTI', 'SINGLE'));
ALTER TABLE "SvSettings" ADD CONSTRAINT "SvSettings_fees" CHECK ("serviceFeeMinor" >= 0 AND "smallOrderThresholdMinor" >= 0 AND "smallOrderFeeMinor" >= 0 AND "priorityFeeMinor" >= 0 AND "quoteTtlSeconds" BETWEEN 60 AND 3600);
INSERT INTO "SvSettings"(id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE "SvFoodDetail" ADD CONSTRAINT "SvFoodDetail_limits" CHECK ("orderMin" >= 0 AND "orderMax" >= 0 AND ("orderMax" = 0 OR "orderMin" <= "orderMax") AND ("inventory" IS NULL OR "inventory" >= 0));

ALTER TABLE "SvDeal" ADD CONSTRAINT "SvDeal_type" CHECK (
  ("discountType" = 'PERCENTAGE' AND "discountBasisPoints" BETWEEN 1 AND 10000 AND "discountMinor" IS NULL)
  OR ("discountType" = 'FIXED' AND "discountMinor" > 0 AND "discountBasisPoints" IS NULL));
ALTER TABLE "SvDeal" ADD CONSTRAINT "SvDeal_window" CHECK ("endsAt" > "startsAt");

ALTER TABLE "SvScheduleDay" ADD CONSTRAINT "SvScheduleDay_day" CHECK ("day" IN ('MON','TUE','WED','THU','FRI','SAT','SUN'));
ALTER TABLE "SvScheduleSlot" ADD CONSTRAINT "SvScheduleSlot_times" CHECK ("startTime" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "endTime" ~ '^[0-2][0-9]:[0-5][0-9]$' AND "startTime" < "endTime" AND "maxOrder" BETWEEN 1 AND 1000);

ALTER TABLE "SvCartLine" ADD CONSTRAINT "SvCartLine_quantity" CHECK ("quantity" BETWEEN 1 AND 999);
ALTER TABLE "SvOrder" ADD CONSTRAINT "SvOrder_payment" CHECK ("paymentMethod" IN ('COD', 'STRIPE'));
ALTER TABLE "SvCreditRecord" ADD CONSTRAINT "SvCreditRecord_type" CHECK ("recordType" IN ('credit', 'debit') AND "amountMinor" > 0);
ALTER TABLE "SvFeedback" ADD CONSTRAINT "SvFeedback_rating" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "SvUserSubscription" ADD CONSTRAINT "SvUserSubscription_status" CHECK ("status" IN ('active', 'past_due', 'canceled', 'incomplete'));
ALTER TABLE "SvSubscriptionPlan" ADD CONSTRAINT "SvSubscriptionPlan_interval" CHECK ("interval" IN ('month', 'year') AND "intervalCount" BETWEEN 1 AND 12 AND "amountMinor" > 0);

-- Adjustments are history: never updated or deleted (AGENTS.md immutable journals).
CREATE FUNCTION sv_credit_adjustment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'credit adjustments are append only'; END; $$;
CREATE TRIGGER sv_credit_adjustment_immutable BEFORE UPDATE OR DELETE ON "SvCreditAdjustment"
  FOR EACH ROW EXECUTE FUNCTION sv_credit_adjustment_immutable();

-- One live deal per variation and period (R22).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "SvDeal" ADD CONSTRAINT "SvDeal_no_overlap" EXCLUDE USING gist (
  "variationId" WITH =, tstzrange("startsAt", "endsAt") WITH &&) WHERE ("isActive" AND "deletedAt" IS NULL);
```

Cross-lane foreign keys for `docs/CROSS_LANE_FKS.md` (lead adds them in a Wave 5 migration `20261020199_L12_cross_lane_fks`; table names are those of the owning lanes' Prisma models — confirm in Task 0 Step 4):

| Column | References | On delete |
|---|---|---|
| `SvSettings.storeRestaurantId` | `Restaurant.id` (L3) | RESTRICT |
| `SvFoodDetail.foodId`, `SvDeal.foodId`, `SvStoreBanner.foodId`, `SvCartLine.foodId`, `SvFavoriteFood.foodId` | `Food.id` (L3) | RESTRICT (foods are soft-deleted) |
| `SvDeal.variationId`, `SvCartLine.variationId` | `Variation.id` (L3) | RESTRICT |
| `SvFoodDetail.restaurantId`, `SvDeal.restaurantId`, `SvStoreBanner.restaurantId`, `SvScheduleDay.restaurantId`, `SvCart.restaurantId`, `SvCheckoutQuote.restaurantId`, `SvOrder.restaurantId` | `Restaurant.id` (L3) | RESTRICT |
| `SvCart.userId`, `SvCheckoutQuote.userId`, `SvOrder.userId`, `SvFavoriteFood.userId`, `SvCreditRecord.userId`, `SvCreditRecord.createdBy`, `SvCreditAdjustment.actorId`, `SvReferralCode.userId`, `SvUserSubscription.userId`, `SvFreeDeliveryGrant.userId`, `SvFeedback.userId` | `User.id` (L1) | RESTRICT |
| `SvOrder.orderId`, `SvCheckoutQuote.orderId`, `SvFreeDeliveryGrant.usedOrderId` | `Order.id` (L5) | RESTRICT |
| `SvCheckoutQuote.couponId` | `Coupon.id` (L3) | SET NULL |
| `SvCreditAdjustment.journalId` | `LedgerJournal.id` (L7) | RESTRICT |

---

## Business rules

Gate, store and access

- **R1** Every L12 root first calls `SvSettings.assertEnabled(name)`; when `SINGLE_VENDOR_ENABLED` is false it throws `NOT_IMPLEMENTED` "`<name>` is not available yet". Field resolvers on shared types are not gated (they only answer fields the single-vendor documents select).
- **R2** Customer operations act on the designated store. Without one: `NOT_FOUND` "The store is not configured yet".
- **R3** Store-scoped admin operations take the restaurant from their arguments (`restaurantId`, `restaurant`, `id`, `input.restaurant`, `bannerInput.restaurant`, `foodInput.food.restaurant`) or, for existing rows, from the row. Access: ADMIN; STAFF with `Stores`; VENDOR/RESTAURANT only when `requireOwnership(auth, { restaurantId })` passes. Never trust a restaurant id without this check.
- **R4** Credit operations: ADMIN or STAFF with `Users`. Configuration operations: ADMIN or STAFF with `Configuration`. Plan administration (`createPriceForProduct`, `deactivatePrice`, and `getAllSubscriptionPlans` for owners): ADMIN only.
- **R5** Customer-only operations use `requireAuth(auth, "CUSTOMER")`; data is always scoped to `auth.userId`. Another customer's cart line or order is reported exactly like a missing one (no existence leak).
- **R6** Public catalog queries work anonymously; with a CUSTOMER token they personalise `isFavourite`, `cartQuantity`, `isSelected`, `selectedVariationsIds`, `selectedAddonsId`.

Catalog and deals

- **R7** Visible foods: `isActive` foods whose category exists, ordered by category position then title. A food is out of stock when it or all its variations are out of stock.
- **R8** A deal is live when `isActive`, `startsAt ≤ now < endsAt` and not deleted. A variation's displayed deal is its newest live deal. Deal price = base price − deal (percent via `percentOf`, fixed clamped at 0). Addon prices are never discounted.
- **R9** Sections (SV7): `LIMITED_TIME` live and `endsAt − now ≤ 72 h` (ordered by `endsAt`), `WEEKLY` live and `endsAt − startsAt ≤ 7 days`, `NEW_OFFERS` live and `now − startsAt ≤ 7 days` (both ordered by `startsAt` desc). A food appears once per section. Unknown section: `BAD_USER_INPUT` "Unknown deal section".
- **R10** `skip`/`offset` default 0, `limit` default 20, max 50. `pagination.currentPage = floor(skip/limit) + 1`.
- **R11** Search: trimmed text, case-insensitive substring of title or description; empty text returns no items; text longer than 100 characters: `BAD_USER_INPUT` "Search text is too long".
- **R12** `viewType` is `see-all` when the category has sub-categories, `list` otherwise. `itemCount` counts visible foods.
- **R13** `isPopular`: the food is among the 10 foods with the highest ordered quantity in non-cancelled single-vendor orders of the last 30 days.
- **R14** Recommended: foods most often in the same single-vendor order, then same-category foods, excluding the food itself. Similar: same sub-category first, then same category, excluding itself. Unknown food: `NOT_FOUND` "Product not found".
- **R15** `catalogVersion` = first 16 hex chars of SHA-256 over category/food/variation ids and `updatedAt` plus deal ids and `updatedAt`; it changes whenever displayed catalog data changes.
- **R16** `couponsbyRestaurant` lists the store's enabled, currently valid coupons from `COUPONS_PORT.list`. `discount` is the percent.

Cart

- **R17** Cart lines are identified by `(foodId, variationId, addon selection)`. Adding an identical configuration adds to its quantity. Addon selections are normalised: options merged per addon, de-duplicated, sorted.
- **R18** Selection validation (`resolveSelection`), in order, each returning `success: false` with the quoted message: unknown or inactive food "This product is no longer available"; variation not of the food "This product option is no longer available"; out of stock "This item is out of stock"; addon not attached to the variation "This add-on is not available for this product"; option not in the addon "This add-on option is not available"; more options than `quantityMaximum` "Choose at most <n> options for <addon>"; fewer than `quantityMinimum` for any attached addon "Choose at least <n> options for <addon>".
- **R19** Quantity per line is between `max(1, orderMin)` and `orderMax` (or 99 when `orderMax` is 0) from `SvFoodDetail`; otherwise `success: false` "You can order between <min> and <max> of this item".
- **R20** Business-rule failures of cart mutations return `success: false` and a message (both apps show `message`, `useAddToCart.js:32-38`, `ProductDetails.js:71-74`); malformed ids are `BAD_USER_INPUT`. Every successful cart mutation increments `cartRevision` by 1.
- **R21** Cart totals: `actualUnit = variation + Σ options`; `discountedUnit = dealPrice(variation) + Σ options`; `itemTotal = discountedItemTotal = discountedUnit × qty`; `grandTotal = discountedGrandTotal = Σ itemTotal`; `totalDiscount = actualGrandTotal − discountedGrandTotal`; `minOrderAmount` = restaurant minimum; `isBelowMinimumOrder = discountedGrandTotal < minOrderAmount`; `maxOrderAmount` = small-order threshold; `lowOrderFees` = small-order fee when `discountedGrandTotal` is below a non-zero threshold, else 0. Lines whose food or variation disappeared are left out of `foods` and totals and `message` is "Some items are no longer available". `updateUserCartCount` on a line not in the caller's cart: `success: false` "This item is no longer in your cart". `editSingleVendorCartItem` with a stale `expectedCartRevision`: `success: false` "Your cart changed, please try again".
- **R22** Deals (admin): `discountType` must be `PERCENTAGE` or `FIXED` (`percentage_off`/`fixed_amount_off` accepted) else "Discount type must be PERCENTAGE or FIXED"; percentage `0 < v ≤ 100` else "Percentage must be between 0 and 100"; fixed `0 < v ≤ variation price` else "Fixed discount must be greater than 0 and not exceed the price"; dates parse else "Invalid start date"/"Invalid end date"; `end > start` else "End date must be after start date"; food and variation must belong to the restaurant else "Product not found"/"Variation not found"; overlapping active deal on the same variation: `CONFLICT` "An active deal already exists for this variation in that period" (database exclusion constraint, mapped from SQLSTATE `23P01`). Deletion is soft.

Checkout and orders

- **R23** Quote amounts (minor units): `subtotal` = Σ actual items; `dealDiscount` = Σ (actual − discounted) items; `couponDiscount = percentOf(discountedItems, coupon%)`; `delivery` = 0 for pickup, else `fixed ? rate : ceil(haversineKm) × rate`, falling back to `rate` when 0 (reference/02 §5.4); `serviceFee`, small-order fee (`isBelowMaximumOrder = threshold > 0 && discountedItems < threshold`) from `SvSettings`; `tax = percentOf(discountedItems − coupon + delivery, restaurant.taxPercent)`; `grandTotal = discountedItems − coupon + delivery + serviceFee + smallOrderFee + tax`; `isBelowMinimumOrder = (discountedItems − coupon + delivery) < minimumOrder`; `totalDiscount = dealDiscount + couponDiscount`; `creditsUsed = 0` (SV9); `priorityDeliveryFees` is the configured priority fee (0 for pickup) and is **not** in `grandTotal` (the app adds it only when priority is chosen, `Checkout.js:423`).
- **R24** `calculateCheckout` failures return `success: false` with: empty cart "Your cart is empty"; delivery without coordinates "Please select a delivery address"; outside the store's delivery bounds (or zone when no bounds) "Sorry! we can't deliver to your address." (exact string, `useCheckout.js:13`). An unknown coupon keeps `success: true`, sets `couponApplied: false`, `couponDiscountAmount: 0`, `message` "Coupon is not valid". The coupon argument matches a coupon `_id` (app sends the voucher id, `useCheckout.js:104`) or title (web sends the typed code).
- **R25** A successful `calculateCheckout` stores a quote (cart id and revision, pickup flag, coordinates, coupon, amounts, `expiresAt = now + quoteTtlSeconds`) and returns `checkoutQuoteId`, `checkoutQuoteExpiresAt`, `cartRevision`.
- **R26** Single-vendor `placeOrder` (via `SINGLE_VENDOR_CHECKOUT_PORT`), in order, each `BAD_USER_INPUT` unless noted: replay of a used `(user, idempotencyKey)` returns the original order (no second order); payment method `COD` or `STRIPE` else "Unsupported payment method"; `PAYPAL` "PayPal payments are not available"; `STRIPE` without a configured provider "Card payments are not available" (D12); missing `checkoutQuoteId` "Please review your order before placing it"; quote not the caller's or unknown `NOT_FOUND` "Checkout not found"; quote used "This checkout was already used"; quote expired "Your checkout expired, please review your order again"; `isPickedUp` differs from the quote "Delivery option changed, please review your order again"; cart revision differs "Your cart changed, please review your order again"; any line unavailable "Some items in your cart are no longer available"; recomputed `grandTotal` differs from the quote "Prices changed, please review your order again"; delivery address outside bounds "Sorry! we can't deliver to your address."; not scheduled and store inactive, unavailable or closed (`isOpenAt` in the store time zone) "The store is closed right now"; below minimum "Your order is below the minimum order amount"; tip negative "Tip must not be negative", tip greater than the discounted item subtotal "Tip is too high"; pickup forces tip 0 and ignores `isPriority`.
- **R27** Scheduling: `scheduleData.isScheduled` with `dayId` and `scheduleTimeId` must name an open day and live slot of the store else "This time slot is not available"; the slot is booked for the next date (within 7 days, store time zone) on that weekday whose slot start is in the future; capacity `maxOrder` counts non-cancelled `SvOrder` rows of that slot and date under `SELECT … FOR UPDATE` of the slot; full: "This time slot is full, please choose another". `scheduledAt` is the slot start instant; L5 stores it on the order and its accept timeout counts from `scheduledAt − 30 min` (P2).
- **R28** `placeOrder` writes, in one transaction: `OrdersPort.createPriced` (L5 inserts the order, items and the `order.placed` outbox event), `SvOrder` snapshot, quote `consumedAt`/`orderId`, cart lines deleted and revision incremented. Amounts sent to L5: `itemsMinor` = subtotal, `discountMinor` = deal + coupon, `deliveryMinor`, `taxMinor`, `tipMinor`, `feesMinor` = service + small-order + priority, `totalMinor` = grand total + priority + tip. L5's core-plan commission (0 %) applies (SV8).
- **R29** `orderDetailsPage(orderId)` accepts the human order id (web routes to `/order/<orderId>/tracking`, `Checkout.tsx:128`) or the UUID; only the caller's single-vendor orders; else `NOT_FOUND` "Order not found". `recentActiveOrder` returns the newest single-vendor order of the caller whose status is not `DELIVERED`/`CANCELLED`, else `success: false`, `message` "No active order", `rawOrder: null`, `data: null`. `scheduledOrders` lists the caller's orders with `scheduledAt`, status not terminal, ordered by `scheduledAt`.
- **R30** `Order.orderState` mapping (SV13). `getEstimatedDeliveryTime(addressId)`: the address must be the caller's (`ADDRESSES_PORT.owned`) else `NOT_FOUND` "Address not found"; outside bounds `BAD_USER_INPUT` "Sorry! we can't deliver to your address."; returns the store's `deliveryTimeMinutes`.

Favourites, schedules, banners, foods

- **R31** `toggleFavoriteFoodSingleVendor` on a non-visible food: `NOT_FOUND` "Product not found". Messages: "Added to favourites" / "Removed from favourites". List newest first; foods no longer visible are omitted.
- **R32** `getRestaurantSchedule` ensures seven day rows exist (`isOpen = false`, no slots) and returns them `MON…SUN`. `updateScheduleTimings` only touches the days and slots it names: a slot with `_id` and empty `startTime`/`endTime` is deleted (soft); with `_id` updated; without `_id` created. Validation (`BAD_USER_INPUT`): day must belong to the restaurant "Schedule day not found"; time "HH:MM" "Invalid time"; `start < end` "Start time must be before end time"; `maxOrder` integer 1–1000 "Max orders must be between 1 and 1000"; slots of a day must not overlap "Time slots must not overlap". Response `name` is the restaurant name.
- **R33** `getScheduleByDay` lists, for today and the next 6 days in store time, each open day with at least one future, non-full slot: `date` (`YYYY-MM-DD`), `day`, `dayId`, `timings: [{ id: dayId, times }]`. `getScheduleUntilNextDayOff` groups consecutive open days other than Saturday with identical slot strings (`"HH:MM-HH:MM"` joined by `", "`) into `openDaysTimes` (`"MON-WED 09:00-17:00; FRI 10:00-16:00"`), `openDaysString` (`"MON-WED, FRI"`), and Saturday's slots into `saturdaySlotString` (`""` when closed) — the format parsed by `RestaurantScheduleTime.js:37-56`.
- **R34** Store banners: `title` 1–100 chars "Title is required"; `file` empty or an `https://` URL or a `/media/` path "Invalid banner image"; `foodId` must be a food of the restaurant "Product not found"; edit/delete of unknown or other-store banner `NOT_FOUND` "Banner not found"; `editBannerRestaurant` without `_id` "Banner id is required". `displayImage = file ?? foodImage`. Delete is soft and returns `true`.
- **R35** Admin foods: `title` 1–200 chars "Title is required"; at least one variation "At least one variation is required"; prices ≥ 0 (via `toMinor`); `orderQuantity.max > 0` requires `min ≤ max` "Minimum quantity cannot exceed maximum quantity"; `inventory ≥ 0` "Inventory must not be negative"; nutrition name/quantity ≤ 100 chars "Nutrition values are too long". Category, sub-category and addon checks are L3's (`CATALOG_PORT.saveFood` throws `BAD_USER_INPUT`). A variation `deal` creates or replaces that variation's L12 deal (R22 rules). Update of a food not in the restaurant: `NOT_FOUND` "Product not found".

Credits, membership, referrals, feedback, notifications, dashboard, payments

- **R36** `giveUserCredits`: user must be an active customer `NOT_FOUND` "User not found"; `amount > 0` "Amount must be greater than 0"; `orderId` 1–64 chars "Order ID is required" and must be an order of that user (human id or UUID) "Order not found for this user"; a `debit` may not exceed the balance "Insufficient credits". One transaction: record, adjustment (0 → amount), journal (SV9), audit entry `credits.give`.
- **R37** `editUserCreditsHistory`: record must exist `NOT_FOUND` "Credit record not found"; new amount > 0; posts a journal for the delta only (credit: increase = grant, decrease = reversal; debit: the opposite); the resulting balance must stay ≥ 0 "Insufficient credits"; optimistic concurrency on `version` (`CONFLICT` "The credit record changed, try again"). Unchanged amount returns the record without a journal.
- **R38** Balance = Σ credit − Σ debit record amounts of the user (projection); it must equal `LEDGER_PORT.accountBalance("CUSTOMER_CREDIT:<userId>")` (test-enforced).
- **R39** Membership: SV10. `createPriceForProduct` validation: `amount > 0` "Amount must be greater than 0"; `interval` month/year "Interval must be month or year"; `intervalCount` 1–12 "Interval count must be between 1 and 12"; then `PROVIDER_UNAVAILABLE` "Subscription billing is not available" (no Stripe) or `NOT_IMPLEMENTED` "Subscription billing is not available yet" (Stripe present, adapter missing). `deactivatePrice`/`createSubscription` with an unknown plan `NOT_FOUND` "Plan not found". `createSubscription` with a known plan: `PROVIDER_UNAVAILABLE` "Membership payments are not available". `User.stripe_plan_id` is the active subscription's plan `providerPriceId`.
- **R40** Referral codes: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, one per customer, stable. `checkReferralCodeExists`: code trimmed, upper-cased, 4–16 chars else `BAD_USER_INPUT` "Invalid referral code".
- **R41** Feedback: `rating` integer 1–5 "Rating must be between 1 and 5"; `comments` trimmed 1–1000 chars "Please write your feedback"; returns `success: true`, `message` "Thank you for your feedback".
- **R42** Notifications by token: the caller's notifications from `NOTIFICATION_FEED_PORT` (L8); "today" = created since local midnight in the store time zone, "past" = before it. `hasMore = skip + returned < total`.
- **R43** Dashboard: dates parse with `parseClientDate`, `YYYY-MM-DD` end dates are inclusive (exclusive bound = next day), else `BAD_USER_INPUT` "Invalid date range"; `all`/`cod`/`card` (card = `STRIPE`) each contain `_type` `all`, `isPickedUp`, `isNotPickedUp`; `total_sales` = Σ `totalMinor`, `total_delivery_fee` = Σ `deliveryMinor`, `total_sales_without_delivery` = difference, over `DELIVERED` orders (`OrdersPort.salesSummary`).
- **R44** `subscriptionPaymentSuccess(userId)`: socket user must be the CUSTOMER `userId` else `FORBIDDEN`. Published by the L12 worker handler for `order.paid` when the order is a single-vendor order, on topic `SV_PAYMENT_SUCCESS.<userId>`, payload `{ userId, orderId: humanOrderId, orderObjId, orderStatus: lastStatus, paymentStatus: "PAID", paymentMethod }`.
- **R45** `POST /stripe/create-web-checkout-session`: `Authorization: Bearer <customer token>` else 401 `{ "error": "Unauthenticated" }`; body `{ id, payment_method }` with a UUID `id` else 400 `{ "error": "Invalid request" }`; order must be the caller's single-vendor order else 404 `{ "error": "Order not found" }`; must be `STRIPE`, `PENDING` payment, not cancelled else 409 `{ "error": "Order is not awaiting payment" }`; `paypal` 400 `{ "error": "PayPal payments are not available" }`; no provider 503 `{ "error": "Card payments are not available" }`; else 200 `{ "checkoutUrl" }` with success/cancel URLs on the request `Origin` (must be in `CORS_ORIGINS`, else 400) `…/stripe/success?orderId=<human id>` and `…/stripe/cancel?orderId=<human id>`.
- **R46** The L12 worker updates `SvOrder.lastStatus` on every `order.transitioned` event and sets `cancelledAt` on `CANCELLED` (frees scheduled-slot capacity).
- **R47** Configuration: `saveVendorTypeToggle(false)` needs exactly one active restaurant "Single-vendor mode needs exactly one active store" and designates it; `true` keeps the designation. Both config mutations write an audit entry (`AUDIT_PORT.record`) and return the admin `Configuration` view.

<!-- CONTINUE -->
