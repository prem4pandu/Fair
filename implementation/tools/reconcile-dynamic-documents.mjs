// Records the statically expanded interpolated sites; never executes UI code.
// Use --check in verification. Regeneration is an explicit reviewable action.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "prettier";
import { Kind, parse } from "graphql";
import { resolvedDocuments } from "./derive-type-requirements.mjs";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "docs/ENATEGA_DYNAMIC_DOCUMENT_RESOLUTIONS.json");
const artifact = JSON.parse(readFileSync(target, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sites = resolvedDocuments({ checkAutomaticSites: false })
  .filter((document) => document.interpolations > 0)
  .map((document) => ({
    app: document.app,
    file: document.file,
    line: document.line,
    exportName: document.exportName,
    sourceSha256: hash(
      readFileSync(
        resolve(root, "vendor/enatega-ui", document.app, document.file),
      ),
    ),
    documentSha256: hash(document.text),
    definitions: parse(document.text).definitions.map((definition) => ({
      kind:
        definition.kind === Kind.OPERATION_DEFINITION
          ? definition.operation
          : "fragment",
      name: definition.name?.value ?? null,
    })),
  }))
  .sort(
    (a, b) =>
      a.app.localeCompare(b.app, "en") ||
      a.file.localeCompare(b.file, "en") ||
      a.line - b.line,
  );
artifact.automaticallyResolvedSites = sites;
const output = await format(JSON.stringify(artifact), { parser: "json" });
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) {
    console.error(
      "Interpolated document inventory is stale; reconcile and review the changed sites",
    );
    process.exitCode = 1;
  }
} else writeFileSync(target, output);
console.log(
  `${sites.length} interpolated sites recorded; ${artifact.resolutions.length} manual import resolutions`,
);
