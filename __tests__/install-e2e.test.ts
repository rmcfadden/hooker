import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// End-to-end: exercise the *built* package the way a consumer does. This guards against the
// class of breakage where a GitHub install ships without `dist/` (bin points at a missing file)
// — `npm run build` must produce a runnable `dist/bin/hooker.js` that wires a real project.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "dist", "bin", "hooker.js");

/** Run the compiled CLI in a throwaway project with an isolated data dir; return combined stdout. */
function hooker(target: string, ...argv: string[]): string {
  return execFileSync("node", [bin, ...argv], {
    cwd: target,
    env: { ...process.env, PROFILE_DATA_DIR: join(target, ".profile") },
    encoding: "utf8",
  });
}

test("built package installs into a consumer project end-to-end", async (t) => {
  // Build the way `prepare` does on a GitHub install — dist/ is git-ignored, so it must be produced.
  execFileSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", stdio: "pipe" });
  assert.ok(existsSync(bin), "npm run build must emit dist/bin/hooker.js (the package `bin`)");

  const target = mkdtempSync(join(tmpdir(), "hooker-e2e-"));

  await t.test("install wires recorders that point at the built dist/hooks scripts", () => {
    const out = hooker(target, "install", "--target", target);
    assert.match(out, /wired recorders into/);
    const settings = JSON.parse(
      readFileSync(join(target, ".claude", "settings.local.json"), "utf8"),
    );
    const pre = settings.hooks.PreToolUse[0].hooks[0].command;
    const post = settings.hooks.PostToolUse[0].hooks[0].command;
    assert.match(pre, /dist\/hooks\/profile-tool-pre\.sh$/);
    assert.match(post, /dist\/hooks\/profile-tool-post\.sh$/);
    assert.ok(existsSync(bin.replace(/bin\/hooker\.js$/, "hooks/profile-tool-pre.sh")),
      "the recorder script the settings reference must exist in dist/");
  });

  await t.test("status reports the recorders and recording state via the compiled binary", () => {
    assert.match(hooker(target, "status", "--target", target),
      /recording=enabled recorders=\[PreToolUse, PostToolUse\]/);
  });

  await t.test("disable/enable round-trips through the compiled binary", () => {
    hooker(target, "disable");
    assert.match(hooker(target, "status", "--target", target), /recording=disabled/);
    hooker(target, "enable");
    assert.match(hooker(target, "status", "--target", target), /recording=enabled/);
  });

  await t.test("uninstall removes the recorders again", () => {
    assert.match(hooker(target, "uninstall", "--target", target), /removed profile entries/);
    const settings = JSON.parse(
      readFileSync(join(target, ".claude", "settings.local.json"), "utf8"),
    );
    const recorders = (settings.hooks?.PreToolUse ?? []).filter(
      (entry: { _profile?: boolean }) => entry._profile,
    );
    assert.equal(recorders.length, 0, "no hooker recorder entries should remain after uninstall");
  });
});
