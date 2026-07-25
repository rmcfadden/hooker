import assert from "node:assert/strict";
import { test } from "node:test";
import { stepsToEvents } from "../lib/github.mjs";

const JOBS = [
  {
    id: 42,
    run_id: 7,
    name: "unit",
    workflow_name: "Tests",
    steps: [
      { name: "checkout", number: 1, started_at: "2026-07-20T10:00:00Z", completed_at: "2026-07-20T10:00:05Z", conclusion: "success" },
      { name: "npm test", number: 2, started_at: "2026-07-20T10:00:05Z", completed_at: "2026-07-20T10:02:05Z", conclusion: "failure" },
      { name: "pending", number: 3, started_at: null, completed_at: null, conclusion: null },
    ],
  },
];

test("stepsToEvents maps steps to events and skips unfinished steps", () => {
  const events = stepsToEvents(JOBS);
  assert.equal(events.length, 2);
  const [checkout, npmTest] = events;
  assert.equal(checkout.tier, "github-action");
  assert.equal(checkout.hook, "Tests/unit");
  assert.equal(checkout.end - checkout.start, 5_000_000);
  assert.equal(npmTest.status, "failure");
  assert.equal(npmTest.sourceKey, "7/42/2");
});
