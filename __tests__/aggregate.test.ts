import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregate,
  buildReport,
  percentile,
  rangeMicros,
} from "../lib/aggregate.ts";
import { nowMicros } from "../lib/clock.ts";
import { openDb } from "../lib/db.ts";
import { insertMany } from "../lib/record.ts";
import { WAIT_TIER } from "../lib/tiers.ts";
import type { CategorizedRow } from "../lib/types.ts";

async function seededDb() {
  const db = await openDb(":memory:");
  insertMany(db, [
    {
      start: 1000,
      end: 1100,
      tier: "claude-tool",
      hook: "Bash",
      command: "npm",
      status: "success",
    },
    {
      start: 2000,
      end: 9_002_000,
      tier: WAIT_TIER,
      hook: "AskUserQuestion",
      command: "AskUserQuestion",
      status: "success",
    },
  ]);
  return db;
}

test("rangeMicros builds a half-open day window", () => {
  const { lo, hi } = rangeMicros("2026-07-01", "2026-07-01");
  assert.equal(hi - lo, 86_400_000_000);
});

test("rangeMicros honors second-precise datetime bounds", () => {
  const { lo, hi } = rangeMicros(
    "2026-07-22T14:00:00Z",
    "2026-07-22T15:00:30Z",
  );
  assert.equal(hi - lo, 3_600_000_000 + 30_000_000);
});

test("rangeMicros with a relative last span ends now and looks back", () => {
  const { lo, hi } = rangeMicros(undefined, undefined, "1h");
  assert.equal(hi, Number.MAX_SAFE_INTEGER);
  assert.ok(Math.abs(lo - (nowMicros() - 3_600_000_000)) < 1_000_000);
});

test("percentile picks the nearest-rank value", () => {
  const sorted = [10, 20, 30, 40, 100];
  assert.equal(percentile(sorted, 50), 30);
  assert.equal(percentile(sorted, 95), 100);
  assert.equal(percentile([], 95), 0);
});

test("aggregate groups and totals with failure counts", () => {
  const rows = [
    {
      tier: "git-hook",
      hook: "pre-commit",
      command: "lint",
      elapsed: 100,
      status: "success",
    },
    {
      tier: "git-hook",
      hook: "pre-commit",
      command: "lint",
      elapsed: 300,
      status: "failure",
    },
    {
      tier: "claude-tool",
      hook: "Bash",
      command: "npm",
      elapsed: 50,
      status: "success",
    },
  ];
  const groups = aggregate(rows as unknown as CategorizedRow[]);
  assert.equal(groups.length, 2);
  const lint = groups.find((g) => g.command === "lint");
  assert.ok(lint);
  assert.equal(lint.count, 2);
  assert.equal(lint.total, 400);
  assert.equal(lint.avg, 200);
  assert.equal(lint.failures, 1);
});

test("aggregate honors a custom grouping", () => {
  const rows = [
    {
      tier: "git-hook",
      hook: "pre-commit",
      command: "a",
      elapsed: 1,
      status: "success",
    },
    {
      tier: "git-hook",
      hook: "pre-push",
      command: "b",
      elapsed: 2,
      status: "success",
    },
  ];
  const groups = aggregate(rows as unknown as CategorizedRow[], ["tier"]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].total, 3);
});

test("buildReport excludes wait-tier think-time from groups and totals by default", async () => {
  const db = await seededDb();
  const report = buildReport(db, {});
  db.close();
  assert.equal(report.totals.count, 1);
  assert.equal(report.totals.total, 100);
  assert.ok(!report.groups.some((g) => g.category === "wait"));
  assert.equal(report.wait.count, 1);
  assert.equal(report.wait.total, 9_000_000);
});

test("buildReport folds wait-tier back in when includeWait is set", async () => {
  const db = await seededDb();
  const report = buildReport(db, { includeWait: true });
  db.close();
  assert.equal(report.totals.count, 2);
  assert.ok(report.groups.some((g) => g.category === "wait"));
  assert.equal(report.wait.count, 1);
});

test("buildReport groups by derived category and excludes wait by default", async () => {
  const db = await seededDb();
  const work = buildReport(db, { group: ["category"] });
  const withWait = buildReport(db, { group: ["category"], includeWait: true });
  db.close();
  assert.deepEqual(
    work.groups.map((g) => g.category),
    ["run"],
  );
  assert.ok(withWait.groups.some((g) => g.category === "wait"));
});

test("buildReport with last only counts events inside the recent window", async () => {
  const db = await openDb(":memory:");
  const now = nowMicros();
  insertMany(db, [
    {
      start: now - 2 * 3_600_000_000,
      end: now - 2 * 3_600_000_000 + 100,
      tier: "claude-tool",
      hook: "Bash",
      command: "old",
      status: "success",
    },
    {
      start: now - 5 * 60_000_000,
      end: now - 5 * 60_000_000 + 200,
      tier: "claude-tool",
      hook: "Bash",
      command: "recent",
      status: "success",
    },
  ]);
  const report = buildReport(db, { last: "1h" });
  db.close();
  assert.equal(report.last, "1h");
  assert.equal(report.totals.count, 1);
  assert.deepEqual(
    report.groups.map((g) => g.command),
    ["recent"],
  );
});
