import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDocument, listDocuments } from "./documents.mjs";

test("loads an exported gql document by name with its operation intact", () => {
  const text = loadDocument(
    "enatega-multivendor-admin",
    "lib/api/graphql/mutations/metrics/index.ts",
    "METRICS_GENERAL",
  );
  assert.match(text, /mutation MetricsGeneral/);
  assert.match(text, /metricsGeneral \{/);
});

test("inlines interpolated fragments from the same or imported files", () => {
  const docs = listDocuments("enatega-multivendor-web");
  const withFragments = docs.find((document) => {
    return document.interpolations > 0 && document.resolved;
  });
  assert.ok(withFragments, "at least one interpolated document resolves");
  assert.doesNotMatch(withFragments.text, /\$\{/);
});

test("refuses paths outside vendor/enatega-ui", () => {
  assert.throws(() => loadDocument("..", "package.json", "x"), /outside/);
});
