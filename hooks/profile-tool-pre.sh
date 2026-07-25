#!/usr/bin/env bash
# claude-tool PreToolUse recorder: records the tool call's start into SQLite `pending`.
# Never blocks the tool — always exits 0.
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/profile.mjs"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

payload=$(cat)
ts=$(now_us)

tool=$(printf '%s' "$payload" | jq -r '.tool_name // "unknown"')
session=$(printf '%s' "$payload" | jq -r '.session_id // ""')
corr=$(printf '%s' "$payload" | jq -r '.tool_use_id // ""')
raw=$(printf '%s' "$payload" | jq -r '.tool_input.command // .tool_input.file_path // .tool_name // "unknown"')

node "$bin" record --phase pre --tier claude-tool --hook "$tool" --command "$raw" \
  --corr "$corr" --key "$session|$tool" --start "$ts" >/dev/null 2>&1 || true

exit 0
