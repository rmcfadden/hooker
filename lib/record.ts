import { toEvents } from "./command-label.ts";
import type { Db, EventInput, MarkerEvent, TokenType, Tier } from "./types.ts";

const INSERT_EVENT = `INSERT OR IGNORE INTO event (start, "end", tier, hook, command, subcommand, status, source_key, tokens, token_type)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Insert one completed event; ignored when its source_key already exists (idempotent re-ingest). */
export function insertEvent(db: Db, ev: EventInput): void {
  db.prepare(INSERT_EVENT).run(
    ev.start,
    ev.end,
    ev.tier,
    ev.hook,
    ev.command,
    ev.subcommand ?? null,
    ev.status ?? null,
    ev.sourceKey ?? null,
    ev.tokens ?? 0,
    ev.tokenType ?? "none",
  );
}

/** Insert many events in one transaction, rolling back on any failure. Returns the count. */
export function insertMany(db: Db, events: EventInput[]): number {
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

/** Arguments for {@link recordSplit}: a raw activity to derive and insert. */
export interface RecordSplitArgs {
  tier: Tier;
  hook: string;
  source: string;
  start: number;
  end: number;
  status?: string | null | undefined;
  tokens?: number | null | undefined;
  tokenType?: TokenType | null | undefined;
}

/** Insert a completed activity, deriving command/subcommand (and Bash &&-split) from its raw source. */
export function recordSplit(
  db: Db,
  { tier, hook, source, start, end, status, tokens, tokenType }: RecordSplitArgs,
): number {
  return insertMany(db, toEvents({ tier, hook, source, start, end, status, tokens, tokenType }));
}

/** One row of the `pending` table — a pre marker awaiting its post. */
interface PendingRow {
  tier: string;
  hook: string;
  command: string;
  start: number;
}

/** Direct-SQLite pre/post pairing via the pending table (needs a stable corr, e.g. tool_use_id). */
export function recordMarker(db: Db, marker: MarkerEvent): boolean {
  if (marker.phase === "pre") {
    db.prepare(
      "INSERT OR REPLACE INTO pending (corr, tier, hook, command, start) VALUES (?, ?, ?, ?, ?)",
    ).run(
      marker.corr,
      marker.tier ?? "",
      marker.hook ?? "",
      marker.raw ?? marker.command ?? "",
      marker.ts,
    );
    return false;
  }
  const pre = db
    .prepare("SELECT tier, hook, command, start FROM pending WHERE corr = ?")
    .get(marker.corr) as PendingRow | undefined;
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
    tokens: marker.tokens,
    tokenType: marker.tokenType,
  });
  for (const ev of events) {
    insertEvent(db, ev);
  }
  return true;
}
