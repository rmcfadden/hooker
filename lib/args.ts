import type { Flags } from "./types.ts";

/** The next argv entry if it's a value (present and not another `--flag`), else null. */
function valueAt(argv: string[], i: number): string | null {
  const next = argv[i + 1];
  return next !== undefined && !next.startsWith("--") ? next : null;
}

/** Minimal flag parser: `--k v`, `--k=v`, and boolean `--flag`; everything else is positional. */
export function parseFlags(argv: string[]): { positional: string[]; flags: Flags } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const value = valueAt(argv, i);
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (value !== null) {
      flags[arg.slice(2)] = value;
      i += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { positional, flags };
}
