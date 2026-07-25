/** Microseconds → human string (µs / ms / s), matching the CLI's formatDuration. */
export function formatDuration(us: number): string {
  if (us < 1000) return `${us} µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(1)} ms`;
  return `${(us / 1_000_000).toFixed(2)} s`;
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

const TIER_COLORS: Record<string, string> = {
  "claude-hook": "#6366f1",
  "claude-tool": "#0ea5e9",
  "claude-wait": "#a855f7",
  "git-hook": "#f59e0b",
  "github-action": "#10b981",
};

export function tierColor(tier?: string): string {
  return (tier && TIER_COLORS[tier]) ?? "#94a3b8";
}

/** epoch-µs → value for a <input type="datetime-local"> (local time, minute precision). */
export function microsToLocalInput(us: number): string {
  const d = new Date(us / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
