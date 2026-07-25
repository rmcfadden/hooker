import { extname } from "node:path";
import { isWaitTier } from "./tiers.ts";
import type { CategorizableRow } from "./types.ts";

/** High-level category buckets a recorded row can fall into. */
export type Category =
  | "wait"
  | "hook"
  | "vcs"
  | "test"
  | "lint"
  | "build"
  | "pkg"
  | "search"
  | "sys"
  | "run"
  | "shell"
  | "edit"
  | "read"
  | "agent"
  | "other";

const VCS = new Set(["git", "gh"]);
const TEST = new Set([
  "test",
  "test:unit",
  "test:integration",
  "test:frontend",
  "test:e2e",
  "test:skills",
  "vitest",
  "jest",
]);
const LINT = new Set([
  "lint",
  "lint:dup",
  "format",
  "typecheck",
  "tsc",
  "prettier",
  "eslint",
]);
const BUILD = new Set(["build", "build:typescript", "compile", "emit"]);
const PKG = new Set(["install", "ci", "add", "remove", "update", "prune"]);
const SEARCH = new Set([
  "grep",
  "rg",
  "find",
  "ls",
  "cat",
  "fd",
  "ag",
  "head",
  "tail",
]);
const SYS = new Set([
  "rm",
  "cp",
  "mv",
  "mkdir",
  "pkill",
  "kill",
  "lsof",
  "ps",
  "chmod",
  "ln",
  "curl",
  "wget",
  "mktemp",
  "touch",
]);
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "node"]);
const SHELL = new Set([
  "cd",
  "echo",
  "printf",
  "pwd",
  "sleep",
  "true",
  "false",
  ":",
  "export",
  "set",
  "read",
  "unset",
  "eval",
  "source",
  "test",
  "sed",
  "awk",
  "wc",
  "tr",
  "cut",
  "sort",
  "uniq",
  "tee",
  "dirname",
  "basename",
  "env",
  "xargs",
  "seq",
  "diff",
  "timeout",
  "bash",
  "zsh",
  "sh",
]);
const FILE_HOOKS: Record<string, "edit" | "read" | "search"> = {
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  Read: "read",
  Grep: "search",
  Glob: "search",
};

const COMMAND_CATEGORY = new Map<string, "search" | "sys" | "run" | "shell">();
for (const [category, set] of [
  ["search", SEARCH],
  ["sys", SYS],
  ["run", RUNNERS],
  ["shell", SHELL],
] as const) {
  for (const command of set) COMMAND_CATEGORY.set(command, category);
}

/** Category for a shell command from its executable + verb (git → vcs, npm test → test, …).
 * Subcommand rules win first (so `git add` stays vcs, not pkg), then the executable lookup. */
function bashCategory(command: string, subcommand?: string | null): Category {
  const sub = subcommand ?? "";
  if (VCS.has(command)) return "vcs";
  if (TEST.has(sub) || TEST.has(command)) return "test";
  if (LINT.has(sub) || LINT.has(command) || /^lint/.test(sub)) return "lint";
  if (BUILD.has(sub)) return "build";
  if (PKG.has(sub)) return "pkg";
  return COMMAND_CATEGORY.get(command) ?? "other";
}

/** High-level category for a recorded row — tier-first (wait/hook), then command-driven. */
export function categorize({ tier, hook, command, subcommand }: CategorizableRow): Category {
  if (isWaitTier(tier)) return "wait";
  if (tier === "claude-hook") return "hook";
  if (tier === "git-hook") return bashCategory(command, subcommand);
  if (hook !== "Bash") return FILE_HOOKS[hook] ?? "agent";
  return bashCategory(command, subcommand);
}

/** The curated middle tier between category and the raw command — the specific verb/file-kind.
 * File tools → extension (`.tsx`); Bash → its verb (`push`, `install`, `tsc`, test kind); else
 * `"default"` when there's no meaningful sub, keeping every label a uniform three parts. */
export function subcategorize(row: CategorizableRow): string {
  const category = categorize(row);
  if (category === "edit" || category === "read") {
    return extname(row.subcommand ?? row.command ?? "") || "default";
  }
  const sub = row.subcommand;
  if (!sub) {
    return "default";
  }
  return category === "test" ? sub.replace(/^test:/, "") : sub;
}
