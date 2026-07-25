#!/usr/bin/env bash
# claude-tool PostToolUse recorder: pairs with the pending `pre` by corr (tool_use_id) and
# writes the completed event(s) to SQLite. Never blocks the tool — always exits 0.
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/hooker.mjs"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

payload=$(cat)
ts=$(now_us)

tool=$(printf '%s' "$payload" | jq -r '.tool_name // "unknown"')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""')
corr=$(printf '%s' "$payload" | jq -r '.tool_use_id // ""')

node "$bin" record --phase post --corr "$corr" --key "$session|$tool" \
  --end "$ts" --status success >/dev/null 2>&1 || true

exit 0
