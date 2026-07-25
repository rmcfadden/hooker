import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsIn, runHook as run, script, tempDataDir } from "./hook-harness.mjs";

const dataDir = () => tempDataDir("hooks");

test("profile-hook.sh forwards stdout + exit code and records into SQLite", async () => {
  const dir = await dataDir();
  const payload = JSON.stringify({ hook_event_name: "PreToolUse" });
  const res = await run(
    [script("profile-hook.sh"), "dispatch-guard", "bash", "-c", "cat; echo DECISION; exit 7"],
    payload,
    dir,
  );
  assert.equal(res.code, 7);
  assert.match(res.stdout, /DECISION/);
  const rows = await eventsIn(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, "claude-hook");
  assert.equal(rows[0].hook, "PreToolUse");
  assert.equal(rows[0].command, "dispatch-guard");
  assert.equal(rows[0].status, "failure");
  assert.ok(rows[0].elapsed >= 0);
});

test("profile-step.sh preserves the inner exit code and records a git-hook row", async () => {
  const dir = await dataDir();
  const res = await run([script("profile-step.sh"), "pre-commit", "lint-x", "bash", "-c", "exit 3"], "", dir);
  assert.equal(res.code, 3);
  const rows = await eventsIn(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, "git-hook");
  assert.equal(rows[0].command, "lint-x");
  assert.equal(rows[0].status, "failure");
});

test("a compound Bash call records one row per sub-command via pending pairing", async () => {
  const dir = await dataDir();
  const pre = JSON.stringify({ tool_name: "Bash", session_id: "s", tool_use_id: "u1", tool_input: { command: "cd /repo && npm run test" } });
  const post = JSON.stringify({ tool_name: "Bash", session_id: "s", tool_use_id: "u1" });
  await run([script("profile-tool-pre.sh")], pre, dir);
  await run([script("profile-tool-post.sh")], post, dir);

  const rows = await eventsIn(dir);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].command, rows[0].subcommand, rows[0].elapsed], ["cd", null, 0]);
  assert.equal(rows[1].command, "npm");
  assert.equal(rows[1].subcommand, "test");
  assert.ok(rows[1].elapsed > 0);
});
