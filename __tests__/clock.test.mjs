import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundMicros,
  durationMicros,
  isoToMicros,
  MICROS_PER_DAY,
} from "../lib/clock.mjs";

test("boundMicros snaps a bare date to the UTC day boundary", () => {
  assert.equal(boundMicros("2026-07-22"), isoToMicros("2026-07-22T00:00:00Z"));
  assert.equal(
    boundMicros("2026-07-22", { end: true }),
    isoToMicros("2026-07-22T00:00:00Z") + MICROS_PER_DAY,
  );
});

test("boundMicros resolves a datetime to its exact instant, second-precise", () => {
  assert.equal(
    boundMicros("2026-07-22T14:30:00Z"),
    isoToMicros("2026-07-22T14:30:00Z"),
  );
  const delta =
    boundMicros("2026-07-22T14:30:15Z") - boundMicros("2026-07-22T14:30:00Z");
  assert.equal(delta, 15 * 1_000_000);
});

test("boundMicros ignores the end flag for a precise datetime", () => {
  assert.equal(
    boundMicros("2026-07-22T14:30:00Z", { end: true }),
    boundMicros("2026-07-22T14:30:00Z"),
  );
});

test("durationMicros parses s/m/h/d suffixes", () => {
  assert.equal(durationMicros("30s"), 30_000_000);
  assert.equal(durationMicros("90m"), 90 * 60_000_000);
  assert.equal(durationMicros("2h"), 2 * 3_600_000_000);
  assert.equal(durationMicros("1d"), MICROS_PER_DAY);
});

test("durationMicros throws on an unparseable duration", () => {
  assert.throws(() => durationMicros("soon"), /unparseable duration/);
});
