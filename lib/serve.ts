import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport } from "./aggregate.ts";
import { nowMicros } from "./clock.ts";
import { openDb } from "./db.ts";
import { dbPath } from "./paths.ts";
import type { Db, ReportOptions } from "./types.ts";

/** Built React bundle (web/dist) — served as the UI when present; see web/README for the build. */
const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

/** Translate `/api/report` query params into a buildReport() options object. */
function reportOptions(params: URLSearchParams): ReportOptions {
  const group = params.get("group");
  const includeWait = params.get("includeWait");
  return {
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    last: params.get("last") || undefined,
    group: group ? group.split(",").filter(Boolean) : undefined,
    includeWait: includeWait === "1" || includeWait === "true",
  };
}

interface MetaRow {
  min: number | null;
  max: number | null;
  count: number;
}

/** Now plus the epoch-µs span of recorded events, so the UI can bound its datetime pickers. */
function meta(db: Db): { now: number; min: number | null; max: number | null; count: number } {
  const row = db
    .prepare(`SELECT MIN(start) AS min, MAX("end") AS max, COUNT(*) AS count FROM event`)
    .get() as unknown as MetaRow;
  return { now: nowMicros(), min: row.min, max: row.max, count: row.count };
}

/** Serve a file out of web/dist, falling back to index.html for client-side routes. */
async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const target = rel === "" ? "index.html" : rel;
  const full = join(WEB_DIST, target);
  // Keep resolved paths inside the bundle dir — never let `..` escape web/dist.
  if (full !== WEB_DIST && !full.startsWith(WEB_DIST + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  const body = await readFile(full).catch(() => null);
  if (body == null) {
    return serveIndex(res);
  }
  res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
  res.end(body);
}

async function serveIndex(res: ServerResponse): Promise<void> {
  const body = await readFile(join(WEB_DIST, "index.html")).catch(() => null);
  if (body == null) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      "<!doctype html><meta charset=utf-8><body style=\"font:14px system-ui;padding:2rem\">" +
        "<h1>hooker serve</h1><p>The web UI isn't built yet. Run:</p>" +
        "<pre>cd web &amp;&amp; npm install &amp;&amp; npm run build</pre>" +
        "<p>The API is live at <code>/api/report</code> and <code>/api/meta</code>.</p>",
    );
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

/** Route one request: `/api/*` returns JSON from the live DB, everything else is the web bundle. */
async function handle(req: IncomingMessage, res: ServerResponse, db: Db): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/api/report") {
      return sendJson(res, 200, buildReport(db, reportOptions(url.searchParams)));
    }
    if (url.pathname === "/api/meta") {
      return sendJson(res, 200, meta(db));
    }
    if (url.pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: `no route ${url.pathname}` });
    }
    return await serveStatic(res, url.pathname);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (url.pathname.startsWith("/api/")) {
      return sendJson(res, 400, { error: message });
    }
    res.writeHead(500).end(message);
  }
}

/** Options for {@link serve}. */
export interface ServeOptions {
  port?: number | undefined;
  host?: string | undefined;
  path?: string | undefined;
}

/**
 * Start the report server on `host:port`. Holds one WAL-mode connection open for the process
 * lifetime so range queries always read the latest committed events. Resolves to `{ server, url }`.
 */
export async function serve({
  port = 4180,
  host = "127.0.0.1",
  path = dbPath(),
}: ServeOptions = {}): Promise<{ server: Server; url: string }> {
  const db = await openDb(path);
  const server = createServer((req, res) => handle(req, res, db));
  server.on("close", () => db.close());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address() as AddressInfo;
  return { server, url: `http://${host}:${addr.port}` };
}
