import { getServiceInfo } from "../lib/service";
export const dynamic = "force-dynamic";
export default async function Home() {
  const result = await getServiceInfo();
  return (
    <>
      <p className="eyebrow">Administrator foundation</p>
      <h1>A clear view of platform operations</h1>
      <p className="intro">
        Administrator experience foundation. Platform management, dispatch and
        access controls are not available yet.
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
