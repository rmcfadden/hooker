import assert from "node:assert/strict";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { insertEvent, insertMany, recordMarker } from "../lib/record.mjs";

const sample = {
  start: 1000,
  end: 1500,
  tier: "claude-hook",
  hook: "PreToolUse",
  command: "dispatch-guard",
  status: "success",
};

test("openDb is idempotent and creates the schema", async () => {
  const db = await openDb(":memory:");
  const again = () => db.exec("SELECT 1 FROM event LIMIT 0;");
  assert.doesNotThrow(again);
  db.close();
});

test("insertEvent stores computable elapsed", async () => {
  const db = await openDb(":memory:");
  insertEvent(db, sample);
  const row = db.prepare(`SELECT "end" - start AS elapsed FROM event`).get();
  assert.equal(row.elapsed, 500);
  db.close();
});

test("insertEvent round-trips the subcommand column", async () => {
  const db = await openDb(":memory:");
  insertEvent(db, { ...sample, tier: "claude-tool", hook: "Bash", command: "git", subcommand: "push" });
  const row = db.prepare("SELECT command, subcommand FROM event").get();
  assert.deepEqual({ ...row }, { command: "git", subcommand: "push" });
  db.close();
});

test("source_key dedupes on re-insert", async () => {
  const db = await openDb(":memory:");
  const ev = { ...sample, sourceKey: "run/1/2" };
  insertMany(db, [ev, ev]);
  const row = db.prepare("SELECT COUNT(*) AS n FROM event").get();
  assert.equal(row.n, 1);
  db.close();
});

test("recordMarker pairs pre then post via the pending table", async () => {
  const db = await openDb(":memory:");
  recordMarker(db, { phase: "pre", corr: "x", tier: "claude-tool", hook: "Bash", command: "npm", ts: 200 });
  const paired = recordMarker(db, { phase: "post", corr: "x", ts: 650, status: "success" });
  assert.equal(paired, true);
  const row = db.prepare(`SELECT start, "end" FROM event`).get();
  assert.deepEqual({ ...row }, { start: 200, end: 650 });
  db.close();
});
