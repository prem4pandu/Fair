/**
 * T-026A observation fixture (used only for evidence, never by the harness).
 *
 * Preloaded into every node process through `NODE_OPTIONS=--require <this file>`
 * while the smoke harness runs with a deliberately poisoned ambient
 * environment. It appends one JSON line per node process listing every
 * environment variable whose name denotes secret material.
 *
 * Deliberate design notes:
 *
 *  - It re-implements the sensitive-name pattern instead of importing
 *    `../environment.mjs`, so the observation is independent of the code it is
 *    used to verify.
 *  - It needs no environment variable of its own to work: the harness now drops
 *    every name it does not allow, so an observation that depended on its own
 *    names being inherited would observe nothing. The output path can be
 *    overridden with `E2E_SMOKE_PROBE_OUT`, otherwise it lands next to this
 *    task's evidence.
 *  - It performs no other work and swallows every error, so it can never change
 *    the harness result.
 *  - Since the A1 fix, `NODE_OPTIONS` is no longer on the harness's passthrough
 *    allowlist, so a *post-fix* run preloaded this way records only the three
 *    bootstrap processes above the harness (`corepack` → `pnpm e2e:smoke` →
 *    `run.mjs`), never a harness-spawned child. That absence is the A1 canary:
 *    if the vector were reopened, this file would appear in a child again.
 */
// This fixture is loaded by `node --require`, which only supports CommonJS.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
/* eslint-enable @typescript-eslint/no-require-imports */

const SENSITIVE_NAME =
  /(SECRET|PASSWORD|PASSWD|PASSPHRASE|PEPPER|TOKEN|CREDENTIAL|PRIVATE_KEY|API_?KEY|_KEY$|^DATABASE_URL$|^REDIS_URL$)/i;

const defaultOut = path.join(
  __dirname,
  "../../../docs/artifacts/w25/t026/smoke/child-env-probe.jsonl",
);
const out = process.env.E2E_SMOKE_PROBE_OUT || defaultOut;

if (out) {
  const present = {};
  for (const [name, value] of Object.entries(process.env))
    if (SENSITIVE_NAME.test(name)) present[name] = value;
  try {
    fs.appendFileSync(
      out,
      `${JSON.stringify({
        pid: process.pid,
        argv: process.argv.slice(1, 3),
        cwd: process.cwd(),
        present,
      })}\n`,
    );
  } catch {
    /* observation must never influence the run */
  }
}
