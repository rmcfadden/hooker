const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  indigo: "\x1b[38;5;99m",
  amber: "\x1b[38;5;214m",
  purple: "\x1b[38;5;171m",
};

/** A painter: wraps text in the named ANSI styles, or returns it untouched when disabled. */
export function makePaint(enabled) {
  return (text, ...styles) => {
    const codes = styles.map((s) => ANSI[s]).filter(Boolean);
    if (!enabled || codes.length === 0) {
      return String(text);
    }
    return `${codes.join("")}${text}${ANSI.reset}`;
  };
}

/**
 * Paint `[{text, style}]` segments into a fixed-width column: truncate the visible text with `…`
 * once it would exceed `width`, otherwise pad with spaces. Visible width is always `width + 1`, so
 * every row's following columns line up regardless of how long the label is.
 */
export function fitSegments(segments, width, paint) {
  let used = 0;
  let painted = "";
  for (const { text, style } of segments) {
    if (used >= width) {
      break;
    }
    const room = width - used;
    const shown = text.length > room ? `${text.slice(0, room - 1)}…` : text;
    painted += paint(shown, style);
    used += shown.length;
  }
  return painted + " ".repeat(width - used + 1);
}

const TIER_STYLE = {
  "claude-tool": "cyan",
  "claude-hook": "indigo",
  "git-hook": "amber",
  "github-action": "green",
  "claude-wait": "purple",
};

/** ANSI style name for a tier's label (unknown tiers dim to gray). */
export function tierStyle(tier) {
  return TIER_STYLE[tier] ?? "gray";
}

const CATEGORY_STYLE = {
  vcs: "amber",
  test: "green",
  lint: "yellow",
  build: "cyan",
  pkg: "purple",
  run: "cyan",
  search: "cyan",
  edit: "green",
  read: "gray",
  sys: "gray",
  shell: "gray",
  hook: "indigo",
  agent: "indigo",
  wait: "purple",
};

/** ANSI style name for a category's label (unknown categories dim to gray). */
export function categoryStyle(category) {
  return CATEGORY_STYLE[category] ?? "gray";
}

/** Duration heat: count-only 0µs dims, then green < 1s, yellow < 10s, red at or above. */
export function heatStyle(us) {
  if (us === 0) {
    return "gray";
  }
  if (us >= 10_000_000) {
    return "red";
  }
  if (us >= 1_000_000) {
    return "yellow";
  }
  return "green";
}

/** Whether to colorize: on by default; off for HTML output, `--no-color`, or the NO_COLOR env. */
export function colorEnabled(flags, env = process.env) {
  if (flags.html || env.NO_COLOR) {
    return false;
  }
  return flags["no-color"] !== true && flags.color !== "false";
}
