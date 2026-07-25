# profile — hook & tool-call timing profiler

Captures **elapsed time** for Claude Code hooks, Claude tool calls, git hooks, and GitHub
Actions steps into a SQLite database, and aggregates totals by date range grouped by
**tier → hook → command**. Self-contained, zero external dependencies (`node:sqlite`,
`node:test`, inline-SVG charts); `gh` is only needed for the GitHub source.

## Data model

One `event` row per timed thing. Timestamps are **integer epoch microseconds** from a
high-performance clock; elapsed is computed on read (`"end" - start`), never stored.

| tier            | hook                               | command                               |
| --------------- | ---------------------------------- | ------------------------------------- |
| `claude-hook`   | `PreToolUse` / `Stop` …            | wrapped hook script                   |
| `claude-tool`   | tool name (`Bash` …)               | executable / edited file              |
| `git-hook`      | `pre-commit` / `pre-push`          | lint step                             |
| `github-action` | `workflow/job`                     | step name                             |
| `claude-wait`   | `AskUserQuestion` / `ExitPlanMode` | user think-time (excluded by default) |
| `cursor-turn`   | `turn`                             | turn (submit → stop duration)         |
| `cursor-tool`   | `Bash`/`Edit`/`Read`/`MCP`         | executable / file (0 duration)        |

### Wait tier (`claude-wait`)

Tools that block on the user — `AskUserQuestion`, `ExitPlanMode` — measure _think-time_, not
machine work, and a single overnight prompt can dwarf every real hook. They're reclassified to
the **`claude-wait`** tier and **excluded from report groups and totals by default**; the
excluded count + duration still shows in the header. Pass **`--include-wait`** to fold them in.

### Cursor (`--host cursor`)

Cursor's hooks (v1.7+, `.cursor/hooks.json`) are point events — there is **no
`afterShellExecution`** and hooks **can't rewrite commands** — so per-command durations
aren't available. The Cursor host records **turn durations** (`beforeSubmitPrompt` → `stop`,
`cursor-turn`) and **activity counts** (`cursor-tool`, 0 duration). Recorders are
non-blocking (Cursor only enforces `deny`; they emit `allow`).

## CLI

```
profile init | reset               # create / drop+recreate the SQLite DB
profile ingest --github --since 2026-07-01                 # pull GitHub Actions timings
profile report --from 2026-07-01 --to 2026-07-22           # whole-day range (wait tier excluded)
profile report --from 2026-07-22T14:00:00 --to 2026-07-22T14:30:00   # second-precise slice
profile report --last 1h                                   # rolling window (30s/90m/2h/1d)
profile report --from … --to … --include-wait              # fold user think-time back in
profile report --last 1h --no-color                        # plain text (color is on by default)
profile report --last 1d --group category                  # roll up into vcs/test/lint/pkg/…
profile report --from … --to … --group tier,command,subcommand --html
profile install [--target <dir>] [--wrap-hooks]            # wire recorders into a project
profile install --host cursor [--global]                  # wire Cursor recorders (.cursor/hooks.json)
profile install-git                                        # time each git-hook step in place
profile upgrade [--host cursor]                            # re-apply the current install (run after a git pull)
profile status / profile uninstall [--host cursor] / profile uninstall-git
```

**Categories & subcategories.** Every event is rolled up into a two-level taxonomy, **derived at
read time** (no stored column) from its tier/command/subcommand. The default report groups by
**`tier › category › subcategory › command`** — the leading `tier` keeps the source
(`claude-tool` / `claude-hook` / `github-action` / `git-hook`) visible, e.g.
`claude-tool › test › integration › npm`, `claude-tool › vcs › push › git`,
`claude-hook › hook › default › main-branch-guard`. Categories: **vcs** (git/gh), **test**, **lint**,
**build**, **pkg**, **search**, **sys**, **run** (other npm/npx/node), **shell** (cd/echo/sed/…
trivial builtins), **edit** / **read** (file tools), **agent** (Task/WebFetch/…), plus the
tier-driven **hook** (guards) and **wait** (excluded by default). The **subcategory** is the
specific verb/file-kind (`push`, `install`, `tsc`, a `.tsx` extension), or the literal `default`
when there's none. Regroup freely: `--group tier,command,subcommand`, `--group category`, etc.

**Color.** The text report is colorized by default — tier-tinted labels (tool cyan, hook indigo,
git-hook amber, wait purple), duration heat (green → yellow → red), dimmed counts. Disable with
`--no-color` or the standard `NO_COLOR` env var; it's auto-stripped for `--html`.

**Report ranges.** `--from`/`--to` take either a bare day (`2026-07-22`, snapped to the whole
UTC day) or a second-precise datetime (`2026-07-22T14:30:00`, interpreted in local time unless it
carries an explicit offset like `…Z`). `--last <span>` (`30s`/`90m`/`2h`/`1d`) reports a rolling
window ending now and overrides `--from`/`--to`.

`upgrade` (alias `update`) refreshes the full wiring in one shot — recorders, guard-wrapping,
and git-hook steps — re-applying only what's already installed (add `--wrap-hooks` / `--git`
to force those on). The recorder scripts are path-referenced, so their behavior updates on
`git pull` regardless; `upgrade` just refreshes the settings/git-hook wiring.

## Capture

Hot-path recorders (`hooks/*.sh`) write **directly into SQLite** (WAL mode) via
`profile record` — safe under parallel writers (many sessions / hooks at once). A tool
call's start lands in the `pending` table (PreToolUse) and is paired + split into
`event` rows on completion (PostToolUse); guards and git-hook steps insert completed rows.
`perl Time::HiRes` gives the µs clock; `jq` extracts payload fields. No flat file, no
offline ingest step (only GitHub timings are pulled on demand). `profile install` adds the
two tool recorders to `.claude/settings.local.json` and, with `--wrap-hooks`, wraps existing
hooks in `.claude/settings.json` for self-timing (transparent — stdout and exit preserved).

`profile install-git` wraps each step in the local `.git/hooks/pre-commit`/`pre-push` with
`hooks/profile-step.sh` in place (idempotent, reversible via `uninstall-git`), so every lint
step and test run is timed under the `git-hook` tier.

## Test

```
npm test        # node --test (unit + shell-integration; needs jq + perl)
```
