function takesValue(argv, i) {
  const next = argv[i + 1];
  return next !== undefined && !next.startsWith("--");
}

/** Minimal flag parser: `--k v`, `--k=v`, and boolean `--flag`; everything else is positional. */
export function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (takesValue(argv, i)) {
      flags[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { positional, flags };
}
