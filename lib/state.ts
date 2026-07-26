import { join } from "node:path";
import { readJson, writeJson } from "./json-file.ts";
import { dataDir } from "./paths.ts";

/** Runtime state file — sits beside the DB in the data dir (project-local unless `$PROFILE_DATA_DIR`). */
export function statePath(): string {
  return join(dataDir(), "state.json");
}

interface State {
  enabled?: boolean;
}

/** Recording is on unless it was explicitly turned off — a missing state file means enabled.
 * `path` defaults to the data-dir state file; the service layer passes a db-co-located path. */
export async function isRecordingEnabled(path: string = statePath()): Promise<boolean> {
  const state = (await readJson(path)) as State;
  return state.enabled !== false;
}

/** Persist the enabled flag, preserving any other keys already in the state file. */
export async function setRecordingEnabled(
  enabled: boolean,
  path: string = statePath(),
): Promise<void> {
  const state = (await readJson(path)) as State;
  await writeJson(path, { ...state, enabled });
}
