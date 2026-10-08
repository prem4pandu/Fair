import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { buildSchema, validateSchema } from "graphql";

function documents(directory, include = () => true) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return documents(path, include);
    return entry.name.endsWith(".graphql") && include(path)
      ? [readFileSync(path, "utf8")]
      : [];
  });
}

test("the runtime Enatega and compatible legacy contracts compose", () => {
  const contracts = fileURLToPath(new URL("../contracts/", import.meta.url));
  const compatibleLegacy = new Set([
    "foundation.graphql",
    "identity.graphql",
    "catalog.graphql",
    "addresses.graphql",
  ]);
  const schema = buildSchema(
    [
      ...documents(
        join(contracts, "enatega"),
        (path) =>
          !path.endsWith("kernel.graphql") &&
          !path.endsWith("L12-single-vendor.graphql"),
      ),
      ...[...compatibleLegacy].map((file) =>
        readFileSync(join(contracts, file), "utf8"),
      ),
    ].join("\n"),
  );
  assert.deepEqual(validateSchema(schema), []);
  assert.ok(schema.getQueryType().getFields().serviceInfo);
  assert.ok(schema.getQueryType().getFields().configuration);
  assert.ok(schema.getMutationType().getFields().registerCustomer);
  assert.ok(schema.getMutationType().getFields().metricsGeneral);
});
