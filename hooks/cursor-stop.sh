#!/usr/bin/env bash
# Cursor stop: pair with the pending beforeSubmitPrompt to record the turn's duration.
# Notification hook — no response required.
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/hooker.ts"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

payload=$(cat)
ts=$(now_us)
gen=$(printf '%s' "$payload" | jq -r '.generation_id // .conversation_id // ""')
status=$(printf '%s' "$payload" | jq -r '.status // "success"')

node "$bin" record --phase post --corr "$gen" --end "$ts" --status "$status" >/dev/null 2>&1 || true

exit 0
