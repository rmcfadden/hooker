import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../lib/db.ts";
import { hooksDir } from "../lib/paths.ts";

export function runHook(args, input, dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", args, {
      env: { ...process.env, PROFILE_DATA_DIR: dataDir },
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
    child.stdin.end(input ?? "");
  });
}

export function tempDataDir(label) {
  return mkdtemp(join(tmpdir(), `profile-${label}-`));
}

export function script(name) {
  return join(hooksDir(), name);
}

export async function eventsIn(dir) {
  const db = await openDb(join(dir, "profile.db"));
  const rows = db
    .prepare(`SELECT tier, hook, command, subcommand, status, "end" - start AS elapsed FROM event ORDER BY elapsed`)
    .all()
    .map((r) => ({ ...r }));
  db.close();
  return rows;
}
