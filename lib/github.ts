import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isoToMicros } from "./clock.ts";
import { insertMany } from "./record.ts";
import type { Db, EventInput } from "./types.ts";

const execFileAsync = promisify(execFile);

/** One step within a GitHub Actions job. */
interface Step {
  name: string;
  number: number;
  started_at: string | null;
  completed_at: string | null;
  conclusion: string | null;
}

/** One GitHub Actions job (with its steps) from the runs/jobs API. */
interface Job {
  id: number;
  run_id: number;
  name: string;
  workflow_name?: string;
  steps?: Step[];
}

/** Options for the Actions fetch/ingest helpers. */
export interface IngestOptions {
  repo?: string | undefined;
  since?: string | undefined;
  limit?: number | undefined;
}

/** Pure transform: GitHub Actions jobs (with steps[]) → completed events. Testable with a fixture. */
export function stepsToEvents(jobs: Job[]): EventInput[] {
  const events: EventInput[] = [];
  for (const job of jobs) {
    for (const step of job.steps ?? []) {
      if (!step.started_at || !step.completed_at) {
        continue;
      }
      events.push({
        start: isoToMicros(step.started_at),
        end: isoToMicros(step.completed_at),
        tier: "github-action",
        hook: `${job.workflow_name ?? "workflow"}/${job.name}`,
        command: step.name,
        status: step.conclusion,
        sourceKey: `${job.run_id}/${job.id}/${step.number}`,
      });
    }
  }
  return events;
}

async function gh(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    return repo;
  }
  const info = (await gh(["repo", "view", "--json", "nameWithOwner"])) as { nameWithOwner: string };
  return info.nameWithOwner;
}

async function fetchJobs(repo: string, runId: number): Promise<Job[]> {
  const data = (await gh(["api", `repos/${repo}/actions/runs/${runId}/jobs`])) as { jobs?: Job[] };
  return data.jobs ?? [];
}

/** Fetch recent workflow-run step timings from the GitHub Actions API as completed events. */
export async function fetchActionsEvents({ repo, since, limit = 30 }: IngestOptions = {}): Promise<EventInput[]> {
  const owner = await resolveRepo(repo);
  const query = since ? `created=>=${since}&per_page=${limit}` : `per_page=${limit}`;
  const runs = (await gh(["api", `repos/${owner}/actions/runs?${query}`])) as {
    workflow_runs?: Array<{ id: number }>;
  };
  const events: EventInput[] = [];
  for (const run of runs.workflow_runs ?? []) {
    events.push(...stepsToEvents(await fetchJobs(owner, run.id)));
  }
  return events;
}

/** Fetch + insert GitHub Actions timings (idempotent via source_key). Returns inserted count. */
export async function ingestGithub(db: Db, opts?: IngestOptions): Promise<number> {
  const events = await fetchActionsEvents(opts);
  return insertMany(db, events);
}
