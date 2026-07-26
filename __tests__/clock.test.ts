import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundMicros,
  durationMicros,
  isoToMicros,
  MICROS_PER_DAY,
} from "../lib/clock.ts";

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

test("durationMicros accepts word units with an implied count of 1", () => {
  assert.equal(durationMicros("hour"), 3_600_000_000);
  assert.equal(durationMicros("minute"), 60_000_000);
  assert.equal(durationMicros("day"), MICROS_PER_DAY);
  assert.equal(durationMicros("week"), 7 * MICROS_PER_DAY);
});

test("durationMicros accepts plural, short, and counted word forms", () => {
  assert.equal(durationMicros("2hours"), 2 * 3_600_000_000);
  assert.equal(durationMicros("15min"), 15 * 60_000_000);
  assert.equal(durationMicros("3wk"), 3 * 7 * MICROS_PER_DAY);
  assert.equal(durationMicros("HOUR"), 3_600_000_000);
});

test("durationMicros throws on an unparseable duration", () => {
  assert.throws(() => durationMicros("soon"), /unparseable duration/);
});
