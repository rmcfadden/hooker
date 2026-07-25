import type { GroupCol, Report, ReportGroup } from "./types.ts";

const TIER_COLORS: Record<string, string> = {
  "claude-hook": "#6366f1",
  "claude-tool": "#0ea5e9",
  "claude-wait": "#a855f7",
  "git-hook": "#f59e0b",
  "github-action": "#10b981",
};

interface BarItem {
  label: string;
  total: number;
  tier: string | number | null | undefined;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Microseconds → human string (µs / ms / s), the report's canonical duration format. */
export function formatDuration(us: number): string {
  if (us < 1000) {
    return `${us} µs`;
  }
  if (us < 1_000_000) {
    return `${(us / 1000).toFixed(1)} ms`;
  }
  return `${(us / 1_000_000).toFixed(2)} s`;
}

function tierColor(tier: string | number | null | undefined): string {
  return TIER_COLORS[String(tier)] ?? "#94a3b8";
}

function barChartSvg(items: BarItem[], width = 640, rowHeight = 22): string {
  if (items.length === 0) {
    return "<p>No data.</p>";
  }
  const max = Math.max(...items.map((it) => it.total));
  const labelW = 220;
  const barW = width - labelW - 90;
  const bars = items
    .map((it, i) => {
      const y = i * rowHeight;
      const w = max ? Math.round((it.total / max) * barW) : 0;
      return `<g transform="translate(0,${y})">
  <text x="0" y="15" class="lbl">${escapeHtml(it.label)}</text>
  <rect x="${labelW}" y="4" width="${w}" height="14" fill="${tierColor(it.tier)}"/>
  <text x="${labelW + w + 6}" y="15" class="val">${escapeHtml(formatDuration(it.total))}</text>
</g>`;
    })
    .join("\n");
  return `<svg viewBox="0 0 ${width} ${items.length * rowHeight}" width="${width}" role="img">${bars}</svg>`;
}

function groupLabel(group: ReportGroup, groupCols: GroupCol[]): string {
  return groupCols
    .map((col) => group[col])
    .filter((part) => part != null && part !== "")
    .join(" › ");
}

function summaryRows(groups: ReportGroup[], groupCols: GroupCol[]): string {
  return groups
    .map(
      (g) => `<tr>
  <td>${escapeHtml(groupLabel(g, groupCols))}</td>
  <td class="n">${g.count}</td>
  <td class="n">${escapeHtml(formatDuration(g.total))}</td>
  <td class="n">${escapeHtml(formatDuration(g.avg))}</td>
  <td class="n">${escapeHtml(formatDuration(g.p95))}</td>
  <td class="n">${g.failures}</td>
</tr>`,
    )
    .join("\n");
}

function topBars(groups: ReportGroup[], groupCols: GroupCol[]): BarItem[] {
  return groups.slice(0, 15).map((g) => ({
    label: groupLabel(g, groupCols),
    total: g.total,
    tier: g.tier,
  }));
}

const STYLE = `body{font:14px/1.5 system-ui,sans-serif;margin:2rem;color:#0f172a}
h1{font-size:1.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{padding:.4rem .6rem;border-bottom:1px solid #e2e8f0;text-align:left}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.lbl{font:12px system-ui}.val{font:12px system-ui;fill:#475569}
.meta{color:#64748b}`;

/** Human label for a report's window: a relative `last` span, else the from → to bounds. */
export function rangeLabel(report: Report): string {
  if (report.last) {
    return `last ${report.last}`;
  }
  return `${report.from ?? "beginning"} → ${report.to ?? "now"}`;
}

function waitNote(report: Report): string {
  if (report.wait.count === 0) {
    return "";
  }
  const verb = report.includeWait ? "includes" : "excludes";
  const hint = report.includeWait ? "" : " — pass --include-wait";
  return ` · ${verb} ${report.wait.count} wait events (${escapeHtml(formatDuration(report.wait.total))}${hint})`;
}

/** Render the report payload from buildReport() into a self-contained HTML document. */
export function renderReport(report: Report): string {
  const { groupCols, groups, totals } = report;
  const range = rangeLabel(report);
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Hook &amp; tool profile ${escapeHtml(range)}</title><style>${STYLE}</style></head><body>
<h1>Hook &amp; tool-call profile</h1>
<p class="meta">Range ${escapeHtml(range)} · ${totals.count} events · ${escapeHtml(formatDuration(totals.total))} total · ${totals.failures} failures${waitNote(report)}</p>
<h2>Top by total time</h2>
${barChartSvg(topBars(groups, groupCols))}
<h2>Breakdown by ${escapeHtml(groupCols.join(" / "))}</h2>
<table><thead><tr><th>${escapeHtml(groupCols.join(" › "))}</th><th class="n">count</th><th class="n">total</th><th class="n">avg</th><th class="n">p95</th><th class="n">fails</th></tr></thead>
<tbody>${summaryRows(groups, groupCols)}</tbody></table>
</body></html>`;
}
