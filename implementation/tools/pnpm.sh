#!/bin/sh
set -eu
workspace_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$workspace_dir/.toolchain/bin"
corepack enable --install-directory "$workspace_dir/.toolchain/bin"
PATH="$workspace_dir/.toolchain/bin:$PATH"
export PATH
exec pnpm "$@"
