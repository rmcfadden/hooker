import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { insertEvent, insertMany, recordMarker } from "../lib/record.ts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

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
  const row = db.prepare(`SELECT "end" - start AS elapsed FROM event`).get() as { elapsed: number };
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
  const row = db.prepare("SELECT COUNT(*) AS n FROM event").get() as { n: number };
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

test("insertEvent defaults tokens to 0 / token_type to 'none', and stores provided values", async () => {
  const db = await openDb(":memory:");
  insertEvent(db, sample);
  insertEvent(db, { ...sample, start: 3000, tokens: 1200, tokenType: "claude" });
  const rows = db
    .prepare("SELECT tokens, token_type FROM event ORDER BY start")
    .all() as Array<{ tokens: number; token_type: string }>;
  assert.deepEqual({ ...rows[0] }, { tokens: 0, token_type: "none" });
  assert.deepEqual({ ...rows[1] }, { tokens: 1200, token_type: "claude" });
  db.close();
});

test("openDb backfills the token columns onto a pre-existing table", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hooker-migrate-"));
  const path = join(dir, "profile.db");
  // Simulate an older database whose event table predates the token columns.
  const legacy = new DatabaseSync(path);
  legacy.exec(
    `CREATE TABLE event (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, "end" INTEGER NOT NULL,
      tier TEXT NOT NULL, hook TEXT NOT NULL, command TEXT NOT NULL, subcommand TEXT, status TEXT, source_key TEXT)`,
  );
  legacy.prepare(`INSERT INTO event (start, "end", tier, hook, command) VALUES (1, 2, 't', 'h', 'c')`).run();
  legacy.close();

  const db = await openDb(path);
  const cols = new Set(
    (db.prepare("PRAGMA table_info(event)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  assert.ok(cols.has("tokens") && cols.has("token_type"), "migration added both columns");
  const row = db.prepare("SELECT tokens, token_type FROM event").get() as {
    tokens: number;
    token_type: string;
  };
  assert.equal(row.tokens, 0);
  assert.equal(row.token_type, "none");
  db.close();
});
