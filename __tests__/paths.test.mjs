import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { dataDir, dbPath } from "../lib/paths.mjs";

test("dataDir honors PROFILE_DATA_DIR, else project-local .profile", () => {
  const saved = process.env.PROFILE_DATA_DIR;
  try {
    process.env.PROFILE_DATA_DIR = "/tmp/custom-profile";
    assert.equal(dataDir(), "/tmp/custom-profile");
    assert.equal(dbPath(), "/tmp/custom-profile/profile.db");
    delete process.env.PROFILE_DATA_DIR;
    assert.equal(dataDir(), join(process.cwd(), ".profile"));
    assert.equal(dbPath(), join(process.cwd(), ".profile", "profile.db"));
  } finally {
    if (saved === undefined) {
      delete process.env.PROFILE_DATA_DIR;
    } else {
      process.env.PROFILE_DATA_DIR = saved;
    }
  }
});
