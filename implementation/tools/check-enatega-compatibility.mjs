import ts from "typescript";
import { format } from "prettier";
import {
  buildSchema,
  parse,
  validate,
  Kind,
  GraphQLError,
  print,
} from "graphql";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative as nativeRelative, extname, sep } from "node:path";
// Report paths are POSIX-style on every platform so reports stay byte-stable.
const relative = (from, to) => nativeRelative(from, to).split(sep).join("/");
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";

export const apps = [
  "enatega-multivendor-web",
  "enatega-multivendor-admin",
  "enatega-singlevendor-admin",
  "enatega-multivendor-app",
  "enatega-multivendor-store",
  "enatega-multivendor-rider",
];
const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".expo",
  ".toolchain",
]);
const hash = (text) => createHash("sha256").update(text).digest("hex");
function files(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory())
        return ignored.has(entry.name) ? [] : files(path, extensions);
      return entry.isFile() && extensions.includes(extname(path)) ? [path] : [];
    });
}
function looksLikeGraphQL(text) {
  return /^(?:\s|#[^\n]*(?:\n|$))*(?:(?:query|mutation|subscription)\s*(?:[A-Za-z_]\w*\s*)?[({]|fragment\s+[A-Za-z_]\w*\s+on\s+|\{\s*[A-Za-z_])/.test(
    text,
  );
}
export function audit(source, contracts, appNames = apps) {
  const schemaFiles = files(contracts, [".graphql"]);
  if (!schemaFiles.length) throw new Error("No backend SDL files found");
  const schema = buildSchema(
    schemaFiles.map((path) => readFileSync(path, "utf8")).join("\n"),
  );
  const serverPath = resolve(contracts, "../services/api/src/app.ts");
  let boundRule;
  let serverLimits = {
    status: "NOT_INSPECTED",
    reason: "API source is absent",
  };
  if (existsSync(serverPath)) {
    const server = readFileSync(serverPath, "utf8");
    const serverAst = ts.createSourceFile(
      serverPath,
      server,
      ts.ScriptTarget.Latest,
      true,
    );
    let expression;
    const findRule = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText(serverAst) === "boundedOperation"
      )
        expression = node.initializer?.getText(serverAst);
      ts.forEachChild(node, findRule);
    };
    findRule(serverAst);
    if (!expression)
      throw new Error("Cannot locate actual backend boundedOperation rule");
    // Execute only our local validation rule, never frontend/upstream source.
    const compiled = ts.transpileModule(`const rule = ${expression}; rule;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    boundRule = runInNewContext(
      compiled,
      { Kind, GraphQLError, print },
      { timeout: 1000 },
    );
    const bodyLimit = /json\(\{\s*limit:\s*["']16kb["']/.test(server)
      ? 16384
      : null;
    serverLimits = {
      status: "ACTUAL_RULE_EXTRACTED",
      source: "services/api/src/app.ts",
      sourceSha256: hash(server),
      httpBodyBytes: bodyLimit,
      caveat:
        "Body check uses GraphQL print AST and query-only JSON; variables, operationName, extensions and transport encoding can increase actual bytes.",
    };
  }
  const reports = appNames.map((app) => {
    const documents = [];
    const sourceErrors = [];
    const paths = files(resolve(source, app), [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".graphql",
      ".gql",
    ]);
    function record(path, line, text, dynamic) {
      const document = {
        file: relative(source, path),
        line,
        sha256: hash(text),
        status: "UNRESOLVED",
        operations: [],
        missingRoots: [],
        errors: [],
      };
      if (dynamic) {
        document.errors.push({
          message:
            "Dynamic GraphQL expression requires import/interpolation resolution; source is never executed.",
        });
      } else {
        try {
          const ast = parse(text);
          const fragments = new Map(
            ast.definitions
              .filter((d) => d.kind === Kind.FRAGMENT_DEFINITION)
              .map((d) => [d.name.value, d]),
          );
          const roots = (selectionSet, seen = new Set()) =>
            selectionSet.selections.flatMap((selection) => {
              if (selection.kind === Kind.FIELD) return [selection.name.value];
              if (selection.kind === Kind.INLINE_FRAGMENT)
                return roots(selection.selectionSet, seen);
              if (seen.has(selection.name.value)) return [];
              const fragment = fragments.get(selection.name.value);
              return fragment
                ? roots(
                    fragment.selectionSet,
                    new Set([...seen, selection.name.value]),
                  )
                : [];
            });
          for (const operation of ast.definitions.filter(
            (d) => d.kind === Kind.OPERATION_DEFINITION,
          )) {
            const names = [...new Set(roots(operation.selectionSet))].sort();
            document.operations.push({
              kind: operation.operation,
              name: operation.name?.value ?? null,
              roots: names,
            });
            const type = schema.getRootType(operation.operation);
            for (const root of names)
              if (
                root !== "__typename" &&
                !(
                  operation.operation === "query" &&
                  ["__schema", "__type"].includes(root)
                ) &&
                !type?.getFields()[root]
              )
                document.missingRoots.push(`${operation.operation}.${root}`);
          }
          document.errors = validate(schema, ast, undefined, {
            maxErrors: 10000,
          }).map((error) => ({
            message: error.message,
            locations: error.locations ?? [],
          }));
          for (const operation of document.operations)
            if (!schema.getRootType(operation.kind))
              document.errors.push({
                message: `Backend schema has no ${operation.kind} root type`,
              });
          document.status =
            document.errors.length || document.missingRoots.length
              ? "INVALID"
              : "VALID_STATIC_DOCUMENT";
          document.backendOperationLimits = boundRule
            ? validate(schema, ast, [boundRule]).map((error) => error.message)
            : null;
          document.minimumHttpBodyBytes = Buffer.byteLength(
            JSON.stringify({ query: print(ast) }),
            "utf8",
          );
          document.minimumHttpBodyExceedsLimit =
            serverLimits.httpBodyBytes == null
              ? null
              : document.minimumHttpBodyBytes > serverLimits.httpBodyBytes;
        } catch (error) {
          document.status = "PARSE_ERROR";
          document.errors = [{ message: error.message }];
        }
      }
      documents.push(document);
    }
    for (const path of paths) {
      const raw = readFileSync(path, "utf8");
      if ([".graphql", ".gql"].includes(extname(path))) {
        record(path, 1, raw, false);
        continue;
      }
      const ast = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true);
      for (const diagnostic of ast.parseDiagnostics)
        sourceErrors.push({
          file: relative(source, path),
          line:
            ast.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
          code: diagnostic.code,
        });
      const visit = (node) => {
        const tagged =
          ts.isTaggedTemplateExpression(node) &&
          /(?:^|\.)(gql|graphql)$/.test(node.tag.getText(ast));
        const called =
          ts.isCallExpression(node) &&
          /(?:^|\.)(gql|graphql)$/.test(node.expression.getText(ast));
        if (tagged || called) {
          const argument = tagged ? node.template : node.arguments[0];
          const literal =
            argument &&
            (ts.isStringLiteral(argument) ||
              ts.isNoSubstitutionTemplateLiteral(argument));
          record(
            path,
            ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
            literal ? argument.text : node.getText(ast),
            !literal,
          );
          return;
        }
        if (
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node)) &&
          looksLikeGraphQL(node.text)
        ) {
          record(
            path,
            ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
            node.text,
            false,
          );
          return;
        }
        if (ts.isTemplateExpression(node) && looksLikeGraphQL(node.head.text)) {
          record(
            path,
            ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
            node.getText(ast),
            true,
          );
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    const missingRoots = [
      ...new Set(documents.flatMap((d) => d.missingRoots)),
    ].sort();
    return {
      app,
      filesScanned: paths.length,
      totalDocuments: documents.length,
      validDocuments: documents.filter(
        (d) => d.status === "VALID_STATIC_DOCUMENT",
      ).length,
      unresolvedDocuments: documents.filter((d) => d.status === "UNRESOLVED")
        .length,
      missingRoots,
      sourceErrors,
      documents,
    };
  });
  const compatible =
    serverLimits.status === "ACTUAL_RULE_EXTRACTED" &&
    serverLimits.httpBodyBytes !== null &&
    reports.length > 0 &&
    reports.every(
      (report) =>
        report.totalDocuments > 0 &&
        report.sourceErrors.length === 0 &&
        report.validDocuments === report.totalDocuments &&
        report.documents.every(
          (d) =>
            !d.backendOperationLimits?.length && !d.minimumHttpBodyExceedsLimit,
        ),
    );
  return {
    serverLimits,
    schemaVersion: 1,
    staticCompatibility: compatible ? "PASS" : "FAIL",
    method:
      "TypeScript AST extraction and GraphQL full-document validation against backend SDL; upstream code is never executed",
    limitations: [
      "Static validation cannot prove resolver behavior, runtime reachability, authorization, URLs, subscriptions transport or UI parity.",
      "Dynamic/interpolated gql calls are unresolved and fail the gate; arbitrary computed document factories may require manual audit.",
      "Imported fragments are not automatically assembled. Standalone fragments and absent imports may cause validation failures requiring explicit reconciliation.",
      "SDL compatibility is not proof that the running server loaded these contracts.",
    ],
    backendSchema: schemaFiles.map((path) => ({
      file: relative(contracts, path),
      sha256: hash(readFileSync(path, "utf8")),
    })),
    summary: {
      apps: reports.length,
      documents: reports.reduce((n, a) => n + a.totalDocuments, 0),
      validDocuments: reports.reduce((n, a) => n + a.validDocuments, 0),
      unresolvedDocuments: reports.reduce(
        (n, a) => n + a.unresolvedDocuments,
        0,
      ),
      missingRoots: [...new Set(reports.flatMap((a) => a.missingRoots))].sort(),
    },
    apps: reports,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [source, contracts, output, mode] = process.argv.slice(2);
  if (!source || !contracts || !output || (mode && mode !== "--check"))
    throw new Error(
      "Usage: node tools/check-enatega-compatibility.mjs SOURCE CONTRACTS OUTPUT [--check]",
    );
  const report = audit(resolve(source), resolve(contracts));
  writeFileSync(
    output,
    await format(JSON.stringify(report), { parser: "json" }),
  );
  console.log(
    JSON.stringify({
      status: report.staticCompatibility,
      ...report.summary,
      missingRoots: report.summary.missingRoots.length,
    }),
  );
  if (mode === "--check" && report.staticCompatibility !== "PASS")
    process.exitCode = 1;
}
