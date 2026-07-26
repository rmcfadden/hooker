import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, setWriter } from "../bin/hooker.ts";
import { openDb } from "../lib/db.ts";
import { withFakeGh } from "./fake-gh.ts";

// Isolate every CLI invocation from the user's real ~/.profile data.
const DATA = mkdtempSync(join(tmpdir(), "hooker-cli-"));
process.env.PROFILE_DATA_DIR = DATA;

/** Run the CLI with argv, capturing the lines it writes (via the swappable output sink). */
async function run(...argv: string[]): Promise<{ out: string; result: unknown }> {
  let buf = "";
  setWriter((line) => {
    buf += `${line}\n`;
  });
  try {
    const result = await main(argv);
    return { out: buf, result };
  } finally {
    setWriter();
  }
}

async function eventCount(): Promise<number> {
  const db = await openDb(join(DATA, "profile.db"));
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM event").get() as { n: number };
  db.close();
  return n;
}

// One parent test with awaited subtests: the CLI mutates shared process/DB state
// (stdout, PROFILE_DATA_DIR, exit code), so the steps must run strictly in order.
test("hooker CLI", async (t) => {
  await t.test("no command prints usage and exits 0", async () => {
    process.exitCode = 0;
    const { out } = await run();
    assert.match(out, /usage: hooker/);
    assert.equal(process.exitCode, 0);
  });

  await t.test("an unknown command prints usage and sets exit code 1", async () => {
    process.exitCode = 0;
    const { out } = await run("wat");
    assert.match(out, /usage: hooker/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  await t.test("init creates the database", async () => {
    const { out } = await run("init");
    assert.match(out, /initialized/);
    const db = await openDb(join(DATA, "profile.db"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    db.close();
    assert.ok(tables.some((c) => c.name === "event"));
  });

  await t.test("mock --reset seeds deterministic events", async () => {
    const { out } = await run("mock", "--count", "40", "--reset", "--seed", "7", "--last", "10d");
    assert.match(out, /inserted 40 mock events/);
    assert.equal(await eventCount(), 40);
  });

  await t.test("report prints a text summary with a range and totals", async () => {
    const { out } = await run("report", "--last", "30d", "--group", "tier", "--no-color");
    assert.match(out, /Range/);
    assert.match(out, /events/);
  });

  await t.test("report --html writes a self-contained file", async () => {
    const { out } = await run("report", "--html", "--last", "30d");
    assert.match(out, /wrote .*\.html/);
    const files = await readdir(join(DATA, "reports"));
    const html = files.find((f) => f.endsWith(".html"));
    assert.ok(html);
    assert.match(await readFile(join(DATA, "reports", html), "utf8"), /<!doctype html>/i);
  });

  await t.test("record inserts a completed event", async () => {
    const before = await eventCount();
    await run(
      "record",
      "--tier", "claude-tool",
      "--hook", "PostToolUse",
      "--command", "Bash",
      "--start", "1000",
      "--end", "1500",
    );
    assert.equal(await eventCount(), before + 1);
  });

  await t.test("record --split derives events from a raw command", async () => {
    await run(
      "record",
      "--split",
      "--tier", "git-hook",
      "--hook", "pre-commit",
      "--command", "npm run lint && npm test",
      "--start", "2000",
      "--end", "3000",
    );
    const db = await openDb(join(DATA, "profile.db"));
    const rows = db.prepare("SELECT command FROM event WHERE tier='git-hook'").all();
    db.close();
    assert.ok(rows.length >= 2);
  });

  await t.test("record --phase pairs a pre/post marker into one event", async () => {
    await run(
      "record", "--phase", "pre", "--corr", "abc",
      "--tier", "claude-tool", "--hook", "PreToolUse", "--command", "Read", "--start", "5000",
    );
    await run(
      "record", "--phase", "post", "--corr", "abc",
      "--tier", "claude-tool", "--hook", "PostToolUse", "--command", "Read", "--end", "5400",
    );
    const db = await openDb(join(DATA, "profile.db"));
    const row = db.prepare("SELECT * FROM event WHERE start=5000").get() as
      | { start: number; end: number }
      | undefined;
    const { n: pending } = db.prepare("SELECT COUNT(*) AS n FROM pending").get() as { n: number };
    db.close();
    assert.ok(row, "expected the pre/post markers to pair into one event");
    assert.equal(row.end - row.start, 400);
    assert.equal(pending, 0, "the pending row should be consumed on pairing");
  });

  await t.test("ingest pulls GitHub Actions timings via the gh CLI", async () => {
    const restore = await withFakeGh();
    try {
      const { out } = await run("ingest", "--repo", "o/r");
      assert.match(out, /ingested 2 GitHub Actions events/);
    } finally {
      restore();
    }
  });

  await t.test("serve starts an HTTP server that answers /api/meta", async () => {
    const { out, result } = await run("serve", "--port", "0");
    assert.match(out, /serving report UI \+ API/);
    const serveResult = result as { server: import("node:http").Server; url: string };
    try {
      const meta = (await (await fetch(`${serveResult.url}/api/meta`)).json()) as { count: number };
      assert.ok(typeof meta.count === "number");
    } finally {
      serveResult.server.close();
    }
  });

  await t.test("install → status → upgrade → uninstall round-trips a project", async () => {
    const target = await mkdtemp(join(tmpdir(), "hooker-target-"));
    assert.match((await run("install", "--target", target)).out, /wired recorders/);
    assert.match((await run("status", "--target", target)).out, /recorders=\[/);
    assert.match((await run("upgrade", "--target", target)).out, /upgraded/);
    assert.match((await run("uninstall", "--target", target)).out, /removed profile entries/);
  });

  await t.test("git hook wrap/unwrap commands report their work", async () => {
    const target = await mkdtemp(join(tmpdir(), "hooker-git-"));
    assert.match((await run("install-git", "--target", target)).out, /git-hook steps|no git hooks/);
    assert.match((await run("uninstall-git", "--target", target)).out, /git hooks/);
  });

  await t.test("cursor install/status/upgrade/uninstall work against a target", async () => {
    const target = await mkdtemp(join(tmpdir(), "hooker-cursor-"));
    assert.match((await run("install", "--host", "cursor", "--target", target)).out, /wired cursor recorders/);
    assert.match((await run("status", "--host", "cursor", "--target", target)).out, /cursor events=\[/);
    assert.match((await run("upgrade", "--host", "cursor", "--target", target)).out, /upgraded cursor/);
    assert.match((await run("uninstall", "--host", "cursor", "--target", target)).out, /removed cursor recorders/);
  });

  await t.test("reset drops all events", async () => {
    const { out } = await run("reset");
    assert.match(out, /reset .*dropped all events/);
    assert.equal(await eventCount(), 0);
  });

  delete process.env.PROFILE_DATA_DIR;
});
