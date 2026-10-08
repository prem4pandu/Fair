/* Adapted from pinned Enatega MIT source. See SOURCE_PROVENANCE.md and LICENSE.upstream. */
import Link from "next/link";
import {
  formatPrice,
  storePath,
  type CatalogPage,
  type Item,
  type Outlet,
} from "../catalog";
// Source: home-heading-section/index.tsx; source heading/border structure retained.
function HomeHeadingSection({ title }: { title: string }) {
  return (
    <div className="catalog-heading">
      <h1>{title}</h1>
    </div>
  );
}
// Source: card/index.tsx; content structure retained; real links replace role=link handlers.
function Card({ item }: { item: Outlet }) {
  return (
    <Link className="catalog-card" href={storePath(item)}>
      <div className="catalog-card-content">
        <h3>{item.name}</h3>
        <p>{item.merchantName}</p>
        <span>View menu</span>
      </div>
    </Link>
  );
}
// Source: restaurant-main-section/index.tsx; heading/grid/empty/pagination boundaries retained.
function MainSection({ data }: { data: CatalogPage<Outlet> }) {
  return (
    <section className="catalog-main" aria-labelledby="restaurant-list-heading">
      <h2 id="restaurant-list-heading">All restaurants</h2>
      {data.nodes.length ? (
        <div className="catalog-grid">
          {data.nodes.map((item) => (
            <Card key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <p>No restaurants are published yet.</p>
      )}
      {data.hasNextPage && (
        <Link
          className="catalog-next"
          href={`/restaurants?after=${data.endCursor}`}
        >
          Next restaurants
        </Link>
      )}
    </section>
  );
}
// Source: GenericListingComponent/index.tsx and home/restaurants/index.tsx.
export function RestaurantsScreen({ data }: { data: CatalogPage<Outlet> }) {
  return (
    <div className="catalog">
      <HomeHeadingSection title="Restaurants" />
      <MainSection data={data} />
    </div>
  );
}
// Source: resturant-store/store/index.tsx: store heading, category navigation and category/menu cards.
export function StoreDetailsScreen({
  outlet,
  data,
}: {
  outlet: Outlet;
  data: CatalogPage<Item>;
}) {
  const categories = [
    ...new Map(
      data.nodes.map((item) => [item.category.id, item.category]),
    ).values(),
  ];
  return (
    <div className="catalog">
      <Link href="/restaurants">All restaurants</Link>
      <HomeHeadingSection title={outlet.name} />
      <p className="catalog-merchant">{outlet.merchantName}</p>
      <p>Ordering is not available yet.</p>
      <h2>Menu</h2>
      {categories.length > 0 && (
        <nav className="catalog-categories" aria-label="Menu categories">
          {categories.map((category) => (
            <a key={category.id} href={`#category-${category.id}`}>
              {category.name}
            </a>
          ))}
        </nav>
      )}
      {!data.nodes.length && <p>No menu items are published yet.</p>}
      {categories.map((category) => (
        <section
          className="catalog-category"
          id={`category-${category.id}`}
          key={category.id}
        >
          <h3>{category.name}</h3>
          <div className="catalog-menu-grid">
            {data.nodes
              .filter((item) => item.category.id === category.id)
              .map((item) => (
                <article className="catalog-menu-card" key={item.id}>
                  <div>
                    <h4>{item.name}</h4>
                    <p>{item.description}</p>
                    <p className="catalog-price">
                      {formatPrice(item.priceMinor, outlet.currency)}
                    </p>
                    {!item.available && <p>Currently unavailable</p>}
                  </div>
                </article>
              ))}
          </div>
        </section>
      ))}
      {data.hasNextPage && (
        <Link
          className="catalog-next"
          href={`${storePath(outlet)}?after=${data.endCursor}`}
        >
          Next menu items
        </Link>
      )}
    </div>
  );
}
export function CatalogUnavailable({ retry }: { retry: string }) {
  return (
    <section className="catalog">
      <h1>Catalog unavailable</h1>
      <p>We could not load the catalog. Please try again.</p>
      <Link href={retry}>Try again</Link>
    </section>
  );
}
export function InvalidCatalogRequest() {
  return (
    <section className="catalog">
      <h1>Invalid catalog request</h1>
      <Link href="/restaurants">All restaurants</Link>
    </section>
  );
}
