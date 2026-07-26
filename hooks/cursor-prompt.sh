#!/usr/bin/env bash
# Cursor beforeSubmitPrompt: record the turn START into pending (paired at `stop`).
# Non-blocking — emits allow (Cursor only enforces deny).
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/hooker.ts"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

payload=$(cat)
ts=$(now_us)
gen=$(printf '%s' "$payload" | jq -r '.generation_id // .conversation_id // ""')

node "$bin" record --phase pre --tier cursor-turn --hook turn --command turn \
  --corr "$gen" --start "$ts" >/dev/null 2>&1 || true

printf '{"permission":"allow"}'
exit 0
