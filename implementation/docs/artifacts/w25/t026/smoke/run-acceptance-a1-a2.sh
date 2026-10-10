#!/bin/sh
# T-026A review-fix acceptance driver (findings A1 + A2) — run from
# `implementation/`.
#
# Round-1 evidence (task-1) was produced by `run-acceptance.sh`. This driver
# produces the round-2 evidence that closes the two review findings:
#
#   A2 — three runs (two consecutive normal runs and one poisoned run); the
#        `deterministicSecretsFingerprint` of every child must be identical
#        across all three, while the per-run container endpoints may differ.
#   A1 — a live run whose parent environment carries `NODE_OPTIONS=--require
#        <probe>` (the exact vector the reviewer used) plus the poisoned
#        secrets, showing the flag never reaches a child; a focused no-Docker
#        demo for the credential-bearing vectors (`DOCKER_HOST` userinfo,
#        credential proxy) and for the run-time guard; and a check that the
#        poisoned secret values are fatal to the API config, so the passing
#        poisoned run proves the API child did not receive them.
#
# Docker runs are serialised on purpose. Poison values are non-canonical so a
# leak into the API child would fail `readConfig` instead of passing silently.
set -u

ev=docs/artifacts/w25/t026/smoke
mkdir -p "$ev"

POISON_ACCESS='poisoned-ambient-access-token-secret-000'
POISON_PEPPER='poisoned-ambient-refresh-pepper-000000000'
POISON_PUBLIC='poisoned-ambient-public-access-secret-0000'
POISON_DB='postgresql://poisoned:poisoned@poisoned.invalid:5432/poisoned'
POISON_REDIS='redis://poisoned.invalid:6379/0'

# 1 — unit spec (A1 + A2 cases)
{
  echo "\$ node --test e2e/smoke/environment.test.mjs"
  echo
  node --test e2e/smoke/environment.test.mjs 2>&1
  echo "exit=$?"
} >"$ev/tdd-4-green-a1-a2.log" 2>&1

# 2 — acceptance run 1 (normal environment)
{
  echo "### round 2, acceptance run 1 — normal parent environment"
  echo "\$ pnpm e2e:smoke            # from implementation/"
  echo
  ./tools/pnpm.sh e2e:smoke 2>&1
  echo "exit=$?"
} >"$ev/run1-normal.log" 2>&1
cp test-results/e2e-smoke.json "$ev/run1-normal-artifact.json"

# 3 — acceptance run 2 (normal environment, consecutive)
{
  echo "### round 2, acceptance run 2 — normal parent environment (consecutive run)"
  echo "\$ pnpm e2e:smoke            # from implementation/"
  echo
  ./tools/pnpm.sh e2e:smoke 2>&1
  echo "exit=$?"
} >"$ev/run2-normal.log" 2>&1
cp test-results/e2e-smoke.json "$ev/run2-normal-artifact.json"

# 4 — A1: poisoned secrets + the reviewer's NODE_OPTIONS injection vector
rm -f "$ev/child-env-probe.jsonl"
{
  echo "### round 2, acceptance run 3 — poisoned secrets + NODE_OPTIONS injection vector"
  echo "\$ ACCESS_TOKEN_SECRET='$POISON_ACCESS' \\"
  echo "    REFRESH_TOKEN_PEPPER='$POISON_PEPPER' \\"
  echo "    PUBLIC_ACCESS_SECRET='$POISON_PUBLIC' \\"
  echo "    DATABASE_URL='$POISON_DB' \\"
  echo "    REDIS_URL='$POISON_REDIS' \\"
  echo "    NODE_PATH='/tmp/t026-evil-modules' \\"
  echo "    NODE_OPTIONS=\"--require \$PWD/e2e/smoke/fixtures/child-env-probe.cjs\" \\"
  echo "    pnpm e2e:smoke          # from implementation/"
  echo
  ACCESS_TOKEN_SECRET="$POISON_ACCESS" \
    REFRESH_TOKEN_PEPPER="$POISON_PEPPER" \
    PUBLIC_ACCESS_SECRET="$POISON_PUBLIC" \
    DATABASE_URL="$POISON_DB" \
    REDIS_URL="$POISON_REDIS" \
    NODE_PATH='/tmp/t026-evil-modules' \
    NODE_OPTIONS="--require $PWD/e2e/smoke/fixtures/child-env-probe.cjs" \
    ./tools/pnpm.sh e2e:smoke 2>&1
  echo "exit=$?"
} >"$ev/run3-poisoned.log" 2>&1
cp test-results/e2e-smoke.json "$ev/run3-poisoned-artifact.json"
cp "$ev/child-env-probe.jsonl" "$ev/run3-poisoned-probe.jsonl"
rm -f "$ev/child-env-probe.jsonl"

{
  echo "\$ node docs/artifacts/w25/t026/smoke/analyse-probe.mjs docs/artifacts/w25/t026/smoke/run3-poisoned-probe.jsonl"
  node "$ev/analyse-probe.mjs" "$ev/run3-poisoned-probe.jsonl" 2>&1 |
    sed -E 's/\{"product".*$//'
  echo "exit=${PIPESTATUS[0]:-0}"
} >"$ev/a1-injection-vector.log" 2>&1

# 5 — A1: focused canary demo for the injection vector + credential vectors
# A no-op preload writes its pid to a canary file whenever it executes. The demo
# parent has NODE_OPTIONS in effect (so the vector is live), then spawns one
# child the old way (`env: process.env`) and one through the harness builder:
# only the old-style child may execute it.
cat >/tmp/t026-evil-preload.cjs <<'PRELOAD'
require("node:fs").appendFileSync("/tmp/t026-evil-canary.txt", `${process.pid}\n`);
PRELOAD
rm -f /tmp/t026-evil-canary.txt

{
  echo "### A1 focused demo — an ambient injection vector is live in the parent and"
  echo "### never reaches a harness-built child; credential-bearing values are dropped"
  echo "### and caught by the run-time guard."
  echo
  echo "# canary preload (/tmp/t026-evil-preload.cjs):"
  echo "#   require('node:fs').appendFileSync('/tmp/t026-evil-canary.txt', process.pid)"
  echo "\$ DOCKER_HOST='tcp://user:password@docker.internal:2375' \\"
  echo "    HTTPS_PROXY='http://proxy-user:proxy-password@proxy.internal:8080' \\"
  echo "    NODE_OPTIONS='--require /tmp/t026-evil-preload.cjs' \\"
  echo "    NODE_PATH='/tmp/evil-modules' \\"
  echo "    node --input-type=module -e '<spawn an old-style child and a harness-style child>'"
  echo
  DOCKER_HOST='tcp://user:password@docker.internal:2375' \
    HTTPS_PROXY='http://proxy-user:proxy-password@proxy.internal:8080' \
    NODE_OPTIONS='--require /tmp/t026-evil-preload.cjs' \
    NODE_PATH='/tmp/evil-modules' \
    node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  assertNoInheritedSecrets,
  buildChildEnvironment,
  describeAmbientHazard,
  scanAmbientHazards,
} from "./e2e/smoke/environment.mjs";

const canary = () => {
  try {
    return readFileSync("/tmp/t026-evil-canary.txt", "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

const ambient = process.env;
console.log("ambient values the harness excludes (name -> reason):");
for (const hazard of scanAmbientHazards(ambient))
  console.log(`  ${hazard.name} -> ${hazard.reason}`);
console.log(`  (the demo parent itself already executed the preload: canary has ${canary().length} entry)`);

const childEnv = buildChildEnvironment(ambient, { PATH: ambient.PATH });
console.log("\nharness-built child environment key set:");
console.log(`  ${Object.keys(childEnv).sort().join(",")}`);
for (const name of ["NODE_OPTIONS", "NODE_PATH", "DOCKER_HOST", "HTTPS_PROXY"])
  console.log(`  ${name} in child environment: ${name in childEnv}`);
console.log(
  `  child environment carries any credential/injection value: ${/password@docker|proxy-password|evil-preload|evil-modules/.test(JSON.stringify(childEnv))}`,
);

const beforeOld = canary().length;
spawnSync("node", ["-e", "0"], { env: process.env, stdio: "inherit" });
const oldRan = canary().length > beforeOld;
console.log(`\nold-style child (env: process.env) executed the preload: ${oldRan}`);

const beforeNew = canary().length;
spawnSync("node", ["-e", "0"], { env: childEnv, stdio: "inherit" });
const newRan = canary().length > beforeNew;
console.log(`harness-built child executed the preload: ${newRan}`);
console.log(
  newRan ? "FAIL: the harness-built child executed the ambient preload" : "PASS: the harness-built child did not execute the ambient preload",
);
if (newRan || !oldRan) process.exitCode = 1;

console.log("\nforcing the vectors into a child environment to show the run-time guard fails the run:");
for (const name of ["NODE_OPTIONS", "DOCKER_HOST", "HTTPS_PROXY"]) {
  try {
    assertNoInheritedSecrets(ambient, { [name]: ambient[name] }, {});
    console.log(`  ${name}: NOT caught (unexpected)`);
    process.exitCode = 1;
  } catch (error) {
    console.log(`  ${name}: caught -> ${error.message}`);
  }
}
console.log(`\nNODE_PATH hazard by name: ${describeAmbientHazard("NODE_PATH", ambient.NODE_PATH)}`);
'
  echo "exit=$?"
} >"$ev/a1-credential-vector-demo.log" 2>&1

# 6 — A1: the poison values are fatal to the API configuration
{
  echo "### the poisoned secret values are fatal to the API configuration"
  echo "### (so a passing poisoned smoke run proves the API child did not receive them)"
  echo "\$ node --input-type=module -e 'import { readConfig } from \"./services/api/dist/config.js\"; readConfig(process.env)'"
  echo "    with the poisoned values in the environment"
  echo
  ACCESS_TOKEN_SECRET="$POISON_ACCESS" \
    REFRESH_TOKEN_PEPPER="$POISON_PEPPER" \
    PUBLIC_ACCESS_SECRET="$POISON_PUBLIC" \
    DATABASE_URL="$POISON_DB" \
    REDIS_URL="$POISON_REDIS" \
    APP_ENV='development' \
    PASSWORD_AUTH_ENABLED='true' \
    PUBLIC_ACCESS_ENFORCED='true' \
    node --input-type=module -e '
import { readConfig } from "./services/api/dist/config.js";
try {
  readConfig(process.env);
  console.log("ACCEPTED — unexpected: the poisoned config was accepted");
  process.exitCode = 1;
} catch (error) {
  console.log("REJECTED:", error.message);
}
'
  echo "exit=$?"
} >"$ev/a1-poison-fatal-to-config.log" 2>&1

# 7 — A2: fingerprint equality across the three runs
{
  echo "\$ node docs/artifacts/w25/t026/smoke/compare-fingerprints.mjs \\"
  echo "    docs/artifacts/w25/t026/smoke/run1-normal-artifact.json \\"
  echo "    docs/artifacts/w25/t026/smoke/run2-normal-artifact.json \\"
  echo "    docs/artifacts/w25/t026/smoke/run3-poisoned-artifact.json"
  echo
  node "$ev/compare-fingerprints.mjs" \
    "$ev/run1-normal-artifact.json" \
    "$ev/run2-normal-artifact.json" \
    "$ev/run3-poisoned-artifact.json" 2>&1
  echo "exit=$?"
} >"$ev/a2-fingerprint-proof.log" 2>&1

# 8 — hashes of the exact code state these runs were executed against
shasum -a 256 e2e/smoke/run.mjs e2e/smoke/environment.mjs \
  e2e/smoke/environment.test.mjs e2e/smoke/fixtures/child-env-probe.cjs \
  >"$ev/code-state-a1-a2.sha256"

echo "A1/A2 acceptance driver finished"
