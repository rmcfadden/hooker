import type { Tier } from "./types.ts";

const WAIT_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** Tier for tools whose elapsed time is the user thinking/responding, not machine work. */
export const WAIT_TIER = "claude-wait";

/** Reclassify a recorded tier to the wait tier when the tool is really blocked on the user. */
export function resolveTier(tier: Tier, hook: string): Tier {
  return WAIT_TOOLS.has(hook) ? WAIT_TIER : tier;
}

/** Wait-tier time is user think-time — excluded from work totals unless the report opts in. */
export function isWaitTier(tier: string): boolean {
  return tier === WAIT_TIER;
}
