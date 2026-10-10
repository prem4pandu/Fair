# Enatega operation traceability matrix

**Generated file — do not hand-edit.** Regenerate with
`node tools/generate-operation-traceability.mjs`; `--check` fails when stale.

- Source: `vendor/enatega-ui (six packages, pinned d9eb29e)` (schemaVersion 1)
- Operations: 334 (159 query, 164 mutation, 11 subscription)
- Scoped multivendor document compatibility: PASS (531/531 documents valid)
- Full six-app document compatibility: PASS (845/845 valid; 0 unresolved)
- Resolvers implemented today: 23/334
- Recorded per-operation evidence: 0/334
- Roots with no SDL declaration: 0
- `OPERATION_LANES.json` is internally consistent (its `perLane` counts match the `operations` array).

`resolver` describes the schema's real resolver binding; `NOT_IMPLEMENTED` means the
root exists in the contract and fails explicitly at runtime via
`services/api/src/kernel/not-implemented.ts` — it is never a success. `sdl` names the
contract file that declares the root. `evidence` mirrors
`docs/OPERATION_TEST_EVIDENCE.json`; `UNRECORDED` means no verified test evidence has
been recorded yet, which is what `pnpm check:operations` fails on.

## Per-lane completeness

| Lane | Name                           | Operations | Resolver implemented | Not implemented |
| ---- | ------------------------------ | ---------- | -------------------- | --------------- |
| L0   | Platform kernel                | 1          | 1                    | 0               |
| L1   | Identity & sessions            | 30         | 13                   | 17              |
| L2   | Platform configuration         | 54         | 2                    | 52              |
| L3   | Vendors, catalog & discovery   | 75         | 2                    | 73              |
| L4   | Customers, addresses & support | 22         | 5                    | 17              |
| L5   | Orders, pricing & lifecycle    | 24         | 0                    | 24              |
| L6   | Dispatch, riders & tracking    | 32         | 0                    | 32              |
| L7   | Finance & payments             | 11         | 0                    | 11              |
| L8   | Notifications & messaging      | 5          | 0                    | 5               |
| L9   | Analytics                      | 9          | 0                    | 9               |
| L12  | Single-vendor (gated)          | 71         | 0                    | 71              |

## Ownership map

| Lane | Owning plan                           |
| ---- | ------------------------------------- |
| L0   | `01-wave0-foundation.md`              |
| L1   | `10-lane-L1-identity.md`              |
| L2   | `11-lane-L2-configuration.md`         |
| L3   | `12-lane-L3-catalog.md`               |
| L4   | `13-lane-L4-discovery.md`             |
| L5   | `14-lane-L5-orders.PARTIAL.md`        |
| L6   | `15-lane-L6-dispatch.PARTIAL.md`      |
| L7   | `16-lane-L7-finance.PARTIAL.md`       |
| L8   | `17-lane-L8-notifications.PARTIAL.md` |
| L9   | `18-lane-L9-analytics.md`             |
| L12  | `22-wave5-single-vendor.PARTIAL.md`   |

## Operations

| #   | Lane | Wave | Kind         | Operation                                                 | Multivendor apps              | Resolver        | SDL                          | Evidence     |
| --- | ---- | ---- | ------------ | --------------------------------------------------------- | ----------------------------- | --------------- | ---------------------------- | ------------ |
| 1   | L0   | 0    | mutation     | `metricsGeneral`                                          | admin, app, rider, store, web | IMPLEMENTED     | kernel.graphql               | NOT_VERIFIED |
| 2   | L1   | 2    | mutation     | `changePassword`                                          | app                           | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 3   | L1   | 2    | mutation     | `createStaff`                                             | admin                         | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 4   | L1   | 2    | mutation     | `createUser`                                              | app, web                      | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 5   | L1   | 2    | mutation     | `Deactivate`                                              | app, rider, web               | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 6   | L1   | 2    | mutation     | `deleteStaff`                                             | admin                         | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 7   | L1   | 2    | mutation     | `editStaff`                                               | admin                         | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 8   | L1   | 2    | mutation     | `emailExist`                                              | app, rider, web               | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 9   | L1   | 2    | mutation     | `forgotPassword`                                          | app, rider, web               | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 10  | L1   | 2    | mutation     | `login`                                                   | app, rider, web               | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 11  | L1   | 2    | mutation     | `ownerLogin`                                              | admin                         | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 12  | L1   | 2    | mutation     | `phoneExist`                                              | app, rider, web               | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 13  | L1   | 2    | mutation     | `pushToken`                                               | app                           | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 14  | L1   | 2    | mutation     | `refreshToken`                                            | admin                         | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 15  | L1   | 2    | mutation     | `resetPassword`                                           | app, rider, web               | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 16  | L1   | 2    | mutation     | `resetUserSession`                                        | admin                         | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 17  | L1   | 2    | mutation     | `restaurantLogin`                                         | store                         | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 18  | L1   | 2    | mutation     | `riderLogin`                                              | rider                         | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 19  | L1   | 2    | mutation     | `saveNotificationTokenWeb`                                | web                           | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 20  | L1   | 2    | mutation     | `saveRestaurantToken`                                     | store                         | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 21  | L1   | 2    | mutation     | `sendOtpToEmail`                                          | app, rider, web               | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 22  | L1   | 2    | mutation     | `sendOtpToPhoneNumber`                                    | app, rider, web               | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 23  | L1   | 2    | mutation     | `updateNotificationStatus`                                | app, web                      | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 24  | L1   | 2    | mutation     | `updateUser`                                              | app, web                      | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 25  | L1   | 2    | mutation     | `verifyOtp`                                               | app, web                      | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 26  | L1   | 2    | query        | `appleAuthNonce`                                          | app                           | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 27  | L1   | 2    | query        | `hasOwnerPermission`                                      | admin                         | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 28  | L1   | 2    | query        | `ownerSession`                                            | admin                         | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 29  | L1   | 2    | query        | `profile`                                                 | app, web                      | IMPLEMENTED     | L1-identity.graphql          | NOT_VERIFIED |
| 30  | L1   | 2    | query        | `staffs`                                                  | admin                         | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 31  | L1   | 2    | query        | `staffsPaginated`                                         | admin                         | NOT_IMPLEMENTED | L1-identity.graphql          | NOT_VERIFIED |
| 32  | L2   | 2    | mutation     | `createActivity`                                          | app                           | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 33  | L2   | 2    | mutation     | `createBanner`                                            | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 34  | L2   | 2    | mutation     | `createCuisine`                                           | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 35  | L2   | 2    | mutation     | `createShopType`                                          | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 36  | L2   | 2    | mutation     | `createTaxation`                                          | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 37  | L2   | 2    | mutation     | `createTipping`                                           | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 38  | L2   | 2    | mutation     | `createZone`                                              | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 39  | L2   | 2    | mutation     | `deleteBanner`                                            | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 40  | L2   | 2    | mutation     | `deleteCuisine`                                           | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 41  | L2   | 2    | mutation     | `deleteShopType`                                          | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 42  | L2   | 2    | mutation     | `deleteZone`                                              | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 43  | L2   | 2    | mutation     | `editBanner`                                              | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 44  | L2   | 2    | mutation     | `editCuisine`                                             | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 45  | L2   | 2    | mutation     | `editTaxation`                                            | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 46  | L2   | 2    | mutation     | `editTipping`                                             | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 47  | L2   | 2    | mutation     | `editZone`                                                | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 48  | L2   | 2    | mutation     | `saveAmplitudeApiKeyConfiguration`                        | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 49  | L2   | 2    | mutation     | `saveAppConfigurations`                                   | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 50  | L2   | 2    | mutation     | `saveCloudinaryConfiguration`                             | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 51  | L2   | 2    | mutation     | `saveCurrencyConfiguration`                               | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 52  | L2   | 2    | mutation     | `saveDeliveryRateConfiguration`                           | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 53  | L2   | 2    | mutation     | `saveEmailConfiguration`                                  | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 54  | L2   | 2    | mutation     | `saveFirebaseConfiguration`                               | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 55  | L2   | 2    | mutation     | `saveFormEmailConfiguration`                              | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 56  | L2   | 2    | mutation     | `saveGoogleApiKeyConfiguration`                           | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 57  | L2   | 2    | mutation     | `saveGoogleClientIDConfiguration`                         | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 58  | L2   | 2    | mutation     | `savePaypalConfiguration`                                 | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 59  | L2   | 2    | mutation     | `saveSendGridConfiguration`                               | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 60  | L2   | 2    | mutation     | `saveSentryConfiguration`                                 | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 61  | L2   | 2    | mutation     | `saveStripeConfiguration`                                 | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 62  | L2   | 2    | mutation     | `saveTwilioConfiguration`                                 | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 63  | L2   | 2    | mutation     | `saveVerificationsToggle`                                 | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 64  | L2   | 2    | mutation     | `saveWebConfiguration`                                    | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 65  | L2   | 2    | mutation     | `setVersions`                                             | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 66  | L2   | 2    | mutation     | `updateShopType`                                          | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 67  | L2   | 2    | mutation     | `uploadImageToS3`                                         | admin, app, rider             | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 68  | L2   | 2    | mutation     | `uploadToken`                                             | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 69  | L2   | 2    | query        | `auditLogs`                                               | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 70  | L2   | 2    | query        | `banners`                                                 | admin, app, web               | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 71  | L2   | 2    | query        | `configuration`                                           | admin, app, rider, store, web | IMPLEMENTED     | L2-platform.graphql          | NOT_VERIFIED |
| 72  | L2   | 2    | query        | `cuisines`                                                | admin, app                    | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 73  | L2   | 2    | query        | `cuisinesPaginated`                                       | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 74  | L2   | 2    | query        | `fetchAllShopTypes`                                       | app, web                      | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 75  | L2   | 2    | query        | `fetchShopTypeByUnique`                                   | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 76  | L2   | 2    | query        | `fetchShopTypes`                                          | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 77  | L2   | 2    | query        | `getCitiesByCountry`                                      | web                           | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 78  | L2   | 2    | query        | `getCountries`                                            | web                           | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 79  | L2   | 2    | query        | `getCountryByIso`                                         | app                           | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 80  | L2   | 2    | query        | `getVersions`                                             | admin, app                    | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 81  | L2   | 2    | query        | `publicConfiguration`                                     | app, web                      | IMPLEMENTED     | L2-platform.graphql          | NOT_VERIFIED |
| 82  | L2   | 2    | query        | `taxes`                                                   | app                           | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 83  | L2   | 2    | query        | `tips`                                                    | admin, app, web               | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 84  | L2   | 2    | query        | `zones`                                                   | admin, app, web               | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 85  | L2   | 2    | query        | `zonesPaginated`                                          | admin                         | NOT_IMPLEMENTED | L2-platform.graphql          | NOT_VERIFIED |
| 86  | L3   | 2    | mutation     | `createAddons`                                            | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 87  | L3   | 2    | mutation     | `createCategory`                                          | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 88  | L3   | 2    | mutation     | `createCoupon`                                            | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 89  | L3   | 2    | mutation     | `createFood`                                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 90  | L3   | 2    | mutation     | `createOptions`                                           | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 91  | L3   | 2    | mutation     | `createRestaurant`                                        | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 92  | L3   | 2    | mutation     | `createRestaurantCoupon`                                  | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 93  | L3   | 2    | mutation     | `createSubCategories`                                     | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 94  | L3   | 2    | mutation     | `createVendor`                                            | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 95  | L3   | 2    | mutation     | `deleteAddon`                                             | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 96  | L3   | 2    | mutation     | `deleteCategory`                                          | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 97  | L3   | 2    | mutation     | `deleteCoupon`                                            | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 98  | L3   | 2    | mutation     | `deleteFood`                                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 99  | L3   | 2    | mutation     | `deleteOption`                                            | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 100 | L3   | 2    | mutation     | `deleteRestaurant`                                        | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 101 | L3   | 2    | mutation     | `deleteRestaurantCoupon`                                  | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 102 | L3   | 2    | mutation     | `deleteSubCategory`                                       | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 103 | L3   | 2    | mutation     | `deleteVendor`                                            | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 104 | L3   | 2    | mutation     | `duplicateRestaurant`                                     | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 105 | L3   | 2    | mutation     | `editAddon`                                               | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 106 | L3   | 2    | mutation     | `editCategory`                                            | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 107 | L3   | 2    | mutation     | `editCoupon`                                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 108 | L3   | 2    | mutation     | `editFood`                                                | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 109 | L3   | 2    | mutation     | `editOption`                                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 110 | L3   | 2    | mutation     | `editRestaurant`                                          | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 111 | L3   | 2    | mutation     | `editRestaurantCoupon`                                    | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 112 | L3   | 2    | mutation     | `editVendor`                                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 113 | L3   | 2    | mutation     | `hardDeleteRestaurant`                                    | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 114 | L3   | 2    | mutation     | `toggleStoreAvailability`                                 | store                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 115 | L3   | 2    | mutation     | `updateDeliveryBoundsAndLocation`                         | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 116 | L3   | 2    | mutation     | `updateDeliveryOptions`                                   | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 117 | L3   | 2    | mutation     | `updateFoodOutOfStock`                                    | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 118 | L3   | 2    | mutation     | `updateRestaurantBussinessDetails`                        | admin, store                  | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 119 | L3   | 2    | mutation     | `updateRestaurantDelivery`                                | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 120 | L3   | 2    | mutation     | `updateTimings`                                           | admin, store                  | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 121 | L3   | 2    | query        | `attachedCuisines`                                        | web                           | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 122 | L3   | 2    | query        | `coupons`                                                 | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 123 | L3   | 2    | query        | `couponsPaginated`                                        | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 124 | L3   | 2    | query        | `fetchCategoryDetailsByStoreId`                           | web                           | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 125 | L3   | 2    | query        | `fetchCategoryDetailsByStoreIdForMobile`                  | app                           | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 126 | L3   | 2    | query        | `getClonedRestaurants`                                    | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 127 | L3   | 2    | query        | `getClonedRestaurantsPaginated`                           | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 128 | L3   | 2    | query        | `getRestaurantDeliveryZoneInfo`                           | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 129 | L3   | 2    | query        | `getStoreDetailsByVendorId`                               | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 130 | L3   | 2    | query        | `getStoreDetailsByVendorIdPaginated`                      | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 131 | L3   | 2    | query        | `getVendor`                                               | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 132 | L3   | 2    | query        | `mostOrderedRestaurants`                                  | app                           | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 133 | L3   | 2    | query        | `mostOrderedRestaurantsPreview`                           | app, web                      | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 134 | L3   | 2    | query        | `nearByRestaurants`                                       | app, rider                    | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 135 | L3   | 2    | query        | `nearByRestaurantsCuisines`                               | app, web                      | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 136 | L3   | 2    | query        | `nearByRestaurantsPreview`                                | app, rider, web               | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 137 | L3   | 2    | query        | `popularFoodItems`                                        | app                           | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 138 | L3   | 2    | query        | `popularItems`                                            | app, web                      | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 139 | L3   | 2    | query        | `recentOrderRestaurants`                                  | app, rider                    | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 140 | L3   | 2    | query        | `recentOrderRestaurantsPreview`                           | app, web                      | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 141 | L3   | 2    | query        | `relatedItems`                                            | app, web                      | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 142 | L3   | 2    | query        | `restaurant`                                              | admin, app, store, web        | IMPLEMENTED     | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 143 | L3   | 2    | query        | `restaurantAddonsPaginated`                               | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 144 | L3   | 2    | query        | `restaurantByOwner`                                       | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 145 | L3   | 2    | query        | `restaurantCategoriesPaginated`                           | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 146 | L3   | 2    | query        | `restaurantCoupons`                                       | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 147 | L3   | 2    | query        | `restaurantCouponsPaginated`                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 148 | L3   | 2    | query        | `restaurantOptionsPaginated`                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 149 | L3   | 2    | query        | `restaurantReviewsPaginated`                              | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 150 | L3   | 2    | query        | `restaurants`                                             | admin                         | IMPLEMENTED     | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 151 | L3   | 2    | query        | `restaurantsPaginated`                                    | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 152 | L3   | 2    | query        | `reviews`                                                 | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 153 | L3   | 2    | query        | `reviewsByRestaurant`                                     | app, web                      | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 154 | L3   | 2    | query        | `subCategories`                                           | admin, app, web               | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 155 | L3   | 2    | query        | `subCategoriesByParentId`                                 | admin, app                    | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 156 | L3   | 2    | query        | `subCategory`                                             | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 157 | L3   | 2    | query        | `topRatedVendors`                                         | app                           | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 158 | L3   | 2    | query        | `topRatedVendorsPreview`                                  | app, web                      | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 159 | L3   | 2    | query        | `vendorCount`                                             | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 160 | L3   | 2    | query        | `vendors`                                                 | admin                         | NOT_IMPLEMENTED | L3-vendors-catalog.graphql   | NOT_VERIFIED |
| 161 | L4   | 3    | mutation     | `addFavourite`                                            | app, web                      | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 162 | L4   | 3    | mutation     | `createAddress`                                           | app, web                      | IMPLEMENTED     | L4-customers-support.graphql | NOT_VERIFIED |
| 163 | L4   | 3    | mutation     | `createMessage`                                           | admin, app, web               | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 164 | L4   | 3    | mutation     | `createSupportTicket`                                     | admin, app, web               | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 165 | L4   | 3    | mutation     | `deleteAddress`                                           | app, web                      | IMPLEMENTED     | L4-customers-support.graphql | NOT_VERIFIED |
| 166 | L4   | 3    | mutation     | `deleteBulkAddresses`                                     | app                           | IMPLEMENTED     | L4-customers-support.graphql | NOT_VERIFIED |
| 167 | L4   | 3    | mutation     | `deleteUser`                                              | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 168 | L4   | 3    | mutation     | `editAddress`                                             | app, web                      | IMPLEMENTED     | L4-customers-support.graphql | NOT_VERIFIED |
| 169 | L4   | 3    | mutation     | `selectAddress`                                           | app, web                      | IMPLEMENTED     | L4-customers-support.graphql | NOT_VERIFIED |
| 170 | L4   | 3    | mutation     | `updateSupportTicketStatus`                               | admin, web                    | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 171 | L4   | 3    | mutation     | `updateUserNotes`                                         | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 172 | L4   | 3    | mutation     | `updateUserStatus`                                        | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 173 | L4   | 3    | query        | `getSingleSupportTicket`                                  | admin, app, web               | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 174 | L4   | 3    | query        | `getSingleUserSupportTickets`                             | admin, app, web               | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 175 | L4   | 3    | query        | `getTicketMessages`                                       | admin, app, web               | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 176 | L4   | 3    | query        | `getTicketUsers`                                          | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 177 | L4   | 3    | query        | `getTicketUsersWithLatest`                                | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 178 | L4   | 3    | query        | `ordersByUser`                                            | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 179 | L4   | 3    | query        | `user`                                                    | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 180 | L4   | 3    | query        | `userFavourite`                                           | app, web                      | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 181 | L4   | 3    | query        | `users`                                                   | admin, app                    | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 182 | L4   | 3    | query        | `usersPaginated`                                          | admin                         | NOT_IMPLEMENTED | L4-customers-support.graphql | NOT_VERIFIED |
| 183 | L5   | 3    | mutation     | `abortOrder`                                              | app, rider, web               | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 184 | L5   | 3    | mutation     | `acceptOrder`                                             | store                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 185 | L5   | 3    | mutation     | `cancelOrder`                                             | store                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 186 | L5   | 3    | mutation     | `coupon`                                                  | app, web                      | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 187 | L5   | 3    | mutation     | `muteRing`                                                | store                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 188 | L5   | 3    | mutation     | `orderPickedUp`                                           | store                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 189 | L5   | 3    | mutation     | `placeOrder`                                              | app, rider, web               | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 190 | L5   | 3    | mutation     | `reviewOrder`                                             | app, rider, web               | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 191 | L5   | 3    | mutation     | `updateStatus`                                            | admin                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 192 | L5   | 3    | query        | `allOrders`                                               | admin                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 193 | L5   | 3    | query        | `allOrdersPaginated`                                      | admin                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 194 | L5   | 3    | query        | `allOrdersWithoutPagination`                              | admin                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 195 | L5   | 3    | query        | `getUsersActiveOrders`                                    | app, web                      | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 196 | L5   | 3    | query        | `getUsersPastOrders`                                      | app, web                      | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 197 | L5   | 3    | query        | `order`                                                   | app, rider                    | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 198 | L5   | 3    | query        | `orderDetails`                                            | web                           | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 199 | L5   | 3    | query        | `orderFilterOptions`                                      | admin                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 200 | L5   | 3    | query        | `orders`                                                  | app, rider, web               | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 201 | L5   | 3    | query        | `ordersByRestId`                                          | admin                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 202 | L5   | 3    | query        | `ordersByRestIdWithoutPagination`                         | admin                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 203 | L5   | 3    | query        | `restaurantOrders`                                        | store                         | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 204 | L5   | 3    | subscription | `orderStatusChanged`                                      | app, web                      | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 205 | L5   | 3    | subscription | `subscribePlaceOrder`                                     | admin, store                  | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 206 | L5   | 3    | subscription | `subscriptionOrder`                                       | admin, app, rider, store, web | NOT_IMPLEMENTED | L5-orders.graphql            | NOT_VERIFIED |
| 207 | L6   | 4    | mutation     | `assignOrder`                                             | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 208 | L6   | 4    | mutation     | `assignRider`                                             | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 209 | L6   | 4    | mutation     | `createRider`                                             | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 210 | L6   | 4    | mutation     | `deleteRider`                                             | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 211 | L6   | 4    | mutation     | `editRider`                                               | admin, rider                  | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 212 | L6   | 4    | mutation     | `registerLiveActivitySession`                             | app                           | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 213 | L6   | 4    | mutation     | `removeLiveActivitySession`                               | app                           | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 214 | L6   | 4    | mutation     | `sendChatMessage`                                         | app, rider, web               | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 215 | L6   | 4    | mutation     | `toggleAvailablity`                                       | admin, rider                  | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 216 | L6   | 4    | mutation     | `updateOrderStatusRider`                                  | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 217 | L6   | 4    | mutation     | `updateRiderBussinessDetails`                             | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 218 | L6   | 4    | mutation     | `updateRiderLicenseDetails`                               | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 219 | L6   | 4    | mutation     | `updateRiderLocation`                                     | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 220 | L6   | 4    | mutation     | `updateRiderVehicleDetails`                               | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 221 | L6   | 4    | mutation     | `updateWorkSchedule`                                      | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 222 | L6   | 4    | query        | `availableRiders`                                         | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 223 | L6   | 4    | query        | `chat`                                                    | app, rider, web               | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 224 | L6   | 4    | query        | `getActiveOrders`                                         | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 225 | L6   | 4    | query        | `getLiveMonitorData`                                      | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 226 | L6   | 4    | query        | `orderTracking`                                           | admin, app, web               | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 227 | L6   | 4    | query        | `rider`                                                   | admin, app, rider, web        | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 228 | L6   | 4    | query        | `riderOrders`                                             | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 229 | L6   | 4    | query        | `riders`                                                  | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 230 | L6   | 4    | query        | `ridersByZone`                                            | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 231 | L6   | 4    | query        | `ridersPaginated`                                         | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 232 | L6   | 4    | subscription | `riderUpdated`                                            | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 233 | L6   | 4    | subscription | `subscriptionAssignRider`                                 | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 234 | L6   | 4    | subscription | `subscriptionDispatcher`                                  | admin                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 235 | L6   | 4    | subscription | `subscriptionNewMessage`                                  | app, rider, web               | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 236 | L6   | 4    | subscription | `subscriptionOrderTracking`                               | admin, app, web               | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 237 | L6   | 4    | subscription | `subscriptionRiderLocation`                               | app, web                      | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 238 | L6   | 4    | subscription | `subscriptionZoneOrders`                                  | rider                         | NOT_IMPLEMENTED | L6-dispatch.graphql          | NOT_VERIFIED |
| 239 | L7   | 4    | mutation     | `createWithdrawRequest`                                   | admin, rider, store           | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 240 | L7   | 4    | mutation     | `updateCommission`                                        | admin                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 241 | L7   | 4    | mutation     | `updateWithdrawReqStatus`                                 | admin                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 242 | L7   | 4    | query        | `commissionRate`                                          | admin                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 243 | L7   | 4    | query        | `earnings`                                                | admin, store                  | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 244 | L7   | 4    | query        | `riderCurrentWithdrawRequest`                             | rider                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 245 | L7   | 4    | query        | `riderEarningsGraph`                                      | rider                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 246 | L7   | 4    | query        | `storeCurrentWithdrawRequest`                             | store                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 247 | L7   | 4    | query        | `storeEarningsGraph`                                      | store                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 248 | L7   | 4    | query        | `transactionHistory`                                      | admin, rider, store           | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 249 | L7   | 4    | query        | `withdrawRequests`                                        | admin                         | NOT_IMPLEMENTED | L7-finance.graphql           | NOT_VERIFIED |
| 250 | L8   | 3    | mutation     | `markWebNotificationsAsRead`                              | admin                         | NOT_IMPLEMENTED | L8-notifications.graphql     | NOT_VERIFIED |
| 251 | L8   | 3    | mutation     | `sendNotificationUser`                                    | admin                         | NOT_IMPLEMENTED | L8-notifications.graphql     | NOT_VERIFIED |
| 252 | L8   | 3    | query        | `notifications`                                           | admin                         | NOT_IMPLEMENTED | L8-notifications.graphql     | NOT_VERIFIED |
| 253 | L8   | 3    | query        | `notificationsPaginated`                                  | admin                         | NOT_IMPLEMENTED | L8-notifications.graphql     | NOT_VERIFIED |
| 254 | L8   | 3    | query        | `webNotifications`                                        | admin                         | NOT_IMPLEMENTED | L8-notifications.graphql     | NOT_VERIFIED |
| 255 | L9   | 5    | query        | `getDashboardOrdersByType`                                | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 256 | L9   | 5    | query        | `getDashboardSalesByType`                                 | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 257 | L9   | 5    | query        | `getDashboardUsers`                                       | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 258 | L9   | 5    | query        | `getDashboardUsersByYear`                                 | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 259 | L9   | 5    | query        | `getRestaurantDashboardOrderSalesDetailsByPaymentMethod`  | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 260 | L9   | 5    | query        | `getRestaurantDashboardOrdersSalesStats`                  | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 261 | L9   | 5    | query        | `getRestaurantDashboardSalesOrderCountDetailsByYear`      | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 262 | L9   | 5    | query        | `getVendorDashboardGrowthDetailsByYear`                   | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 263 | L9   | 5    | query        | `getVendorDashboardStatsCardDetails`                      | admin                         | NOT_IMPLEMENTED | L9-analytics.graphql         | NOT_VERIFIED |
| 264 | L12  | 6    | mutation     | `cancelSubscription`                                      | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 265 | L12  | 6    | mutation     | `checkReferralCodeExists`                                 | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 266 | L12  | 6    | mutation     | `clearCart`                                               | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 267 | L12  | 6    | mutation     | `createBannerRestaurant`                                  | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 268 | L12  | 6    | mutation     | `createFoodDeal`                                          | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 269 | L12  | 6    | mutation     | `createFoodSingleVendor`                                  | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 270 | L12  | 6    | mutation     | `createPriceForProduct`                                   | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 271 | L12  | 6    | mutation     | `createSubscription`                                      | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 272 | L12  | 6    | mutation     | `deactivatePrice`                                         | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 273 | L12  | 6    | mutation     | `deleteBannerRestaurant`                                  | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 274 | L12  | 6    | mutation     | `deleteFoodDeal`                                          | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 275 | L12  | 6    | mutation     | `editBannerRestaurant`                                    | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 276 | L12  | 6    | mutation     | `editSingleVendorCartItem`                                | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 277 | L12  | 6    | mutation     | `editUserCreditsHistory`                                  | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 278 | L12  | 6    | mutation     | `giveFeedback`                                            | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 279 | L12  | 6    | mutation     | `giveUserCredits`                                         | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 280 | L12  | 6    | mutation     | `ownerLogout`                                             | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 281 | L12  | 6    | mutation     | `saveGeneralConfiguration`                                | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 282 | L12  | 6    | mutation     | `saveVendorTypeToggle`                                    | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 283 | L12  | 6    | mutation     | `toggleFavoriteFoodSingleVendor`                          | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 284 | L12  | 6    | mutation     | `updateFoodDeal`                                          | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 285 | L12  | 6    | mutation     | `updateFoodSingleVendor`                                  | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 286 | L12  | 6    | mutation     | `updateScheduleTimings`                                   | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 287 | L12  | 6    | mutation     | `updateSubscription`                                      | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 288 | L12  | 6    | mutation     | `updateUserCartCount`                                     | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 289 | L12  | 6    | mutation     | `userCartData`                                            | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 290 | L12  | 6    | query        | `adminConfiguration`                                      | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 291 | L12  | 6    | query        | `bannerRestaurant`                                        | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 292 | L12  | 6    | query        | `bannerRestaurants`                                       | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 293 | L12  | 6    | query        | `calculateCheckout`                                       | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 294 | L12  | 6    | query        | `couponsbyRestaurant`                                     | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 295 | L12  | 6    | query        | `getAllCategoriesWithSubCategoriesDataSeeAllSingleVendor` | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 296 | L12  | 6    | query        | `getAllCategoriesWithSubCategoriesOnlySeeAllSingleVendor` | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 297 | L12  | 6    | query        | `getAllCreditsRecords`                                    | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 298 | L12  | 6    | query        | `getAllFoodDealsAdmin`                                    | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 299 | L12  | 6    | query        | `getAllfoods`                                             | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 300 | L12  | 6    | query        | `getAllfoodsPaginated`                                    | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 301 | L12  | 6    | query        | `getAllSubscriptionPlans`                                 | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 302 | L12  | 6    | query        | `getAllUserCredits`                                       | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 303 | L12  | 6    | query        | `getAllUsersDropDownSearch`                               | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 304 | L12  | 6    | query        | `getCategoryItemsSingleVendor`                            | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 305 | L12  | 6    | query        | `getCategoryProducts`                                     | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 306 | L12  | 6    | query        | `getDashboardOrderSalesDetailsByPaymentMethod`            | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 307 | L12  | 6    | query        | `getEstimatedDeliveryTime`                                | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 308 | L12  | 6    | query        | `getFavoriteFoodsSingleVendor`                            | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 309 | L12  | 6    | query        | `getFavoriteFoodsStatus`                                  | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 310 | L12  | 6    | query        | `getFoodDetails`                                          | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 311 | L12  | 6    | query        | `getLimitedTimeFoodsDeals`                                | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 312 | L12  | 6    | query        | `getMyFreeDeliveries`                                     | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 313 | L12  | 6    | query        | `getMyReferralCode`                                       | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 314 | L12  | 6    | query        | `getNewOffersFoodsDeals`                                  | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 315 | L12  | 6    | query        | `getRecommendedFoods`                                     | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 316 | L12  | 6    | query        | `getRestaurantCategoriesSingleVendor`                     | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 317 | L12  | 6    | query        | `getRestaurantSchedule`                                   | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 318 | L12  | 6    | query        | `getScheduleByDay`                                        | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 319 | L12  | 6    | query        | `getScheduleUntilNextDayOff`                              | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 320 | L12  | 6    | query        | `getSimilarFoods`                                         | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 321 | L12  | 6    | query        | `getUserCart`                                             | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 322 | L12  | 6    | query        | `getUserCreditsHistory`                                   | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 323 | L12  | 6    | query        | `getWeeklyFoodsDeals`                                     | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 324 | L12  | 6    | query        | `orderDetailsPage`                                        | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 325 | L12  | 6    | query        | `pastNotificationsByToken`                                | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 326 | L12  | 6    | query        | `recentActiveOrder`                                       | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 327 | L12  | 6    | query        | `scheduledOrders`                                         | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 328 | L12  | 6    | query        | `searchFood`                                              | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 329 | L12  | 6    | query        | `searchSingleVendorFoods`                                 | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 330 | L12  | 6    | query        | `singleVendorBanners`                                     | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 331 | L12  | 6    | query        | `singleVendorDeals`                                       | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 332 | L12  | 6    | query        | `singleVendorDiscovery`                                   | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 333 | L12  | 6    | query        | `todayNotificationsByToken`                               | —                             | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
| 334 | L12  | 6    | subscription | `subscriptionPaymentSuccess`                              | web                           | NOT_IMPLEMENTED | L12-single-vendor.graphql    | NOT_VERIFIED |
