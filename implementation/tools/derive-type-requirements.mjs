import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Kind, parse, print } from "graphql";
import { format } from "prettier";

import { listDocuments, loadDocument } from "./lib/documents.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apps = [
  "enatega-multivendor-app",
  "enatega-multivendor-admin",
  "enatega-multivendor-store",
  "enatega-multivendor-rider",
  "enatega-multivendor-web",
  "enatega-singlevendor-admin",
];

const sorted = (values) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b, "en"));

function namedInput(typeNode) {
  let node = typeNode;
  while (node.kind === Kind.NON_NULL_TYPE || node.kind === Kind.LIST_TYPE)
    node = node.type;
  return node.name.value.endsWith("Input") ? node.name.value : null;
}

function emptySelection() {
  return { leaf: false, typeConditions: [], fields: {} };
}

function mergeSelection(target, selectionSet, fragments, conditions = []) {
  if (!selectionSet) {
    target.leaf = true;
    return;
  }
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const name = selection.name.value;
      if (name === "__typename") continue;
      const child = (target.fields[name] ??= emptySelection());
      child.typeConditions = sorted([...child.typeConditions, ...conditions]);
      mergeSelection(child, selection.selectionSet, fragments, conditions);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const condition = selection.typeCondition?.name.value;
      const next = condition ? [...conditions, condition] : conditions;
      target.typeConditions = sorted([...target.typeConditions, ...next]);
      mergeSelection(target, selection.selectionSet, fragments, next);
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragment = fragments.get(selection.name.value);
      if (!fragment)
        throw new Error(`Missing fragment ${selection.name.value}`);
      const condition = fragment.typeCondition.name.value;
      const next = [...conditions, condition];
      target.typeConditions = sorted([...target.typeConditions, condition]);
      mergeSelection(target, fragment.selectionSet, fragments, next);
    }
  }
}

function objectKeys(value) {
  return value.kind === Kind.OBJECT
    ? value.fields.map((field) => field.name.value)
    : [];
}

function objectFieldTypes(value, variables) {
  if (value.kind !== Kind.OBJECT) return {};
  return Object.fromEntries(
    value.fields
      .map((field) => {
        const type =
          field.value.kind === Kind.VARIABLE
            ? variables.get(field.value.name.value)
            : ({
                [Kind.INT]: "Int",
                [Kind.FLOAT]: "Float",
                [Kind.STRING]: "String",
                [Kind.BOOLEAN]: "Boolean",
              }[field.value.kind] ?? "String");
        return [field.name.value, type];
      })
      .sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}

function normalizeNode(node) {
  node.typeConditions = sorted(node.typeConditions);
  node.fields = Object.fromEntries(
    Object.entries(node.fields)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([name, child]) => [name, normalizeNode(child)]),
  );
  return node;
}

export function deriveFromDocuments(documents) {
  const result = { query: {}, mutation: {}, subscription: {}, inputs: {} };
  for (const document of documents) {
    const ast = parse(document.text);
    const fragments = new Map(
      ast.definitions
        .filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION)
        .map((definition) => [definition.name.value, definition]),
    );
    for (const operation of ast.definitions.filter(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION,
    )) {
      const variables = new Map(
        (operation.variableDefinitions ?? []).map((definition) => {
          const type = print(definition.type);
          const input = namedInput(definition.type);
          if (input) result.inputs[input] ??= { declaredName: input, keys: [] };
          return [definition.variable.name.value, type];
        }),
      );
      const roots = [];
      const collectRoots = (selectionSet) => {
        for (const selection of selectionSet.selections) {
          if (selection.kind === Kind.FIELD) roots.push(selection);
          else if (selection.kind === Kind.INLINE_FRAGMENT)
            collectRoots(selection.selectionSet);
          else if (selection.kind === Kind.FRAGMENT_SPREAD) {
            const fragment = fragments.get(selection.name.value);
            if (!fragment)
              throw new Error(`Missing fragment ${selection.name.value}`);
            collectRoots(fragment.selectionSet);
          }
        }
      };
      collectRoots(operation.selectionSet);
      for (const field of roots) {
        const rootField = (result[operation.operation][field.name.value] ??= {
          arguments: {},
          selection: emptySelection(),
          apps: [],
        });
        rootField.apps = sorted([...rootField.apps, document.app]);
        for (const argument of field.arguments ?? []) {
          const entry = (rootField.arguments[argument.name.value] ??= {
            variableTypes: [],
            literalKinds: [],
            objectKeys: [],
            objectFieldTypes: {},
            enumValues: [],
          });
          if (argument.value.kind === Kind.VARIABLE) {
            const variableType = variables.get(argument.value.name.value);
            if (!variableType)
              throw new Error(
                `Missing variable definition $${argument.value.name.value}`,
              );
            entry.variableTypes = sorted([
              ...entry.variableTypes,
              variableType,
            ]);
          } else {
            entry.literalKinds = sorted([
              ...entry.literalKinds,
              argument.value.kind,
            ]);
            entry.objectKeys = sorted([
              ...entry.objectKeys,
              ...objectKeys(argument.value),
            ]);
            entry.objectFieldTypes = {
              ...entry.objectFieldTypes,
              ...objectFieldTypes(argument.value, variables),
            };
            if (argument.value.kind === Kind.ENUM)
              entry.enumValues = sorted([
                ...entry.enumValues,
                argument.value.value,
              ]);
          }
        }
        mergeSelection(rootField.selection, field.selectionSet, fragments);
      }
    }
  }
  for (const operation of ["query", "mutation", "subscription"])
    result[operation] = Object.fromEntries(
      Object.entries(result[operation])
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([name, value]) => {
          value.arguments = Object.fromEntries(
            Object.entries(value.arguments).sort(([a], [b]) =>
              a.localeCompare(b, "en"),
            ),
          );
          value.selection = normalizeNode(value.selection);
          return [name, value];
        }),
    );
  result.inputs = Object.fromEntries(
    Object.entries(result.inputs).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  return result;
}

function operationRoots(text) {
  const ast = parse(text);
  const fragments = new Map(
    ast.definitions
      .filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION)
      .map((definition) => [definition.name.value, definition]),
  );
  const roots = [];
  const collect = (operation, selectionSet, seen = new Set()) => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD)
        roots.push(`${operation}.${selection.name.value}`);
      else if (selection.kind === Kind.INLINE_FRAGMENT)
        collect(operation, selection.selectionSet, seen);
      else if (!seen.has(selection.name.value)) {
        const fragment = fragments.get(selection.name.value);
        if (fragment)
          collect(
            operation,
            fragment.selectionSet,
            new Set([...seen, selection.name.value]),
          );
      }
    }
  };
  for (const definition of ast.definitions)
    if (definition.kind === Kind.OPERATION_DEFINITION)
      collect(definition.operation, definition.selectionSet);
  return sorted(roots);
}

const singleVendorModeFile = (file) =>
  /(^|\/)(?:singlevendor|single-vendor)(\/|$)/i.test(file ?? "");

export function multivendorDocuments(documents, lanes) {
  const laneByRoot = new Map(
    lanes.operations.map(({ type, name, lane }) => [`${type}.${name}`, lane]),
  );
  return documents.filter((document) => {
    if (document.app === "enatega-singlevendor-admin") return false;
    if (singleVendorModeFile(document.file)) return false;
    const roots = operationRoots(document.text);
    return !(
      roots.length > 0 && roots.every((root) => laneByRoot.get(root) === "L12")
    );
  });
}

// Which documents inform the generated SDL. This is deliberately wider than the
// multivendor gate: the single-vendor admin's selections are additive (extra
// fields and arguments break no document that does not select them), so the
// contract should serve that app even though it sits outside the gate.
//
// Still excluded, for reasons that are not about scope at all:
//   - single-vendor MODE files, because they contradict the three shipping
//     multivendor apps on emailExist/phoneExist (object vs Boolean). Honouring
//     them would break the live login flow in web, app and rider, so they stay
//     out until the single-vendor lane is actually built (owner decision D1/W21).
//   - L12-only documents, so generate-sdl keeps treating L12 as an empty lane
//     and never overwrites the hand-curated L12-single-vendor.graphql.
export function contractDocuments(documents, lanes) {
  const laneByRoot = new Map(
    lanes.operations.map(({ type, name, lane }) => [`${type}.${name}`, lane]),
  );
  return documents.filter((document) => {
    if (singleVendorModeFile(document.file)) return false;
    const roots = operationRoots(document.text);
    return !(
      roots.length > 0 && roots.every((root) => laneByRoot.get(root) === "L12")
    );
  });
}

// Keep reconciliation independently testable: duplicate entries must never be
// silently overwritten by Map, and every manual entry must still match its site.
export function reconcileDocumentSites(documents, artifact, sourceHash) {
  const resolutions = new Map();
  for (const item of artifact.resolutions ?? []) {
    const key = `${item.app}:${item.file}:${item.line}`;
    if (resolutions.has(key))
      throw new Error(`Duplicate dynamic document resolution ${key}`);
    resolutions.set(key, item);
  }
  const seen = new Set();
  const result = documents.map((document) => {
    if (document.resolved) return document;
    const key = `${document.app}:${document.file}:${document.line}`;
    const resolution = resolutions.get(key);
    if (!resolution) throw new Error(`Unresolved document ${key}`);
    if (sourceHash(document) !== resolution.sourceSha256)
      throw new Error(`Stale dynamic document resolution ${key}`);
    if (seen.has(key))
      throw new Error(`Duplicate dynamic document site ${key}`);
    parse(resolution.text);
    seen.add(key);
    return { ...document, text: resolution.text, resolved: true };
  });
  const stale = [...resolutions.keys()].filter((key) => !seen.has(key));
  if (stale.length)
    throw new Error(`Stale resolution entries: ${stale.join(", ")}`);
  return result;
}

export function verifyAutomaticSites(documents, entries, sourceHash) {
  const index = new Map();
  for (const entry of entries) {
    const key = `${entry.app}:${entry.file}:${entry.line}`;
    if (index.has(key))
      throw new Error(`Duplicate automatic document resolution ${key}`);
    index.set(key, entry);
  }
  for (const document of documents.filter((item) => item.interpolations > 0)) {
    const key = `${document.app}:${document.file}:${document.line}`;
    const entry = index.get(key);
    if (!entry) throw new Error(`Unrecorded interpolated document ${key}`);
    const documentSha256 = createHash("sha256")
      .update(document.text)
      .digest("hex");
    if (
      sourceHash(document) !== entry.sourceSha256 ||
      documentSha256 !== entry.documentSha256
    )
      throw new Error(`Stale automatic document resolution ${key}`);
    index.delete(key);
  }
  if (index.size)
    throw new Error(
      `Obsolete automatic document resolutions: ${[...index.keys()].join(", ")}`,
    );
}

export function resolvedDocuments(options = {}) {
  const resolutionPath = resolve(
    root,
    "docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json",
  );
  const artifact = JSON.parse(readFileSync(resolutionPath, "utf8"));
  const documents = reconcileDocumentSites(
    apps.flatMap((app) =>
      listDocuments(app).map((document) => ({ app, ...document })),
    ),
    artifact,
    ({ app, file }) =>
      createHash("sha256")
        .update(readFileSync(resolve(root, "vendor/enatega-ui", app, file)))
        .digest("hex"),
  );
  if (
    artifact.automaticallyResolvedSites &&
    options.checkAutomaticSites !== false
  )
    verifyAutomaticSites(
      documents,
      artifact.automaticallyResolvedSites,
      ({ app, file }) =>
        createHash("sha256")
          .update(readFileSync(resolve(root, "vendor/enatega-ui", app, file)))
          .digest("hex"),
    );
  for (const supplemental of artifact.supplementalDocuments ?? []) {
    const source = readFileSync(
      resolve(root, "vendor/enatega-ui", supplemental.app, supplemental.file),
    );
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash !== supplemental.sourceSha256)
      throw new Error(
        `Stale supplemental document ${supplemental.app}:${supplemental.file}:${supplemental.exportName}`,
      );
    const text = loadDocument(
      supplemental.app,
      supplemental.file,
      supplemental.exportName,
    );
    const existing = documents.find(
      (document) =>
        document.app === supplemental.app &&
        document.file === supplemental.file &&
        document.exportName === supplemental.exportName,
    );
    if (existing) {
      if (existing.text !== text)
        throw new Error(
          `Conflicting supplemental document ${supplemental.exportName}`,
        );
      continue;
    }
    documents.push({
      app: supplemental.app,
      file: supplemental.file,
      line: 1,
      exportName: supplemental.exportName,
      text,
      resolved: true,
    });
  }
  if (options.scope === "multivendor" || options.scope === "contract") {
    const lanes =
      options.lanes ??
      JSON.parse(readFileSync(resolve(root, "docs/OPERATION_LANES.json")));
    return options.scope === "contract"
      ? contractDocuments(documents, lanes)
      : multivendorDocuments(documents, lanes);
  }
  return documents;
}

export async function run() {
  const result = deriveFromDocuments(resolvedDocuments({ scope: "contract" }));
  writeFileSync(
    resolve(root, "docs/ENATEGA_TYPE_REQUIREMENTS.json"),
    await format(JSON.stringify(result), { parser: "json" }),
  );
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await run();
