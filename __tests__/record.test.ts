import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { insertMany, recordMarker } from "../lib/record.ts";

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), "hooker-record-"));
  return openDb(join(dir, "profile.db"));
}

test("insertMany rolls back and rethrows when a row is invalid", async () => {
  const db = await freshDb();
  const good = { start: 1, end: 2, tier: "t", hook: "h", command: "c" };
  // Force a failure mid-transaction (INSERT OR IGNORE would swallow a bad value or constraint,
  // so make reading the row itself throw) to exercise the rollback-and-rethrow path.
  const bad = {
    get start(): number {
      throw new Error("boom");
    },
    end: 2, tier: "t", hook: "h", command: "c",
  };
  assert.throws(() => insertMany(db, [good, bad]), /boom/);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM event").get() as { n: number };
  assert.equal(n, 0, "the good row must not survive the rolled-back transaction");
  // The transaction is closed (not left dangling), so a subsequent insert still works.
  assert.equal(insertMany(db, [good]), 1);
  db.close();
});

test("a post marker with no matching pre is a no-op", async () => {
  const db = await freshDb();
  const paired = recordMarker(db, {
    phase: "post",
    corr: "never-seen",
    tier: "claude-tool",
    hook: "PostToolUse",
    command: "Read",
    ts: 100,
  });
  assert.equal(paired, false);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM event").get() as { n: number };
  assert.equal(n, 0);
  db.close();
});
