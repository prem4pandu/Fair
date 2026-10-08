import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveFromDocuments,
  multivendorDocuments,
} from "./derive-type-requirements.mjs";

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
