#!/usr/bin/env bash
# Cursor beforeReadFile: record the read file as a cursor-tool activity.
# Non-blocking — emits allow (Cursor only enforces deny).
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/hooker.ts"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

payload=$(cat)
ts=$(now_us)
file=$(printf '%s' "$payload" | jq -r '.file_path // "unknown"')

node "$bin" record --split --tier cursor-tool --hook Read --command "$file" \
  --start "$ts" --end "$ts" >/dev/null 2>&1 || true

printf '{"permission":"allow"}'
exit 0
