import { toEvents } from "./command-label.mjs";

const INSERT_EVENT = `INSERT OR IGNORE INTO event (start, "end", tier, hook, command, subcommand, status, source_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/** Insert one completed event; ignored when its source_key already exists (idempotent re-ingest). */
export function insertEvent(db, ev) {
  db.prepare(INSERT_EVENT).run(
    ev.start,
    ev.end,
    ev.tier,
    ev.hook,
    ev.command,
    ev.subcommand ?? null,
    ev.status ?? null,
    ev.sourceKey ?? null,
  );
}

/** Insert many events in one transaction, rolling back on any failure. Returns the count. */
export function insertMany(db, events) {
  db.exec("BEGIN");
  try {
    for (const ev of events) {
      insertEvent(db, ev);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return events.length;
}

/** Insert a completed activity, deriving command/subcommand (and Bash &&-split) from its raw source. */
export function recordSplit(db, { tier, hook, source, start, end, status }) {
  return insertMany(db, toEvents({ tier, hook, source, start, end, status }));
}

/** Direct-SQLite pre/post pairing via the pending table (needs a stable corr, e.g. tool_use_id). */
export function recordMarker(db, marker) {
  if (marker.phase === "pre") {
    db.prepare(
      "INSERT OR REPLACE INTO pending (corr, tier, hook, command, start) VALUES (?, ?, ?, ?, ?)",
    ).run(marker.corr, marker.tier, marker.hook, marker.raw ?? marker.command, marker.ts);
    return false;
  }
  const pre = db
    .prepare("SELECT tier, hook, command, start FROM pending WHERE corr = ?")
    .get(marker.corr);
  if (!pre) {
    return false;
  }
  db.prepare("DELETE FROM pending WHERE corr = ?").run(marker.corr);
  const events = toEvents({
    tier: pre.tier,
    hook: pre.hook,
    source: pre.command,
    start: pre.start,
    end: marker.ts,
    status: marker.status,
  });
  for (const ev of events) {
    insertEvent(db, ev);
  }
  return true;
}
