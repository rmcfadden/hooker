import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JOBS = JSON.stringify({
  jobs: [
    {
      id: 42,
      run_id: 7,
      name: "unit",
      workflow_name: "Tests",
      steps: [
        { name: "checkout", number: 1, started_at: "2026-07-20T10:00:00Z", completed_at: "2026-07-20T10:00:05Z", conclusion: "success" },
        { name: "test", number: 2, started_at: "2026-07-20T10:00:05Z", completed_at: "2026-07-20T10:02:05Z", conclusion: "failure" },
      ],
    },
  ],
});

// A POSIX-sh shim (not a node script, so it never emits its own V8 coverage) that answers the
// three `gh` calls lib/github.mjs makes: repo view, run listing, and per-run jobs.
const SCRIPT = `#!/bin/sh
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '%s' '{"nameWithOwner":"o/r"}'
elif [ "$1" = "api" ]; then
  case "$2" in
    */jobs) printf '%s' '${JOBS}' ;;
    *actions/runs*) printf '%s' '{"workflow_runs":[{"id":7}]}' ;;
    *) echo "unexpected gh api: $2" >&2; exit 2 ;;
  esac
else
  echo "unexpected gh call: $*" >&2; exit 2
fi
`;

/**
 * Write an executable `gh` shim into a fresh temp dir and prepend it to PATH, so the real
 * `execFile("gh", ...)` in lib/github.mjs runs our fixture responder instead of the GitHub CLI.
 * Returns a restore() that puts PATH back.
 */
export async function withFakeGh() {
  const dir = await mkdtemp(join(tmpdir(), "hooker-gh-"));
  const file = join(dir, "gh");
  await writeFile(file, SCRIPT);
  await chmod(file, 0o755);
  const prev = process.env.PATH;
  process.env.PATH = `${dir}:${prev}`;
  return () => {
    process.env.PATH = prev;
  };
}
