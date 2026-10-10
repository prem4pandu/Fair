#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import {
  defaultImplementation,
  implementedRoots,
  sdlHomes,
} from "./lib/operation-state.mjs";

export const operationKey = ({ type, name }) => `${type}:${name}`;
const mobileApps = new Set(["app", "app(sv)", "rider", "store"]);
const webApps = new Set(["web", "admin", "svadmin(sv)"]);
const knownApps = new Set([...mobileApps, ...webApps]);
const supportedTypes = new Set(["query", "mutation", "subscription"]);
const declarationNotice =
  "Declaration completeness with operation-associated artifacts; not release proof.";

// Served roots that are deliberately not part of the app-operation inventory:
// the kernel's own inert placeholders in contracts/enatega/core.graphql. They
// exist so codegen and the standalone contract set have root types; listing
// them here is the only way a served-but-uninventoried root may pass, so any
// new one fails the check instead of silently disappearing from every artifact.
export const UNINVENTORIED_SERVED_ROOTS = new Set([
  "query._kernel",
  "subscription._kernel",
]);

export function checkOperationSchema(
  inventory,
  {
    implementation = defaultImplementation,
    implemented = implementedRoots({ implementation }),
    homes = runtimeSdlHomes(implementation),
    fallbackEnabled = defaultFallbackEnabled(implementation),
    uninventoriedExemptions = UNINVENTORIED_SERVED_ROOTS,
  } = {},
) {
  const errors = [];
  if (
    !Array.isArray(inventory?.operations) ||
    inventory.operations.length === 0
  )
    return {
      ready: false,
      total: 0,
      implemented: 0,
      explicitNotImplemented: 0,
      missing: [],
      errors: ["Inventory must contain at least one operation"],
    };
  const missing = [];
  const inventoryKeys = new Set(
    inventory.operations.map(
      (operation) =>
        `${String(operation?.type ?? "").toLowerCase()}.${operation?.name ?? ""}`,
    ),
  );
  let implementedCount = 0;
  let fallbackCount = 0;
  for (const operation of inventory.operations) {
    const key = `${String(operation?.type ?? "").toLowerCase()}.${operation?.name ?? ""}`;
    if (!homes.has(key)) {
      missing.push({
        type: operation?.type,
        name: operation?.name,
        reason: "SDL_MISSING",
      });
      continue;
    }
    if (implemented.has(key)) implementedCount += 1;
    else if (fallbackEnabled) fallbackCount += 1;
    else
      missing.push({
        type: operation?.type,
        name: operation?.name,
        reason: "NO_RESOLVER_OR_NOT_IMPLEMENTED_FALLBACK",
      });
  }
  // The reverse direction: a root the runtime serves but the inventory never
  // lists would be invisible to every generated artifact, so it must fail here
  // unless it is an explicitly reviewed kernel placeholder.
  for (const key of homes.keys())
    if (!inventoryKeys.has(key) && !uninventoriedExemptions.has(key)) {
      const [type, ...rest] = key.split(".");
      missing.push({
        type,
        name: rest.join("."),
        reason: "UNINVENTORIED_SDL_ROOT",
      });
    }
  if (inventory.total !== inventory.operations.length)
    errors.push("Inventory total does not match operation count");
  return {
    ready: errors.length === 0 && missing.length === 0,
    total: inventory.operations.length,
    implemented: implementedCount,
    explicitNotImplemented: fallbackCount,
    missing,
    errors,
  };
}

function defaultFallbackEnabled(implementation) {
  try {
    const app = fs.readFileSync(
      path.resolve(implementation, "services/api/src/app.ts"),
      "utf8",
    );
    const fallback = fs.readFileSync(
      path.resolve(
        implementation,
        "services/api/src/kernel/not-implemented.ts",
      ),
      "utf8",
    );
    const appAst = ts.createSourceFile(
      "app.ts",
      app,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let imported = false,
      wired = false;
    const visit = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier.text === "./kernel/not-implemented.js" &&
        node.importClause?.namedBindings?.elements?.some(
          (element) => element.name.text === "fillNotImplemented",
        )
      )
        imported = true;
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(appAst) === "transformSchema" &&
        node.initializer.getText(appAst) === "fillNotImplemented"
      )
        wired = true;
      ts.forEachChild(node, visit);
    };
    visit(appAst);
    const fallbackAst = ts.createSourceFile(
      "not-implemented.ts",
      fallback,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const text = fallbackAst.getText();
    return (
      imported &&
      wired &&
      text.includes("field.resolve =") &&
      text.includes("field.subscribe =") &&
      (text.match(/appError\(\s*"NOT_IMPLEMENTED"/g)?.length ?? 0) >= 2
    );
  } catch {
    return false;
  }
}

function runtimeSdlHomes(implementation) {
  const schema = fs.readFileSync(
    path.resolve(implementation, "services/api/src/kernel/schema.ts"),
    "utf8",
  );
  const excludedBlock =
    /EXCLUDED_ENATEGA_CONTRACTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(
      schema,
    )?.[1];
  if (!excludedBlock)
    throw new Error("Cannot determine the runtime contract exclusion set");
  const excluded = new Set(
    [...excludedBlock.matchAll(/["']([^"']+\.graphql)["']/g)].map(
      (match) => match[1],
    ),
  );
  return sdlHomes({ implementation, excludedFiles: excluded });
}

/** Evidence is a declaration plus inspectable artifacts, never proof of production readiness.
 * Format: {records:[{type,name,tests:{unit:[check],integration:[check],
 * playwright:[check],webJourney:[check],device:[check]}}]}.
 * check: {path,command,result:{status:'passed',exitCode:0,evidenceFiles:[path]}}.
 * All paths resolve against root; files must be present, regular and nonempty. Test and result artifact contents must include the exact
 * operation key (type:name or type.name), bounded by non-identifier characters.
 */
export function checkOperationEvidence(
  inventory,
  evidence = { records: [] },
  {
    root = process.cwd(),
    inspectFile = defaultInspectFile,
    readTestFile = (file) => fs.readFileSync(file, "utf8"),
  } = {},
) {
  const errors = [],
    uncovered = [],
    covered = [];
  if (!Array.isArray(inventory?.operations))
    return {
      errors: ["Inventory operations must be an array"],
      uncovered,
      covered,
      total: 0,
      complete: false,
    };
  if (inventory.operations.length === 0)
    errors.push("Inventory must contain at least one operation");
  const operations = new Map();
  for (const operation of inventory.operations) {
    if (
      !operation ||
      typeof operation.type !== "string" ||
      !operation.type ||
      typeof operation.name !== "string" ||
      !operation.name
    ) {
      errors.push("Invalid inventory operation");
      continue;
    }
    const key = operationKey(operation);
    if (!supportedTypes.has(operation.type))
      errors.push(`Unsupported operation type: ${key}`);
    if (!Array.isArray(operation.apps) || operation.apps.length === 0)
      errors.push(`${key}: missing or empty apps`);
    else
      for (const app of operation.apps)
        if (!knownApps.has(app)) errors.push(`${key}: unknown app ${app}`);
    if (operations.has(key))
      errors.push(`Duplicate inventory operation: ${key}`);
    operations.set(key, operation);
  }
  if (inventory.total !== inventory.operations.length)
    errors.push("Inventory total does not match operation count");
  if (!Array.isArray(evidence?.records))
    return {
      errors: [...errors, "Evidence records must be an array"],
      uncovered,
      covered,
      total: operations.size,
      complete: false,
    };
  const records = new Map();
  for (const record of evidence.records) {
    const key = operationKey(record ?? {});
    if (!operations.has(key)) errors.push(`Unexpected operation: ${key}`);
    if (records.has(key)) errors.push(`Duplicate evidence operation: ${key}`);
    records.set(key, record);
  }
  const checkFile = (file, label) => {
    if (typeof file !== "string" || !file.trim()) {
      errors.push(`${label}: missing file path`);
      return;
    }
    if (!inspectFile(path.resolve(root, file)))
      errors.push(`${label}: missing, empty or non-regular file ${file}`);
  };
  for (const [key, operation] of operations) {
    const record = records.get(key);
    if (!record) {
      uncovered.push({
        type: operation.type,
        name: operation.name,
        missing: ["evidence record"],
      });
      continue;
    }
    const before = errors.length;
    const apps = Array.isArray(operation.apps) ? operation.apps : [];
    const required = ["unit", "integration"];
    if (apps.some((app) => mobileApps.has(app))) required.push("device");
    if (apps.some((app) => webApps.has(app))) required.push("web");
    for (const category of Object.keys(record.tests ?? {})) {
      if (
        !["unit", "integration", "device", "playwright", "webJourney"].includes(
          category,
        )
      )
        errors.push(`${key}: unknown test category ${category}`);
      else if (
        !required.includes(category) &&
        !["playwright", "webJourney"].includes(category)
      )
        required.push(category);
    }
    if (
      (record.tests?.playwright || record.tests?.webJourney) &&
      !required.includes("web")
    )
      required.push("web");
    const missing = [];
    for (const category of required) {
      const checks =
        category === "web"
          ? [
              ...(Array.isArray(record.tests?.playwright)
                ? record.tests.playwright
                : []),
              ...(Array.isArray(record.tests?.webJourney)
                ? record.tests.webJourney
                : []),
            ]
          : record.tests?.[category];
      if (!Array.isArray(checks) || checks.length === 0) {
        missing.push(category);
        continue;
      }
      for (const [index, check] of checks.entries()) {
        const label = `${key} ${category}[${index}]`;
        checkFile(check?.path, label);
        const associate = (file, fileLabel) => {
          if (typeof file !== "string" || !file.trim()) return;
          const escape = (value) =>
            value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const matcher = new RegExp(
            `(^|[^A-Za-z0-9_])${escape(operation.type)}[.:]${escape(operation.name)}($|[^A-Za-z0-9_])`,
          );
          try {
            const contents = readTestFile(path.resolve(root, file));
            if (typeof contents !== "string" || !matcher.test(contents))
              errors.push(
                `${fileLabel}: no exact operation association ${key}`,
              );
          } catch {
            errors.push(
              `${fileLabel}: cannot read operation association ${file}`,
            );
          }
        };
        associate(check?.path, label);
        if (typeof check?.command !== "string" || !check.command.trim())
          errors.push(`${label}: missing command`);
        if (check?.result?.status !== "passed" || check?.result?.exitCode !== 0)
          errors.push(`${label}: missing actual passing result`);
        if (
          !Array.isArray(check?.result?.evidenceFiles) ||
          check.result.evidenceFiles.length === 0
        )
          errors.push(`${label}: missing result evidence files`);
        else
          check.result.evidenceFiles.forEach((file) => {
            checkFile(file, `${label} result`);
            associate(file, `${label} result`);
          });
      }
    }
    if (missing.length || errors.length > before)
      uncovered.push({
        type: operation.type,
        name: operation.name,
        missing: [
          ...missing,
          ...(errors.length > before ? ["invalid evidence"] : []),
        ],
      });
    else covered.push({ type: operation.type, name: operation.name });
  }
  return {
    notice: declarationNotice,
    total: operations.size,
    covered,
    uncovered,
    errors,
    complete: errors.length === 0 && uncovered.length === 0,
  };
}
function defaultInspectFile(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}
export function runCli(args = process.argv.slice(2)) {
  const options = { inventory: "docs/OPERATION_LANES.json" };
  let requireComplete = false,
    requireSchema = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--require-complete") requireComplete = true;
    else if (args[i] === "--require-schema") requireSchema = true;
    else if (
      ["--inventory", "--evidence", "--report", "--root"].includes(args[i]) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      options[args[i].slice(2)] = args[++i];
    else throw new Error(`Unknown option or missing argument: ${args[i]}`);
  }
  const root = path.resolve(options.root ?? process.cwd());
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  const report = checkOperationEvidence(
    read(options.inventory),
    options.evidence ? read(options.evidence) : { records: [] },
    { root },
  );
  if (requireSchema)
    report.schemaReadiness = checkOperationSchema(read(options.inventory), {
      implementation: root,
    });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.report)
    fs.writeFileSync(path.resolve(root, options.report), json, { flag: "wx" });
  process.stdout.write(json);
  return report.errors.length ||
    (requireComplete && !report.complete) ||
    (requireSchema && !report.schemaReadiness?.ready)
    ? 1
    : 0;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
