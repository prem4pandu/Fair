import ts from "typescript";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { createHash } from "node:crypto";
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg)
  throw new Error("Usage: node tools/inventory-actions.mjs SOURCE OUTPUT");
const source = resolve(sourceArg);
const folders = [
  "enatega-multivendor-web",
  "enatega-multivendor-admin",
  "enatega-singlevendor-admin",
  "enatega-multivendor-app",
  "enatega-multivendor-store",
  "enatega-multivendor-rider",
];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const files = [];
function scan(directory) {
  for (const entry of readdirSync(directory).sort()) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      scan(path);
      continue;
    }
    if (![".ts", ".tsx", ".js", ".jsx"].includes(extname(path))) continue;
    const raw = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(
      path,
      raw,
      ts.ScriptTarget.Latest,
      true,
      extname(path).endsWith("x")
        ? ts.ScriptKind.TSX
        : extname(path) === ".ts"
          ? ts.ScriptKind.TS
          : ts.ScriptKind.JS,
    );
    const actions = [];
    const unknowns = [];
    const visit = (node) => {
      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(ast);
        if (/^on[A-Z]/.test(name) || name === "href") {
          const start = node.getStart(ast);
          const position = ast.getLineAndCharacterOfPosition(start);
          actions.push({
            id: digest(`${relative(source, path)}:${start}:${name}`).slice(
              0,
              24,
            ),
            line: position.line + 1,
            attribute: name,
            expression_sha256: digest(node.getText(ast)),
            requirement: "UNMAPPED",
            implementation: "NOT_STARTED",
            verification: "NOT_RUN",
          });
        }
      }
      if (ts.isJsxSpreadAttribute(node))
        unknowns.push({
          line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
          kind: "spread_attributes_may_supply_actions",
        });
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (actions.length || unknowns.length || ast.parseDiagnostics.length)
      files.push({
        path: relative(source, path),
        sha256: digest(raw),
        actions,
        unknowns,
        parse_errors: ast.parseDiagnostics.map((d) => ({
          code: d.code,
          line: ast.getLineAndCharacterOfPosition(d.start ?? 0).line + 1,
        })),
      });
  }
}
for (const folder of folders) scan(resolve(source, folder));
const report = {
  source_commit: "d9eb29e8b32b6ec11ee038f94d43caa0eba54bab",
  method: "TypeScript source AST; upstream code is not executed",
  limits: [
    "Source handlers are not proof of runtime reachability, feature semantics or exhaustive user capabilities",
    "Spread attributes, dynamic component behavior, gestures, menus and navigation configuration require manual/runtime audit",
    "Every action begins unmapped and unverified; release parity requires independent runtime reconciliation",
  ],
  files,
};
writeFileSync(outputArg, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    source_files: files.length,
    actions: files.reduce((n, f) => n + f.actions.length, 0),
    dynamic_spreads: files.reduce((n, f) => n + f.unknowns.length, 0),
    parse_errors: files.reduce((n, f) => n + f.parse_errors.length, 0),
  }),
);
