#!/usr/bin/env node
// Declares the gates that are planned but not yet implemented, and fails them
// honestly. A missing harness is a failure with a reason, never a silent pass
// and never an alias to an unrelated smoke test.
import { fileURLToPath } from "node:url";
import path from "node:path";

export const implementation = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const pendingGates = {
  // `e2e:smoke` is implemented by W1 (`e2e/smoke/run.mjs`): it boots the real
  // PostGIS/Redis/API stack and loads the exact pinned admin and customer web
  // documents over HTTP and both WebSocket frame sets. It is deliberately no
  // longer listed here — a pending entry would shadow the real harness.
  "test:journeys": {
    workstream: "W15",
    requirement:
      "cross-lane journeys replaying the exact app documents (identity -> catalog -> order -> payment -> dispatch -> notification)",
    blockedBy: "requires the L5-L8 lanes to be implemented",
  },
  "coverage:e2e": {
    workstream: "W17",
    requirement:
      "API line coverage measured while the Playwright suites run, with a >= 80% threshold",
    blockedBy:
      "requires the Playwright suites in W16 and instrumentation in W17",
  },
  e2e: {
    workstream: "W16",
    requirement:
      "full Playwright suites for customer web, admin web and single-vendor admin",
    blockedBy:
      "requires the frontend integration in W12/W13 and the suites in W16",
  },
};

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const name = process.argv[2];
  const gate = pendingGates[name];
  if (!gate) {
    process.stderr.write(
      `pending-gate: unknown gate "${name ?? ""}". Known gates: ${Object.keys(pendingGates).join(", ")}\n`,
    );
    process.exit(2);
  }
  process.stderr.write(
    `${name} is NOT implemented yet (${gate.workstream}): ${gate.requirement}.\n` +
      `Blocked by: ${gate.blockedBy}.\n` +
      `This gate fails by design until its harness exists; no substitute smoke test satisfies it.\n` +
      `See docs/ROADMAP.md §7.\n`,
  );
  process.exit(1);
}
