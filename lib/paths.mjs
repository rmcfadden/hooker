import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));

/** The profile/ root — data lives alongside the tool so a consumer only needs this folder. */
export const profileHome = resolve(libDir, "..");

/** Data dir: `$PROFILE_DATA_DIR` (tests / custom location) or `<home>/data`. */
export function dataDir(home = profileHome) {
  return process.env.PROFILE_DATA_DIR ?? join(home, "data");
}

export function dbPath(home = profileHome) {
  return join(dataDir(home), "profile.db");
}

export function reportsDir(home = profileHome) {
  return join(dataDir(home), "reports");
}

export function hooksDir(home = profileHome) {
  return join(home, "hooks");
}
