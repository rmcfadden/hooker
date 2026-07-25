import type { DatabaseSync } from "node:sqlite";

/** A node:sqlite database handle (the whole app uses the synchronous API). */
export type Db = DatabaseSync;

/** Recorded activity tier. Open-ended (hooks can emit their own), with the known ones spelled out. */
export type Tier =
  | "claude-tool"
  | "claude-hook"
  | "git-hook"
  | "github-action"
  | "claude-wait"
  | (string & {});

/** Parsed CLI flags: `--k v` / `--k=v` become strings, bare `--flag` becomes `true`. */
export type Flags = Record<string, string | boolean>;

/** A completed activity ready to insert. Optional fields may be omitted or explicitly null. */
export interface EventInput {
  start: number;
  end: number;
  tier: Tier;
  hook: string;
  command: string;
  subcommand?: string | null;
  status?: string | null;
  sourceKey?: string | null;
}

/** A pre/post marker paired through the `pending` table (Direct-SQLite recorder path). */
export interface MarkerEvent {
  phase: "pre" | "post";
  corr: string;
  tier: Tier;
  hook: string;
  command: string;
  raw?: string;
  ts: number;
  status?: string | null;
  key?: string;
}

/** A row selected from `event` with elapsed pre-computed (`"end" - start`, microseconds). */
export interface EventRow {
  start: number;
  elapsed: number;
  tier: string;
  hook: string;
  command: string;
  subcommand: string | null;
  status: string | null;
}

/** An {@link EventRow} tagged with its derived category/subcategory for grouping. */
export interface CategorizedRow extends EventRow {
  category: string;
  subcategory: string;
}

/** The minimal shape categorize()/subcategorize() need — a subset of a recorded row. */
export interface CategorizableRow {
  tier: string;
  hook: string;
  command: string;
  subcommand?: string | null;
}

/** A cell value produced by grouping — text columns, numeric stats, or a missing column. */
export type CellValue = string | number | null;

/** A column name to group a report by (a key of the categorized row). */
export type GroupCol = string;

/** Grand totals over a set of rows. */
export interface Totals {
  count: number;
  total: number;
  failures: number;
}

/** One grouped row: the grouped key columns plus per-group timing stats. */
export interface ReportGroup {
  [col: string]: string | number | null | undefined;
  count: number;
  total: number;
  avg: number;
  p50: number;
  p95: number;
  failures: number;
}

/** Options accepted by buildReport() and the `/api/report` endpoint. */
export interface ReportOptions {
  from?: string | undefined;
  to?: string | undefined;
  last?: string | undefined;
  group?: GroupCol[] | undefined;
  includeWait?: boolean | undefined;
}

/** The full report payload: the window, grouped rows, grand totals, and split-out wait time. */
export interface Report {
  from: string | undefined;
  to: string | undefined;
  last: string | undefined;
  includeWait: boolean;
  groupCols: GroupCol[];
  groups: ReportGroup[];
  totals: Totals;
  wait: Totals;
}

/** ANSI style names understood by the painter. */
export type StyleName =
  | "reset"
  | "bold"
  | "dim"
  | "gray"
  | "red"
  | "green"
  | "yellow"
  | "cyan"
  | "indigo"
  | "amber"
  | "purple";

/** A painter: wraps text in named ANSI styles, or returns it untouched when disabled. */
export type Paint = (
  text: string | number,
  ...styles: Array<StyleName | null | undefined>
) => string;

/** One paintable label segment for a fixed-width column. */
export interface Segment {
  text: string;
  style: StyleName | null;
}
