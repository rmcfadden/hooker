#!/usr/bin/env bash
# Cursor afterFileEdit: record the edited file as a cursor-tool activity.
# Notification hook — no response required.
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/profile.mjs"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

payload=$(cat)
ts=$(now_us)
file=$(printf '%s' "$payload" | jq -r '.file_path // "unknown"')

node "$bin" record --split --tier cursor-tool --hook Edit --command "$file" \
  --start "$ts" --end "$ts" >/dev/null 2>&1 || true

exit 0
