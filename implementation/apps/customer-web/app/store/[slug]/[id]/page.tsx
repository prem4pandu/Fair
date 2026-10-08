import { notFound } from "next/navigation";
import { getItems, getOutlet, validCatalogId } from "../../../../lib/catalog";
import {
  CatalogUnavailable,
  InvalidCatalogRequest,
  StoreDetailsScreen,
} from "../../../../lib/ui/catalog";
export const dynamic = "force-dynamic";
export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { id, slug } = await params;
  const { after } = await searchParams;
  if (!validCatalogId(id)) notFound();
  if (after !== undefined && !validCatalogId(after))
    return <InvalidCatalogRequest />;
  let outlet;
  try {
    outlet = await getOutlet(id);
  } catch {
    return (
      <CatalogUnavailable retry={`/store/${encodeURIComponent(slug)}/${id}`} />
    );
  }
  if (!outlet) notFound();
  try {
    return (
      <StoreDetailsScreen
        outlet={outlet}
        data={await getItems(id, after ?? null)}
      />
    );
  } catch {
    return (
      <CatalogUnavailable retry={`/store/${encodeURIComponent(slug)}/${id}`} />
    );
  }
}
