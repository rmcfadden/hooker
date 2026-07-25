import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

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
  source_key TEXT
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

/** Open (creating the parent dir + schema) a WAL-mode SQLite database at path. */
export async function openDb(path) {
  await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout must precede the first write so journal_mode/schema retry instead of SQLITE_BUSY under concurrent opens.
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  return db;
}

/** Delete the database (and its WAL/SHM sidecars) and recreate it on the current schema. */
export async function resetDb(path) {
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${path}${suffix}`, { force: true });
  }
  return openDb(path);
}
