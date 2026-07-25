#!/usr/bin/env bash
# git-hook step wrapper: profile-step.sh <hook-name> <label> <inner-cmd...>
# Times one step, records it into SQLite, and exits the inner code so `|| exit 1` still gates.
set -uo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
bin="$script_dir/../bin/profile.mjs"
now_us() { perl -MTime::HiRes=time -e 'printf("%d", time() * 1e6)'; }

hook="$1"
label="$2"
shift 2

start=$(now_us)
"$@"
code=$?
end=$(now_us)

status=$([ "$code" -eq 0 ] && echo success || echo failure)

node "$bin" record --tier git-hook --hook "$hook" --command "$label" \
  --start "$start" --end "$end" --status "$status" >/dev/null 2>&1 || true

exit "$code"
