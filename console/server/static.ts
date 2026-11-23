import fs from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

// Serves files of a run (its HTML report, screenshots, traces) and the web app. A path that
// leaves its base folder is refused, however it is spelled.

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".zip": "application/zip",
  ".webm": "video/webm",
};

/** The file under `baseDir`, or null when the path leaves it or nothing is there. */
export function resolveInside(
  baseDir: string,
  relativePath: string
): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    return null;
  }
  try {
    const stats = fs.statSync(target);
    const file = stats.isDirectory() ? path.join(target, "index.html") : target;
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

export function serveFile(
  response: ServerResponse,
  baseDir: string,
  relativePath: string,
  headers: Record<string, string> = {}
): boolean {
  const file = resolveInside(baseDir, relativePath);
  if (file === null) {
    return false;
  }
  response.writeHead(200, {
    "content-type":
      CONTENT_TYPES[path.extname(file).toLowerCase()] ??
      "application/octet-stream",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  fs.createReadStream(file).pipe(response);
  return true;
}
