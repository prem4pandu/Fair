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
