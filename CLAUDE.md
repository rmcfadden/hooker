# CLAUDE.md

## Project

`hooker` — a self-contained CLI that records Claude/Cursor/git/GitHub hook and tool-call
timings into SQLite (`node:sqlite`) and reports them via CLI + a web UI. Zero runtime deps.

- Root package `hooker`: `lib/` (core modules — db, record, report, install, categorize,
  aggregate, serve), `bin/hooker.ts` (CLI entry), `hooks/` (bash recorder scripts installed
  into instrumented projects), `__tests__/` (`*.test.ts`, `node:test`), `scripts/postbuild.ts`.
- `web/` — a private React 19 + Vite + Tailwind sub-package (the `hooker serve` UI).
- Commands: `npm test` (`node --test`), `npm run coverage` (enforces 95% line + function),
  `npm run typecheck` (`tsc --noEmit`, base + test configs), `npm run build`
  (`tsc` build + `postbuild.ts`, which copies `hooks/`→`dist/`, rewrites imports, chmods bins).
- Node ≥ 22.5 (for `node:sqlite`). Strict TS everywhere; async-only I/O (`node:fs/promises`).
  There is no linter, formatter, git hook, or CI — TS strict mode + the coverage thresholds
  are the only automated gates.

## Engineering rules

- **Surface errors immediately.** Throw on unexpected/invariant conditions; no
  `try { … } catch { return default }` soft fallbacks; never `console.log` an error and continue.
  `?.` is for genuinely-optional fields only — missing-means-malformed should throw.
- **No sync I/O.** `node:fs/promises` + `promisify(execFile)`; async is the house style even in
  a synchronous-feeling CLI. Use `await access(p).then(() => true, () => false)` for existence.
- **No empty/comment-only catch.** Rethrow, narrow to the recoverable error, or use the API's
  own opt-out (`rm({ force: true })`). Tests assert throws with the runner, not a try/catch.
- **DRY on the second copy.** Extract a shared helper the second time you'd write the same
  function/constant/regex — including duplicates already in a file you touch.
- **Comments explain why, not what.** Delete comments that restate the code; keep ones that
  carry a tradeoff or non-obvious constraint. No multi-line `//` blocks or banner comments —
  self-document via naming, or put the thought in the PR description / a memory.
- **Naming.** PascalCase for type-likes; camelCase for values (PascalCase for React components
  and factories, UPPER_SNAKE for constants). Never `snake_case` a local — rename the local,
  keep the wire key.
- **Fix root causes.** No retries, `.skip`, fallbacks, or "click twice" workarounds.
- **Honesty.** Claim a behavior works/breaks only after running the real path (the actual test,
  the CLI against real data) — reading code is a hypothesis. Quote the actual error; "verified"
  ≠ "appears to work"; surface bugs the moment you find them, not in a wrap-up footnote.
- **Warnings are errors.** A `tsc`/build/`npm` warning you can't explain is an undiagnosed
  failure — fix it at the source, don't silence it.
- **Refactoring.** Prefer the clean rewrite in the shape the code should be over the minimal
  diff that preserves the old shape; match surrounding *style*, not old structure. A line-count
  target means delete code, not relocate it behind an import.
- **Scratch scripts** go in `.claude/tmp/` (gitignored) — never the repo root or `scripts/`.

## Merge flow

Locally green → commit → push → PR → `gh pr merge --squash --delete-branch`, same turn. There
are no git hooks and no CI, so **`npm test` + `npm run typecheck` passing locally is the merge
gate** — run both before pushing and never push a red tree. `main` has no required status
checks: once the PR is open, squash-merge it immediately; don't arm `--auto`, don't poll, don't
`--admin`. Any edit starts from a branch (`git worktree add -b <branch> .worktrees/<slug> main`);
don't give the user guidance for changes that aren't merged to `main` yet.
