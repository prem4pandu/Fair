#!/usr/bin/env node
// Generates docs/OPERATION_TRACEABILITY.md: one row per statically extracted
// Enatega root operation, with its lane, wave, calling apps, backend resolver
// state, SDL home, owning plan, and recorded test evidence state.
//
// This is a generated artifact. Never hand-edit it: run
//   node tools/generate-operation-traceability.mjs
// and commit the result. `--check` fails when the file on disk is stale, which
// is what keeps the matrix honest as lanes land.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { format } from "prettier";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_PLANS, loadOperationState } from "./lib/operation-state.mjs";

const implementation = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = resolve(implementation, "docs/OPERATION_TRACEABILITY.md");

const sha = (text) => createHash("sha256").update(text).digest("hex");

function build() {
  const { lanes, compatibility, rows, laneSummary, laneDrift, totals } =
    loadOperationState({ implementation });

  const header = [
    "# Enatega operation traceability matrix",
    "",
    "**Generated file — do not hand-edit.** Regenerate with",
    "`node tools/generate-operation-traceability.mjs`; `--check` fails when stale.",
    "",
    `- Source: \`${lanes.source}\` (schemaVersion ${lanes.schemaVersion})`,
    `- Operations: ${totals.operations} (${totals.query} query, ` +
      `${totals.mutation} mutation, ${totals.subscription} subscription)`,
    `- Static document compatibility: ${compatibility.staticCompatibility} ` +
      `(${compatibility.summary.validDocuments}/${compatibility.summary.documents} documents valid)`,
    `- Resolvers implemented today: ${totals.implemented}/${totals.operations}`,
    `- Recorded per-operation evidence: ${totals.evidenced}/${totals.operations}`,
    `- Roots with no SDL declaration: ${totals.withoutSdl} (all in L12; \`contracts/enatega/L12-single-vendor.graphql\` is a placeholder scalar)`,
    laneDrift.length
      ? `- Data-quality note: \`OPERATION_LANES.json\` \`perLane\` disagrees with its own \`operations\` array (${laneDrift.map((lane) => `${lane.lane} ${lanes.perLane?.[lane.lane]}/${lane.count}`).join(", ")}). Run \`node tools/operation-lanes.mjs docs/ENATEGA_OPERATION_INVENTORY.json docs/OPERATION_LANES.json\`.`
      : "- `OPERATION_LANES.json` is internally consistent (its `perLane` counts match the `operations` array).",
    "",
    "`resolver` describes the schema's real resolver binding; `NOT_IMPLEMENTED` means the",
    "root exists in the contract and fails explicitly at runtime via",
    "`services/api/src/kernel/not-implemented.ts` — it is never a success. `sdl` names the",
    "contract file that declares the root. `evidence` mirrors",
    "`docs/OPERATION_TEST_EVIDENCE.json`; `UNRECORDED` means no verified test evidence has",
    "been recorded yet, which is what `pnpm check:operations` fails on.",
    "",
    "## Per-lane completeness",
    "",
    "| Lane | Name | Operations | Resolver implemented | Not implemented |",
    "| --- | --- | --- | --- | --- |",
    ...laneSummary.map(
      (lane) =>
        `| ${lane.lane} | ${lane.name} | ${lane.count} | ${lane.done} | ${lane.missing} |`,
    ),
    "",
    "## Ownership map",
    "",
    "| Lane | Owning plan |",
    "| --- | --- |",
    ...Object.entries(LANE_PLANS).map(
      ([lane, plan]) => `| ${lane} | \`${plan}\` |`,
    ),
    "",
    "## Operations",
    "",
    "| # | Lane | Wave | Kind | Operation | Multivendor apps | Resolver | SDL | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row, index) =>
        `| ${index + 1} | ${row.lane} | ${row.wave} | ${row.kind} | \`${row.name}\` | ${row.apps} | ${row.resolver} | ${row.sdl} | ${row.evidence} |`,
    ),
    "",
  ].join("\n");

  return { text: `${header}\n`, totals, laneSummary };
}

const { text: raw, totals, laneSummary } = build();
// Format exactly as `prettier --check .` expects so the committed artifact stays
// clean under the repository format gate.
const text = await format(raw, { parser: "markdown" });

if (process.argv.includes("--check")) {
  const current = existsSync(outputs) ? readFileSync(outputs, "utf8") : "";
  if (current !== text) {
    process.stderr.write(
      "docs/OPERATION_TRACEABILITY.md is stale; regenerate with `node tools/generate-operation-traceability.mjs`\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    `operation traceability is current (${totals.operations} operations, sha256 ${sha(text).slice(0, 16)})\n`,
  );
} else {
  writeFileSync(outputs, text);
  process.stdout.write(
    `wrote ${relative(implementation, outputs).split(sep).join("/")} (${totals.operations} operations; ` +
      `${laneSummary.reduce((total, lane) => total + lane.done, 0)} with resolvers)\n`,
  );
}
