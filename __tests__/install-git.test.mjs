import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  gitHookStatus,
  gitLabel,
  resolveHooksDir,
  unwrapGitHooks,
  unwrapStep,
  wrapGitHooks,
  wrapHookText,
  wrapStep,
} from "../lib/install-git.mjs";

const execFileAsync = promisify(execFile);

test("resolveHooksDir handles both relative and absolute git-path output", () => {
  assert.equal(resolveHooksDir("/repo", ".git/hooks\n"), "/repo/.git/hooks");
  assert.equal(resolveHooksDir("/repo", "/repo/.git/hooks\n"), "/repo/.git/hooks");
});

test("gitLabel derives the lint stem or npm script name", () => {
  assert.equal(gitLabel('node "$ROOT/scripts/hooks/lint-comments.mjs" --staged'), "lint-comments");
  assert.equal(gitLabel('npm run test:unit --prefix "$ROOT"'), "test:unit");
});

test("wrapStep routes node/npm steps through _pf and preserves the exit gate", () => {
  assert.equal(
    wrapStep('node "$ROOT/scripts/hooks/lint-comments.mjs" --staged || exit 1', "pre-commit"),
    '_pf pre-commit lint-comments node "$ROOT/scripts/hooks/lint-comments.mjs" --staged || exit 1',
  );
  assert.equal(
    wrapStep('npm run test:unit --prefix "$ROOT" || exit 1', "pre-push"),
    '_pf pre-push test:unit npm run test:unit --prefix "$ROOT" || exit 1',
  );
  const warn = wrapStep('node "$ROOT/scripts/hooks/lint-solid-s.mjs" --staged --warn', "pre-commit");
  assert.match(warn, /^_pf pre-commit lint-solid-s node .* --warn$/);
  assert.doesNotMatch(warn, /exit/);
});

test("wrapStep leaves non-steps and already-wrapped lines untouched", () => {
  for (const line of ["#!/bin/sh", 'ROOT="$(git rev-parse --show-toplevel)"', "# a comment", ""]) {
    assert.equal(wrapStep(line, "pre-commit"), line);
  }
  const already = '_pf pre-commit lint node "$ROOT/x.mjs"';
  assert.equal(wrapStep(already, "pre-commit"), already);
});

test("unwrapStep round-trips wrapStep", () => {
  const line = 'node "$ROOT/scripts/hooks/lint-naming.mjs" --staged || exit 1';
  assert.equal(unwrapStep(wrapStep(line, "pre-commit")), line);
});

const HOOK_BODY = [
  "#!/bin/sh",
  'ROOT="$(git rev-parse --show-toplevel)"',
  'node "$ROOT/scripts/hooks/lint-comments.mjs" --staged || exit 1',
  'npm run test:unit --prefix "$ROOT" || exit 1',
  "",
].join("\n");

test("wrapHookText injects the shim once and unwrap restores the original", () => {
  const wrapped = wrapHookText(HOOK_BODY, "pre-commit", "profile/hooks");
  assert.match(wrapped, /# >>> profile >>>/);
  assert.match(wrapped, /_pf pre-commit lint-comments node/);
  assert.match(wrapped, /_pf pre-commit test:unit npm run test:unit/);
  assert.equal(wrapHookText(wrapped, "pre-commit", "profile/hooks"), wrapped);
});

async function initRepoWithHook(body) {
  const repo = await mkdtemp(join(tmpdir(), "profile-git-"));
  await execFileAsync("git", ["init", "-q"], { cwd: repo });
  await mkdir(join(repo, ".git", "hooks"), { recursive: true });
  await writeFile(join(repo, ".git", "hooks", "pre-commit"), body, "utf8");
  return repo;
}

test("wrapGitHooks + unwrapGitHooks round-trip a real hook file", async () => {
  const repo = await initRepoWithHook(HOOK_BODY);
  const home = join(repo, "profile");

  await wrapGitHooks({ target: repo, home });
  assert.equal(await gitHookStatus({ target: repo }), 2);
  await wrapGitHooks({ target: repo, home });
  assert.equal(await gitHookStatus({ target: repo }), 2);

  await unwrapGitHooks({ target: repo });
  assert.equal(await readFile(join(repo, ".git", "hooks", "pre-commit"), "utf8"), HOOK_BODY);
  assert.equal(await gitHookStatus({ target: repo }), 0);
});

test("_pf shim runs the raw command when profile-step.sh is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profile-shim-"));
  const body = ['#!/bin/sh', 'ROOT="/tmp"', `node -e "process.stdout.write('HELLO')" || exit 1`].join("\n");
  const file = join(dir, "pre-commit");
  await writeFile(file, wrapHookText(body, "pre-commit", "profile/hooks"), "utf8");
  await chmod(file, 0o755);
  const { stdout } = await execFileAsync("sh", [file]);
  assert.equal(stdout, "HELLO");
});
