import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryStyle,
  colorEnabled,
  fitSegments,
  heatStyle,
  makePaint,
  tierStyle,
} from "../lib/ansi.ts";

const plain = makePaint(false);
const seg = (text, style = null) => ({ text, style });

test("fitSegments pads a short label to a fixed visible width", () => {
  const out = fitSegments([seg("git"), seg(" › "), seg("push")], 40, plain);
  assert.equal(out, `git › push${" ".repeat(31)}`);
  assert.equal(out.length, 41);
});

test("fitSegments truncates an overflowing label with an ellipsis", () => {
  const long = "Edit › BindingsForm.integration.test.tsx.extra";
  const out = fitSegments([seg(long)], 40, plain);
  assert.equal(out.length, 41);
  assert.ok(out.endsWith("… "));
  assert.equal(out.trimEnd(), `${long.slice(0, 39)}…`);
});

test("makePaint(true) wraps text in ANSI codes and resets", () => {
  const paint = makePaint(true);
  assert.equal(paint("hi", "red"), "\x1b[31mhi\x1b[0m");
  assert.equal(paint("hi", "bold", "cyan"), "\x1b[1m\x1b[36mhi\x1b[0m");
});

test("makePaint(false) and empty styles return the plain string", () => {
  assert.equal(makePaint(false)("hi", "red"), "hi");
  assert.equal(makePaint(true)("hi"), "hi");
});

test("tierStyle maps known tiers and dims the rest to gray", () => {
  assert.equal(tierStyle("claude-wait"), "purple");
  assert.equal(tierStyle("git-hook"), "amber");
  assert.equal(tierStyle("mystery"), "gray");
});

test("categoryStyle maps known categories and dims the rest to gray", () => {
  assert.equal(categoryStyle("vcs"), "amber");
  assert.equal(categoryStyle("test"), "green");
  assert.equal(categoryStyle("wait"), "purple");
  assert.equal(categoryStyle("mystery"), "gray");
});

test("heatStyle escalates with duration and dims count-only rows", () => {
  assert.equal(heatStyle(0), "gray");
  assert.equal(heatStyle(500_000), "green");
  assert.equal(heatStyle(5_000_000), "yellow");
  assert.equal(heatStyle(50_000_000), "red");
});

test("colorEnabled defaults on, and off for html, --no-color, or NO_COLOR", () => {
  assert.equal(colorEnabled({}, {}), true);
  assert.equal(colorEnabled({ html: true }, {}), false);
  assert.equal(colorEnabled({ "no-color": true }, {}), false);
  assert.equal(colorEnabled({ color: "false" }, {}), false);
  assert.equal(colorEnabled({}, { NO_COLOR: "1" }), false);
});
