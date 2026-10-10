#!/bin/sh
# T-026A acceptance driver — run from `implementation/`.
#
# Executes, in order and serially (testcontainers/Docker), the three checks
# whose transcripts are this task's evidence:
#
#   1. the new unit spec for the deterministic child environments;
#   2. `pnpm e2e:smoke` in a normal environment;
#   3. `pnpm e2e:smoke` under a poisoned parent environment, with the child-env
#      probe preloaded so every node process is observed.
#
# The poisoned values are deliberately non-canonical so that a leak into the
# API child would fail `readConfig` instead of passing silently.
set -u

ev=docs/artifacts/w25/t026/smoke
mkdir -p "$ev"

# 1 — unit spec
{
  echo "\$ node --test e2e/smoke/environment.test.mjs"
  echo
  node --test e2e/smoke/environment.test.mjs 2>&1
  echo "exit=$?"
} >"$ev/tdd-3-green-after-fix.log" 2>&1

# 2 — acceptance 1: normal environment
{
  echo "### acceptance 1 — post-fix, normal parent environment"
  echo "\$ pnpm e2e:smoke            # from implementation/"
  echo
  ./tools/pnpm.sh e2e:smoke 2>&1
  echo "exit=$?"
} >"$ev/postfix-normal-run.log" 2>&1
cp test-results/e2e-smoke.json "$ev/postfix-normal-artifact.json"

# 3 — acceptance 2: poisoned parent environment + child-env probe
rm -f "$ev/child-env-probe.jsonl"
{
  echo "### acceptance 2 — post-fix, poisoned parent environment"
  echo "\$ ACCESS_TOKEN_SECRET='poisoned-ambient-access-token-secret-000' \\"
  echo "    REFRESH_TOKEN_PEPPER='poisoned-ambient-refresh-pepper-000000000' \\"
  echo "    PUBLIC_ACCESS_SECRET='poisoned-ambient-public-access-secret-0000' \\"
  echo "    DATABASE_URL='postgresql://poisoned:poisoned@poisoned.invalid:5432/poisoned' \\"
  echo "    REDIS_URL='redis://poisoned.invalid:6379/0' \\"
  echo "    NODE_OPTIONS=\"--require \$PWD/e2e/smoke/fixtures/child-env-probe.cjs\" \\"
  echo "    pnpm e2e:smoke          # from implementation/"
  echo
  ACCESS_TOKEN_SECRET='poisoned-ambient-access-token-secret-000' \
    REFRESH_TOKEN_PEPPER='poisoned-ambient-refresh-pepper-000000000' \
    PUBLIC_ACCESS_SECRET='poisoned-ambient-public-access-secret-0000' \
    DATABASE_URL='postgresql://poisoned:poisoned@poisoned.invalid:5432/poisoned' \
    REDIS_URL='redis://poisoned.invalid:6379/0' \
    NODE_OPTIONS="--require $PWD/e2e/smoke/fixtures/child-env-probe.cjs" \
    ./tools/pnpm.sh e2e:smoke 2>&1
  echo "exit=$?"
} >"$ev/poisoned-postfix-run.log" 2>&1
cp test-results/e2e-smoke.json "$ev/poisoned-postfix-artifact.json"
cp "$ev/child-env-probe.jsonl" "$ev/poisoned-postfix-probe.jsonl"
rm -f "$ev/child-env-probe.jsonl"

{
  echo "\$ node docs/artifacts/w25/t026/smoke/analyse-probe.mjs docs/artifacts/w25/t026/smoke/poisoned-postfix-probe.jsonl"
  node "$ev/analyse-probe.mjs" "$ev/poisoned-postfix-probe.jsonl" 2>&1 |
    sed -E 's/\{"product".*$//'
  echo "exit=${PIPESTATUS[0]:-0}"
} >"$ev/probe-analysis-postfix.log" 2>&1

# 4 — hashes of the exact code state these runs were executed against
shasum -a 256 e2e/smoke/run.mjs e2e/smoke/environment.mjs \
  e2e/smoke/environment.test.mjs e2e/smoke/fixtures/child-env-probe.cjs \
  >"$ev/code-state.sha256"

echo "acceptance driver finished"
