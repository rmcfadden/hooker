#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseFlags } from "../lib/args.mjs";
import { buildReport } from "../lib/aggregate.mjs";
import { durationMicros, nowMicros } from "../lib/clock.mjs";
import { openDb, resetDb } from "../lib/db.mjs";
import { ingestGithub } from "../lib/github.mjs";
import { generateEvents } from "../lib/mock.mjs";
import { dbPath, profileHome, reportsDir } from "../lib/paths.mjs";
import {
  insertEvent,
  insertMany,
  recordMarker,
  recordSplit,
} from "../lib/record.mjs";
import {
  formatDuration,
  rangeLabel,
  renderReport,
} from "../lib/report-html.mjs";
import {
  categoryStyle,
  colorEnabled,
  fitSegments,
  heatStyle,
  makePaint,
  tierStyle,
} from "../lib/ansi.mjs";
import { install, status, uninstall, upgrade } from "../lib/install.mjs";
import { serve } from "../lib/serve.mjs";
import {
  gitHookStatus,
  unwrapGitHooks,
  wrapGitHooks,
} from "../lib/install-git.mjs";
import {
  cursorStatus,
  installCursor,
  uninstallCursor,
} from "../lib/install-cursor.mjs";

const stdoutLine = (line) => process.stdout.write(`${line}\n`);

// Output sink — swappable so tests (or embedders) can capture CLI output instead of stdout.
let writeLine = stdoutLine;

/** Redirect CLI output; call with no args to restore the default stdout writer. */
export function setWriter(fn = stdoutLine) {
  writeLine = fn;
}

function out(line) {
  writeLine(line);
}

async function cmdInit() {
  const db = await openDb(dbPath());
  db.close();
  await mkdir(reportsDir(), { recursive: true });
  out(`hooker: initialized ${dbPath()}`);
}

async function cmdReset() {
  const db = await resetDb(dbPath());
  db.close();
  out(`hooker: reset ${dbPath()} (dropped all events)`);
}

function eventFromFlags(flags) {
  const base = {
    tier: flags.tier,
    hook: flags.hook,
    command: flags.command,
    status: flags.status ?? "success",
  };
  if (flags.phase) {
    return {
      phase: flags.phase,
      corr: flags.corr,
      key: flags.key,
      ts: Number(flags.end ?? flags.start),
      ...base,
    };
  }
  return { ...base, start: Number(flags.start), end: Number(flags.end) };
}

async function cmdRecord(flags) {
  const event = eventFromFlags(flags);
  const db = await openDb(dbPath());
  if (flags.split) {
    recordSplit(db, { ...event, source: event.command });
  } else if (event.phase) {
    recordMarker(db, event);
  } else {
    insertEvent(db, event);
  }
  db.close();
}

async function cmdIngest(flags) {
  const db = await openDb(dbPath());
  const opts = { since: flags.since, repo: flags.repo };
  out(
    `hooker: ingested ${await ingestGithub(db, opts)} GitHub Actions events`,
  );
  db.close();
}

async function cmdMock(flags) {
  const count = Number(flags.count ?? 5000);
  const last = flags.last ?? "30d";
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

function waitNote(report, paint) {
  if (report.wait.count === 0) {
    return "";
  }
  const text = report.includeWait
    ? `(includes ${report.wait.count} wait events, ${formatDuration(report.wait.total)})`
    : `(excludes ${report.wait.count} wait events, ${formatDuration(report.wait.total)} — pass --include-wait)`;
  return `  ${paint(text, "dim")}`;
}

const COL_STYLE = { tier: tierStyle, category: categoryStyle };
const LABEL_WIDTH = 48;

/** `tier › command › subcommand` as paintable segments (tier/category tinted, separators dimmed). */
function labelSegments(report, g) {
  const segments = [];
  for (const col of report.groupCols) {
    const val = g[col];
    if (val == null || val === "") {
      continue;
    }
    if (segments.length > 0) {
      segments.push({ text: " › ", style: "dim" });
    }
    segments.push({ text: String(val), style: COL_STYLE[col]?.(val) ?? null });
  }
  return segments;
}

function printReport(report, paint) {
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

async function cmdReport(flags) {
  const db = await openDb(dbPath());
  const group =
    typeof flags.group === "string" ? flags.group.split(",") : undefined;
  const includeWait = Boolean(flags["include-wait"] ?? flags.wait);
  const report = buildReport(db, {
    from: flags.from,
    to: flags.to,
    last: flags.last,
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

async function cmdServe(flags) {
  const result = await serve({
    port: flags.port != null ? Number(flags.port) : undefined,
    host: flags.host,
  });
  out(`hooker: serving report UI + API at ${result.url} (Ctrl-C to stop)`);
  return result;
}

function isCursor(flags) {
  return flags.host === "cursor";
}

function cursorOpts(flags) {
  return {
    target: flags.target ?? process.cwd(),
    home: profileHome,
    global: Boolean(flags.global),
  };
}

async function cmdInstall(flags) {
  if (isCursor(flags)) {
    out(
      `hooker: wired cursor recorders into ${await installCursor(cursorOpts(flags))}`,
    );
    return;
  }
  const target = flags.target ?? process.cwd();
  const files = await install({
    target,
    home: profileHome,
    wrapHooks: Boolean(flags["wrap-hooks"]),
  });
  out(`hooker: wired recorders into ${files.join(", ")}`);
}

async function cmdUpgrade(flags) {
  if (isCursor(flags)) {
    const file = await installCursor(cursorOpts(flags));
    out(
      `hooker: upgraded cursor — events=[${(await cursorStatus(cursorOpts(flags))).events.join(", ")}] in ${file}`,
    );
    return;
  }
  const target = flags.target ?? process.cwd();
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

async function cmdInstallGit(flags) {
  const target = flags.target ?? process.cwd();
  const files = await wrapGitHooks({ target, home: profileHome });
  out(
    `hooker: wrapped git-hook steps in ${files.join(", ") || "(no git hooks found)"}`,
  );
}

async function cmdUninstallGit(flags) {
  const target = flags.target ?? process.cwd();
  const files = await unwrapGitHooks({ target, home: profileHome });
  out(
    `hooker: unwrapped git hooks in ${files.join(", ") || "(no git hooks found)"}`,
  );
}

async function cmdStatus(flags) {
  if (isCursor(flags)) {
    out(
      `hooker: cursor events=[${(await cursorStatus(cursorOpts(flags))).events.join(", ")}]`,
    );
    return;
  }
  const target = flags.target ?? process.cwd();
  const info = await status({ target });
  const gitSteps = await gitHookStatus({ target });
  out(
    `hooker: recorders=[${info.recorders.join(", ")}] wrapped-hooks=${info.wrapped} git-steps=${gitSteps}`,
  );
}

async function cmdUninstall(flags) {
  if (isCursor(flags)) {
    out(
      `hooker: removed cursor recorders from ${await uninstallCursor(cursorOpts(flags))}`,
    );
    return;
  }
  const files = await uninstall({ target: flags.target ?? process.cwd() });
  out(`hooker: removed profile entries from ${files.join(", ")}`);
}

const COMMANDS = {
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

export async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseFlags(argv);
  const command = COMMANDS[positional[0]];
  if (!command) {
    out(
      "usage: hooker <init|reset|record|ingest|mock|report|serve|install|upgrade|update|uninstall|install-git|uninstall-git|status> [flags]",
    );
    process.exitCode = positional[0] ? 1 : 0;
    return;
  }
  return command(flags);
}

// Only auto-run when executed as the CLI entry point, so tests can import main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`hooker: ${err.stack ?? err}\n`);
    process.exit(1);
  });
}
