import { dirname, join } from "node:path";
import { buildReport } from "./aggregate.ts";
import { nowMicros } from "./clock.ts";
import { openDb } from "./db.ts";
import { dbPath } from "./paths.ts";
import { isRecordingEnabled, setRecordingEnabled } from "./state.ts";
import type { Db, Report, ReportOptions } from "./types.ts";

/** Now plus the epoch-µs span of recorded events — bounds the report pickers. */
export interface Meta {
  now: number;
  min: number | null;
  max: number | null;
  count: number;
}

/** {@link Meta} plus whether recording is currently enabled — the `/api/status` payload. */
export interface Status extends Meta {
  recording: boolean;
}

/** Options for {@link createService}. */
export interface ServiceOptions {
  /** SQLite file to open; defaults to the project's {@link dbPath}. */
  path?: string | undefined;
  /** Recording-state file; defaults to `state.json` beside the db so the service is self-contained. */
  statePath?: string | undefined;
}

/**
 * A connection to the datasource bundled with the read (report/meta) and recording-state
 * (enable/disable) operations. The HTTP server in `serve.ts` is built on this; embedders can
 * use it directly. Holds one WAL connection open until {@link HookerService.close}.
 */
export interface HookerService {
  /** Aggregated report for a window — same payload as `hooker report` / `GET /api/report`. */
  report(options?: ReportOptions): Report;
  /** Now plus the recorded-event span and count. */
  meta(): Meta;
  /** {@link meta} plus the current recording flag. */
  status(): Promise<Status>;
  /** Whether recording is currently enabled. */
  isEnabled(): Promise<boolean>;
  /** Turn recording on/off; resolves to the new state. */
  setEnabled(enabled: boolean): Promise<boolean>;
  /** Release the underlying connection. */
  close(): void;
}

interface MetaRow {
  min: number | null;
  max: number | null;
  count: number;
}

function readMeta(db: Db): Meta {
  const row = db
    .prepare(`SELECT MIN(start) AS min, MAX("end") AS max, COUNT(*) AS count FROM event`)
    .get() as unknown as MetaRow;
  return { now: nowMicros(), min: row.min, max: row.max, count: row.count };
}

/**
 * Open the datasource and return a {@link HookerService} over it. The state file defaults to
 * `state.json` alongside the db, so a service pointed at a temp db toggles an isolated flag; in
 * normal use (`path === dbPath()`) it resolves to the same file the CLI uses.
 */
export async function createService({
  path = dbPath(),
  statePath = join(dirname(path), "state.json"),
}: ServiceOptions = {}): Promise<HookerService> {
  const db = await openDb(path);
  return {
    report: (options = {}) => buildReport(db, options),
    meta: () => readMeta(db),
    status: async () => ({ ...readMeta(db), recording: await isRecordingEnabled(statePath) }),
    isEnabled: () => isRecordingEnabled(statePath),
    setEnabled: async (enabled) => {
      await setRecordingEnabled(enabled, statePath);
      return enabled;
    },
    close: () => db.close(),
  };
}
