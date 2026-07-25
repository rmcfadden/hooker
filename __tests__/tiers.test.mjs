import assert from "node:assert/strict";
import { test } from "node:test";
import { isWaitTier, resolveTier, WAIT_TIER } from "../lib/tiers.ts";

test("resolveTier reclassifies user-blocked tools to the wait tier", () => {
  assert.equal(resolveTier("claude-tool", "AskUserQuestion"), WAIT_TIER);
  assert.equal(resolveTier("claude-tool", "ExitPlanMode"), WAIT_TIER);
});

test("resolveTier leaves working tools on their own tier", () => {
  assert.equal(resolveTier("claude-tool", "Bash"), "claude-tool");
  assert.equal(resolveTier("git-hook", "pre-commit"), "git-hook");
});

test("isWaitTier only matches the wait tier", () => {
  assert.equal(isWaitTier(WAIT_TIER), true);
  assert.equal(isWaitTier("claude-tool"), false);
});
