import { join, relative } from "node:path";
import { gitHookStatus, wrapGitHooks } from "./install-git.ts";
import { readJson, writeJson } from "./json-file.ts";
import { hooksDir } from "./paths.ts";

/** One `{ type, command, timeout }` hook command; `_profileOrig` holds the pre-wrap command. */
interface HookCommand {
  type?: string;
  command?: string;
  timeout?: number;
  _profileOrig?: string;
  [key: string]: unknown;
}

/** A matcher entry grouping hook commands; `_profile` marks our additive recorder entries. */
interface HookEntry {
  matcher?: string;
  _profile?: boolean;
  hooks?: HookCommand[];
  [key: string]: unknown;
}

type HookMap = Record<string, HookEntry[]>;

/** Parsed `.claude/settings.json` / `settings.local.json`. */
interface Settings {
  hooks?: HookMap;
  [key: string]: unknown;
}

/** Common options for the Claude install commands. */
interface InstallOpts {
  target: string;
  home: string;
  wrapHooks?: boolean;
}

const TOOL_RECORDERS = [
  { event: "PreToolUse", script: "profile-tool-pre.sh" },
  { event: "PostToolUse", script: "profile-tool-post.sh" },
];

const PROJECT_DIR = "${CLAUDE_PROJECT_DIR}";

function settingsPath(target: string): string {
  return join(target, ".claude", "settings.json");
}

function localPath(target: string): string {
  return join(target, ".claude", "settings.local.json");
}

/** Portable hook command: `bash ${CLAUDE_PROJECT_DIR}/<rel>` resolved against the target root. */
function hookCommand(target: string, home: string, script: string): string {
  const rel = relative(target, join(hooksDir(home), script));
  return `bash ${PROJECT_DIR}/${rel}`;
}

function recorderEntry(target: string, home: string, script: string): HookEntry {
  return {
    matcher: "*",
    _profile: true,
    hooks: [{ type: "command", command: hookCommand(target, home, script), timeout: 5 }],
  };
}

function setRecorders(hooks: HookMap, target: string, home: string): void {
  for (const { event, script } of TOOL_RECORDERS) {
    const kept = (hooks[event] ?? []).filter((entry) => !entry._profile);
    kept.push(recorderEntry(target, home, script));
    hooks[event] = kept;
  }
}

function labelFor(command: string): string {
  const match = command.match(/([\w.-]+\.(?:sh|mjs|js|cjs))\b/);
  return match?.[1] ? match[1].replace(/\.[^.]+$/, "") : "hook";
}

function wrapExisting(hooks: HookMap, target: string, home: string): void {
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      if (entry._profile) {
        continue;
      }
      for (const hook of entry.hooks ?? []) {
        if (hook._profileOrig || typeof hook.command !== "string") {
          continue;
        }
        hook._profileOrig = hook.command;
        const wrapper = hookCommand(target, home, "profile-hook.sh");
        hook.command = `${wrapper} ${labelFor(hook.command)} ${hook.command}`;
      }
    }
  }
}

/**
 * Wire the additive tool recorders into settings.local.json, and (with wrapHooks) time the
 * project's existing hooks in place in settings.json. Returns the files written.
 */
export async function install({ target, home, wrapHooks = false }: InstallOpts): Promise<string[]> {
  const local = (await readJson(localPath(target))) as Settings;
  local.hooks ??= {};
  setRecorders(local.hooks, target, home);
  await writeJson(localPath(target), local);
  const written = [localPath(target)];
  if (wrapHooks) {
    const settings = (await readJson(settingsPath(target))) as Settings;
    settings.hooks ??= {};
    wrapExisting(settings.hooks, target, home);
    await writeJson(settingsPath(target), settings);
    written.push(settingsPath(target));
  }
  return written;
}

function stripRecorders(hooks: HookMap): void {
  for (const event of Object.keys(hooks)) {
    hooks[event] = (hooks[event] ?? []).filter((entry) => !entry._profile);
  }
}

function unwrapExisting(hooks: HookMap): void {
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        if (hook._profileOrig) {
          hook.command = hook._profileOrig;
          delete hook._profileOrig;
        }
      }
    }
  }
}

/** Reverse install(): strip recorders from settings.local.json and unwrap settings.json. */
export async function uninstall({ target }: { target: string }): Promise<string[]> {
  const local = (await readJson(localPath(target))) as Settings;
  stripRecorders(local.hooks ?? {});
  await writeJson(localPath(target), local);
  const settings = (await readJson(settingsPath(target))) as Settings;
  unwrapExisting(settings.hooks ?? {});
  await writeJson(settingsPath(target), settings);
  return [localPath(target), settingsPath(target)];
}

function countWrapped(hooks: HookMap): number {
  let wrapped = 0;
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      wrapped += (entry.hooks ?? []).filter((hook) => hook._profileOrig).length;
    }
  }
  return wrapped;
}

/** Report the recorders wired into settings.local.json and the wrapped-hook count in settings.json. */
export async function status({ target }: { target: string }): Promise<{ recorders: string[]; wrapped: number }> {
  const local = (await readJson(localPath(target))) as Settings;
  const settings = (await readJson(settingsPath(target))) as Settings;
  const recorders: string[] = [];
  for (const [event, entries] of Object.entries(local.hooks ?? {})) {
    for (const entry of entries) {
      if (entry._profile) {
        recorders.push(event);
      }
    }
  }
  return { recorders, wrapped: countWrapped(settings.hooks ?? {}) };
}

/** Options for {@link upgrade}. */
interface UpgradeOpts {
  target: string;
  home: string;
  wrapHooks?: boolean;
  git?: boolean;
}

/**
 * Re-apply the current install to pick up new script/wiring (run after a `git pull`). Refreshes
 * only what's already installed — guard-wrapping and git-hook steps are re-applied iff they were
 * present — unless forced on with `wrapHooks` / `git`. Returns the files rewritten.
 */
export async function upgrade({ target, home, wrapHooks = false, git = false }: UpgradeOpts): Promise<string[]> {
  const wasWrapped = (await status({ target })).wrapped > 0;
  const hadGitSteps = (await gitHookStatus({ target })) > 0;
  const files = await install({ target, home, wrapHooks: wasWrapped || wrapHooks });
  if (hadGitSteps || git) {
    files.push(...(await wrapGitHooks({ target, home })));
  }
  return files;
}
