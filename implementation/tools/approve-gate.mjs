#!/usr/bin/env node
// Records an independent reviewer's approval against a recorded gate run.
//
// tools/record-gate.mjs deliberately never writes an approval, which left the
// second half of every gate with no mechanism at all: docs/GATES.json could
// say "commands passed" but never "closed", so every workstream stayed
// formally blocked. This tool is that missing half.
//
//   node tools/approve-gate.mjs --list
//   node tools/approve-gate.mjs --gate GP0 --role lead --reviewer "A N Other <an@example.com>"
//
// The constraints below are the protocol in docs/ROADMAP.md §5.3 and
// docs/TASK_BOARD.md rule 4, enforced by the machine instead of by trust:
//   * only a complete, passing, clean-tree run can be approved;
//   * the reviewer may not be whoever recorded the run (no self-approval);
//   * one identity may not hold two reviewer roles on the same gate;
//   * a later complete run resets approvals, because it is a different run.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { format } from "prettier";
import {
  approvalState,
  identity,
  requiredRoles,
} from "./lib/gate-approval.mjs";

const implementation = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const planFile = path.join(implementation, "docs/ROADMAP.json");
const registryFile = path.join(implementation, "docs/GATES.json");

export class ApprovalError extends Error {}

const fail = (message) => {
  throw new ApprovalError(message);
};

/**
 * Pure core: returns a new registry with the approval applied, or throws
 * ApprovalError explaining precisely why the approval is not permitted.
 *
 * `commitAuthor(commit)` resolves the email that authored a commit, used only
 * as a fallback when a run predates the `recordedBy` stamp.
 */
export function applyApproval({
  registry,
  gate,
  role,
  reviewer,
  head,
  allowStale = false,
  replace = false,
  note = null,
  now = () => new Date().toISOString(),
  commitAuthor = () => null,
}) {
  const required = requiredRoles(gate);
  if (!required.length)
    fail(
      `gate ${gate.id} declares no reviewer roles in docs/ROADMAP.json; fix the plan before approving`,
    );
  if (!required.includes(role))
    fail(
      `gate ${gate.id} does not require role "${role}"; required: ${required.join(", ")}`,
    );
  if (!identity(reviewer))
    fail("--reviewer must name the person or agent giving the approval");

  const entry = registry.gates?.[gate.id];
  const latest = entry?.latest;
  if (!latest?.finishedAt)
    fail(
      `gate ${gate.id} has no complete recorded run; run node tools/record-gate.mjs --gate ${gate.id} first`,
    );
  if (!latest.passed)
    fail(
      `gate ${gate.id}'s latest complete run FAILED at ${latest.finishedAt}; a failing run cannot be approved`,
    );
  // The clean-tree requirement exists so an approval names an exact tree. A run
  // recorded over uncommitted edits proves nothing reproducible.
  if (latest.dirty)
    fail(
      `gate ${gate.id}'s latest run was recorded on a dirty tree (${latest.finishedAt}); commit and re-run before approving`,
    );

  // Approve the run object itself, not just the summary, so the evidence and
  // the headline can never drift apart.
  const run = (entry.runs ?? [])
    .filter((candidate) => !candidate.partial)
    .findLast((candidate) => candidate.finishedAt === latest.finishedAt);
  if (!run)
    fail(
      `gate ${gate.id}: no complete run matches latest.finishedAt ${latest.finishedAt}; docs/GATES.json is inconsistent`,
    );

  if (head && latest.commit && latest.commit !== head && !allowStale)
    fail(
      `gate ${gate.id} passed on ${String(latest.commit).slice(0, 12)} but HEAD is ${String(head).slice(0, 12)}; re-run the gate, or pass --allow-stale to approve the older tree deliberately`,
    );

  const records = run.approvalRecords ?? [];
  const recordedBy = run.recordedBy ?? commitAuthor(run.commit);
  if (recordedBy && identity(reviewer) === identity(recordedBy))
    fail(
      `no self-approval: ${reviewer} recorded this run. A different reviewer must sign role "${role}"`,
    );

  const clash = records.find(
    (record) =>
      identity(record.reviewer) === identity(reviewer) && record.role !== role,
  );
  if (clash)
    fail(
      `${reviewer} already holds role "${clash.role}" on gate ${gate.id}; reviewer roles must be independent people`,
    );

  const existing = records.find((record) => record.role === role);
  if (existing && !replace)
    fail(
      `role "${role}" on gate ${gate.id} is already approved by ${existing.reviewer} at ${existing.at}; pass --replace to supersede it`,
    );

  const record = {
    role,
    reviewer,
    at: now(),
    runFinishedAt: latest.finishedAt,
    commit: latest.commit ?? null,
    headAtApproval: head ?? null,
    approvedStaleTree: Boolean(head && latest.commit && latest.commit !== head),
    note,
  };
  const nextRecords = [
    ...records.filter((candidate) => candidate.role !== role),
    record,
  ].sort((a, b) => required.indexOf(a.role) - required.indexOf(b.role));
  // Roles are stored as a plain string list as well, because that is what the
  // status generators render; the records carry the who and when.
  const roles = required.filter((candidate) =>
    nextRecords.some((entry) => entry.role === candidate),
  );

  run.approvalRecords = nextRecords;
  run.approvals = roles;
  const state = approvalState(gate, { ...run, passed: latest.passed });
  run.reviewer = nextRecords.map((entry) => entry.reviewer).join(", ");
  run.approved = state.approved;
  entry.latest = {
    ...latest,
    approvals: roles,
    approvalRecords: nextRecords,
    approved: state.approved,
  };
  return { registry, state, record };
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: implementation,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  const gates = new Map(plan.gates.map((gate) => [gate.id, gate]));
  const registry = existsSync(registryFile)
    ? JSON.parse(readFileSync(registryFile, "utf8"))
    : { schemaVersion: 1, gates: {} };

  if (args.includes("--list")) {
    for (const gate of gates.values()) {
      const entry = registry.gates?.[gate.id];
      const state = approvalState(gate, entry?.latest);
      process.stdout.write(
        `${gate.id}: ${state.passed ? "commands passed" : "not passing"}; ` +
          `approvals ${state.recorded.length}/${state.required.length}` +
          `${state.missing.length ? ` (missing ${state.missing.join(", ")})` : ""}` +
          `${state.approved ? " — CLOSED" : ""}\n`,
      );
    }
    process.exit(0);
  }

  const value = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  const id = value("--gate");
  const role = value("--role");
  const reviewer = value("--reviewer");
  if (!id || !role || !reviewer) {
    process.stderr.write(
      "usage: node tools/approve-gate.mjs --gate <id> --role <role> --reviewer <identity>\n" +
        "       [--note <text>] [--replace] [--allow-stale] [--list]\n",
    );
    process.exit(2);
  }
  const gate = gates.get(id);
  if (!gate) {
    process.stderr.write(
      `unknown gate ${id}; known: ${[...gates.keys()].join(", ")}\n`,
    );
    process.exit(2);
  }

  let result;
  try {
    result = applyApproval({
      registry,
      gate,
      role,
      reviewer,
      head: git(["rev-parse", "HEAD"]),
      allowStale: args.includes("--allow-stale"),
      replace: args.includes("--replace"),
      note: value("--note") ?? null,
      commitAuthor: (commit) =>
        commit ? git(["log", "-1", "--format=%ae", commit]) : null,
    });
  } catch (error) {
    if (!(error instanceof ApprovalError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  writeFileSync(
    registryFile,
    await format(JSON.stringify(result.registry), { parser: "json" }),
  );
  // The status artifacts are generated from this registry, so regenerate them
  // here rather than leaving a tree whose status contradicts its evidence.
  for (const generator of [
    "tools/generate-implementation-status.mjs",
    "tools/generate-roadmap-status.mjs",
  ]) {
    const { status, stderr } = spawnSync(process.execPath, [generator], {
      cwd: implementation,
      encoding: "utf8",
    });
    if (status !== 0)
      process.stdout.write(
        `  warning: ${generator} failed to regenerate: ${(stderr ?? "").trim()}\n`,
      );
  }

  const { state } = result;
  process.stdout.write(
    `gate ${id}: recorded ${role} approval by ${reviewer} ` +
      `(${state.recorded.length}/${state.required.length})\n` +
      (state.approved
        ? `gate ${id} is CLOSED: commands passed and every required reviewer is recorded\n`
        : `gate ${id} still needs: ${state.missing.join(", ")}\n`),
  );
}
