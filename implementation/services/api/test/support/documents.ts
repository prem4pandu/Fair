import {
  listDocuments,
  loadDocument,
  type LoadedDocument,
} from "../../../../tools/lib/documents.mjs";

export type App =
  | "enatega-multivendor-admin"
  | "enatega-multivendor-web"
  | "enatega-multivendor-app"
  | "enatega-multivendor-store"
  | "enatega-multivendor-rider"
  | "enatega-singlevendor-admin";

export const APPS: readonly App[] = [
  "enatega-multivendor-admin",
  "enatega-multivendor-web",
  "enatega-multivendor-app",
  "enatega-multivendor-store",
  "enatega-multivendor-rider",
  "enatega-singlevendor-admin",
];

export type AppDocument = LoadedDocument & { app: App };

const cache = new Map<string, string>();
const listings = new Map<App, AppDocument[]>();

export function doc(app: App, file: string, exportName: string): string {
  const key = `${app}:${file}:${exportName}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const document = loadDocument(app, file, exportName);
  cache.set(key, document);
  return document;
}

/** Every statically resolved document site in one pinned app. */
export function documents(app: App): AppDocument[] {
  const cached = listings.get(app);
  if (cached) return cached;
  const listed = listDocuments(app).map((document) => ({ ...document, app }));
  listings.set(app, listed);
  return listed;
}

/** Every statically resolved document site in all six pinned apps. */
export function allDocuments(): AppDocument[] {
  return APPS.flatMap((app) => documents(app));
}

/**
 * Replays the exact `METRICS_GENERAL` documents the pinned clients send,
 * including the non-exported store/rider service constants that `loadDocument`
 * cannot reach by export name.
 */
export function handshakeDocuments(): AppDocument[] {
  return allDocuments().filter(
    (document) =>
      document.resolved && /METRICS_GENERAL$/.test(document.exportName ?? ""),
  );
}
