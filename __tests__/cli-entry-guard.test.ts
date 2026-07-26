import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Regression guard: every real install route (`npm link`, npm global-bin) launches the CLI through
// a symlink, so process.argv[1] is the symlink path while import.meta.url is the resolved real path.
// The self-execution guard must realpath argv[1] before comparing, or main() never runs and the CLI
// is a silent no-op. Reproduce that by launching the built binary through a symlink.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "dist", "bin", "hooker.js");

test("the CLI runs when launched through a symlink (npm link / global bin)", () => {
  execFileSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", stdio: "pipe" });
  assert.ok(existsSync(bin), "npm run build must emit dist/bin/hooker.js");

  const dir = mkdtempSync(join(tmpdir(), "hooker-link-"));
  const link = join(dir, "hooker-link.js");
  symlinkSync(bin, link);

  const out = execFileSync("node", [link, "status"], {
    env: { ...process.env, PROFILE_DATA_DIR: join(dir, ".profile") },
    encoding: "utf8",
  });
  assert.match(out, /hooker: recording=/, "the entry guard must fire under a symlinked launch path");
});
