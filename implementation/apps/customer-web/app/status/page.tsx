import { getServiceInfo } from "../../lib/service";
export const dynamic = "force-dynamic";
export default async function Status() {
  const result = await getServiceInfo();
  return (
    <>
      <p className="eyebrow">Foundation diagnostics</p>
      <h1>Service status</h1>
      <section className="panel" aria-labelledby="diagnostic-heading">
        <h2 id="diagnostic-heading">GraphQL connection</h2>
        {result.kind === "ready" ? (
          <dl>
            <dt>Service name</dt>
            <dd>{result.name}</dd>
            <dt>Reported status</dt>
            <dd>{result.status}</dd>
          </dl>
        ) : (
          <p>{result.message}</p>
        )}
        <p>
          Checks the public service information query with a three-second
          timeout. This public query does not verify authenticated sessions or
          product workflows.
        </p>
      </section>
    </>
  );
}
