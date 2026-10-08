# Catalog source adaptation

The catalog presentation in `lib/ui/catalog.tsx` adapts the pinned MIT-licensed
source under `FairBiteFresh/upstream/enatega-multivendor-web`. The copied license
notice remains in `LICENSE.upstream`. The exact original component paths are:

- `lib/ui/screens/protected/home/restaurants/index.tsx` → `RestaurantsScreen`.
- `lib/ui/screen-components/protected/home/GenericListingComponent/index.tsx` → listing composition.
- `lib/ui/useable-components/home-heading-section/index.tsx` → `HomeHeadingSection`.
- `lib/ui/useable-components/restaurant-main-section/index.tsx` → `MainSection`.
- `lib/ui/useable-components/card/index.tsx` → `Card`.
- `lib/ui/screens/protected/resturant-store/store/index.tsx` → `StoreDetailsScreen` category/menu composition.

The original heading, grid, card-content and category/menu structure is adapted to
canonical server data and scoped CSS. Native links replace the original imperative
navigation and keyboard handlers. Server-rendered cursor links replace the original
infinite-scroll query logic. Images, ratings, cuisines, maps, opening-hours overlays,
favorites, cart controls and provider configuration are absent because corresponding
backend capabilities are not implemented. This is a partial source presentation
migration, not complete Enatega parity. `lib/catalog.ts` calls only the configured
FairBite GraphQL service; it never initializes upstream services or client providers.

## Customer addresses

`app/profile/addresses/addresses-screen.tsx` adapts the source screen composition:

- `lib/ui/screens/protected/profile/addresses/index.tsx` → `AddressesScreen`.
- `lib/ui/screen-components/protected/profile/addresses/main/index.tsx` → list, empty state, add/edit state and mutation reread.
- `lib/ui/screen-components/protected/profile/addresses/main/address-listings/index.tsx` → `AddressItem` label/address/content/action row.
- `lib/ui/useable-components/address/index.tsx` → manual address input form.

Native buttons replace inaccessible action divs. A focused inline native form
replaces the upstream map/provider modal because geocoding and maps are unavailable.
Coordinates have no guessed defaults. The BFF validates fixed canonical commands,
keeps access tokens in existing HttpOnly cookies and forwards CUSTOMER-authorized
backend operations. Successful mutations reread the customer's real address list.
