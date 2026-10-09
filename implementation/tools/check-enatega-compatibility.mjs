import ts from "typescript";
import { format } from "prettier";
import {
  buildSchema,
  parse,
  validate,
  Kind,
  GraphQLError,
  print,
  specifiedRules,
  NoUnusedFragmentsRule,
} from "graphql";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import {
  resolve,
  relative as nativeRelative,
  extname,
  basename,
  sep,
} from "node:path";
// Report paths are POSIX-style on every platform so reports stay byte-stable.
const relative = (from, to) => nativeRelative(from, to).split(sep).join("/");
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { resolvedDocuments } from "./derive-type-requirements.mjs";
import { looksLikeGraphQL } from "./lib/graphql-text.mjs";

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
function limitBytes(value) {
  const match = /^(\d+)(kb|mb)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * (match[2] === "mb" ? 1024 * 1024 : 1024);
}

function laneMap(lanes) {
  if (!lanes) return {};
  if (!Array.isArray(lanes.operations)) return lanes;
  return Object.fromEntries(
    lanes.operations.map(({ type, name, lane }) => [`${type}.${name}`, lane]),
  );
}

function readValidationRule(contracts) {
  const candidates = [
    resolve(contracts, "../services/api/src/kernel/limits.ts"),
    resolve(contracts, "../services/api/src/app.ts"),
  ];
  const serverPath = candidates.find(existsSync);
  if (!serverPath)
    return {
      boundRule: undefined,
      serverLimits: { status: "NOT_INSPECTED", reason: "API source is absent" },
    };

  const server = readFileSync(serverPath, "utf8");
  const serverAst = ts.createSourceFile(
    serverPath,
    server,
    ts.ScriptTarget.Latest,
    true,
  );
  let ruleExpression;
  let limitsExpression;
  const findDeclarations = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(serverAst);
      if (name === "boundedOperation")
        ruleExpression = node.initializer?.getText(serverAst);
      if (name === "LIMITS")
        limitsExpression = node.initializer?.getText(serverAst);
    }
    ts.forEachChild(node, findDeclarations);
  };
  findDeclarations(serverAst);
  if (!ruleExpression)
    throw new Error("Cannot locate actual backend boundedOperation rule");

  const compiled = ts.transpileModule(
    `${limitsExpression ? `const LIMITS = ${limitsExpression};` : ""}\nconst rule = ${ruleExpression}; rule;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const boundRule = runInNewContext(
    compiled,
    { Kind, GraphQLError, print },
    { timeout: 1000 },
  );

  const configPath = resolve(contracts, "../services/api/src/config.ts");
  const config = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const configured =
    /GRAPHQL_BODY_LIMIT[\s\S]*?\.default\(["'](\d+(?:kb|mb))["']\)/.exec(
      config,
    )?.[1];
  const httpBodyBytes = configured
    ? limitBytes(configured)
    : /json\(\{\s*limit:\s*["']16kb["']/.test(server) ||
        (serverPath.endsWith("limits.ts") &&
          existsSync(candidates[1]) &&
          /json\(\{\s*limit:\s*["']16kb["']/.test(
            readFileSync(candidates[1], "utf8"),
          ))
      ? 16384
      : null;
  const source = relative(resolve(contracts, ".."), serverPath);
  return {
    boundRule,
    serverLimits: {
      status: "ACTUAL_RULE_EXTRACTED",
      source,
      sourceSha256: hash(server),
      httpBodyBytes,
      caveat:
        "Body check uses GraphQL print AST and query-only JSON; variables, operationName, extensions and transport encoding can increase actual bytes.",
    },
  };
}

export function audit(source, contracts, appNames = apps, options = {}) {
  let schemaFiles = files(contracts, [".graphql"]);
  const generatedDirectory = resolve(contracts, "enatega");
  if (existsSync(generatedDirectory)) {
    schemaFiles = files(generatedDirectory, [".graphql"]);
    if (schemaFiles.some((path) => basename(path) === "core.graphql"))
      schemaFiles = schemaFiles.filter(
        (path) => basename(path) !== "kernel.graphql",
      );
    if (options.scope === "multivendor")
      schemaFiles = schemaFiles.filter(
        (path) => basename(path) !== "L12-single-vendor.graphql",
      );
  }
  if (!schemaFiles.length) throw new Error("No backend SDL files found");
  const schema = buildSchema(
    schemaFiles.map((path) => readFileSync(path, "utf8")).join("\n"),
  );
  const { boundRule, serverLimits } = readValidationRule(contracts);
  const lanes = laneMap(options.lanes);
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
          const rootsInScope = document.operations
            .flatMap((operation) =>
              operation.roots.map((root) => `${operation.kind}.${root}`),
            )
            .filter(
              (root) => root !== "query.__schema" && root !== "query.__type",
            );
          if (
            options.scope === "multivendor" &&
            rootsInScope.length > 0 &&
            rootsInScope.every((root) => lanes[root] === "L12")
          ) {
            document.status = "OUT_OF_SCOPE";
            document.errors = [];
            document.missingRoots = rootsInScope.filter(
              (root) => lanes[root] === "L12",
            );
            documents.push(document);
            return;
          }
          // A fragment-only export (e.g. a shared fragment interpolated into
          // other documents) is never sent as a document on its own, so
          // NoUnusedFragments must not condemn it. Every other rule still
          // applies, so a fragment selecting an unknown field still fails.
          const rules = ast.definitions.some(
            (definition) => definition.kind === Kind.OPERATION_DEFINITION,
          )
            ? undefined
            : specifiedRules.filter((rule) => rule !== NoUnusedFragmentsRule);
          document.documentKind = document.operations.length
            ? "OPERATION"
            : "FRAGMENT_LIBRARY";
          document.errors = validate(schema, ast, rules, {
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
          if (
            options.scope === "multivendor" &&
            document.missingRoots.length > 0 &&
            document.missingRoots.every((root) => lanes[root] === "L12")
          )
            document.status = "OUT_OF_SCOPE";
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
    const suppliedDocuments = options.documents?.filter(
      (document) => document.app === app,
    );
    // Sites the resolver already covered. The source scan still runs below so a
    // site the resolver does NOT cover is reported as UNRESOLVED instead of
    // silently disappearing from the audit.
    const covered = new Set();
    if (suppliedDocuments) {
      for (const document of suppliedDocuments) {
        // reconcile() compares against relative(source, path), which always
        // carries the app prefix; document.file is app-relative.
        covered.add(
          `${app}/${document.file}`.split(sep).join("/") + `:${document.line}`,
        );
        record(
          resolve(source, app, document.file),
          document.line,
          document.text,
          !document.resolved,
        );
      }
    }
    // When the caller supplies a resolution set it is the whole audit, unless it
    // explicitly asks for reconciliation. The CLI enables reconciliation in full
    // mode only, so a lexical site whose resolution is missing is reported as
    // UNRESOLVED instead of disappearing from the six-app audit. The scoped
    // extractor gap is tracked separately (docs/ROADMAP.md §9 R18).
    const reconcileSites = Boolean(options.reconcileUncoveredSites);
    const recordUncovered = (path, line, text, dynamic) => {
      // Without a supplied resolution set the lexical scan IS the audit.
      if (!suppliedDocuments) return record(path, line, text, dynamic);
      if (!reconcileSites) return;
      if (covered.has(`${relative(source, path)}:${line}`)) return;
      record(path, line, text, dynamic);
    };
    for (const path of paths) {
      const raw = readFileSync(path, "utf8");
      if ([".graphql", ".gql"].includes(extname(path))) {
        recordUncovered(path, 1, raw, false);
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
          recordUncovered(
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
          recordUncovered(
            path,
            ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
            node.text,
            false,
          );
          return;
        }
        if (ts.isTemplateExpression(node) && looksLikeGraphQL(node.head.text)) {
          recordUncovered(
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
      outOfScopeDocuments: documents.filter((d) => d.status === "OUT_OF_SCOPE")
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
        report.validDocuments + report.outOfScopeDocuments ===
          report.totalDocuments &&
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
      outOfScopeDocuments: reports.reduce(
        (n, a) => n + a.outOfScopeDocuments,
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
  const [source, contracts, output, ...flags] = process.argv.slice(2);
  const check = flags.includes("--check");
  const scopeAt = flags.indexOf("--scope");
  const scope = scopeAt >= 0 ? flags[scopeAt + 1] : undefined;
  const known = new Set(["--check", "--scope", scope]);
  if (
    !source ||
    !contracts ||
    !output ||
    flags.some((flag) => !known.has(flag)) ||
    (scopeAt >= 0 && scope !== "multivendor")
  )
    throw new Error(
      "Usage: node tools/check-enatega-compatibility.mjs SOURCE CONTRACTS OUTPUT [--check] [--scope multivendor]",
    );
  const lanesPath = resolve("docs/OPERATION_LANES.json");
  const lanes = scope ? JSON.parse(readFileSync(lanesPath, "utf8")) : undefined;
  const scopedApps = scope
    ? apps.filter((app) => app !== "enatega-singlevendor-admin")
    : apps;
  const report = audit(resolve(source), resolve(contracts), scopedApps, {
    scope,
    lanes,
    // Full mode audits all six apps too, so it must consume the checked-in
    // resolutions artifact instead of the raw lexical scan; otherwise every
    // import/interpolated site is reported UNRESOLVED forever. Reconciliation
    // then guarantees that any site the resolver does not cover is still
    // reported rather than silently dropped.
    documents: resolvedDocuments(scope ? { scope, lanes } : {}),
    reconcileUncoveredSites: !scope,
  });
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
  if (check && report.staticCompatibility !== "PASS") process.exitCode = 1;
}
