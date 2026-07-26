#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseFlags } from "../lib/args.ts";
import { buildReport } from "../lib/aggregate.ts";
import { durationMicros, nowMicros } from "../lib/clock.ts";
import { openDb, resetDb } from "../lib/db.ts";
import { ingestGithub } from "../lib/github.ts";
import { generateEvents } from "../lib/mock.ts";
import { dbPath, profileHome, reportsDir } from "../lib/paths.ts";
import {
  insertEvent,
  insertMany,
  recordMarker,
  recordSplit,
} from "../lib/record.ts";
import {
  formatDuration,
  rangeLabel,
  renderReport,
} from "../lib/report-html.ts";
import {
  categoryStyle,
  colorEnabled,
  fitSegments,
  heatStyle,
  makePaint,
  tierStyle,
} from "../lib/ansi.ts";
import { install, status, uninstall, upgrade } from "../lib/install.ts";
import { serve } from "../lib/serve.ts";
import {
  gitHookStatus,
  unwrapGitHooks,
  wrapGitHooks,
} from "../lib/install-git.ts";
import {
  cursorStatus,
  installCursor,
  uninstallCursor,
} from "../lib/install-cursor.ts";
import type { Flags, Paint, Report, ReportGroup, Segment } from "../lib/types.ts";

const stdoutLine = (line: string): boolean => process.stdout.write(`${line}\n`);

// Output sink — swappable so tests (or embedders) can capture CLI output instead of stdout.
let writeLine: (line: string) => unknown = stdoutLine;

/** Redirect CLI output; call with no args to restore the default stdout writer. */
export function setWriter(fn: (line: string) => unknown = stdoutLine): void {
  writeLine = fn;
}

function out(line: string): void {
  writeLine(line);
}

/** A flag's string value, or "" when it's absent or a bare boolean flag. */
function str(v: string | boolean | undefined): string {
  return typeof v === "string" ? v : "";
}

/** A flag's string value, or undefined when it's absent or a bare boolean flag. */
function strOpt(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

async function cmdInit(): Promise<void> {
  const db = await openDb(dbPath());
  db.close();
  await mkdir(reportsDir(), { recursive: true });
  out(`hooker: initialized ${dbPath()}`);
}

async function cmdReset(): Promise<void> {
  const db = await resetDb(dbPath());
  db.close();
  out(`hooker: reset ${dbPath()} (dropped all events)`);
}

async function cmdRecord(flags: Flags): Promise<void> {
  const tier = str(flags.tier);
  const hook = str(flags.hook);
  const command = str(flags.command);
  const status = typeof flags.status === "string" ? flags.status : "success";
  const tokens = flags.tokens != null ? Number(flags.tokens) : 0;
  const tokenType = strOpt(flags["token-type"]) ?? "none";
  const db = await openDb(dbPath());
  if (flags.split) {
    recordSplit(db, {
      tier,
      hook,
      source: command,
      status,
      start: Number(flags.start),
      end: Number(flags.end),
      tokens,
      tokenType,
    });
  } else if (flags.phase) {
    recordMarker(db, {
      phase: flags.phase === "post" ? "post" : "pre",
      corr: str(flags.corr),
      key: str(flags.key),
      tier,
      hook,
      command,
      status,
      ts: Number(flags.end ?? flags.start),
      tokens,
      tokenType,
    });
  } else {
    insertEvent(db, {
      tier,
      hook,
      command,
      status,
      start: Number(flags.start),
      end: Number(flags.end),
      tokens,
      tokenType,
    });
  }
  db.close();
}

async function cmdIngest(flags: Flags): Promise<void> {
  const db = await openDb(dbPath());
  const opts = { since: strOpt(flags.since), repo: strOpt(flags.repo) };
  out(`hooker: ingested ${await ingestGithub(db, opts)} GitHub Actions events`);
  db.close();
}

async function cmdMock(flags: Flags): Promise<void> {
  const count = Number(flags.count ?? 5000);
  const last = strOpt(flags.last) ?? "30d";
  const seed = flags.seed != null ? Number(flags.seed) : nowMicros() >>> 0;
  const db = flags.reset ? await resetDb(dbPath()) : await openDb(dbPath());
  const events = generateEvents({
    count,
    windowMicros: durationMicros(last),
    now: nowMicros(),
    seed,
  });
  insertMany(db, events);
  db.close();
  out(
    `hooker: inserted ${events.length} mock events over the last ${last} (${flags.reset ? "reset" : "appended"})`,
  );
}

function waitNote(report: Report, paint: Paint): string {
  if (report.wait.count === 0) {
    return "";
  }
  const text = report.includeWait
    ? `(includes ${report.wait.count} wait events, ${formatDuration(report.wait.total)})`
    : `(excludes ${report.wait.count} wait events, ${formatDuration(report.wait.total)} — pass --include-wait)`;
  return `  ${paint(text, "dim")}`;
}

const COL_STYLE: Record<string, (value: string) => Segment["style"]> = {
  tier: tierStyle,
  category: categoryStyle,
};
const LABEL_WIDTH = 48;

/** `tier › command › subcommand` as paintable segments (tier/category tinted, separators dimmed). */
function labelSegments(report: Report, g: ReportGroup): Segment[] {
  const segments: Segment[] = [];
  for (const col of report.groupCols) {
    const val = g[col];
    if (val == null || val === "") {
      continue;
    }
    if (segments.length > 0) {
      segments.push({ text: " › ", style: "dim" });
    }
    segments.push({ text: String(val), style: COL_STYLE[col]?.(String(val)) ?? null });
  }
  return segments;
}

function printReport(report: Report, paint: Paint): void {
  const t = report.totals;
  out(
    `${paint("Range", "bold")} ${paint(rangeLabel(report), "cyan")}  ${t.count} events  ` +
      `${paint(formatDuration(t.total), heatStyle(t.total))} total  ${t.failures} failures${waitNote(report, paint)}`,
  );
  for (const g of report.groups) {
    const label = fitSegments(labelSegments(report, g), LABEL_WIDTH, paint);
    out(
      `  ${label}${paint(String(g.count).padStart(5), "dim")}  ` +
        `${paint(formatDuration(g.total).padStart(10), heatStyle(g.total))}  ` +
        `avg ${formatDuration(g.avg).padStart(10)}`,
    );
  }
}

async function cmdReport(flags: Flags): Promise<void> {
  const db = await openDb(dbPath());
  const group = typeof flags.group === "string" ? flags.group.split(",") : undefined;
  const includeWait = Boolean(flags["include-wait"] ?? flags.wait);
  const report = buildReport(db, {
    from: strOpt(flags.from),
    to: strOpt(flags.to),
    last: strOpt(flags.last),
    group,
    includeWait,
  });
  db.close();
  if (flags.html) {
    await mkdir(reportsDir(), { recursive: true });
    const slug = rangeLabel(report).replace(/[^\w.-]+/g, "_");
    const file = join(reportsDir(), `report-${slug}.html`);
    await writeFile(file, renderReport(report), "utf8");
    out(`hooker: wrote ${file}`);
  } else {
    printReport(report, makePaint(colorEnabled(flags)));
  }
}

async function cmdServe(flags: Flags): Promise<{ server: import("node:http").Server; url: string }> {
  const result = await serve({
    port: flags.port != null ? Number(flags.port) : undefined,
    host: strOpt(flags.host),
  });
  out(`hooker: serving report UI + API at ${result.url} (Ctrl-C to stop)`);
  return result;
}

function isCursor(flags: Flags): boolean {
  return flags.host === "cursor";
}

function cursorOpts(flags: Flags): { target: string; home: string; global: boolean } {
  return {
    target: strOpt(flags.target) ?? process.cwd(),
    home: profileHome,
    global: Boolean(flags.global),
  };
}

async function cmdInstall(flags: Flags): Promise<void> {
  if (isCursor(flags)) {
    out(`hooker: wired cursor recorders into ${await installCursor(cursorOpts(flags))}`);
    return;
  }
  const target = strOpt(flags.target) ?? process.cwd();
  const files = await install({
    target,
    home: profileHome,
    wrapHooks: Boolean(flags["wrap-hooks"]),
  });
  out(`hooker: wired recorders into ${files.join(", ")}`);
}

async function cmdUpgrade(flags: Flags): Promise<void> {
  if (isCursor(flags)) {
    const file = await installCursor(cursorOpts(flags));
    out(
      `hooker: upgraded cursor — events=[${(await cursorStatus(cursorOpts(flags))).events.join(", ")}] in ${file}`,
    );
    return;
  }
  const target = strOpt(flags.target) ?? process.cwd();
  await upgrade({
    target,
    home: profileHome,
    wrapHooks: Boolean(flags["wrap-hooks"]),
    git: Boolean(flags.git),
  });
  const info = await status({ target });
  const gitSteps = await gitHookStatus({ target });
  out(
    `hooker: upgraded — recorders=[${info.recorders.join(", ")}] wrapped-hooks=${info.wrapped} git-steps=${gitSteps}`,
  );
}

async function cmdInstallGit(flags: Flags): Promise<void> {
  const target = strOpt(flags.target) ?? process.cwd();
  const files = await wrapGitHooks({ target, home: profileHome });
  out(`hooker: wrapped git-hook steps in ${files.join(", ") || "(no git hooks found)"}`);
}

async function cmdUninstallGit(flags: Flags): Promise<void> {
  const target = strOpt(flags.target) ?? process.cwd();
  const files = await unwrapGitHooks({ target });
  out(`hooker: unwrapped git hooks in ${files.join(", ") || "(no git hooks found)"}`);
}

async function cmdStatus(flags: Flags): Promise<void> {
  if (isCursor(flags)) {
    out(`hooker: cursor events=[${(await cursorStatus(cursorOpts(flags))).events.join(", ")}]`);
    return;
  }
  const target = strOpt(flags.target) ?? process.cwd();
  const info = await status({ target });
  const gitSteps = await gitHookStatus({ target });
  out(
    `hooker: recorders=[${info.recorders.join(", ")}] wrapped-hooks=${info.wrapped} git-steps=${gitSteps}`,
  );
}

async function cmdUninstall(flags: Flags): Promise<void> {
  if (isCursor(flags)) {
    out(`hooker: removed cursor recorders from ${await uninstallCursor(cursorOpts(flags))}`);
    return;
  }
  const files = await uninstall({ target: strOpt(flags.target) ?? process.cwd() });
  out(`hooker: removed profile entries from ${files.join(", ")}`);
}

type Handler = (flags: Flags) => Promise<unknown>;

const COMMANDS: Record<string, Handler> = {
  init: cmdInit,
  reset: cmdReset,
  record: cmdRecord,
  ingest: cmdIngest,
  mock: cmdMock,
  report: cmdReport,
  serve: cmdServe,
  install: cmdInstall,
  upgrade: cmdUpgrade,
  update: cmdUpgrade,
  uninstall: cmdUninstall,
  "install-git": cmdInstallGit,
  "uninstall-git": cmdUninstallGit,
  status: cmdStatus,
};

export async function main(argv: string[] = process.argv.slice(2)): Promise<unknown> {
  const { positional, flags } = parseFlags(argv);
  const name = positional[0];
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    out(
      "usage: hooker <init|reset|record|ingest|mock|report|serve|install|upgrade|update|uninstall|install-git|uninstall-git|status> [flags]",
    );
    process.exitCode = name ? 1 : 0;
    return;
  }
  return command(flags);
}

// Only auto-run when executed as the CLI entry point, so tests can import main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`hooker: ${detail}\n`);
    process.exit(1);
  });
}
