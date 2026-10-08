import { loadDocument } from "../../../../tools/lib/documents.mjs";

export type App =
  | "enatega-multivendor-admin"
  | "enatega-multivendor-web"
  | "enatega-multivendor-app"
  | "enatega-multivendor-store"
  | "enatega-multivendor-rider"
  | "enatega-singlevendor-admin";

const cache = new Map<string, string>();

export function doc(app: App, file: string, exportName: string): string {
  const key = `${app}:${file}:${exportName}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const document = loadDocument(app, file, exportName);
  cache.set(key, document);
  return document;
}
