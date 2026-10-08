import { generate } from "@graphql-codegen/cli";
import { format } from "prettier";
import { readFile } from "node:fs/promises";
import config from "../codegen.ts";
const outputs = await generate(config, false);
for (const output of outputs) {
  const expected = await format(output.content, { parser: "typescript" });
  if ((await readFile(output.filename, "utf8")) !== expected)
    throw new Error(`Stale generated schema: ${output.filename}; run codegen`);
}
console.log("Generated schema matches frozen SDL");
