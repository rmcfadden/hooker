import { basename } from "node:path";
import { resolveTier } from "./tiers.ts";

const MULTIPLEXERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const SUBCOMMAND_TOOLS = new Set(["git", "gh", "docker", "cargo", "kubectl"]);
const PREFIXES = new Set([
  "sudo",
  "command",
  "time",
  "env",
  "nice",
  "nohup",
  "xargs",
  "then",
  "do",
]);
const TRIVIAL = new Set([
  "echo",
  "tail",
  "head",
  "cat",
  "true",
  ":",
  "wc",
  "ls",
  "printf",
  "sleep",
  "pwd",
  "sed",
]);
const SEQUENCE_SEPS = ["&&", ";", "\n"];
const LABEL_SEPS = ["&&", "||", ";", "|", "\n"];
const HEREDOC = /<<-?\s*['"]?([A-Za-z_][\w]*)['"]?/;

const SHELL_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "select",
  "function",
  "in",
  "time",
]);
const SHELL_BUILTINS = new Set([
  "export",
  "local",
  "readonly",
  "declare",
  "eval",
  "set",
  "unset",
  "trap",
  "shift",
  "return",
  "break",
  "continue",
  "exit",
  "source",
  "mapfile",
  "read",
]);
const COMMAND_HEAD = /^[A-Za-z_./][\w.@/+-]*$/;

/** A shell token that isn't a real executable name: a keyword/builtin, an assignment, or a
 * fragment/operator (`$f`, `}`, `(cd`, `-s`, `json'`) left over from splitting complex bash. */
function isNoiseHead(token) {
  if (!token || !COMMAND_HEAD.test(token) || /^\w+\+?=/.test(token)) {
    return true;
  }
  return SHELL_KEYWORDS.has(token) || SHELL_BUILTINS.has(token);
}

function splitStep(ctx, i) {
  const { command, separators, state } = ctx;
  const c = command[i];
  if (state.quote) {
    state.buf += c;
    state.quote = c === state.quote ? null : state.quote;
    return i;
  }
  if (c === "'" || c === '"') {
    state.quote = c;
    state.buf += c;
    return i;
  }
  if (c === "\\") {
    state.buf += c + (command[i + 1] ?? "");
    return i + 1;
  }
  const sep = separators.find((s) => command.startsWith(s, i));
  if (sep) {
    state.parts.push(state.buf);
    state.buf = "";
    return i + sep.length - 1;
  }
  state.buf += c;
  return i;
}

/** Split respecting single/double quotes and backslash escapes; `separators` matched longest-first. */
function quoteAwareSplit(command, separators) {
  const ctx = {
    command,
    separators,
    state: { parts: [], buf: "", quote: null },
  };
  for (let i = 0; i < command.length; i += 1) {
    i = splitStep(ctx, i);
  }
  ctx.state.parts.push(ctx.state.buf);
  return ctx.state.parts.map((part) => part.trim()).filter(Boolean);
}

/** Drop heredoc bodies (`cmd <<'EOF' … EOF`) so their contents aren't mistaken for commands. */
function stripHeredocs(command) {
  if (!command.includes("<<")) {
    return command;
  }
  const kept = [];
  let delim = null;
  for (const line of command.split("\n")) {
    if (delim !== null) {
      if (line.trim() === delim) {
        delim = null;
      }
      continue;
    }
    const match = line.match(HEREDOC);
    if (match) {
      delim = match[1];
      kept.push(line.slice(0, match.index));
    } else {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

function stripPrefixes(segment) {
  const tokens = segment.trim().split(/\s+/);
  while (
    tokens.length > 1 &&
    (/^\w+=/.test(tokens[0]) || PREFIXES.has(tokens[0]))
  ) {
    tokens.shift();
  }
  return tokens;
}

/** First real command of a shell segment (scans across pipes/operators), as tokens — skips `cd`,
 * env prefixes, and shell noise. `null` when the segment is pure noise (a bare `cd` stays labeled). */
function firstMeaningfulTokens(command) {
  for (const stage of quoteAwareSplit(command, LABEL_SEPS)) {
    const tokens = stripPrefixes(stage);
    if (tokens[0] && tokens[0] !== "cd" && !isNoiseHead(tokens[0])) {
      return tokens;
    }
  }
  const fallback = stripPrefixes(command);
  return fallback[0] === "cd" ? fallback : null;
}

function partsFromTokens(tokens) {
  if (!tokens) {
    return { command: null, subcommand: null };
  }
  const head = basename(tokens[0] ?? "") || "sh";
  const next = tokens[1];
  if (MULTIPLEXERS.has(head)) {
    if (next === "run" && tokens[2]) {
      return { command: head, subcommand: tokens[2] };
    }
    return { command: head, subcommand: next ?? null };
  }
  if (head === "npx" && next) {
    return { command: head, subcommand: basename(next) };
  }
  if (SUBCOMMAND_TOOLS.has(head) && next) {
    return { command: head, subcommand: next };
  }
  if (head === "node" && next && !next.startsWith("-")) {
    return { command: head, subcommand: basename(next) };
  }
  return { command: head, subcommand: null };
}

/** `{command, subcommand}` for one shell segment: executable + its verb/script (skips `cd`/env). */
export function bashParts(command) {
  return partsFromTokens(firstMeaningfulTokens(command ?? ""));
}

/** `{command, subcommand}` for a tool call: Bash → executable/verb; other tools → tool/target
 * (Edit › filename), so the operation shows. Targetless tools (Task, AskUserQuestion) → tool/null. */
export function deriveParts(tool, raw) {
  if (tool === "Bash") {
    return bashParts(raw);
  }
  const target = raw && raw !== tool ? basename(raw) : null;
  return { command: tool, subcommand: target };
}

/** Top-level sequential commands of a shell line (split on `&&`/`;`/newline, quote/heredoc aware). */
export function splitSequence(command) {
  return quoteAwareSplit(stripHeredocs(command ?? ""), SEQUENCE_SEPS);
}

/** Index of the last non-trivial command — the one that did the work, not a trailing `tail`/`echo`. */
function primaryIndex(parts) {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!TRIVIAL.has(parts[i].command)) {
      return i;
    }
  }
  return parts.length - 1;
}

function bashRows(source) {
  const segments = splitSequence(source ?? "");
  const parts = (segments.length <= 1 ? [source] : segments)
    .map((segment) => bashParts(segment))
    .filter((part) => part.command !== null);
  if (parts.length === 0) {
    return [{ command: "sh", subcommand: null, primary: true }];
  }
  const primary = primaryIndex(parts);
  return parts.map((part, i) => ({ ...part, primary: i === primary }));
}

/**
 * Expand one paired tool timing into event rows. A Bash call splits (quote/heredoc aware) on
 * `&&`/`;`/newline into one row per sub-command — the last non-trivial one is primary and gets the
 * full [start, end]; the rest are count-only ([end, end], 0 µs). Non-Bash calls yield a single row.
 */
export function toEvents({ tier, hook, source, start, end, status }) {
  const resolvedStatus = status ?? "success";
  const resolvedTier = resolveTier(tier, hook);
  const rows =
    hook === "Bash"
      ? bashRows(source)
      : [{ ...deriveParts(hook, source), primary: true }];
  return rows.map((row) => ({
    start: row.primary ? start : end,
    end,
    tier: resolvedTier,
    hook,
    command: row.command,
    subcommand: row.subcommand,
    status: resolvedStatus,
    sourceKey: null,
  }));
}
