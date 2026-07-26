import assert from "node:assert/strict";
import { test } from "node:test";
import { categorize, subcategorize } from "../lib/categories.ts";
import type { CategorizableRow } from "../lib/types.ts";

test("categorize is tier-first: wait and guards never fall through to command rules", () => {
  assert.equal(
    categorize({ tier: "claude-wait", hook: "AskUserQuestion", command: "" }),
    "wait",
  );
  assert.equal(
    categorize({
      tier: "claude-hook",
      hook: "main-branch-guard",
      command: "main-branch-guard",
    }),
    "hook",
  );
});

test("categorize routes git-hook steps through the command rules", () => {
  assert.equal(
    categorize({
      tier: "git-hook",
      hook: "pre-push",
      command: "npm",
      subcommand: "test:unit",
    }),
    "test",
  );
  assert.equal(
    categorize({
      tier: "git-hook",
      hook: "pre-commit",
      command: "node",
      subcommand: "lint-dup.mjs",
    }),
    "lint",
  );
});

test("categorize maps Bash commands by executable and verb", () => {
  const bash = (command: string, subcommand: string | null) =>
    categorize({ tier: "claude-tool", hook: "Bash", command, subcommand });
  assert.equal(bash("git", "push"), "vcs");
  assert.equal(bash("gh", "pr"), "vcs");
  assert.equal(bash("npm", "test:integration"), "test");
  assert.equal(bash("npx", "vitest"), "test");
  assert.equal(bash("npm", "lint:dup"), "lint");
  assert.equal(bash("npx", "prettier"), "lint");
  assert.equal(bash("npm", "install"), "pkg");
  assert.equal(bash("grep", null), "search");
  assert.equal(bash("rm", null), "sys");
  assert.equal(bash("docker", "run"), "other");
  assert.equal(bash("node", "sim.mjs"), "run");
  assert.equal(bash("cd", null), "shell");
  assert.equal(bash("echo", null), "shell");
  assert.equal(bash("sed", null), "shell");
  assert.equal(bash("frobnicate", null), "other");
});

test("categorize maps non-Bash tools by hook", () => {
  assert.equal(
    categorize({ tier: "claude-tool", hook: "Edit", command: "App.tsx" }),
    "edit",
  );
  assert.equal(
    categorize({ tier: "claude-tool", hook: "Read", command: "App.tsx" }),
    "read",
  );
  assert.equal(
    categorize({ tier: "claude-tool", hook: "Task", command: "Task" }),
    "agent",
  );
});

test("subcategorize gives the verb/file-kind, or 'default' when there is none", () => {
  const sub = (fields: Pick<CategorizableRow, "command"> & Partial<CategorizableRow>) =>
    subcategorize({ tier: "claude-tool", hook: "Bash", ...fields });
  assert.equal(
    sub({ command: "npm", subcommand: "test:integration" }),
    "integration",
  );
  assert.equal(sub({ command: "npx", subcommand: "tsc" }), "tsc");
  assert.equal(sub({ command: "git", subcommand: "push" }), "push");
  assert.equal(sub({ command: "npm", subcommand: "install" }), "install");
  assert.equal(sub({ command: "grep", subcommand: null }), "default");
  assert.equal(sub({ command: "cd", subcommand: null }), "default");
  assert.equal(
    subcategorize({
      tier: "claude-tool",
      hook: "Edit",
      command: "Edit",
      subcommand: "App.tsx",
    }),
    ".tsx",
  );
  assert.equal(
    subcategorize({ tier: "claude-tool", hook: "Read", command: "Makefile" }),
    "default",
  );
  assert.equal(
    subcategorize({
      tier: "claude-hook",
      hook: "PreToolUse",
      command: "main-branch-guard",
    }),
    "default",
  );
});
