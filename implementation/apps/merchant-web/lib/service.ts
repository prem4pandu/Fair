export type ServiceResult =
  | { kind: "ready"; name: string; status: string }
  | { kind: "unconfigured" | "invalid" | "unavailable"; message: string };

/** Server-only: never expose the configured endpoint or upstream failure details. */
export async function getServiceInfo(): Promise<ServiceResult> {
  const configured = process.env.FAIRBITE_API_URL;
  if (!configured)
    return { kind: "unconfigured", message: "API endpoint is not configured." };
  let endpoint: URL;
  try {
    endpoint = new URL(configured);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/graphql"
    )
      throw new Error("Invalid endpoint");
    if (
      endpoint.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
    )
      throw new Error("HTTPS required");
  } catch {
    return {
      kind: "invalid",
      message: "API endpoint configuration is invalid.",
    };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "query FoundationServiceInfo { serviceInfo { name status } }",
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("HTTP failure");
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > 16384)
      throw new Error("Response too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("Response too large");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !result ||
      typeof result !== "object" ||
      "errors" in result ||
      !("data" in result)
    )
      throw new Error("Invalid GraphQL response");
    const data = result.data;
    if (!data || typeof data !== "object" || !("serviceInfo" in data))
      throw new Error("Missing data");
    const info = data.serviceInfo;
    if (
      !info ||
      typeof info !== "object" ||
      !("name" in info) ||
      !("status" in info) ||
      typeof info.name !== "string" ||
      info.name.length < 1 ||
      info.name.length > 100 ||
      typeof info.status !== "string" ||
      info.status.length < 1 ||
      info.status.length > 40
    )
      throw new Error("Invalid service info");
    if (info.status === "unavailable")
      return {
        kind: "unavailable",
        message:
          "API service reports unavailable. Required infrastructure is not ready.",
      };
    if (info.status !== "ready") throw new Error("Unknown service status");
    return { kind: "ready", name: info.name, status: info.status };
  } catch {
    return {
      kind: "unavailable",
      message: "API service is unavailable or returned an invalid response.",
    };
  }
}
