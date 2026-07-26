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

/** Recording is on unless it was explicitly turned off — a missing state file means enabled. */
export async function isRecordingEnabled(): Promise<boolean> {
  const state = (await readJson(statePath())) as State;
  return state.enabled !== false;
}

/** Persist the enabled flag, preserving any other keys already in the state file. */
export async function setRecordingEnabled(enabled: boolean): Promise<void> {
  const state = (await readJson(statePath())) as State;
  await writeJson(statePath(), { ...state, enabled });
}
