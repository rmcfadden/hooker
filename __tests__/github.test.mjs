import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import {
  fetchActionsEvents,
  ingestGithub,
  stepsToEvents,
} from "../lib/github.ts";
import { withFakeGh } from "./fake-gh.mjs";

const JOBS = [
  {
    id: 42,
    run_id: 7,
    name: "unit",
    workflow_name: "Tests",
    steps: [
      { name: "checkout", number: 1, started_at: "2026-07-20T10:00:00Z", completed_at: "2026-07-20T10:00:05Z", conclusion: "success" },
      { name: "npm test", number: 2, started_at: "2026-07-20T10:00:05Z", completed_at: "2026-07-20T10:02:05Z", conclusion: "failure" },
      { name: "pending", number: 3, started_at: null, completed_at: null, conclusion: null },
    ],
  },
];

test("stepsToEvents maps steps to events and skips unfinished steps", () => {
  const events = stepsToEvents(JOBS);
  assert.equal(events.length, 2);
  const [checkout, npmTest] = events;
  assert.equal(checkout.tier, "github-action");
  assert.equal(checkout.hook, "Tests/unit");
  assert.equal(checkout.end - checkout.start, 5_000_000);
  assert.equal(npmTest.status, "failure");
  assert.equal(npmTest.sourceKey, "7/42/2");
});

test("fetchActionsEvents resolves the current repo and pulls step timings", async () => {
  const restore = await withFakeGh();
  try {
    const events = await fetchActionsEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].hook, "Tests/unit");
    assert.equal(events[0].tier, "github-action");
  } finally {
    restore();
  }
});

test("fetchActionsEvents honors an explicit repo and since window", async () => {
  const restore = await withFakeGh();
  try {
    const events = await fetchActionsEvents({ repo: "o/r", since: "2026-01-01", limit: 5 });
    assert.equal(events.length, 2);
  } finally {
    restore();
  }
});

test("ingestGithub inserts events and dedupes on re-ingest", async () => {
  const restore = await withFakeGh();
  const dir = await mkdtemp(join(tmpdir(), "hooker-gh-db-"));
  const db = await openDb(join(dir, "profile.db"));
  try {
    assert.equal(await ingestGithub(db, { repo: "o/r" }), 2);
    // Second ingest hits the source_key unique index — no new rows land.
    await ingestGithub(db, { repo: "o/r" });
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM event").get();
    assert.equal(n, 2);
  } finally {
    db.close();
    restore();
  }
});
