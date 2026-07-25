import { microsToLocalInput } from "./format";

/** A relative preset resolves server-side to `last`; `custom` uses the from/to datetime inputs. */
export type Range =
  | { kind: "preset"; label: string; last?: string }
  | { kind: "custom"; from: string; to: string };

/** Relative windows offered in the dropdown. `last` values are durations the CLI parser accepts. */
export const PRESETS: { label: string; last?: string }[] = [
  { label: "Last 15 minutes", last: "15min" },
  { label: "Last hour", last: "1h" },
  { label: "Last 6 hours", last: "6h" },
  { label: "Last 24 hours", last: "24h" },
  { label: "Last 7 days", last: "7d" },
  { label: "Last 30 days", last: "30d" },
  { label: "All time" },
  { label: "Custom range…" },
];

const CUSTOM = "Custom range…";

const selectClass =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm " +
  "focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

/** Sensible default custom window: the last day up to now, seeded from the data span when known. */
export function defaultCustom(now: number): { from: string; to: string } {
  return { from: microsToLocalInput(now - 86_400_000_000), to: microsToLocalInput(now) };
}

export function RangePicker({
  range,
  now,
  onChange,
}: {
  range: Range;
  now: number;
  onChange: (next: Range) => void;
}) {
  const selected = range.kind === "custom" ? CUSTOM : range.label;

  function pickPreset(label: string) {
    if (label === CUSTOM) {
      onChange({ kind: "custom", ...defaultCustom(now) });
      return;
    }
    const preset = PRESETS.find((p) => p.label === label);
    onChange({ kind: "preset", label, last: preset?.last });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm font-medium text-slate-600">Range</label>
      <select
        className={selectClass}
        value={selected}
        onChange={(e) => pickPreset(e.target.value)}
      >
        {PRESETS.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
          </option>
        ))}
      </select>

      {range.kind === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            className={selectClass}
            value={range.from}
            max={range.to}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
          />
          <span className="text-slate-400">→</span>
          <input
            type="datetime-local"
            className={selectClass}
            value={range.to}
            min={range.from}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
