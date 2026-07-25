import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, writeJson } from "./json-file.ts";
import { hooksDir } from "./paths.ts";

const CURSOR_HOOKS = [
  { event: "beforeSubmitPrompt", script: "cursor-prompt.sh" },
  { event: "stop", script: "cursor-stop.sh" },
  { event: "beforeShellExecution", script: "cursor-shell.sh" },
  { event: "afterFileEdit", script: "cursor-edit.sh" },
  { event: "beforeReadFile", script: "cursor-read.sh" },
  { event: "beforeMCPExecution", script: "cursor-mcp.sh" },
];

const MARKER = "profile/hooks/cursor-";

/** `.cursor/hooks.json` — project-level by default, `~/.cursor/hooks.json` when global. */
function hooksJsonPath(target, global) {
  return global ? join(homedir(), ".cursor", "hooks.json") : join(target, ".cursor", "hooks.json");
}

function isProfileEntry(entry) {
  return typeof entry?.command === "string" && entry.command.includes(MARKER);
}

function setCursorHooks(config, home) {
  config.version ??= 1;
  config.hooks ??= {};
  for (const { event, script } of CURSOR_HOOKS) {
    const kept = (config.hooks[event] ?? []).filter((entry) => !isProfileEntry(entry));
    kept.push({ command: `bash ${join(hooksDir(home), script)}` });
    config.hooks[event] = kept;
  }
}

/** Wire the Cursor recorders into `.cursor/hooks.json` (idempotent, merges with existing hooks). */
export async function installCursor({ target, home, global = false } = {}) {
  const file = hooksJsonPath(target, global);
  const config = await readJson(file);
  setCursorHooks(config, home);
  await writeJson(file, config);
  return file;
}

/** Remove the profile recorders from `.cursor/hooks.json`, leaving the user's own hooks intact. */
export async function uninstallCursor({ target, global = false } = {}) {
  const file = hooksJsonPath(target, global);
  const config = await readJson(file);
  for (const event of Object.keys(config.hooks ?? {})) {
    config.hooks[event] = config.hooks[event].filter((entry) => !isProfileEntry(entry));
  }
  await writeJson(file, config);
  return file;
}

/** The Cursor hook events currently wired to the profile recorders. */
export async function cursorStatus({ target, global = false } = {}) {
  const config = await readJson(hooksJsonPath(target, global));
  const events = [];
  for (const [event, entries] of Object.entries(config.hooks ?? {})) {
    if (entries.some(isProfileEntry)) {
      events.push(event);
    }
  }
  return { events };
}
