import { readFile, stat } from "node:fs/promises";
import {
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type WebHostOptions = {
  webRoot?: string;
  managerRoot?: string;
  backendOrigin?: string;
};

function sendError(
  response: ServerResponse,
  status: number,
  error: string,
): void {
  const body = JSON.stringify({ error });
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function proxyToBackend(
  incoming: IncomingMessage,
  response: ServerResponse,
  backendOrigin: string,
): void {
  const target = new URL(incoming.url ?? "/", backendOrigin);
  const upstream = httpRequest(
    target,
    {
      method: incoming.method,
      headers: { ...incoming.headers, host: target.host },
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) sendError(response, 502, "backend-unavailable");
    else response.destroy();
  });
  incoming.pipe(upstream);
}

async function serveStatic(
  incoming: IncomingMessage,
  response: ServerResponse,
  webRoot: string,
  pathname: string,
): Promise<boolean> {
  if (incoming.method !== "GET" && incoming.method !== "HEAD") return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendError(response, 400, "invalid-path");
    return true;
  }

  const root = resolve(webRoot);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let filePath = resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    sendError(response, 403, "forbidden");
    return true;
  }

  try {
    if (!(await stat(filePath)).isFile()) return false;
  } catch {
    if (extname(relative)) return false;
    filePath = resolve(root, "index.html");
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": filePath.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      "Content-Type":
        CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": body.byteLength,
    });
    response.end(incoming.method === "HEAD" ? undefined : body);
  } catch {
    sendError(response, 404, "not-found");
  }
  return true;
}

export async function handleWebRequest(
  incoming: IncomingMessage,
  response: ServerResponse,
  options: WebHostOptions,
): Promise<boolean> {
  const url = new URL(incoming.url ?? "/", "http://listen-gateway.local");
  if (url.pathname.startsWith("/api/") && options.backendOrigin) {
    proxyToBackend(incoming, response, options.backendOrigin);
    return true;
  }
  if (url.pathname === "/manager" && options.managerRoot) {
    response.writeHead(302, { Location: "/manager/" });
    response.end();
    return true;
  }
  if (url.pathname.startsWith("/manager/") && options.managerRoot) {
    return serveStatic(
      incoming,
      response,
      options.managerRoot,
      url.pathname.slice("/manager".length),
    );
  }
  if (options.webRoot) {
    return serveStatic(incoming, response, options.webRoot, url.pathname);
  }
  return false;
}
