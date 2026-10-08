import { getOutlets, validCatalogId } from "../../lib/catalog";
import {
  CatalogUnavailable,
  InvalidCatalogRequest,
  RestaurantsScreen,
} from "../../lib/ui/catalog";
export const dynamic = "force-dynamic";
export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { after } = await searchParams;
  if (after !== undefined && !validCatalogId(after))
    return <InvalidCatalogRequest />;
  try {
    return <RestaurantsScreen data={await getOutlets(after ?? null)} />;
  } catch {
    return <CatalogUnavailable retry="/restaurants" />;
  }
}
