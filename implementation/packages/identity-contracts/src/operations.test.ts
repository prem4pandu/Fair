import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { it, expect } from "vitest";
import { identityOperations } from "./index.js";

// The legacy contracts only *extend* the root types: the base Query/Mutation
// definitions live in the Enatega core contract, exactly as the runtime schema
// loads them (services/api/src/kernel/schema.ts). Building from the legacy files
// alone yields an SDL that cannot be constructed, so the base contract is part
// of this contract test.
const SDL_FILES = [
  "../../../contracts/enatega/core.graphql",
  "../../../contracts/foundation.graphql",
  "../../../contracts/identity.graphql",
];

it("validates every client operation against the frozen SDL", () => {
  const schema = buildSchema(
    SDL_FILES.map((path) =>
      readFileSync(new URL(path, import.meta.url), "utf8"),
    ).join("\n"),
  );
  for (const operation of Object.values(identityOperations))
    expect(validate(schema, parse(operation))).toEqual([]);
});
