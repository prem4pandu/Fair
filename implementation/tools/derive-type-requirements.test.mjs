import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contractDocuments,
  deriveFromDocuments,
  multivendorDocuments,
  reconcileDocumentSites,
  verifyAutomaticSites,
  resolvedDocuments,
} from "./derive-type-requirements.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("expanded six-app documents account for every inventoried root without introducing unowned roots", () => {
  const requirements = deriveFromDocuments(resolvedDocuments());
  const lanes = JSON.parse(
    readFileSync(
      new URL("../docs/OPERATION_LANES.json", import.meta.url),
      "utf8",
    ),
  );
  const expected = lanes.operations
    .map((operation) => `${operation.type}.${operation.name}`)
    .sort();
  const actual = ["query", "mutation", "subscription"]
    .flatMap((kind) =>
      Object.keys(requirements[kind]).map((name) => `${kind}.${name}`),
    )
    .sort();
  assert.deepEqual(actual, expected);
});

test("checked-in interpolation inventory matches every current static expansion", () => {
  execFileSync(
    process.execPath,
    ["tools/reconcile-dynamic-documents.mjs", "--check"],
    { cwd: new URL("..", import.meta.url) },
  );
});

test("automatic interpolation inventory detects changed sources, expansions and new sites", () => {
  const doc = {
    app: "web",
    file: "query.ts",
    line: 1,
    text: "query { viewer { id } }",
    interpolations: 1,
  };
  const entry = {
    ...doc,
    sourceSha256: "source",
    documentSha256: createHash("sha256").update(doc.text).digest("hex"),
  };
  verifyAutomaticSites([doc], [entry], () => "source");
  assert.throws(
    () => verifyAutomaticSites([doc], [], () => "source"),
    /Unrecorded/,
  );
  assert.throws(
    () => verifyAutomaticSites([doc], [entry], () => "changed"),
    /Stale/,
  );
  assert.throws(
    () =>
      verifyAutomaticSites(
        [{ ...doc, text: "query { other }" }],
        [entry],
        () => "source",
      ),
    /Stale/,
  );
  assert.throws(
    () => verifyAutomaticSites([doc], [entry, entry], () => "source"),
    /Duplicate/,
  );
  assert.throws(
    () => verifyAutomaticSites([], [entry], () => "source"),
    /Obsolete/,
  );
});

test("manual reconciliation fails closed on missing, stale, duplicate and obsolete sites", () => {
  const site = {
    app: "web",
    file: "query.ts",
    line: 3,
    text: "gql(imported)",
    resolved: false,
  };
  const entry = {
    ...site,
    text: "query { viewer { id } }",
    sourceSha256: "source-hash",
  };
  const resolve = (sites, entries, hash = "source-hash") =>
    reconcileDocumentSites(sites, { resolutions: entries }, () => hash);
  assert.deepEqual(resolve([site], [entry]), [
    { ...site, text: entry.text, resolved: true },
  ]);
  assert.throws(() => resolve([site], []), /Unresolved document/);
  assert.throws(() => resolve([site], [entry], "changed"), /Stale dynamic/);
  assert.throws(
    () => resolve([site], [entry, entry]),
    /Duplicate dynamic document resolution/,
  );
  assert.throws(
    () => resolve([site, site], [entry]),
    /Duplicate dynamic document site/,
  );
  assert.throws(
    () => resolve([{ ...site, resolved: true }], [entry]),
    /Stale resolution entries/,
  );
  assert.throws(
    () => resolve([site], [{ ...entry, text: "query {" }]),
    /Syntax Error/,
  );
});

test("merges selections, argument types and fragment type conditions per root", () => {
  const result = deriveFromDocuments([
    {
      app: "web",
      text: "query A($id: String!) { restaurant(id: $id) { _id name ...P } } fragment P on RestaurantPreview { slug }",
    },
    {
      app: "app",
      text: "query B($id: String) { restaurant(id: $id) { _id location { coordinates } } }",
    },
  ]);
  const root = result.query.restaurant;
  assert.deepEqual(root.arguments.id.variableTypes, ["String", "String!"]);
  assert.deepEqual(Object.keys(root.selection.fields), [
    "_id",
    "location",
    "name",
    "slug",
  ]);
  assert.deepEqual(root.selection.typeConditions, ["RestaurantPreview"]);
  assert.equal(root.selection.fields.location.fields.coordinates.leaf, true);
  assert.deepEqual(root.apps, ["app", "web"]);
});

test("records inline literal argument kinds and input object keys", () => {
  const result = deriveFromDocuments([
    {
      app: "admin",
      text: "query { earnings(userType: STORE, pagination: { pageSize: 10, pageNo: 1 }) { data { _id } } }",
    },
  ]);
  assert.deepEqual(result.query.earnings.arguments.userType.literalKinds, [
    "EnumValue",
  ]);
  assert.deepEqual(result.query.earnings.arguments.pagination.objectKeys, [
    "pageNo",
    "pageSize",
  ]);
});

test("tracks named input types and list/nullability syntax", () => {
  const result = deriveFromDocuments([
    {
      app: "app",
      text: "mutation M($input: [OrderInput!]!) { placeOrder(order: $input) { _id } }",
    },
  ]);
  assert.deepEqual(result.mutation.placeOrder.arguments.order.variableTypes, [
    "[OrderInput!]!",
  ]);
  assert.deepEqual(result.inputs.OrderInput, {
    declaredName: "OrderInput",
    keys: [],
  });
});

test("multivendor scope excludes single-vendor apps and L12-only documents", () => {
  const documents = [
    { app: "enatega-multivendor-app", text: "query { restaurants { _id } }" },
    { app: "enatega-multivendor-app", text: "query { getAllfoods { _id } }" },
    {
      app: "enatega-multivendor-app",
      file: "src/singlevendor/queries.js",
      text: "query { restaurants { _id } }",
    },
    {
      app: "enatega-singlevendor-admin",
      text: "query { restaurants { _id } }",
    },
  ];
  const lanes = {
    operations: [
      { type: "query", name: "restaurants", lane: "L3" },
      { type: "query", name: "getAllfoods", lane: "L12" },
    ],
  };
  assert.deepEqual(multivendorDocuments(documents, lanes), [documents[0]]);
});

test("contract scope keeps the single-vendor admin but drops single-vendor mode and L12", () => {
  const documents = [
    { app: "enatega-multivendor-app", text: "query { restaurants { _id } }" },
    { app: "enatega-multivendor-app", text: "query { getAllfoods { _id } }" },
    {
      app: "enatega-multivendor-app",
      file: "src/singlevendor/queries.js",
      text: "query { restaurants { _id } }",
    },
    {
      app: "enatega-multivendor-web",
      file: "lib/api/graphql/single-vendor/index.ts",
      text: "query { restaurants { _id } }",
    },
    {
      app: "enatega-singlevendor-admin",
      file: "lib/api/graphql/queries/banners/index.tsx",
      text: "query { restaurants { _id } }",
    },
  ];
  const lanes = {
    operations: [
      { type: "query", name: "restaurants", lane: "L3" },
      { type: "query", name: "getAllfoods", lane: "L12" },
    ],
  };
  // The single-vendor admin's selections are additive, so the generated contract
  // must serve it even though it sits outside the multivendor gate.
  assert.deepEqual(contractDocuments(documents, lanes), [
    documents[0],
    documents[4],
  ]);
  // Single-vendor MODE files stay out: they contradict the shipping apps on
  // emailExist/phoneExist. L12-only documents stay out so generate-sdl keeps
  // L12 an empty lane and never overwrites the curated L12 contract.
  assert.equal(
    contractDocuments(documents, lanes).includes(documents[1]),
    false,
  );
  assert.equal(
    contractDocuments(documents, lanes).includes(documents[2]),
    false,
  );
  assert.equal(
    contractDocuments(documents, lanes).includes(documents[3]),
    false,
  );
});
