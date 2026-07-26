import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../lib/db.ts";
import { hooksDir } from "../lib/paths.ts";

/** The result of running a hook script: its captured stdout and exit code. */
export interface RunResult {
  stdout: string;
  code: number | null;
}

/** A recorded event row as read back by {@link eventsIn}. */
export interface HookEventRow {
  tier: string;
  hook: string;
  command: string;
  subcommand: string | null;
  status: string | null;
  elapsed: number;
}

export function runHook(args: string[], input: string | undefined, dataDir: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", args, {
      env: { ...process.env, PROFILE_DATA_DIR: dataDir },
    });
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
    child.stdin?.end(input ?? "");
  });
}

export function tempDataDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `profile-${label}-`));
}

export function script(name: string): string {
  return join(hooksDir(), name);
}

export async function eventsIn(dir: string): Promise<HookEventRow[]> {
  const db = await openDb(join(dir, "profile.db"));
  const rows = (
    db
      .prepare(`SELECT tier, hook, command, subcommand, status, "end" - start AS elapsed FROM event ORDER BY elapsed`)
      .all() as unknown as HookEventRow[]
  ).map((r) => ({ ...r }));
  db.close();
  return rows;
}
