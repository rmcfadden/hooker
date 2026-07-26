import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsIn, runHook, script, tempDataDir } from "./hook-harness.ts";

const run = (name: string, input: string, dir: string) => runHook([script(name)], input, dir);
const dataDir = () => tempDataDir("cursor-hooks");

test("cursor-shell.sh allows the command and records split activity (0 duration)", async () => {
  const dir = await dataDir();
  const res = await run(
    "cursor-shell.sh",
    JSON.stringify({ command: "cd /r && git push", generation_id: "g1" }),
    dir,
  );
  assert.equal(res.code, 0);
  assert.deepEqual(JSON.parse(res.stdout), { permission: "allow" });
  const rows = await eventsIn(dir);
  const push = rows.find((r) => r.command === "git");
  assert.ok(push);
  assert.deepEqual(
    [push.tier, push.hook, push.subcommand, push.elapsed],
    ["cursor-tool", "Bash", "push", 0],
  );
});

test("cursor-edit.sh records the edited file as a cursor-tool activity", async () => {
  const dir = await dataDir();
  await run(
    "cursor-edit.sh",
    JSON.stringify({ file_path: "/repo/src/App.tsx" }),
    dir,
  );
  const rows = await eventsIn(dir);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].tier, rows[0].hook, rows[0].command, rows[0].subcommand],
    ["cursor-tool", "Edit", "Edit", "App.tsx"],
  );
});

test("cursor prompt→stop pair into a cursor-turn event with a duration", async () => {
  const dir = await dataDir();
  await run(
    "cursor-prompt.sh",
    JSON.stringify({ generation_id: "gen-42" }),
    dir,
  );
  await run(
    "cursor-stop.sh",
    JSON.stringify({ generation_id: "gen-42", status: "success" }),
    dir,
  );
  const rows = await eventsIn(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, "cursor-turn");
  assert.equal(rows[0].command, "turn");
  assert.ok(rows[0].elapsed > 0);
});
