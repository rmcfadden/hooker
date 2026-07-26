/**
 * Deterministic mock-event generator for populating the datasource so `hooker report` has
 * something to visualize. Pure (no DB/IO): callers persist the returned rows with `insertMany`.
 * Templates mirror the taxonomy in `categories.ts` so generated rows land in real category groups.
 */

import { resolveTier } from "./tiers.ts";
import type { EventInput, Tier } from "./types.ts";

const MS = 1000; // microseconds per millisecond
const SEC = 1000 * MS;

/** Seedable PRNG (mulberry32) — same seed yields the same sequence, so runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An event template biasing the generated mix (see the array below for field semantics). */
interface Template {
  weight: number;
  tier: Tier;
  hook: string;
  command: string;
  subs: string[] | null;
  min: number;
  max: number;
  fail: number;
}

/**
 * Event templates. `weight` biases how often each is picked; `min`/`max` bound the elapsed time
 * (microseconds); `fail` is the per-template failure rate. `subs` (when present) supplies a random
 * subcommand — a Bash verb or, for file tools, a filename whose extension drives the subcategory.
 */
const TEMPLATES: Template[] = [
  // claude-tool · Bash
  { weight: 8, tier: "claude-tool", hook: "Bash", command: "git", subs: ["status", "add", "commit", "push", "diff", "log"], min: 40 * MS, max: 2 * SEC, fail: 0.03 },
  { weight: 5, tier: "claude-tool", hook: "Bash", command: "npm", subs: ["install", "test", "run build", "ci"], min: 500 * MS, max: 40 * SEC, fail: 0.08 },
  { weight: 3, tier: "claude-tool", hook: "Bash", command: "node", subs: null, min: 80 * MS, max: 6 * SEC, fail: 0.05 },
  { weight: 3, tier: "claude-tool", hook: "Bash", command: "tsc", subs: null, min: 800 * MS, max: 20 * SEC, fail: 0.1 },
  { weight: 3, tier: "claude-tool", hook: "Bash", command: "eslint", subs: null, min: 400 * MS, max: 12 * SEC, fail: 0.07 },
  { weight: 2, tier: "claude-tool", hook: "Bash", command: "prettier", subs: null, min: 200 * MS, max: 5 * SEC, fail: 0.02 },
  { weight: 5, tier: "claude-tool", hook: "Bash", command: "rg", subs: null, min: 15 * MS, max: 400 * MS, fail: 0.01 },
  { weight: 3, tier: "claude-tool", hook: "Bash", command: "grep", subs: null, min: 15 * MS, max: 400 * MS, fail: 0.01 },
  { weight: 3, tier: "claude-tool", hook: "Bash", command: "ls", subs: null, min: 8 * MS, max: 120 * MS, fail: 0.0 },
  { weight: 2, tier: "claude-tool", hook: "Bash", command: "mkdir", subs: null, min: 5 * MS, max: 60 * MS, fail: 0.0 },
  { weight: 2, tier: "claude-tool", hook: "Bash", command: "rm", subs: null, min: 5 * MS, max: 80 * MS, fail: 0.01 },
  { weight: 2, tier: "claude-tool", hook: "Bash", command: "cd", subs: null, min: 2 * MS, max: 20 * MS, fail: 0.0 },
  { weight: 3, tier: "claude-tool", hook: "Bash", command: "echo", subs: null, min: 2 * MS, max: 30 * MS, fail: 0.0 },

  // claude-tool · file tools (subcommand is a filename → extension subcategory)
  { weight: 10, tier: "claude-tool", hook: "Read", command: "Read", subs: ["src/index.ts", "app.tsx", "lib/db.mjs", "package.json", "README.md"], min: 20 * MS, max: 600 * MS, fail: 0.01 },
  { weight: 8, tier: "claude-tool", hook: "Edit", command: "Edit", subs: ["src/index.ts", "app.tsx", "lib/db.mjs", "config.json", "notes.md"], min: 30 * MS, max: 900 * MS, fail: 0.02 },
  { weight: 4, tier: "claude-tool", hook: "Write", command: "Write", subs: ["src/new.ts", "styles.tsx", "data.json", "doc.md"], min: 30 * MS, max: 900 * MS, fail: 0.02 },
  { weight: 3, tier: "claude-tool", hook: "MultiEdit", command: "MultiEdit", subs: ["src/index.ts", "app.tsx", "lib/util.mjs"], min: 40 * MS, max: 1 * SEC, fail: 0.03 },
  { weight: 5, tier: "claude-tool", hook: "Grep", command: "Grep", subs: null, min: 20 * MS, max: 500 * MS, fail: 0.01 },
  { weight: 3, tier: "claude-tool", hook: "Glob", command: "Glob", subs: null, min: 15 * MS, max: 400 * MS, fail: 0.01 },

  // claude-hook · agent guards
  { weight: 4, tier: "claude-hook", hook: "PreToolUse", command: "PreToolUse", subs: null, min: 5 * MS, max: 300 * MS, fail: 0.02 },
  { weight: 4, tier: "claude-hook", hook: "PostToolUse", command: "PostToolUse", subs: null, min: 5 * MS, max: 300 * MS, fail: 0.02 },
  { weight: 2, tier: "claude-hook", hook: "Stop", command: "Stop", subs: null, min: 5 * MS, max: 200 * MS, fail: 0.01 },

  // git-hook · pre-commit / pre-push steps
  { weight: 3, tier: "git-hook", hook: "Bash", command: "lint", subs: ["pre-commit"], min: 300 * MS, max: 8 * SEC, fail: 0.06 },
  { weight: 2, tier: "git-hook", hook: "Bash", command: "test", subs: ["pre-push"], min: 1 * SEC, max: 30 * SEC, fail: 0.1 },

  // github-action · CI steps (hook mirrors real ingest: "workflow/job")
  { weight: 3, tier: "github-action", hook: "ci.yml/build", command: "build", subs: null, min: 5 * SEC, max: 120 * SEC, fail: 0.05 },
  { weight: 3, tier: "github-action", hook: "ci.yml/test", command: "test", subs: null, min: 8 * SEC, max: 180 * SEC, fail: 0.08 },
  { weight: 2, tier: "github-action", hook: "ci.yml/lint", command: "lint", subs: null, min: 3 * SEC, max: 40 * SEC, fail: 0.04 },

  // wait tools (resolve to claude-wait) — user think-time
  { weight: 2, tier: "claude-tool", hook: "AskUserQuestion", command: "AskUserQuestion", subs: null, min: 3 * SEC, max: 120 * SEC, fail: 0.0 },
  { weight: 1, tier: "claude-tool", hook: "ExitPlanMode", command: "ExitPlanMode", subs: null, min: 5 * SEC, max: 180 * SEC, fail: 0.0 },
];

const TOTAL_WEIGHT = TEMPLATES.reduce((sum, t) => sum + t.weight, 0);

/** Pick a template by weight from a [0,1) random value. */
function pickTemplate(r: number): Template {
  let x = r * TOTAL_WEIGHT;
  for (const t of TEMPLATES) {
    x -= t.weight;
    if (x < 0) return t;
  }
  // Non-empty constant array, so the final template is always defined.
  return TEMPLATES[TEMPLATES.length - 1]!;
}

/** Options for {@link generateEvents}. */
export interface GenerateArgs {
  count: number;
  windowMicros: number;
  now: number;
  seed: number;
}

/**
 * Generate `count` mock events uniformly spread over `[now - windowMicros, now)`. Returns rows
 * shaped for `insertEvent`/`insertMany` (`source_key` left unset so the partial dedupe index is a
 * no-op and every row inserts). Deterministic for a given `seed`.
 */
export function generateEvents({ count, windowMicros, now, seed }: GenerateArgs): EventInput[] {
  const rand = mulberry32(seed);
  const events: EventInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const tpl = pickTemplate(rand());
    const start = Math.floor(now - windowMicros + rand() * windowMicros);
    const duration = Math.floor(tpl.min + rand() * (tpl.max - tpl.min));
    const subcommand = tpl.subs ? tpl.subs[Math.floor(rand() * tpl.subs.length)] ?? null : null;
    const status = rand() < tpl.fail ? "failure" : "success";
    events.push({
      start,
      end: start + duration,
      // mirror live recording: wait tools (AskUserQuestion/ExitPlanMode) resolve to the wait tier
      tier: resolveTier(tpl.tier, tpl.hook),
      hook: tpl.hook,
      command: tpl.command,
      subcommand,
      status,
    });
  }
  return events;
}
