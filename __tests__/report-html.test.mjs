import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDuration,
  rangeLabel,
  renderReport,
} from "../lib/report-html.ts";

test("formatDuration scales µs → ms → s", () => {
  assert.equal(formatDuration(500), "500 µs");
  assert.equal(formatDuration(1500), "1.5 ms");
  assert.equal(formatDuration(2_500_000), "2.50 s");
});

test("rangeLabel prefers a relative span, else the from → to bounds", () => {
  assert.equal(rangeLabel({ last: "2h" }), "last 2h");
  assert.equal(
    rangeLabel({ from: "2026-07-22T14:00:00", to: "2026-07-22T15:00:00" }),
    "2026-07-22T14:00:00 → 2026-07-22T15:00:00",
  );
  assert.equal(rangeLabel({}), "beginning → now");
});

const noWait = { count: 0, total: 0, failures: 0 };

test("renderReport emits a self-contained document with totals, table and chart", () => {
  const report = {
    from: "2026-07-01",
    to: "2026-07-02",
    includeWait: false,
    groupCols: ["tier", "hook", "command"],
    groups: [
      {
        tier: "git-hook",
        hook: "pre-commit",
        command: "lint",
        count: 3,
        total: 900,
        avg: 300,
        p50: 300,
        p95: 500,
        failures: 1,
      },
    ],
    totals: { count: 3, total: 900, failures: 1 },
    wait: noWait,
  };
  const html = renderReport(report);
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<svg/);
  assert.match(html, /pre-commit/);
  assert.match(html, /900 µs/);
});

test("renderReport notes excluded wait time and points to the include flag", () => {
  const html = renderReport({
    from: null,
    to: null,
    includeWait: false,
    groupCols: ["tier"],
    groups: [],
    totals: { count: 0, total: 0, failures: 0 },
    wait: { count: 4, total: 9_000_000, failures: 0 },
  });
  assert.match(html, /excludes 4 wait events/);
  assert.match(html, /--include-wait/);
});

test("renderReport escapes HTML in group labels", () => {
  const html = renderReport({
    from: null,
    to: null,
    includeWait: false,
    groupCols: ["command"],
    groups: [
      {
        command: "<script>",
        count: 1,
        total: 1,
        avg: 1,
        p50: 1,
        p95: 1,
        failures: 0,
      },
    ],
    totals: { count: 1, total: 1, failures: 0 },
    wait: noWait,
  });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
