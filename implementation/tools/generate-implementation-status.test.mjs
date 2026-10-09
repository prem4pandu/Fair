import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { implementedRoots } from "./lib/operation-state.mjs";
import { approvalState } from "./lib/gate-approval.mjs";

const root = resolve(import.meta.dirname, "..");
const readDocJson = (name) =>
  JSON.parse(readFileSync(resolve(root, "docs", name), "utf8"));

test("status report is current, self-contained, and accessible", () => {
  execFileSync(
    process.execPath,
    ["tools/generate-implementation-status.mjs", "--check"],
    { cwd: root },
  );
  const html = readFileSync(
    resolve(root, "docs/IMPLEMENTATION_STATUS.html"),
    "utf8",
  );
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<main>/);
  assert.match(html, /scope="row"/);
  assert.match(html, /COMPLETE|IN PROGRESS|BLOCKED/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script|<img|<link/i);
});

test("machine-readable status is generated from operation state, not prose", () => {
  const status = JSON.parse(
    readFileSync(resolve(root, "docs/IMPLEMENTATION_STATUS.json"), "utf8"),
  );
  const lanes = JSON.parse(
    readFileSync(resolve(root, "docs/OPERATION_LANES.json"), "utf8"),
  );
  assert.equal(status.operations.total, lanes.total);
  assert.ok(status.operations.withRealResolvers < status.operations.total);
  // Both of these were once hard-coded constants, which meant a real approval
  // could never be reported. They must be derived from the gate registry.
  const registry = readDocJson("GATES.json");
  const definitions = new Map(
    readDocJson("ROADMAP.json").gates.map((gate) => [gate.id, gate]),
  );
  const closed = (id) =>
    approvalState(definitions.get(id), registry.gates?.[id]?.latest).approved;
  assert.equal(
    status.approvedGates,
    Object.keys(registry.gates ?? {}).filter(closed).length,
    "approved gate count is derived from docs/GATES.json",
  );
  assert.equal(status.release, closed("G5") ? "APPROVED" : "NOT_APPROVED");
  assert.equal(
    Object.values(status.lanes).reduce((sum, lane) => sum + lane.roots, 0),
    lanes.total,
  );
  for (const gate of status.gates) {
    assert.equal(typeof gate.id, "string");
    assert.equal(typeof gate.passed, "boolean");
    assert.ok(Array.isArray(gate.commands));
  }
});

test("reported resolver coverage matches an independent source scan", () => {
  const status = JSON.parse(
    readFileSync(resolve(root, "docs/IMPLEMENTATION_STATUS.json"), "utf8"),
  );
  const lanes = JSON.parse(
    readFileSync(resolve(root, "docs/OPERATION_LANES.json"), "utf8"),
  );
  const implemented = implementedRoots({ implementation: root });
  const expected = lanes.operations.filter((operation) =>
    implemented.has(`${operation.type}.${operation.name}`),
  ).length;
  assert.equal(status.operations.withRealResolvers, expected);
  assert.ok(expected > 0, "at least one root has a real resolver today");
  assert.ok(expected < lanes.total, "the contract is far ahead of the code");
  assert.ok(
    status.notes.some((note) => note.includes("NOT_IMPLEMENTED")),
    "the report must state that unimplemented roots are counted as unimplemented",
  );
});

test("status exposes the full audit independently of the scoped result", () => {
  const status = JSON.parse(
    readFileSync(resolve(root, "docs/IMPLEMENTATION_STATUS.json"), "utf8"),
  );
  const full = JSON.parse(
    readFileSync(
      resolve(root, "docs/ENATEGA_COMPATIBILITY_REPORT.full.json"),
      "utf8",
    ),
  );
  assert.equal(status.fullStaticCompatibility.status, full.staticCompatibility);
  assert.equal(
    status.fullStaticCompatibility.documents,
    full.summary.documents,
  );
  assert.equal(
    status.fullStaticCompatibility.validDocuments,
    full.summary.validDocuments,
  );
  assert.equal(
    status.fullStaticCompatibility.unresolvedDocuments,
    full.summary.unresolvedDocuments,
  );
  assert.equal(
    status.fullStaticCompatibility.invalidDocuments,
    full.apps
      .flatMap((app) => app.documents)
      .filter((document) => document.status === "INVALID").length,
  );
  const html = readFileSync(
    resolve(root, "docs/IMPLEMENTATION_STATUS.html"),
    "utf8",
  );
  assert.match(html, /Full six-app compatibility/);
  assert.match(
    html.replace(/\s+/g, " "),
    /scoped PASS does not satisfy the W2 full-mode gate/,
  );
});
