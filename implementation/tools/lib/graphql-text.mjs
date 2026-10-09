// Shared text predicates for recognising GraphQL inside app sources.
//
// Both the document extractor (tools/lib/documents.mjs) and the compatibility
// audit (tools/check-enatega-compatibility.mjs) have to decide whether a string
// is GraphQL. They used to carry separate copies of this regex, which is how the
// two extractors drifted: the audit saw bare template literals that never
// reached SDL generation. Keep exactly one definition here.

export function looksLikeGraphQL(text) {
  return /^(?:\s|#[^\n]*(?:\n|$))*(?:(?:query|mutation|subscription)\s*(?:[A-Za-z_]\w*\s*)?[({]|fragment\s+[A-Za-z_]\w*\s+on\s+|\{\s*[A-Za-z_])/.test(
    text,
  );
}

// The pinned rider app writes its operations as plain template literals opening
// with a `#graphql` pragma comment. That pragma is an explicit, source-authored
// declaration that the literal is a GraphQL document, so it is a safe signal for
// extracting untagged literals. Literals without it are not extracted: doing so
// would also pull in dead or contradictory source (e.g. the customer app's
// leaf-form `versions` export, which disagrees with the `getVersions` object
// shape every other app sends) and smoke-test scripts that must not inform the
// contract.
export function hasGraphQLPragma(text) {
  return /^\s*#graphql/.test(text);
}
