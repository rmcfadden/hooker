import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMeta, fetchReport, type Report, type ReportQuery } from "./api";
import { defaultCustom, type Range, RangePicker } from "./RangePicker";
import { ReportView } from "./ReportView";

/** Group-by presets → the `group` query param (empty = the server's default grouping). */
const GROUPS: { label: string; group: string }[] = [
  { label: "Tier › Category › Subcat › Command", group: "" },
  { label: "By tier", group: "tier" },
  { label: "By category", group: "tier,category" },
  { label: "By command", group: "tier,command" },
  { label: "By hook", group: "tier,hook" },
];

const controlClass =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm " +
  "focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

function queryOf(range: Range, group: string, includeWait: boolean): ReportQuery {
  const base: ReportQuery = { group: group || undefined, includeWait };
  if (range.kind === "custom") return { ...base, from: range.from, to: range.to };
  return { ...base, last: range.last };
}

export default function App() {
  const [now, setNow] = useState(() => Date.now() * 1000);
  const [range, setRange] = useState<Range>({ kind: "preset", label: "Last 24 hours", last: "24h" });
  const [group, setGroup] = useState("");
  const [includeWait, setIncludeWait] = useState(false);
  const [auto, setAuto] = useState(false);

  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const query = useMemo(() => queryOf(range, group, includeWait), [range, group, includeWait]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rep, meta] = await Promise.all([fetchReport(query), fetchMeta()]);
      setReport(rep);
      setNow(meta.now);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [auto, load]);

  // A custom range seeded before meta's `now` arrived stays stale; refresh its bounds once we know now.
  const seedCustom = () => setRange({ kind: "custom", ...defaultCustom(now) });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Hook &amp; tool-call profile</h1>
          <p className="text-sm text-slate-500">
            Live from <code className="rounded bg-slate-200 px-1">hooker serve</code>
            {updatedAt && ` · updated ${updatedAt.toLocaleTimeString()}`}
            {loading && " · loading…"}
          </p>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <RangePicker range={range} now={now} onChange={setRange} />

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Group</label>
            <select
              className={controlClass}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              {GROUPS.map((g) => (
                <option key={g.label} value={g.group}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includeWait}
              onChange={(e) => setIncludeWait(e.target.checked)}
            />
            Include wait time
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-refresh
          </label>

          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error} — is <code>hooker serve</code> running?{" "}
            <button className="underline" onClick={seedCustom}>
              reset range
            </button>
          </div>
        )}

        {report && <ReportView report={report} />}
      </div>
    </div>
  );
}
