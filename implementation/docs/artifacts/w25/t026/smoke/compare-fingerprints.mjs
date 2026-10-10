#!/usr/bin/env node
/**
 * T-026A review A2 — fingerprint equality proof.
 *
 * Reads two or more `e2e-smoke.json` artifacts and proves that the
 * `deterministicSecretsFingerprint` of every child is identical across all of
 * them, while the `ephemeralContainerPlumbing` endpoints are free to differ
 * (testcontainers picks new host ports every run). Exits non-zero on any
 * deterministic fingerprint mismatch or missing field.
 *
 * Usage: node compare-fingerprints.mjs <artifact.json> <artifact.json> [...]
 */
import { readFileSync } from "node:fs";

const paths = process.argv.slice(2);
if (paths.length < 2) {
  process.stderr.write(
    "usage: compare-fingerprints.mjs <artifact.json> <artifact.json> [...]\n",
  );
  process.exit(2);
}

const artifacts = paths.map((path) => ({
  path,
  record: JSON.parse(readFileSync(path, "utf8")),
}));

const children = new Set();
for (const { record } of artifacts)
  for (const name of Object.keys(record.environment?.children ?? {}))
    children.add(name);

let failures = 0;
for (const child of [...children].sort()) {
  const rows = artifacts.map(({ path, record }) => {
    const entry = record.environment?.children?.[child];
    return {
      path,
      fingerprint: entry?.deterministicSecretsFingerprint,
      plumbing: entry?.ephemeralContainerPlumbing,
    };
  });
  const fingerprints = new Set(rows.map((row) => row.fingerprint));
  const equal = fingerprints.size === 1 && !fingerprints.has(undefined);
  if (!equal) failures += 1;
  process.stdout.write(
    `${equal ? "EQUAL  " : "DIFFER "} ${child} deterministicSecretsFingerprint\n`,
  );
  for (const row of rows)
    process.stdout.write(`          ${row.fingerprint ?? "<missing>"}  ${row.path}\n`);
  const plumbing = new Set(
    rows.map((row) => JSON.stringify(row.plumbing ?? null)),
  );
  process.stdout.write(
    `          ephemeralContainerPlumbing differs between runs: ${plumbing.size > 1 ? "yes (expected)" : "no"}\n`,
  );
  for (const row of rows)
    process.stdout.write(
      `          ${JSON.stringify(row.plumbing ?? null)}  ${row.path}\n`,
    );
  process.stdout.write("\n");
}

process.stdout.write(
  `result: ${failures === 0 ? "PASS" : "FAIL"} — ${children.size} child environment(s), ${artifacts.length} artifact(s), ${failures} mismatch(es)\n`,
);
process.exit(failures === 0 ? 0 : 1);
