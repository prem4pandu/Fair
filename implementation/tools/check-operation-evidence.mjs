#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const operationKey = ({ type, name }) => `${type}:${name}`;
const mobileApps = new Set(["app", "app(sv)", "rider", "store"]);
const webApps = new Set(["web", "admin", "svadmin(sv)"]);
const knownApps = new Set([...mobileApps, ...webApps]);
const supportedTypes = new Set(["query", "mutation", "subscription"]);
const declarationNotice =
  "Declaration completeness with operation-associated artifacts; not release proof.";

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
  let requireComplete = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--require-complete") requireComplete = true;
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
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.report)
    fs.writeFileSync(path.resolve(root, options.report), json, { flag: "wx" });
  process.stdout.write(json);
  return report.errors.length || (requireComplete && !report.complete) ? 1 : 0;
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
