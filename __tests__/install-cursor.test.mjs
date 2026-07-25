import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cursorStatus, installCursor, uninstallCursor } from "../lib/install-cursor.mjs";

async function tempTarget() {
  return mkdtemp(join(tmpdir(), "profile-cursor-"));
}

async function readHooks(target) {
  return JSON.parse(await readFile(join(target, ".cursor", "hooks.json"), "utf8"));
}

const EVENTS = ["beforeSubmitPrompt", "stop", "beforeShellExecution", "afterFileEdit", "beforeReadFile", "beforeMCPExecution"];

test("installCursor writes hooks.json v1 with a profile recorder on every event", async () => {
  const target = await tempTarget();
  await installCursor({ target, home: join(target, "profile") });
  const config = await readHooks(target);
  assert.equal(config.version, 1);
  for (const event of EVENTS) {
    const entries = config.hooks[event].filter((e) => e.command.includes("profile/hooks/cursor-"));
    assert.equal(entries.length, 1, `expected one profile entry on ${event}`);
  }
  assert.deepEqual((await cursorStatus({ target })).events.sort(), [...EVENTS].sort());
});

test("installCursor is idempotent and preserves the user's own hooks", async () => {
  const target = await tempTarget();
  await mkdir(join(target, ".cursor"), { recursive: true });
  const mine = { command: "bash my-guard.sh" };
  await writeFile(
    join(target, ".cursor", "hooks.json"),
    JSON.stringify({ version: 1, hooks: { beforeShellExecution: [mine] } }),
    "utf8",
  );

  await installCursor({ target, home: join(target, "profile") });
  await installCursor({ target, home: join(target, "profile") });
  const config = await readHooks(target);
  const shell = config.hooks.beforeShellExecution;
  assert.equal(shell.filter((e) => e.command.includes("profile/hooks/cursor-")).length, 1);
  assert.ok(shell.some((e) => e.command === "bash my-guard.sh"));
});

test("uninstallCursor removes only the profile recorders", async () => {
  const target = await tempTarget();
  await mkdir(join(target, ".cursor"), { recursive: true });
  await writeFile(
    join(target, ".cursor", "hooks.json"),
    JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: "bash my-guard.sh" }] } }),
    "utf8",
  );
  await installCursor({ target, home: join(target, "profile") });
  await uninstallCursor({ target });
  const config = await readHooks(target);
  assert.deepEqual(config.hooks.beforeShellExecution, [{ command: "bash my-guard.sh" }]);
  assert.equal((await cursorStatus({ target })).events.length, 0);
});
