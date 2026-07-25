#!/usr/bin/env bash
# Cursor beforeShellExecution: record the shell command as a cursor-tool activity (0 duration —
# Cursor has no afterShellExecution). Non-blocking — emits allow (Cursor only enforces deny).
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/hooker.mjs"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

payload=$(cat)
ts=$(now_us)
cmd=$(printf '%s' "$payload" | jq -r '.command // "unknown"')

node "$bin" record --split --tier cursor-tool --hook Bash --command "$cmd" \
  --start "$ts" --end "$ts" >/dev/null 2>&1 || true

printf '{"permission":"allow"}'
exit 0
