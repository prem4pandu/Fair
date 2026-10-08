// Lists every root GraphQL operation in the vendored Enatega apps, with the apps
// that use it. Documents are parsed only; upstream code is never executed.
// Usage (from implementation/):
//   node tools/inventory-operations.mjs docs/ENATEGA_OPERATION_INVENTORY.json
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "graphql";

const packages = [
  "multivendor-admin",
  "multivendor-app",
  "multivendor-rider",
  "multivendor-store",
  "multivendor-web",
  "singlevendor-admin",
];
const skipped = new Set([
  "node_modules",
  ".git",
  "cypress",
  ".next",
  "__tests__",
]);
const source = /\.(js|jsx|ts|tsx|graphql|gql)$/;
const graphqlFile = /\.(graphql|gql)$/;
// A gql tag, or a bare template literal that starts like a GraphQL document.
const documentStart =
  /\bgql\s*\(?\s*`|`(?=\s*(?:#[^\n]*\n\s*)*(?:query|mutation|subscription|fragment)\b)/g;

function walk(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (source.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      out.push(path);
  }
  return out;
}

// Extracts template-literal bodies. `${...}` interpolations are dropped; inside a
// selection set they are replaced by __typename so the document still parses.
function templateBodies(text) {
  const bodies = [];
  documentStart.lastIndex = 0;
  while (documentStart.exec(text)) {
    let index = documentStart.lastIndex;
    let body = "";
    let depth = 0;
    while (index < text.length) {
      const char = text[index];
      if (depth === 0 && char === "`") break;
      if (depth === 0 && char === "$" && text[index + 1] === "{") {
        depth = 1;
        index += 2;
        const open = (body.match(/\{/g) ?? []).length;
        const close = (body.match(/\}/g) ?? []).length;
        if (open > close) body += " __typename ";
        continue;
      }
      if (depth > 0) {
        if (char === "{") depth++;
        else if (char === "}") depth--;
        index++;
        continue;
      }
      body += char;
      index++;
    }
    documentStart.lastIndex = index + 1;
    bodies.push(body);
  }
  return bodies;
}

const roots = { query: {}, mutation: {}, subscription: {} };
const failures = [];
let documents = 0;
for (const name of packages) {
  const directory = join("vendor/enatega-ui", `enatega-${name}`);
  const label =
    name === "singlevendor-admin" ? "svadmin" : name.split("-").pop();
  for (const file of walk(directory)) {
    const text = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
    const bodies = graphqlFile.test(file) ? [text] : templateBodies(text);
    const tag = label + (/singlevendor/.test(file) ? "(sv)" : "");
    for (const body of bodies) {
      if (!body.trim()) continue;
      documents++;
      let document;
      try {
        document = parse(body);
      } catch (error) {
        failures.push(`${file}: ${error.message.slice(0, 80)}`);
        continue;
      }
      for (const definition of document.definitions) {
        if (definition.kind !== "OperationDefinition") continue;
        for (const selection of definition.selectionSet.selections) {
          if (selection.kind !== "Field") continue;
          (roots[definition.operation][selection.name.value] ??= new Set()).add(
            tag,
          );
        }
      }
    }
  }
}

const output = process.argv[2];
if (!output) throw new Error("usage: inventory-operations.mjs <output.json>");
const result = {};
for (const type of Object.keys(roots)) {
  result[type] = {};
  for (const name of Object.keys(roots[type]).sort())
    result[type][name] = [...roots[type][name]].sort();
}
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
const counts = Object.fromEntries(
  Object.entries(result).map(([type, names]) => [
    type,
    Object.keys(names).length,
  ]),
);
console.log(
  JSON.stringify({ documents, failures: failures.length, ...counts }),
);
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
