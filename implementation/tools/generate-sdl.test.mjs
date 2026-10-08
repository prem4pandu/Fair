import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSchema } from "graphql";

import { deriveFromDocuments } from "./derive-type-requirements.mjs";
import { generate } from "./generate-sdl.mjs";

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
