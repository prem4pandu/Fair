import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { it, expect } from "vitest";
import { identityOperations } from "./index.js";
it("validates every client operation against the frozen SDL", () => {
  const schema = buildSchema(
    ["foundation", "identity"]
      .map((name) =>
        readFileSync(
          new URL(`../../../contracts/${name}.graphql`, import.meta.url),
          "utf8",
        ),
      )
      .join("\n"),
  );
  for (const operation of Object.values(identityOperations))
    expect(validate(schema, parse(operation))).toEqual([]);
});
