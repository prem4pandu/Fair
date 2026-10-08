export type ConnectionRequest = (
  url: string,
  options: RequestInit,
) => Promise<Response>;
export interface ServiceInfo {
  name: string;
  status: "ready" | "unavailable";
}
export function apiUrl(raw: string | undefined): string {
  if (!raw) throw new Error("Backend connection is not configured.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Backend URL is invalid.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/graphql"
  ) {
    throw new Error(
      "Use an HTTPS GraphQL URL, or HTTP localhost for development.",
    );
  }
  return url.toString();
}
export function parseServiceInfo(value: unknown): ServiceInfo {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Backend returned an invalid response.");
  const envelope = value as Record<string, unknown>;
  if ("errors" in envelope)
    throw new Error("Backend could not complete the connection check.");
  const data = envelope.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Backend returned an invalid response.");
  const info = (data as Record<string, unknown>).serviceInfo;
  if (!info || typeof info !== "object" || Array.isArray(info))
    throw new Error("Backend returned an invalid response.");
  const fields = info as Record<string, unknown>;
  if (
    typeof fields.name !== "string" ||
    !fields.name.trim() ||
    fields.name.length > 100 ||
    (fields.status !== "ready" && fields.status !== "unavailable")
  )
    throw new Error("Backend returned an invalid service status.");
  return { name: fields.name, status: fields.status };
}
export async function checkConnection(
  raw: string | undefined,
  signal: AbortSignal,
  request: ConnectionRequest = fetch,
): Promise<ServiceInfo> {
  const url = apiUrl(raw);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(cancel, 8000);
  try {
    const response = await request(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "query MobileServiceInfo { serviceInfo { name status } }",
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error("Backend is unavailable. Please try again.");
    if (response.redirected || (response.url && response.url !== url))
      throw new Error("Backend returned an invalid response.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Backend returned an invalid response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new Error("Backend returned an invalid response.");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(bytes);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Backend returned an invalid response.");
    }
    return parseServiceInfo(value);
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Connection check was cancelled or timed out.");
    if (error instanceof Error && /^Backend /.test(error.message)) throw error;
    throw new Error(
      "Could not reach the backend. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
