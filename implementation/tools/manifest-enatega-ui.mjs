import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const implementation = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(implementation, "vendor/enatega-ui");
const output = resolve(source, "SOURCE_MANIFEST.json");
const ignored = new Set(["SOURCE_MANIFEST.json"]);
const excludedPaths = new Set([
  "enatega-multivendor-app/GoogleService-Info.plist",
  "enatega-multivendor-app/google-services.json",
  "enatega-multivendor-rider/google-services.json",
  "enatega-multivendor-store/google-services.json",
]);

export function listFiles(root) {
  const skipDirs = new Set([
    ".git",
    "node_modules",
    ".next",
    ".expo",
    "dist",
    ".turbo",
  ]);
  const skipFile = (name) =>
    name === ".DS_Store" ||
    name === "next-env.d.ts" ||
    name === "tsconfig.tsbuildinfo" ||
    name === ".env" ||
    (/^\.env\..+/.test(name) && name !== ".env.example");
  const walk = (directory) =>
    readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory())
          return skipDirs.has(entry.name) ? [] : walk(path);
        const rel = relative(root, path).split(sep).join("/");
        if (
          !entry.isFile() ||
          ignored.has(entry.name) ||
          skipFile(entry.name) ||
          excludedPaths.has(rel)
        )
          return [];
        return [rel];
      });
  return walk(root);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const entries = listFiles(source).map((relativePath) => {
    const path = resolve(source, relativePath);
    const data = readFileSync(path);
    return {
      path: relativePath,
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  });
  const entriesJson = JSON.stringify(entries);

  const manifest = {
    schemaVersion: 1,
    claimedUpstreamCommit: "d9eb29e8b32b6ec11ee038f94d43caa0eba54bab",
    commitIndependentlyVerified: false,
    source: "repository-local pinned upstream snapshot",
    exclusions: [
      ".git",
      "node_modules",
      ".next",
      ".expo",
      "dist",
      ".turbo",
      ".DS_Store",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      ".env",
      ".env.*",
      "upstream Firebase application-binding files",
    ],
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    entriesSha256: createHash("sha256").update(entriesJson).digest("hex"),
    files: entries,
  };

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== serialized)
      throw new Error(
        "Stale Enatega UI manifest; run node tools/manifest-enatega-ui.mjs",
      );
  } else {
    writeFileSync(output, serialized);
  }
  console.log(
    JSON.stringify({
      status: process.argv.includes("--check") ? "verified" : "written",
      files: manifest.fileCount,
      bytes: manifest.totalBytes,
      entriesSha256: manifest.entriesSha256,
    }),
  );
}
