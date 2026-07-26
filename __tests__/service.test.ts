import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDb } from "../lib/db.ts";
import { insertMany } from "../lib/record.ts";
import { createService } from "../lib/service.ts";

/** Seed two events into a fresh db through a short-lived connection (the service is read-focused). */
async function seed(path: string): Promise<void> {
  const db = await openDb(path);
  insertMany(db, [
    { start: 1000, end: 1100, tier: "claude-tool", hook: "Bash", command: "npm", status: "success" },
    { start: 2000, end: 2500, tier: "git-hook", hook: "pre-commit", command: "lint", status: "fail" },
  ]);
  db.close();
}

test("report() aggregates seeded events and meta() reports the span", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hooker-svc-"));
  const path = join(dir, "profile.db");
  await seed(path);
  const service = await createService({ path });
  try {
    const report = service.report({ group: ["tier"] });
    assert.deepEqual(report.groupCols, ["tier"]);
    assert.equal(report.totals.count, 2);
    assert.equal(report.totals.failures, 1);

    const meta = service.meta();
    assert.equal(meta.count, 2);
    assert.equal(meta.min, 1000);
    assert.equal(meta.max, 2500);
    assert.ok(meta.now > meta.max!);
  } finally {
    service.close();
  }
});

test("enable/disable round-trips and persists to the co-located state.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hooker-svc-"));
  const path = join(dir, "profile.db");
  const service = await createService({ path });
  try {
    assert.equal(await service.isEnabled(), true, "missing state file means enabled");
    assert.equal((await service.status()).recording, true);

    assert.equal(await service.setEnabled(false), false);
    assert.equal((await service.status()).recording, false);
    const written = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    assert.equal(written.enabled, false);

    assert.equal(await service.setEnabled(true), true);
    assert.equal(await service.isEnabled(), true);
  } finally {
    service.close();
  }
});
