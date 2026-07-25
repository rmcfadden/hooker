import { boundMicros, durationMicros, nowMicros } from "./clock.ts";
import { categorize, subcategorize } from "./categories.ts";
import { isWaitTier } from "./tiers.ts";
import type {
  CategorizedRow,
  CellValue,
  Db,
  EventRow,
  GroupCol,
  Report,
  ReportGroup,
  ReportOptions,
  Totals,
} from "./types.ts";

/**
 * Half-open epoch-µs window. `last` (e.g. `2h`) wins and yields `[now - last, now)`. Otherwise
 * `from`/`to` accept a day (`2026-07-22`, whole day) or a second-precise datetime
 * (`2026-07-22T14:30:00`); a missing bound is unbounded.
 */
export function rangeMicros(
  from: string | undefined,
  to: string | undefined,
  last: string | undefined,
): { lo: number; hi: number } {
  if (last) {
    return {
      lo: nowMicros() - durationMicros(last),
      hi: Number.MAX_SAFE_INTEGER,
    };
  }
  const lo = from ? boundMicros(from) : 0;
  const hi = to ? boundMicros(to, { end: true }) : Number.MAX_SAFE_INTEGER;
  return { lo, hi };
}

const DEFAULT_GROUP: GroupCol[] = ["tier", "category", "subcategory", "command"];

/** Rows in the window with elapsed pre-computed as `"end" - start` (microseconds). */
export function selectRange(db: Db, lo: number, hi: number): EventRow[] {
  return db
    .prepare(
      `SELECT start, "end" - start AS elapsed, tier, hook, command, subcommand, status
       FROM event WHERE start >= ? AND start < ? ORDER BY start`,
    )
    .all(lo, hi) as unknown as EventRow[];
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)] ?? 0;
}

function isFailure(status: string | null): boolean {
  return status != null && status !== "success";
}

/** Read a grouping column off a row without a static key (columns come from user input). */
function cellOf(row: CategorizedRow, col: GroupCol): CellValue {
  return (row as unknown as Record<string, CellValue>)[col] ?? null;
}

interface Bucket {
  key: Record<string, CellValue>;
  elapsed: number[];
  failures: number;
}

function summarize(
  key: Record<string, CellValue>,
  elapsed: number[],
  failures: number,
): ReportGroup {
  const sorted = [...elapsed].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  return {
    ...key,
    count: sorted.length,
    total,
    avg: Math.round(total / sorted.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    failures,
  };
}

/** Group rows by the chosen columns and compute count/total/avg/p50/p95/failures per group. */
export function aggregate(
  rows: CategorizedRow[],
  groupCols: GroupCol[] = DEFAULT_GROUP,
): ReportGroup[] {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const key = groupCols.map((col) => cellOf(row, col)).join(" ");
    const bucket = buckets.get(key) ?? { key: {}, elapsed: [], failures: 0 };
    for (const col of groupCols) {
      bucket.key[col] = cellOf(row, col);
    }
    bucket.elapsed.push(row.elapsed);
    bucket.failures += isFailure(row.status) ? 1 : 0;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((b) => summarize(b.key, b.elapsed, b.failures))
    .sort((a, b) => b.total - a.total);
}

function totalsOf(rows: EventRow[]): Totals {
  return {
    count: rows.length,
    total: rows.reduce((sum, r) => sum + r.elapsed, 0),
    failures: rows.filter((r) => isFailure(r.status)).length,
  };
}

/** Full report payload for a window: grouped rows + grand totals. Wait-tier rows (user think-time)
 * are excluded from the groups and totals unless `includeWait`; either way the split-out wait
 * totals ride along under `wait` so the report can surface what was set aside. */
export function buildReport(db: Db, options: ReportOptions = {}): Report {
  const { from, to, last, group, includeWait = false } = options;
  const { lo, hi } = rangeMicros(from, to, last);
  const all: CategorizedRow[] = selectRange(db, lo, hi).map((r) => ({
    ...r,
    category: categorize(r),
    subcategory: subcategorize(r),
  }));
  const wait = all.filter((r) => isWaitTier(r.tier));
  const rows = includeWait ? all : all.filter((r) => !isWaitTier(r.tier));
  const groupCols = group ?? DEFAULT_GROUP;
  return {
    from,
    to,
    last,
    includeWait,
    groupCols,
    groups: aggregate(rows, groupCols),
    totals: totalsOf(rows),
    wait: totalsOf(wait),
  };
}
