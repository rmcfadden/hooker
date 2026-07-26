import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { install, status, uninstall, upgrade } from "../lib/install.ts";

async function tempTarget() {
  return mkdtemp(join(tmpdir(), "profile-target-"));
}

async function readJsonMaybe(target: string, name: string) {
  const text = await readFile(join(target, ".claude", name), "utf8").catch(() => "{}");
  return JSON.parse(text);
}

function homeUnder(target: string) {
  return join(target, "profile");
}

test("install adds tool recorders to settings.local.json with portable paths", async () => {
  const target = await tempTarget();
  await install({ target, home: homeUnder(target) });
  const local = await readJsonMaybe(target, "settings.local.json");
  assert.equal(local.hooks.PreToolUse.filter((e: { _profile?: boolean }) => e._profile).length, 1);
  assert.equal(local.hooks.PostToolUse.filter((e: { _profile?: boolean }) => e._profile).length, 1);
  const cmd = local.hooks.PreToolUse[0].hooks[0].command;
  assert.equal(cmd, "bash ${CLAUDE_PROJECT_DIR}/profile/hooks/profile-tool-pre.sh");
  const info = await status({ target });
  assert.deepEqual(info.recorders.sort(), ["PostToolUse", "PreToolUse"]);
});

test("install leaves settings.json untouched unless wrapHooks is set", async () => {
  const target = await tempTarget();
  await install({ target, home: homeUnder(target) });
  const settings = await readJsonMaybe(target, "settings.json");
  assert.deepEqual(settings, {});
});

test("install is idempotent — re-running does not duplicate recorders", async () => {
  const target = await tempTarget();
  await install({ target, home: homeUnder(target) });
  await install({ target, home: homeUnder(target) });
  const local = await readJsonMaybe(target, "settings.local.json");
  assert.equal(local.hooks.PreToolUse.filter((e: { _profile?: boolean }) => e._profile).length, 1);
});

test("upgrade re-applies recorders and is idempotent (no duplication)", async () => {
  const target = await tempTarget();
  await install({ target, home: homeUnder(target) });
  await upgrade({ target, home: homeUnder(target) });
  const local = await readJsonMaybe(target, "settings.local.json");
  assert.equal(local.hooks.PreToolUse.filter((e: { _profile?: boolean }) => e._profile).length, 1);
  assert.equal((await status({ target })).recorders.length, 2);
});

test("upgrade refreshes guard-wrapping only when it was already installed", async () => {
  const plain = await tempTarget();
  await mkdir(join(plain, ".claude"), { recursive: true });
  const original = "bash ${CLAUDE_PROJECT_DIR}/.claude/hooks/guard.sh";
  const settings = { hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: original }] }] } };
  await writeFile(join(plain, ".claude", "settings.json"), JSON.stringify(settings), "utf8");

  await install({ target: plain, home: homeUnder(plain) });
  await upgrade({ target: plain, home: homeUnder(plain) });
  assert.equal((await status({ target: plain })).wrapped, 0);

  await install({ target: plain, home: homeUnder(plain), wrapHooks: true });
  await upgrade({ target: plain, home: homeUnder(plain) });
  assert.equal((await status({ target: plain })).wrapped, 1);
});

test("wrapHooks wraps settings.json commands and uninstall restores them", async () => {
  const target = await tempTarget();
  await mkdir(join(target, ".claude"), { recursive: true });
  const original = "bash ${CLAUDE_PROJECT_DIR}/.claude/hooks/guard.sh";
  await writeFile(
    join(target, ".claude", "settings.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: original }] }] } }),
    "utf8",
  );

  await install({ target, home: homeUnder(target), wrapHooks: true });
  let settings = await readJsonMaybe(target, "settings.json");
  const wrapped = settings.hooks.PreToolUse.find((e: { _profile?: boolean }) => !e._profile).hooks[0];
  assert.match(wrapped.command, /profile\/hooks\/profile-hook\.sh guard /);
  assert.equal(wrapped._profileOrig, original);
  const local = await readJsonMaybe(target, "settings.local.json");
  assert.equal(local.hooks.PreToolUse.filter((e: { _profile?: boolean }) => e._profile).length, 1);
  assert.equal((await status({ target })).wrapped, 1);

  await uninstall({ target });
  settings = await readJsonMaybe(target, "settings.json");
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, original);
  const info = await status({ target });
  assert.equal(info.recorders.length, 0);
  assert.equal(info.wrapped, 0);
});
