import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDocument, listDocuments } from "./documents.mjs";
import { hasGraphQLPragma, looksLikeGraphQL } from "./graphql-text.mjs";

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

test("extracts untagged rider literals that carry the #graphql pragma", () => {
  const docs = listDocuments("enatega-multivendor-rider");
  const otp = docs.find(
    (document) =>
      document.exportName === "SEND_OTP_TO_EMAIL" ||
      /mutation SendOtpToEmail/.test(document.text),
  );
  assert.ok(otp, "the rider's pragma-tagged OTP mutation is extracted");
  assert.match(otp.text, /sendOtpToEmail\(/);
  // The rider passes an otp argument no other app sends. Missing this argument
  // in the SDL was the symptom that the extractor ignored untagged literals.
  assert.match(otp.text, /\$otp/);
});

test("the rider's pragma document count is stable against a vendor bump", () => {
  // hasGraphQLPragma is the only reason the rider's documents reach SDL
  // generation. If a future pinned-source bump drops the pragma the documents
  // would silently vanish from the contract instead of failing loudly.
  const pragma = listDocuments("enatega-multivendor-rider").filter((document) =>
    hasGraphQLPragma(document.text),
  );
  assert.equal(pragma.length, 17);
});

test("an untagged literal without the pragma is not a document", () => {
  // The customer app's leaf-form `versions` export disagrees with the
  // getVersions object shape every other app sends. It carries no pragma, so it
  // must stay out of the contract rather than force a leaf-vs-object conflict.
  const docs = listDocuments("enatega-multivendor-app").filter(
    (document) =>
      document.file === "src/apollo/queries.js" &&
      document.exportName === "versions",
  );
  assert.deepEqual(docs, []);
});

test("the shared predicates agree on pragma and shape", () => {
  assert.equal(hasGraphQLPragma("#graphql\n  query Q { a }"), true);
  assert.equal(hasGraphQLPragma("  #graphql query Q { a }"), true);
  assert.equal(hasGraphQLPragma("query Q { a }"), false);
  assert.equal(hasGraphQLPragma("// graphql\nquery Q { a }"), false);
  // The pragma alone is not enough; the text must still look like GraphQL.
  assert.equal(looksLikeGraphQL("#graphql\n  query Q { a }"), true);
  assert.equal(looksLikeGraphQL("#graphql\n  not graphql at all"), false);
});
