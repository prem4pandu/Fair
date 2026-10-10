// T-026C regression evidence: compare the retired source-text regex against the
// syntax-tree implementation on the real repository. Run from implementation/:
//   node docs/artifacts/w25/t026/state/compare.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { implementedRoots } from "../../../../../tools/lib/operation-state.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const implementation = resolve(here, "../../../../..");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "node_modules" || entry.name === "generated"
        ? []
        : walk(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

const pattern = /@(Query|Mutation|Subscription)\(\s*"([A-Za-z0-9_]+)"\s*\)/g;
const legacy = new Map();
for (const path of walk(resolve(implementation, "services/api/src"))) {
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(pattern)) {
    const key = `${match[1].toLowerCase()}.${match[2]}`;
    if (!legacy.has(key)) legacy.set(key, []);
    const line = text.slice(0, match.index).split("\n").length;
    legacy.get(key).push(`${path.replace(implementation + "/", "")}:${line}`);
  }
}

const ast = implementedRoots({ implementation });
const dropped = [...legacy.keys()].filter((key) => !ast.has(key)).sort();
const added = [...ast].filter((key) => !legacy.has(key)).sort();

console.log(`legacy regex keys: ${legacy.size}`);
console.log(`syntax-tree keys:  ${ast.size}`);
console.log(`dropped (regex said implemented, tree disagrees): ${dropped.length}`);
for (const key of dropped) console.log(`  - ${key}  ${legacy.get(key).join(", ")}`);
console.log(`added (tree found, regex missed): ${added.length}`);
for (const key of added) console.log(`  + ${key}`);

const expected = process.argv[2];
if (expected) {
  const actual = `${dropped.length} dropped / ${added.length} added`;
  console.log(
    actual === expected
      ? `REGRESSION CHECK: PASS (${actual})`
      : `REGRESSION CHECK: FAIL (expected ${expected}, got ${actual})`,
  );
  if (actual !== expected) process.exitCode = 1;
}
