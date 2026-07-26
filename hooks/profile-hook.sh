#!/usr/bin/env bash
# claude-hook self-timing wrapper: profile-hook.sh <label> <inner-cmd...>
# Transparent — forwards the inner command's stdin/stdout and exits with its code.
# Records the timing directly into SQLite (WAL, parallel-safe) via `profile record`.
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/hooker.ts"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

label="$1"
shift
payload=$(cat)

start=$(now_us)
out=$(printf '%s' "$payload" | "$@")
code=$?
end=$(now_us)

hook=$(printf '%s' "$payload" | jq -r '.hook_event_name // "unknown"')
status=$([ "$code" -eq 0 ] && echo success || echo failure)

node "$bin" record --tier claude-hook --hook "$hook" --command "$label" \
  --start "$start" --end "$end" --status "$status" >/dev/null 2>&1 || true

printf '%s' "$out"
exit "$code"
