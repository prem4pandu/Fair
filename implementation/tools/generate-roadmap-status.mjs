#!/usr/bin/env node
// The single "where are we" artifact.
//
// docs/ROADMAP.md says what the plan is; this says what is true. Every value
// below is derived from a repository artifact — the lane inventory, a resolver
// source scan, the per-operation evidence registry and the recorded gate runs.
// Nothing here may be hand-maintained: a workstream is never "done" because a
// document says so, only because a recorded command and an independent
// approval say so.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import prettier from "prettier";
import { loadOperationState } from "./lib/operation-state.mjs";
import { approvalState, judgedRun } from "./lib/gate-approval.mjs";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "docs/ROADMAP_STATUS.md");
const readJson = (name) =>
  JSON.parse(readFileSync(resolve(root, "docs", name), "utf8"));

const roadmap = readJson("ROADMAP.json");
const {
  laneSummary,
  laneDrift,
  totals,
  rows,
  compatibility,
  fullCompatibility,
} = loadOperationState({ implementation: root });

const gatesFile = resolve(root, "docs/GATES.json");
const registry = existsSync(gatesFile)
  ? JSON.parse(readFileSync(gatesFile, "utf8"))
  : { gates: {} };

/** Latest recorded run per gate id, or null when a gate has never run. */
const gateRun = (id) => judgedRun(registry.gates?.[id]);
const gateById = new Map(roadmap.gates.map((gate) => [gate.id, gate]));
// Approval is all-or-nothing against the roles the gate declares in
// ROADMAP.json: one signature out of three required reviewers does not close a
// gate, and must never read as if it did.
const commitAuthor = (commit) => {
  if (!commit) return "";
  try {
    return execFileSync("git", ["show", "-s", "--format=%ae", commit], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
};
const gateState = (id) =>
  approvalState(gateById.get(id), gateRun(id), { commitAuthor });
const gateApproved = (id) => gateState(id).approved;

const laneByIdentifier = new Map(laneSummary.map((lane) => [lane.lane, lane]));

/**
 * A workstream's state is derived, never declared. Lane-owning workstreams are
 * measured against their operations; the rest have no machine signal until
 * their gate is recorded, and say so rather than guessing.
 */
function deriveState(workstream) {
  if (workstream.continuous) return { state: "CONTINUOUS", detail: "ongoing" };

  const lanes = workstream.lanes
    .map((lane) => laneByIdentifier.get(lane))
    .filter(Boolean);
  const gate = workstream.gate;
  const approved = gate ? gateApproved(gate) : false;

  if (lanes.length) {
    const count = lanes.reduce((sum, lane) => sum + lane.count, 0);
    const done = lanes.reduce((sum, lane) => sum + lane.done, 0);
    const evidenced = rows.filter(
      (row) =>
        workstream.lanes.includes(row.lane) && row.evidence === "VERIFIED",
    ).length;
    const detail = `${done}/${count} resolvers · ${evidenced}/${count} evidenced`;
    if (approved && evidenced === count) return { state: "APPROVED", detail };
    if (evidenced === count && count > 0)
      return { state: "EVIDENCED_UNAPPROVED", detail };
    if (done === count && count > 0) return { state: "RESOLVERS_ONLY", detail };
    if (done > 0) return { state: "IN_PROGRESS", detail };
    return { state: "NOT_STARTED", detail };
  }

  const run = gate ? gateRun(gate) : null;
  if (approved) return { state: "APPROVED", detail: `${gate} approved` };
  if (run)
    return {
      state: run.passed ? "GATE_PASSED_UNAPPROVED" : "GATE_FAILED",
      detail: `${gate} recorded ${run.finishedAt}`,
    };
  return { state: "NO_MACHINE_SIGNAL", detail: "no recorded gate run" };
}

const states = new Map(
  roadmap.workstreams.map((workstream) => [
    workstream.id,
    deriveState(workstream),
  ]),
);
const isDone = (id) => states.get(id)?.state === "APPROVED";
const started = (id) =>
  !["NOT_STARTED", "NO_MACHINE_SIGNAL", "CONTINUOUS"].includes(
    states.get(id)?.state,
  );

const unmetDependencies = (workstream) =>
  workstream.depends.filter((dependency) => !isDone(dependency));

const eligible = roadmap.workstreams.filter(
  (workstream) =>
    !workstream.continuous &&
    !isDone(workstream.id) &&
    unmetDependencies(workstream).length === 0 &&
    !(workstream.blockedBy ?? []).length,
);
const atRisk = roadmap.workstreams.filter(
  (workstream) =>
    !workstream.continuous &&
    started(workstream.id) &&
    unmetDependencies(workstream).length > 0,
);
const externallyBlocked = roadmap.workstreams.filter(
  (workstream) => (workstream.blockedBy ?? []).length > 0,
);
const partialPlans = roadmap.workstreams.filter(
  (workstream) => workstream.planState === "PARTIAL",
);
const missingPlans = [
  ...new Set(
    roadmap.workstreams
      .map((workstream) => workstream.planFile)
      .filter(
        (planFile) =>
          planFile?.startsWith("docs/superpowers/") &&
          !existsSync(resolve(root, planFile)),
      ),
  ),
].sort();

const row = (cells) => `| ${cells.join(" | ")} |`;
const table = (headers, body) =>
  [
    row(headers),
    row(headers.map(() => "---")),
    ...body.map((cells) => row(cells)),
  ].join("\n");

const gateRows = roadmap.gates.map((gate) => {
  const run = gateRun(gate.id);
  const state = gateState(gate.id);
  return [
    `\`${gate.id}\``,
    run ? (run.passed ? "commands passed" : "**FAILED**") : "never run",
    run?.finishedAt ?? "—",
    run?.commit ? `\`${String(run.commit).slice(0, 12)}\`` : "—",
    state.recorded.length
      ? `${state.recorded.join(", ")}${state.missing.length ? ` (missing **${state.missing.join(", ")}**)` : ""}`
      : `**none** of ${state.required.length} required`,
  ];
});

const workstreamRows = roadmap.workstreams.map((workstream) => {
  const { state, detail } = states.get(workstream.id);
  const unmet = unmetDependencies(workstream);
  return [
    `\`${workstream.id}\``,
    workstream.name,
    workstream.lanes.join(", ") || "—",
    state === "APPROVED" ? `**${state}**` : state,
    detail,
    unmet.length ? `waiting on ${unmet.join(", ")}` : "—",
  ];
});

const laneRows = laneSummary.map((lane) => [
  `\`${lane.lane}\``,
  lane.name,
  String(lane.count),
  String(lane.done),
  String(
    rows.filter(
      (entry) => entry.lane === lane.lane && entry.evidence === "VERIFIED",
    ).length,
  ),
]);

const fullInvalid = fullCompatibility.apps.reduce(
  (count, app) =>
    count +
    app.documents.filter((document) => document.status === "INVALID").length,
  0,
);

const body = `# Roadmap status — generated

<!-- Generated by tools/generate-roadmap-status.mjs. Do not edit by hand. -->

Regenerate with \`pnpm roadmap\`; \`pnpm roadmap:check\` fails if this file is stale.
Plan and intent live in [\`ROADMAP.md\`](./ROADMAP.md); this file is only what the
repository can prove.

## Headline

- **${totals.implemented}/${totals.operations}** root operations have a real resolver
  (${totals.query} queries, ${totals.mutation} mutations, ${totals.subscription} subscriptions in scope).
- **${totals.evidenced}/${totals.operations}** operations have recorded evidence in \`OPERATION_TEST_EVIDENCE.json\`.
- **${totals.withoutSdl}** roots have no SDL declaration.
- Scoped multivendor compatibility: **${compatibility.staticCompatibility}**
  (${compatibility.summary.validDocuments}/${compatibility.summary.documents} documents valid).
- Full six-app compatibility: **${fullCompatibility.staticCompatibility}**
  (${fullCompatibility.summary.validDocuments}/${fullCompatibility.summary.documents} valid, ${fullInvalid} invalid, ${fullCompatibility.summary.unresolvedDocuments} unresolved).
- Gates with an independent approval recorded: **${roadmap.gates.filter((gate) => gateApproved(gate.id)).length}/${roadmap.gates.length}**.

## Gates

${table(["Gate", "Last run", "Finished", "Commit", "Approvals"], gateRows)}

A gate is closed only when its commands passed **and** every reviewer role it
declares in \`ROADMAP.json\` is recorded. "commands passed" with no approval does
not close a batch, and a partial set of signatures does not either. Record one
with \`pnpm approve-gate --gate <id> --role <role> --reviewer <identity>\`; it
refuses self-approval and refuses a failing or dirty-tree run.

## Workstreams

${table(["ID", "Workstream", "Lanes", "State", "Measured", "Dependencies"], workstreamRows)}

State meanings: \`NOT_STARTED\` no resolver in its lanes · \`IN_PROGRESS\` some
resolvers · \`RESOLVERS_ONLY\` every operation resolves but evidence is missing ·
\`EVIDENCED_UNAPPROVED\` evidence complete, reviewer missing · \`APPROVED\` gate
passed and approved · \`NO_MACHINE_SIGNAL\` nothing measurable until its gate runs.

Where two workstreams split one lane (W5a and W5b both work in L3), each shows the
whole lane's figures: the inventory records a lane per operation, not a workstream.

## Next

${
  eligible.length
    ? eligible
        .map((workstream) => `- \`${workstream.id}\` — ${workstream.name}`)
        .join("\n")
    : "- Nothing is formally eligible: no dependency gate has an independent approval."
}

${
  atRisk.length
    ? `## Proceeding at risk\n\nThese have started while a dependency gate is unapproved. That is allowed only as a\ndeliberate, recorded choice — it is listed here so it is never silent.\n\n${atRisk
        .map(
          (workstream) =>
            `- \`${workstream.id}\` — ${workstream.name} (waiting on ${unmetDependencies(workstream).join(", ")})`,
        )
        .join("\n")}`
    : ""
}

## Blocked on external input

${externallyBlocked
  .map(
    (workstream) =>
      `- \`${workstream.id}\` — ${workstream.name}: ${workstream.blockedBy.join(", ")}`,
  )
  .join("\n")}

## Lanes

${table(["Lane", "Name", "Operations", "Resolvers", "Evidenced"], laneRows)}

${
  laneDrift.length
    ? `**Lane drift:** ${laneDrift
        .map((lane) => `${lane.lane} counted ${lane.count}`)
        .join(
          ", ",
        )} disagrees with \`perLane\` in \`OPERATION_LANES.json\`. Fix the generator input.`
    : "No lane drift: counted operations match `perLane` in `OPERATION_LANES.json`."
}

## Plan readiness

${
  partialPlans.length
    ? `Workstreams whose lane plan is still PARTIAL — completing the plan is the lane's first task:\n\n${partialPlans
        .map(
          (workstream) => `- \`${workstream.id}\` — \`${workstream.planFile}\``,
        )
        .join("\n")}`
    : "Every workstream has a complete plan file."
}
${
  missingPlans.length
    ? `\n\nMissing plan files: ${missingPlans.map((planFile) => `\`${planFile}\``).join(", ")}`
    : ""
}

## Unscheduled gaps

The owner has not scheduled these; they are not done and they undermine the gates
named beside them (\`ROADMAP.md\` §13).

${table(
  ["#", "Gap", "Undermines"],
  roadmap.unscheduledGaps.map((gap) => [gap.id, gap.gap, gap.undermines]),
)}
`;

const markdown = await prettier.format(body, { parser: "markdown" });
const stale = !existsSync(target) || readFileSync(target, "utf8") !== markdown;

if (process.argv.includes("--stdout")) process.stdout.write(markdown);
else if (process.argv.includes("--check")) {
  const problems = [];
  if (stale)
    problems.push(
      "docs/ROADMAP_STATUS.md is stale; regenerate with node tools/generate-roadmap-status.mjs",
    );
  if (laneDrift.length)
    problems.push(
      `OPERATION_LANES.json perLane disagrees with its operations for: ${laneDrift
        .map((lane) => lane.lane)
        .join(", ")}`,
    );
  // Every lane that owns operations must be claimed by exactly one workstream,
  // or work silently has no owner.
  const owned = new Set(roadmap.workstreams.flatMap((w) => w.lanes));
  const unowned = laneSummary
    .filter((lane) => lane.count > 0 && !owned.has(lane.lane))
    .map((lane) => lane.lane);
  if (unowned.length)
    problems.push(
      `lanes with operations but no workstream: ${unowned.join(", ")}`,
    );
  const ids = new Set(roadmap.workstreams.map((w) => w.id));
  for (const workstream of roadmap.workstreams)
    for (const dependency of workstream.depends)
      if (!ids.has(dependency))
        problems.push(`${workstream.id} depends on unknown ${dependency}`);
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log("Roadmap status is current and consistent with the lane data");
} else {
  writeFileSync(target, markdown);
  console.log(`Wrote ${target}`);
}
