import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));

/** The package root — the recorders and CLI live here (works vendored or from node_modules). */
export const profileHome = resolve(libDir, "..");

/**
 * Data dir: `$PROFILE_DATA_DIR` if set, else project-local `.profile/` under the current directory.
 * Keeping data out of the package means an installed dependency never writes into `node_modules`
 * (wiped on reinstall) and every project keeps its own timings. Hooks run at the project root, so
 * `cwd` resolves there; run the CLI from the project root too (or set `$PROFILE_DATA_DIR`).
 */
export function dataDir() {
  return process.env.PROFILE_DATA_DIR ?? join(process.cwd(), ".profile");
}

export function dbPath() {
  return join(dataDir(), "profile.db");
}

export function reportsDir() {
  return join(dataDir(), "reports");
}

/** Recorder scripts live with the package (vendored dir or `node_modules/hooker`), not the project. */
export function hooksDir(home = profileHome) {
  return join(home, "hooks");
}
