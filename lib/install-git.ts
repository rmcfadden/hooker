import { execFile } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { hooksDir } from "./paths.ts";

const execFileAsync = promisify(execFile);
const GIT_HOOKS = ["pre-commit", "pre-push"];
const STEP_LINE = /^\s*(node|npm)\s/;
const EXIT_SUFFIX = /(\s*\|\|\s*exit\s+\d+)\s*$/;
const PREAMBLE_START = "# >>> profile >>>";
const PREAMBLE_END = "# <<< profile <<<";
const WRAPPED_LINE = /^(\s*)_pf \S+ \S+ (.*)$/;

/**
 * Shim so wrapping degrades safely: `_pf <hook> <label> <cmd…>` times the step through
 * profile-step.sh when it exists, else runs the raw command. Keeps shared .git/hooks safe
 * across worktrees that predate profile/.
 */
function preamble(rel: string): string {
  const script = `"$ROOT/${rel}/profile-step.sh"`;
  return [
    PREAMBLE_START,
    `if [ -x ${script} ]; then _pf() { bash ${script} "$@"; }; else _pf() { shift 2; "$@"; }; fi`,
    PREAMBLE_END,
  ].join("\n");
}

/** Short label for a git-hook step: the lint script stem, or the `npm run <script>` name. */
export function gitLabel(command: string): string {
  const npm = command.match(/npm\s+run\s+(\S+)/);
  if (npm) {
    return npm[1] ?? "step";
  }
  const file = command.match(/([\w.-]+)\.(?:mjs|js|cjs)\b/);
  return file?.[1] ?? "step";
}

/** Route one hook step through the `_pf` shim; pass through non-steps and already-wrapped lines. */
export function wrapStep(line: string, hookName: string): string {
  if (!STEP_LINE.test(line) || line.trimStart().startsWith("_pf ")) {
    return line;
  }
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const body = line.slice(indent.length);
  const suffix = body.match(EXIT_SUFFIX)?.[1] ?? "";
  const command = suffix ? body.slice(0, body.length - suffix.length) : body;
  return `${indent}_pf ${hookName} ${gitLabel(command)} ${command}${suffix}`;
}

/** Reverse wrapStep, restoring the original step command. */
export function unwrapStep(line: string): string {
  const match = line.match(WRAPPED_LINE);
  return match ? `${match[1] ?? ""}${match[2] ?? ""}` : line;
}

function injectPreamble(lines: string[], rel: string): string[] {
  if (lines.some((line) => line.includes(PREAMBLE_START))) {
    return lines;
  }
  const rootIdx = lines.findIndex((line) => /^\s*ROOT=/.test(line));
  const at = rootIdx >= 0 ? rootIdx + 1 : 1;
  return [...lines.slice(0, at), preamble(rel), ...lines.slice(at)];
}

/** Inject the shim + route every step through it (idempotent). */
export function wrapHookText(text: string, hookName: string, rel: string): string {
  return injectPreamble(text.split("\n"), rel)
    .map((line) => wrapStep(line, hookName))
    .join("\n");
}

/** Drop the shim block + unwrap every routed step, restoring the original hook. */
export function unwrapHookText(text: string): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (line.includes(PREAMBLE_START)) {
      inBlock = true;
    } else if (line.includes(PREAMBLE_END)) {
      inBlock = false;
    } else if (!inBlock) {
      kept.push(unwrapStep(line));
    }
  }
  return kept.join("\n");
}

/** Resolve `git rev-parse --git-path hooks` output against target — it may be relative or absolute. */
export function resolveHooksDir(target: string, gitPathOutput: string): string {
  return resolve(target, gitPathOutput.trim());
}

async function gitHooksPath(target: string): Promise<string> {
  const stdout = await execFileAsync("git", ["rev-parse", "--git-path", "hooks"], {
    cwd: target,
    encoding: "utf8",
  }).then((r) => r.stdout, () => ".git/hooks");
  return resolveHooksDir(target, stdout);
}

async function readMaybe(file: string): Promise<string | null> {
  return readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  });
}

type HookTransform = (text: string, name: string) => string;

async function transformHooks(target: string, transform: HookTransform): Promise<string[]> {
  const dir = await gitHooksPath(target);
  const written: string[] = [];
  for (const name of GIT_HOOKS) {
    const file = join(dir, name);
    const text = await readMaybe(file);
    if (text === null) {
      continue;
    }
    await writeFile(file, transform(text, name), "utf8");
    await chmod(file, 0o755);
    written.push(file);
  }
  return written;
}

/** Route every step in the local pre-commit/pre-push through the profile shim (idempotent). */
export async function wrapGitHooks({ target, home }: { target: string; home: string }): Promise<string[]> {
  const rel = relative(target, hooksDir(home));
  return transformHooks(target, (text, name) => wrapHookText(text, name, rel));
}

/** Remove the profile shim + step routing from the local git hooks. */
export async function unwrapGitHooks({ target }: { target: string }): Promise<string[]> {
  return transformHooks(target, (text) => unwrapHookText(text));
}

/** Count routed steps across the local git hooks (for `status`). */
export async function gitHookStatus({ target }: { target: string }): Promise<number> {
  const dir = await gitHooksPath(target);
  let steps = 0;
  for (const name of GIT_HOOKS) {
    const text = await readMaybe(join(dir, name));
    steps += text ? text.split("\n").filter((line) => /^\s*_pf /.test(line)).length : 0;
  }
  return steps;
}
