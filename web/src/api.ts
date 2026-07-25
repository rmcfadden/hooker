// Mirrors the payloads from lib/serve.mjs (buildReport + meta). Durations are microseconds.

export interface Group {
  tier?: string;
  category?: string;
  subcategory?: string;
  command?: string;
  hook?: string;
  subcommand?: string;
  count: number;
  total: number;
  avg: number;
  p50: number;
  p95: number;
  failures: number;
}

export interface Totals {
  count: number;
  total: number;
  failures: number;
}

export interface Report {
  from: string | null;
  to: string | null;
  last: string | null;
  includeWait: boolean;
  groupCols: string[];
  groups: Group[];
  totals: Totals;
  wait: Totals;
}

export interface Meta {
  now: number;
  min: number | null;
  max: number | null;
  count: number;
}

export interface ReportQuery {
  from?: string;
  to?: string;
  last?: string;
  group?: string;
  includeWait?: boolean;
}

function qs(query: ReportQuery): string {
  const params = new URLSearchParams();
  if (query.last) params.set("last", query.last);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.group) params.set("group", query.group);
  if (query.includeWait) params.set("includeWait", "1");
  return params.toString();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function fetchReport(query: ReportQuery): Promise<Report> {
  return getJson<Report>(`/api/report?${qs(query)}`);
}

export function fetchMeta(): Promise<Meta> {
  return getJson<Meta>("/api/meta");
}
