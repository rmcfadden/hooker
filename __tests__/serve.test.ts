import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { insertMany } from "../lib/record.ts";
import { serve } from "../lib/serve.ts";
import type { Report } from "../lib/types.ts";

interface MetaResponse {
  now: number;
  min: number | null;
  max: number | null;
  count: number;
}

async function seededDb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hooker-serve-"));
  const path = join(dir, "profile.db");
  const db = await openDb(path);
  insertMany(db, [
    { start: 1000, end: 1100, tier: "claude-tool", hook: "Bash", command: "npm", status: "success" },
    { start: 2000, end: 2500, tier: "git-hook", hook: "pre-commit", command: "lint", status: "fail" },
  ]);
  db.close();
  return path;
}

// port 0 → the OS assigns a free port, returned in the url. Each server gets its own temp dir, so
// its state.json (written by the control routes) is isolated from other tests and the process.
async function seededServer() {
  return serve({ path: await seededDb(), port: 0 });
}

async function controlServer() {
  return serve({ path: await seededDb(), port: 0, control: true });
}

interface StatusResponse extends MetaResponse {
  recording: boolean;
}

test("GET /api/report aggregates events and honors the group param", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/api/report?group=tier`);
    assert.equal(res.status, 200);
    const report = (await res.json()) as Report;
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
    const meta = (await (await fetch(`${url}/api/meta`)).json()) as MetaResponse;
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
    assert.match(((await res.json()) as { error: string }).error, /unparseable duration/);
  } finally {
    server.close();
  }
});

test("unknown API routes 404 as JSON", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/api/nope`);
    assert.equal(res.status, 404);
    assert.match(((await res.json()) as { error: string }).error, /no route/);
  } finally {
    server.close();
  }
});

test("the root path serves the built web bundle's index.html", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "",/text\/html/);
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
    assert.match(res.headers.get("content-type") ?? "",/text\/css/);
  } finally {
    server.close();
  }
});

test("an unknown non-API path falls back to index.html (client-side routing)", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/some/deep/spa/route`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "",/text\/html/);
  } finally {
    server.close();
  }
});

test("GET /api/status reports the recording flag alongside the event span", async () => {
  const { server, url } = await seededServer();
  try {
    const status = (await (await fetch(`${url}/api/status`)).json()) as StatusResponse;
    assert.equal(status.recording, true);
    assert.equal(status.count, 2);
    assert.equal(status.min, 1000);
    assert.equal(status.max, 2500);
  } finally {
    server.close();
  }
});

test("control routes 404 unless the server was started with control", async () => {
  const { server, url } = await seededServer();
  try {
    for (const route of ["enable", "disable"]) {
      const res = await fetch(`${url}/api/${route}`, { method: "POST" });
      assert.equal(res.status, 404);
      assert.match(((await res.json()) as { error: string }).error, /no route/);
    }
  } finally {
    server.close();
  }
});

test("with --control, POST enable/disable toggles recording and status reflects it", async () => {
  const { server, url } = await controlServer();
  try {
    const disable = await fetch(`${url}/api/disable`, { method: "POST" });
    assert.equal(disable.status, 200);
    assert.equal(((await disable.json()) as { recording: boolean }).recording, false);
    assert.equal(
      ((await (await fetch(`${url}/api/status`)).json()) as StatusResponse).recording,
      false,
    );

    const enable = await fetch(`${url}/api/enable`, { method: "POST" });
    assert.equal(((await enable.json()) as { recording: boolean }).recording, true);
    assert.equal(
      ((await (await fetch(`${url}/api/status`)).json()) as StatusResponse).recording,
      true,
    );
  } finally {
    server.close();
  }
});

test("a control route rejects the wrong method with 405", async () => {
  const { server, url } = await controlServer();
  try {
    const res = await fetch(`${url}/api/enable`);
    assert.equal(res.status, 405);
    assert.match(((await res.json()) as { error: string }).error, /use POST/);
  } finally {
    server.close();
  }
});

test("OPTIONS preflight on /api answers 204 with open CORS", async () => {
  const { server, url } = await seededServer();
  try {
    const res = await fetch(`${url}/api/report`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
  } finally {
    server.close();
  }
});
