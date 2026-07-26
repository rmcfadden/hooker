import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Db } from "./types.ts";

// node:sqlite is still gated behind require() rather than a bare import in the supported Node range.
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS event (
  id         INTEGER PRIMARY KEY,
  start      INTEGER NOT NULL,
  "end"      INTEGER NOT NULL,
  tier       TEXT    NOT NULL,
  hook       TEXT    NOT NULL,
  command    TEXT    NOT NULL,
  subcommand TEXT,
  status     TEXT,
  source_key TEXT,
  tokens     INTEGER NOT NULL DEFAULT 0,
  token_type TEXT    NOT NULL DEFAULT 'none'
);
CREATE UNIQUE INDEX IF NOT EXISTS event_dedupe ON event(source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_start ON event(start);
CREATE TABLE IF NOT EXISTS pending (
  corr    TEXT PRIMARY KEY,
  tier    TEXT NOT NULL,
  hook    TEXT NOT NULL,
  command TEXT NOT NULL,
  start   INTEGER NOT NULL
);
`;

/** Columns added to `event` after its first release — applied to pre-existing tables via ALTER. */
const MIGRATIONS = [
  { name: "tokens", ddl: "ALTER TABLE event ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0" },
  { name: "token_type", ddl: "ALTER TABLE event ADD COLUMN token_type TEXT NOT NULL DEFAULT 'none'" },
];

/** Add any columns missing from an already-created `event` table (CREATE IF NOT EXISTS won't). */
function migrate(db: Db): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(event)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const { name, ddl } of MIGRATIONS) {
    if (!columns.has(name)) {
      db.exec(ddl);
    }
  }
}

/** Open (creating the parent dir + schema) a WAL-mode SQLite database at path. */
export async function openDb(path: string): Promise<Db> {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout must precede the first write so journal_mode/schema retry instead of SQLITE_BUSY under concurrent opens.
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Delete the database (and its WAL/SHM sidecars) and recreate it on the current schema. */
export async function resetDb(path: string): Promise<Db> {
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${path}${suffix}`, { force: true });
  }
  return openDb(path);
}
