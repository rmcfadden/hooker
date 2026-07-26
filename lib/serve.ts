import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath } from "./paths.ts";
import { createService } from "./service.ts";
import type { HookerService } from "./service.ts";
import type { ReportOptions } from "./types.ts";

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
    "access-control-allow-methods": "GET, POST, OPTIONS",
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

/** Dispatch an `/api/*` request against the service. `control` mounts the mutating routes. */
async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  service: HookerService,
  control: boolean,
  url: URL,
): Promise<void> {
  const method = req.method ?? "GET";
  // Preflight so browsers can POST the control routes under the open-CORS posture.
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }
  if (url.pathname === "/api/report") {
    return sendJson(res, 200, service.report(reportOptions(url.searchParams)));
  }
  if (url.pathname === "/api/meta") {
    return sendJson(res, 200, service.meta());
  }
  if (url.pathname === "/api/status") {
    return sendJson(res, 200, await service.status());
  }
  // Control routes are opt-in (`--control`); otherwise they 404 like any unknown route.
  if (control && (url.pathname === "/api/enable" || url.pathname === "/api/disable")) {
    if (method !== "POST") {
      return sendJson(res, 405, { error: `use POST for ${url.pathname}` });
    }
    const enabled = url.pathname === "/api/enable";
    return sendJson(res, 200, { recording: await service.setEnabled(enabled) });
  }
  return sendJson(res, 404, { error: `no route ${url.pathname}` });
}

/** Route one request: `/api/*` returns JSON from the service, everything else is the web bundle. */
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  service: HookerService,
  control: boolean,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, service, control, url);
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
  /** Mount the state-mutating control routes (`POST /api/enable|disable`). Off by default. */
  control?: boolean | undefined;
}

/**
 * Start the report server on `host:port`. Holds one service (a WAL-mode connection) open for the
 * process lifetime so range queries always read the latest committed events. `control` opts into
 * the enable/disable routes. Resolves to `{ server, url }`.
 */
export async function serve({
  port = 4180,
  host = "127.0.0.1",
  path = dbPath(),
  control = false,
}: ServeOptions = {}): Promise<{ server: Server; url: string }> {
  const service = await createService({ path });
  const server = createServer((req, res) => handle(req, res, service, control));
  server.on("close", () => service.close());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address() as AddressInfo;
  return { server, url: `http://${host}:${addr.port}` };
}
