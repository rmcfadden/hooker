import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { insertMany } from "../lib/record.mjs";
import { serve } from "../lib/serve.mjs";

async function seededServer() {
  const dir = await mkdtemp(join(tmpdir(), "hooker-serve-"));
  const path = join(dir, "profile.db");
  const db = await openDb(path);
  insertMany(db, [
    { start: 1000, end: 1100, tier: "claude-tool", hook: "Bash", command: "npm", status: "success" },
    { start: 2000, end: 2500, tier: "git-hook", hook: "pre-commit", command: "lint", status: "fail" },
  ]);
  db.close();
  // port 0 → the OS assigns a free port, returned in the url.
  return serve({ path, port: 0 });
}

test("GET /api/report aggregates events and honors the group param", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/api/report?group=tier`);
    assert.equal(res.status, 200);
    const report = await res.json();
    assert.deepEqual(report.groupCols, ["tier"]);
    assert.equal(report.totals.count, 2);
    assert.equal(report.totals.failures, 1);
    assert.equal(report.groups.length, 2);
  } finally {
    server.close();
  }
});

test("GET /api/meta reports the event span and count", async () => {
  const { server, url } = await seededServer();
  try {
    const meta = await (await fetch(`${url}/api/meta`)).json();
    assert.equal(meta.count, 2);
    assert.equal(meta.min, 1000);
    assert.equal(meta.max, 2500);
    assert.ok(meta.now > meta.max);
  } finally {
    server.close();
  }
});

test("an unparseable duration surfaces as a 400 JSON error", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/api/report?last=soon`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /unparseable duration/);
  } finally {
    server.close();
  }
});

test("unknown API routes 404 as JSON", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/api/nope`);
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /no route/);
  } finally {
    server.close();
  }
});

test("the root path serves the built web bundle's index.html", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.match(await res.text(), /<!doctype html>/i);
  } finally {
    server.close();
  }
});

test("a real asset is served with its content-type", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/assets/index-D142FQuR.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/css/);
  } finally {
    server.close();
  }
});

test("an unknown non-API path falls back to index.html (client-side routing)", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/some/deep/spa/route`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
  } finally {
    server.close();
  }
});
