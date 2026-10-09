#!/bin/sh
set -eu
workspace_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$workspace_dir/.toolchain/bin"
corepack enable --install-directory "$workspace_dir/.toolchain/bin"
PATH="$workspace_dir/.toolchain/bin:$PATH"
export PATH

# Testcontainers (node) does not read docker CLI contexts. When the host has
# a non-default context selected (e.g. colima) but no explicit DOCKER_HOST,
# derive it from the context so integration/e2e suites find a runtime.
#
# Such contexts point at a daemon running in a VM that cannot see host paths,
# so the ryuk reaper (which bind-mounts the client socket) must be disabled:
# vitest global teardown still stops every container it started.
if [ -z "${DOCKER_HOST:-}" ] && command -v docker >/dev/null 2>&1; then
  docker_context=$(docker context show 2>/dev/null || true)
  if [ -n "$docker_context" ] && [ "$docker_context" != "default" ]; then
    docker_host=$(docker context inspect "$docker_context" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
    if [ -n "$docker_host" ]; then
      DOCKER_HOST="$docker_host"
      export DOCKER_HOST
      if [ -z "${TESTCONTAINERS_RYUK_DISABLED:-}" ]; then
        TESTCONTAINERS_RYUK_DISABLED=true
        export TESTCONTAINERS_RYUK_DISABLED
      fi
    fi
  fi
fi

exec pnpm "$@"
