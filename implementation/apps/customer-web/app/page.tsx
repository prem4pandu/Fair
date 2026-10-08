import Link from "next/link";
import { getServiceInfo } from "../lib/service";
export const dynamic = "force-dynamic";
export default async function Home() {
  const result = await getServiceInfo();
  return (
    <>
      <p className="eyebrow">Customer foundation</p>
      <h1>Discover your next meal</h1>
      <p className="intro">
        Browse published restaurants and their menus. Ordering remains in
        development.
      </p>
      <p>
        <Link href="/restaurants">Browse restaurants</Link>
      </p>
      <section className="panel" aria-labelledby="service-heading">
        <h2 id="service-heading">Backend connection</h2>
        {result.kind === "ready" ? (
          <p>
            Service {result.name} reports: {result.status}.
          </p>
        ) : (
          <p>{result.message}</p>
        )}
        <p>
          This connection check does not verify commerce features or
          permissions.
        </p>
      </section>
    </>
  );
}
