/** Epoch microseconds from the high-resolution performance clock (µs precision, wall-clock anchored). */
export function nowMicros() {
  return Math.round((performance.timeOrigin + performance.now()) * 1000);
}

/** Parse an ISO8601 timestamp (GitHub API, second-resolution) into epoch microseconds. */
export function isoToMicros(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`invariant: unparseable timestamp ${iso}`);
  }
  return ms * 1000;
}

/** Epoch microseconds at UTC midnight of a YYYY-MM-DD day string. */
export function dayStartMicros(dateStr) {
  return isoToMicros(`${dateStr}T00:00:00Z`);
}

export const MICROS_PER_DAY = 86_400_000_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a range bound to epoch µs. A bare `YYYY-MM-DD` snaps to the UTC day boundary — start of
 * day, or (for an `end` bound) the next midnight so the whole day is included. Anything with a time
 * component (`2026-07-22T14:30:00`, second precision) resolves to that exact instant, in local time
 * unless it carries an explicit offset.
 */
export function boundMicros(str, { end = false } = {}) {
  if (DATE_ONLY.test(str)) {
    return dayStartMicros(str) + (end ? MICROS_PER_DAY : 0);
  }
  return isoToMicros(str);
}

const DURATION = /^(\d*)\s*([a-z]+?)s?$/;
const UNIT_MICROS = {
  s: 1e6, sec: 1e6, second: 1e6,
  m: 60e6, min: 60e6, minute: 60e6,
  h: 3_600e6, hr: 3_600e6, hour: 3_600e6,
  d: 86_400e6, day: 86_400e6,
  w: 604_800e6, wk: 604_800e6, week: 604_800e6,
};

/**
 * Parse a relative duration into microseconds. Accepts a count + unit suffix (`30s`, `90m`, `2h`,
 * `1d`, `1w`) or a bare/counted word unit (`hour`, `day`, `2week`); a missing count means 1.
 */
export function durationMicros(str) {
  const match = DURATION.exec(String(str).trim().toLowerCase());
  const unit = match && UNIT_MICROS[match[2]];
  if (!unit) {
    throw new Error(
      `invariant: unparseable duration ${str} (use 30s/90m/2h/1d or hour/day/week)`,
    );
  }
  return (match[1] === "" ? 1 : Number(match[1])) * unit;
}
