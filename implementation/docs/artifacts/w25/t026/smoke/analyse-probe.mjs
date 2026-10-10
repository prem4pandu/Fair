#!/usr/bin/env node
/**
 * T-026A evidence analyser: reads a `child-env-probe.jsonl` produced by
 * `e2e/smoke/fixtures/child-env-probe.cjs` and reports, per observed node
 * process, whether any poisoned ambient value reached it.
 *
 * Usage: node docs/artifacts/w25/t026/smoke/analyse-probe.mjs <probe.jsonl>
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: analyse-probe.mjs <probe.jsonl>\n");
  process.exit(2);
}

const POISON = /poisoned/i;
const canonical = {
  publicAccessSecret: Buffer.alloc(32, 7).toString("base64url"),
  accessTokenSecret: Buffer.alloc(32, 1).toString("base64url"),
  refreshPepper: Buffer.alloc(32, 2).toString("base64url"),
};
const lines = readFileSync(path, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

/**
 * The harness bootstrap is the shell-launched chain that starts *before* the
 * harness can filter anything: `tools/pnpm.sh` (corepack) → `pnpm e2e:smoke` →
 * `run.mjs`. The probe appends in process-start order, so everything after the
 * `run.mjs` line was spawned by the harness itself.
 */
const runIndex = lines.findIndex((line) =>
  /e2e\/smoke\/run\.mjs/.test(line.argv.join(" ")),
);
const harnessOwned = lines.slice(runIndex + 1);

process.stdout.write(`probe file: ${path}\n`);
process.stdout.write(`node processes observed: ${lines.length}\n`);
process.stdout.write(
  `  harness bootstrap processes (launched by the shell, before the harness can filter anything): ${lines.length - harnessOwned.length}\n`,
);
process.stdout.write(
  `  processes spawned by the harness: ${harnessOwned.length}\n\n`,
);

for (const line of lines) {
  const label = line.argv.join(" ").replace(process.cwd(), ".") || "(node -e)";
  const values = Object.values(line.present);
  const poisoned = values.filter((value) => POISON.test(value));
  const owner = harnessOwned.includes(line) ? "harness" : "bootstrap";
  process.stdout.write(
    `${poisoned.length > 0 ? "POISONED" : "clean   "} | ${owner.padEnd(9)} | ${Object.keys(line.present).length} sensitive name(s) | ${label}\n`,
  );
}

const leaked = harnessOwned.filter((line) =>
  Object.values(line.present).some((value) => POISON.test(value)),
);
process.stdout.write(
  `\nharness-spawned processes that received a poisoned ambient value: ${leaked.length}\n`,
);

const api = lines.find((line) => /dist\/main\.js/.test(line.argv.join(" ")));
if (api) {
  process.stdout.write("\nAPI child configuration (must be the deterministic set):\n");
  for (const [name, value] of Object.entries(api.present))
    process.stdout.write(
      `  ${name} = ${value}${value === canonical.accessTokenSecret ? "  [deterministic smoke key]" : value === canonical.publicAccessSecret ? "  [deterministic smoke key]" : value === canonical.refreshPepper ? "  [deterministic smoke key]" : ""}\n`,
    );
}
process.exit(leaked.length > 0 ? 1 : 0);
