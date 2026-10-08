#!/usr/bin/env node
// Records gate runs with real command output, so docs/GATES.json is evidence
// rather than narrative. Reads the gate definitions from docs/MASTER_PLAN.json.
//
//   node tools/record-gate.mjs --list
//   node tools/record-gate.mjs --gate GP0
//   node tools/record-gate.mjs --gate GP0 --only "pnpm lint" --only "pnpm test"
//   node tools/record-gate.mjs --gate GP0 --skip "pnpm coverage"
//
// Exits non-zero when any executed command fails, and never records an approval:
// reviewers are separate people/agents and are recorded afterwards.
import { spawnSync, execFileSync } from "node:child_process";
import { format } from "prettier";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const implementation = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const planFile = path.join(implementation, "docs/MASTER_PLAN.json");
const outputFile = path.join(implementation, "docs/GATES.json");

export function translate(command) {
  // The repository runs pnpm through its own corepack shim so the recorded
  // command is reproducible without a global pnpm install.
  return command.replace(/^pnpm(\s|$)/, "./tools/pnpm.sh$1");
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

function loadGates() {
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  return new Map(plan.gates.map((gate) => [gate.id, gate]));
}

function loadRegistry() {
  if (!existsSync(outputFile))
    return {
      schemaVersion: 1,
      note: "Gate runs recorded by tools/record-gate.mjs.",
      gates: {},
    };
  return JSON.parse(readFileSync(outputFile, "utf8"));
}

function run(command) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(translate(command), {
    cwd: implementation,
    shell: true,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    command,
    executed: translate(command),
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    startedAt,
    outputTail: output.slice(-2000),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const gates = loadGates();

  if (args.includes("--list")) {
    for (const gate of gates.values())
      process.stdout.write(
        `${gate.id}: ${gate.commands.length} command(s), approvals: ${(gate.approvals ?? []).join(", ") || "none"}\n`,
      );
    process.exit(0);
  }

  const value = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const values = (flag) =>
    args.flatMap((arg, index) =>
      arg === flag && args[index + 1] ? [args[index + 1]] : [],
    );

  const id = value("--gate");
  if (!id) {
    process.stderr.write(
      "usage: node tools/record-gate.mjs --gate <id> [--only <cmd>]... [--skip <cmd>] [--list]\n",
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

  const only = values("--only");
  const skip = values("--skip");
  const partial = only.length > 0 || skip.length > 0;
  const commands = gate.commands.filter(
    (command) =>
      (!only.length || only.some((needle) => command.includes(needle))) &&
      !skip.some((needle) => command.includes(needle)),
  );
  if (!commands.length) {
    process.stderr.write(`gate ${id}: no commands selected\n`);
    process.exit(2);
  }

  const registry = loadRegistry();
  const entry = {
    gate: id,
    commit: git(["rev-parse", "HEAD"]),
    dirty: Boolean(git(["status", "--porcelain"])),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    passed: false,
    partial,
    commands: [],
    missingCommands: gate.commands.filter(
      (command) => !commands.includes(command),
    ),
    approvals: [],
    reviewer: null,
    approved: false,
  };

  process.stdout.write(`gate ${id}: running ${commands.length} command(s)\n`);
  for (const command of commands) {
    process.stdout.write(`  -> ${translate(command)}\n`);
    const result = run(command);
    entry.commands.push(result);
    process.stdout.write(
      `     exit ${result.exitCode} in ${(result.durationMs / 1000).toFixed(1)}s\n`,
    );
  }
  entry.finishedAt = new Date().toISOString();
  entry.passed = entry.commands.every((command) => command.exitCode === 0);

  registry.gates[id] ??= { gate: id, runs: [] };
  registry.gates[id].runs.push(entry);
  // A filtered run is real evidence for the commands it ran, but it must never
  // become the gate's headline result: only a complete run updates `latest`.
  if (!partial)
    registry.gates[id].latest = {
      commit: entry.commit,
      dirty: entry.dirty,
      finishedAt: entry.finishedAt,
      passed: entry.passed,
      commands: entry.commands.map(({ command, exitCode, durationMs }) => ({
        command,
        exitCode,
        durationMs,
      })),
    };
  // Formatted like every other generated artifact so the repository format
  // gate stays green without a special case.
  writeFileSync(
    outputFile,
    await format(JSON.stringify(registry), { parser: "json" }),
  );
  // Recording a run rewrites GATES.json, which is an input to the generated
  // status artifacts. Regenerate them here so the tree is never left with a
  // status document that contradicts the evidence it points at.
  const status = spawnSync(
    process.execPath,
    ["tools/generate-implementation-status.mjs"],
    { cwd: implementation, encoding: "utf8" },
  );
  if (status.status !== 0)
    process.stdout.write(
      `  warning: failed to regenerate the status artifacts: ${(status.stderr ?? "").trim()}\n`,
    );
  process.stdout.write(
    `gate ${id} ${entry.passed ? "PASSED" : "FAILED"}${partial ? " (partial run; latest unchanged)" : ""}; recorded in docs/GATES.json\n`,
  );
  process.exit(entry.passed ? 0 : 1);
}
