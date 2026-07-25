import type { Group, Report } from "./api";
import { formatCount, formatDuration, tierColor } from "./format";

function groupLabel(g: Group, cols: string[]): string {
  return cols
    .map((c) => (g as unknown as Record<string, unknown>)[c])
    .filter((v) => v != null && v !== "")
    .join(" › ");
}

function Totals({ report }: { report: Report }) {
  const { totals, wait, includeWait } = report;
  return (
    <div className="flex flex-wrap gap-4">
      <Stat label="Events" value={formatCount(totals.count)} />
      <Stat label="Total time" value={formatDuration(totals.total)} accent />
      <Stat label="Failures" value={formatCount(totals.failures)} danger={totals.failures > 0} />
      {wait.count > 0 && (
        <Stat
          label={includeWait ? "Wait (included)" : "Wait (excluded)"}
          value={`${formatCount(wait.count)} · ${formatDuration(wait.total)}`}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
}) {
  const tone = danger ? "text-rose-600" : accent ? "text-sky-600" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function TopBars({ report }: { report: Report }) {
  const top = report.groups.slice(0, 15);
  const max = Math.max(1, ...top.map((g) => g.total));
  return (
    <div className="space-y-1">
      {top.map((g, i) => {
        const label = groupLabel(g, report.groupCols);
        return (
          <div key={`${label}-${i}`} className="flex items-center gap-3">
            <div className="w-64 shrink-0 truncate text-right text-sm text-slate-600" title={label}>
              {label}
            </div>
            <div className="relative h-5 flex-1 rounded bg-slate-100">
              <div
                className="h-5 rounded"
                style={{ width: `${(g.total / max) * 100}%`, background: tierColor(g.tier) }}
              />
            </div>
            <div className="w-24 shrink-0 text-sm tabular-nums text-slate-500">
              {formatDuration(g.total)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownTable({ report }: { report: Report }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{report.groupCols.join(" › ")}</th>
            {["count", "total", "avg", "p95", "fails"].map((h) => (
              <th key={h} className="px-3 py-2 text-right font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.groups.map((g, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-1.5">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: tierColor(g.tier) }}
                />
                {groupLabel(g, report.groupCols)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(g.count)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                {formatDuration(g.total)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                {formatDuration(g.avg)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                {formatDuration(g.p95)}
              </td>
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${
                  g.failures > 0 ? "text-rose-600" : "text-slate-400"
                }`}
              >
                {g.failures}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportView({ report }: { report: Report }) {
  if (report.totals.count === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-400">
        No events in this range.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <Totals report={report} />
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Top by total time</h2>
        <TopBars report={report} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">Breakdown</h2>
        <BreakdownTable report={report} />
      </section>
    </div>
  );
}
