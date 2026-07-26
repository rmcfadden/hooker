import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bashParts,
  deriveParts,
  splitSequence,
  toEvents,
} from "../lib/command-label.ts";

test("bashParts splits executable and subcommand, skipping cd/env", () => {
  assert.deepEqual(bashParts("cd /some/path && git push"), {
    command: "git",
    subcommand: "push",
  });
  assert.deepEqual(bashParts("npm run test:unit --prefix x"), {
    command: "npm",
    subcommand: "test:unit",
  });
  assert.deepEqual(bashParts("npm install"), {
    command: "npm",
    subcommand: "install",
  });
  assert.deepEqual(bashParts("docker run --rm img"), {
    command: "docker",
    subcommand: "run",
  });
  assert.deepEqual(bashParts("npx vitest run"), {
    command: "npx",
    subcommand: "vitest",
  });
  assert.deepEqual(bashParts("node scripts/foo.mjs --all"), {
    command: "node",
    subcommand: "foo.mjs",
  });
});

test("bashParts leaves a null subcommand for plain commands and bare cd", () => {
  assert.deepEqual(bashParts("grep -r foo ."), {
    command: "grep",
    subcommand: null,
  });
  assert.deepEqual(bashParts("cd /only/here"), {
    command: "cd",
    subcommand: null,
  });
  assert.deepEqual(bashParts("FOO=1 sudo node run.mjs"), {
    command: "node",
    subcommand: "run.mjs",
  });
});

test("bashParts returns a null command for shell keywords, assignments and fragments", () => {
  for (const noise of [
    "done",
    "for f in a b",
    "fi",
    "if [ -f x ]",
    "export FOO=bar",
    'EXIST+=("$f")',
    'drift="clean"',
    "$f",
    "}",
    "-s",
    "(cd x",
  ]) {
    assert.deepEqual(
      bashParts(noise),
      { command: null, subcommand: null },
      `expected ${noise} to be noise`,
    );
  }
});

test("deriveParts routes Bash vs file-taking tools", () => {
  assert.deepEqual(deriveParts("Bash", "cd x && git status"), {
    command: "git",
    subcommand: "status",
  });
  assert.deepEqual(deriveParts("Read", "/repo/src/App.tsx"), {
    command: "Read",
    subcommand: "App.tsx",
  });
  assert.deepEqual(deriveParts("AskUserQuestion", "AskUserQuestion"), {
    command: "AskUserQuestion",
    subcommand: null,
  });
});

test("splitSequence splits on && and ; but not pipes", () => {
  assert.deepEqual(splitSequence("a && b ; c"), ["a", "b", "c"]);
  assert.deepEqual(splitSequence("grep x | head"), ["grep x | head"]);
});

test("toEvents splits a compound Bash call: setup rows count-only, last is primary", () => {
  const events = toEvents({
    tier: "claude-tool",
    hook: "Bash",
    source: "cd /r && npm run build && git push",
    start: 100,
    end: 900,
  });
  assert.equal(events.length, 3);
  const [cd, build, push] = events;
  assert.deepEqual([cd.command, cd.subcommand], ["cd", null]);
  assert.equal(cd.end - cd.start, 0);
  assert.deepEqual([build.command, build.subcommand], ["npm", "build"]);
  assert.equal(build.end - build.start, 0);
  assert.deepEqual([push.command, push.subcommand], ["git", "push"]);
  assert.equal(push.start, 100);
  assert.equal(push.end, 900);
});

test("toEvents yields one row for a simple command and for non-Bash tools", () => {
  const [bash] = toEvents({
    tier: "claude-tool",
    hook: "Bash",
    source: "grep foo",
    start: 1,
    end: 5,
  });
  assert.deepEqual(
    [bash.command, bash.subcommand, bash.end - bash.start],
    ["grep", null, 4],
  );
  const [read] = toEvents({
    tier: "claude-tool",
    hook: "Read",
    source: "/a/b/App.tsx",
    start: 1,
    end: 5,
  });
  assert.deepEqual([read.command, read.subcommand], ["Read", "App.tsx"]);
});

test("toEvents reclassifies user-blocked tools onto the wait tier", () => {
  const [ask] = toEvents({
    tier: "claude-tool",
    hook: "AskUserQuestion",
    source: "AskUserQuestion",
    start: 0,
    end: 9_000_000,
  });
  assert.equal(ask.tier, "claude-wait");
});

test("splitSequence does not split on operators inside quotes", () => {
  assert.deepEqual(splitSequence(`node -e "for (const r of x) { a(); b() }"`), [
    `node -e "for (const r of x) { a(); b() }"`,
  ]);
  assert.deepEqual(splitSequence(`git commit -m "fix; and && more"`), [
    `git commit -m "fix; and && more"`,
  ]);
  assert.deepEqual(splitSequence(`jq '.a | .b' file`), [`jq '.a | .b' file`]);
});

test("splitSequence drops heredoc bodies", () => {
  const cmd = "cat > f <<'EOF'\nconst x = 1; for (;;) {}\nEOF\nnode f";
  assert.deepEqual(splitSequence(cmd), ["cat > f", "node f"]);
});

test("a trailing tail/echo is count-only; the real work stays primary", () => {
  const events = toEvents({
    tier: "claude-tool",
    hook: "Bash",
    source: "npm run test:unit && tail -4 log",
    start: 0,
    end: 500,
  });
  const byCommand = Object.fromEntries(events.map((e) => [e.command, e]));
  assert.equal(byCommand.npm.end - byCommand.npm.start, 500);
  assert.equal(byCommand.tail.end - byCommand.tail.start, 0);
});

test("bogus tokens from unquoted JS no longer appear as commands", () => {
  const events = toEvents({
    tier: "claude-tool",
    hook: "Bash",
    source: `node -e "for (const r of rows) log(r); done()"`,
    start: 0,
    end: 9,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].command, "node");
});

test("a loop attributes the duration to its body, dropping for/do/done keywords", () => {
  const events = toEvents({
    tier: "claude-tool",
    hook: "Bash",
    source: "for f in a b; do npm run build; done",
    start: 0,
    end: 500,
  });
  assert.deepEqual(
    events.map((e) => e.command),
    ["npm"],
  );
  assert.deepEqual(
    [events[0].subcommand, events[0].end - events[0].start],
    ["build", 500],
  );
});

test("an all-noise shell construct falls back to a single sh row, keeping the timing", () => {
  const events = toEvents({
    tier: "claude-tool",
    hook: "Bash",
    source: "for f in a b; do :; done",
    start: 0,
    end: 42,
  });
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].command, events[0].end - events[0].start],
    ["sh", 42],
  );
});
