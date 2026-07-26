import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport } from "../lib/aggregate.ts";
import { categorize } from "../lib/categories.ts";
import { openDb } from "../lib/db.ts";
import { generateEvents } from "../lib/mock.ts";
import { insertMany } from "../lib/record.ts";
import { isWaitTier } from "../lib/tiers.ts";

const NOW = 1_700_000_000_000_000; // fixed epoch µs so tests don't depend on the wall clock
const WINDOW = 30 * 86_400_000_000; // 30 days in µs
const KNOWN_TIERS = new Set([
  "claude-tool",
  "claude-hook",
  "git-hook",
  "github-action",
  "claude-wait",
]);

function gen(overrides = {}) {
  return generateEvents({
    count: 500,
    windowMicros: WINDOW,
    now: NOW,
    seed: 1,
    ...overrides,
  });
}

test("generates exactly count events within the window and with positive duration", () => {
  const events = gen();
  assert.equal(events.length, 500);
  for (const ev of events) {
    assert.ok(ev.start >= NOW - WINDOW && ev.start < NOW);
    assert.ok(ev.end > ev.start);
  }
});

test("is deterministic for a given seed and varies across seeds", () => {
  assert.deepEqual(gen({ seed: 42 }), gen({ seed: 42 }));
  assert.notDeepEqual(gen({ seed: 1 }), gen({ seed: 2 }));
});

test("every row uses a known tier and categorizes without falling through to other", () => {
  for (const ev of gen()) {
    assert.ok(KNOWN_TIERS.has(ev.tier), `unexpected tier ${ev.tier}`);
    assert.notEqual(categorize(ev), "other");
  }
});

test("produces variety: wait-tool, failure, and multiple categories", () => {
  const events = gen({ count: 2000 });
  assert.ok(events.some((e) => isWaitTier(e.tier)));
  assert.ok(events.some((e) => e.status === "failure"));
  const categories = new Set(events.map((e) => categorize(e)));
  assert.ok(categories.size > 3, `expected >3 categories, got ${categories.size}`);
});

test("inserted events produce a populated report", async () => {
  const db = await openDb(":memory:");
  insertMany(db, gen({ count: 1000 }));
  const report = buildReport(db, { from: "1970-01-01" });
  db.close();
  assert.ok(report.totals.count > 0);
  assert.ok(report.groups.length > 1);
});
