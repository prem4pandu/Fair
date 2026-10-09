import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSchema } from "graphql";

import { deriveFromDocuments } from "./derive-type-requirements.mjs";
import { generate } from "./generate-sdl.mjs";

// The lane-to-file contract callers depend on. Asserted here so a refactor
// cannot silently drop a lane file from generate().files.
const laneFiles = {
  core: "core.graphql",
  L1: "L1-identity.graphql",
  L2: "L2-platform.graphql",
  L3: "L3-vendors-catalog.graphql",
  L4: "L4-customers-support.graphql",
  L5: "L5-orders.graphql",
  L6: "L6-dispatch.graphql",
  L7: "L7-finance.graphql",
  L8: "L8-notifications.graphql",
  L9: "L9-analytics.graphql",
  L12: "L12-single-vendor.graphql",
};

// A single L3 root and no L12 root, mirroring the real requirements artifact in
// which multivendorDocuments() filters every L12-only document out.
const withoutL12 = () =>
  generate(
    deriveFromDocuments([
      {
        app: "web",
        text: "query Q($id: String) { restaurant(id: $id) { _id ...P } } fragment P on RestaurantPreview { slug }",
      },
    ]),
    {
      fixed: { RestaurantPreview: "L3" },
      byFieldName: {},
      byPath: { "query.restaurant": "RestaurantPreview" },
      ownership: { RestaurantPreview: "L3" },
    },
    { operations: [{ type: "query", name: "restaurant", lane: "L3" }] },
  );

test("generates roots, fragment types and named inputs as valid SDL", () => {
  const requirements = deriveFromDocuments([
    {
      app: "web",
      text: "query Q($id: String) { restaurant(id: $id) { _id ...P } } fragment P on RestaurantPreview { slug }",
    },
    {
      app: "app",
      text: "mutation M($input: OrderInput!) { placeOrder(order: $input) { _id } }",
    },
    {
      app: "web",
      text: "mutation E($email: String!) { emailExist(email: $email) }",
    },
  ]);
  const generated = generate(
    requirements,
    {
      fixed: { RestaurantPreview: "L3" },
      byFieldName: {},
      byPath: { "query.restaurant": "RestaurantPreview" },
      ownership: { RestaurantPreview: "L3" },
    },
    {
      operations: [
        { type: "query", name: "restaurant", lane: "L3" },
        { type: "mutation", name: "placeOrder", lane: "L5" },
        { type: "mutation", name: "emailExist", lane: "L1" },
      ],
    },
  );
  const sdl = Object.values(generated.files).join("\n");
  assert.match(sdl, /type RestaurantPreview/);
  assert.match(
    sdl,
    /extend type Query\s*{\s*restaurant\(id: String\): RestaurantPreview/,
  );
  assert.match(sdl, /input OrderInput/);
  assert.match(sdl, /emailExist\(email: String\): Boolean/);
  assert.doesNotThrow(() => buildSchema(sdl));
});

test("applies exact root, object and leaf type overrides while recursing named types", () => {
  const requirements = deriveFromDocuments([
    {
      app: "web",
      text: "query Q { restaurants { categories { foods { _id } } } configuration { skipEmailVerification } }",
    },
  ]);
  const generated = generate(
    requirements,
    {
      fixed: {},
      byFieldName: {
        restaurants: "Restaurant",
        categories: "Category",
        foods: "Food",
      },
      byPath: {},
      typeOverrides: {
        "query.restaurants": "[Restaurant]",
        "Restaurant.categories": "[Category]",
        "Category.foods": "[Food]",
        "query.configuration.skipEmailVerification": "Boolean",
      },
      ownership: {
        Restaurant: "L3",
        Category: "L3",
        Food: "L3",
      },
    },
    {
      operations: [
        { type: "query", name: "restaurants", lane: "L3" },
        { type: "query", name: "configuration", lane: "L2" },
      ],
    },
  );
  const sdl = Object.values(generated.files).join("\n");
  assert.match(sdl, /restaurants: \[Restaurant\]/);
  assert.match(sdl, /categories: \[Category\]/);
  assert.match(sdl, /foods: \[Food\]/);
  assert.match(sdl, /skipEmailVerification: Boolean/);
  assert.doesNotThrow(() => buildSchema(sdl));
});

test("reports collection-shaped selections without a cardinality override", () => {
  const requirements = deriveFromDocuments([
    { app: "web", text: "query Q { banners { _id } }" },
  ]);
  const generated = generate(
    requirements,
    {
      fixed: {},
      byFieldName: { banners: "Banner" },
      byPath: {},
      typeOverrides: {},
      ownership: { Banner: "L2" },
    },
    { operations: [{ type: "query", name: "banners", lane: "L2" }] },
  );
  assert.ok(
    generated.review.includes("query.banners: unresolved root cardinality"),
  );
});

test("reports a lane with no generated content as empty", () => {
  const generated = withoutL12();
  assert.ok(generated.emptyLanes instanceof Set);
  assert.ok(generated.emptyLanes.has("L12"));
  assert.match(
    generated.files[laneFiles.L12],
    /scalar L12DeferredContract/,
    "an empty lane still renders the placeholder run() must refuse to write",
  );
});

test("does not report a lane that received generated content as empty", () => {
  const generated = withoutL12();
  assert.equal(generated.emptyLanes.has("L3"), false);
  assert.equal(generated.emptyLanes.has("core"), false);
  assert.match(generated.files[laneFiles.L3], /type RestaurantPreview/);
  assert.match(
    generated.files[laneFiles.L3],
    /extend type Query\s*{\s*restaurant\(id: String\): RestaurantPreview/,
  );
  assert.doesNotMatch(generated.files[laneFiles.L3], /DeferredContract/);
});

test("produces a file entry for every lane including the empty ones", () => {
  const generated = withoutL12();
  assert.deepEqual(
    Object.keys(generated.files).sort(),
    Object.values(laneFiles).sort(),
  );
  for (const lane of generated.emptyLanes) {
    assert.ok(
      Object.hasOwn(generated.files, laneFiles[lane]),
      `empty lane ${lane} must keep its files entry`,
    );
    assert.ok(generated.files[laneFiles[lane]].length > 0);
  }
});

test("applies exact argument and named input overrides", () => {
  const requirements = deriveFromDocuments([
    {
      app: "web",
      text: "mutation Create($addressInput: AddressInput!) { createAddress(addressInput: $addressInput) { _id } }",
    },
  ]);
  const generated = generate(
    requirements,
    {
      fixed: {},
      byFieldName: {},
      byPath: {},
      typeOverrides: {},
      ownership: {},
      argumentOverrides: {
        "mutation.createAddress.addressInput": "AddressInput!",
      },
      inputOverrides: {
        AddressInput: {
          _id: "ID",
          label: "String!",
          longitude: "String!",
        },
      },
    },
    {
      operations: [{ type: "mutation", name: "createAddress", lane: "L4" }],
    },
  );
  const sdl = Object.values(generated.files).join("\n");
  assert.match(
    sdl,
    /input AddressInput\s*{\s*_id: ID\s+label: String!\s+longitude: String!\s*}/,
  );
  assert.match(
    sdl,
    /createAddress\(addressInput: AddressInput!\): CreateAddressCreateAddress/,
  );
  assert.doesNotThrow(() => buildSchema(sdl));
});
