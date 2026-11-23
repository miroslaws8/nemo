import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { isGuarded, requireOnEnvironment } from "../auth/permissions";
import { HttpError } from "../http-error";
import type { RunManager } from "../run-manager";
import { runFile, runIdFrom } from "../run-store";
import { serveFile } from "../static";
import type { IActor, IConsoleSettings, IFilesSettings } from "../types";
import { FileTickets, type ITicketScope } from "./tickets";

// A run's files: its HTML report (with Playwright's trace viewer), its attachments (traces, error
// context) and its step screenshots. Branch code writes them, so a console with
// QA_CONSOLE_FILES_URL serves them from that origin and never from its own: at
// /runs/<id>/report/… and /runs/<id>/files/… it checks who asks and sends the browser on with a
// ticket for that run. Without it the console serves them itself, as before. The controllers
// (files.controller.ts, files-host.controller.ts) take the requests; this decides what they get.

/** A request for run files, as a controller hands it over. */
export interface IFileExchange {
  request: IncomingMessage;
  response: ServerResponse;
  query: URLSearchParams;
}

/** What a console does with a request for run files. */
export interface IRunFiles {
  // At the console's own address: the file itself, or the browser sent on to the files origin.
  deliver(exchange: IFileExchange, file: IRunFile): void;
  // At the files origin, by ticket (404 for a console without one).
  serveByTicket(exchange: IFileExchange, ticket: string, file: IRunFile): void;
}

/** One requested file: under the run's report (html/) or one of its folders. */
export interface IRunFile {
  id: string;
  // "report", or "files/<folder>"
  part: string;
  // The folder in the run directory.
  folder: string;
  // Relative to the folder; "" for its index.html.
  path: string;
  scope: ITicketScope;
}

// Live screenshots go to whoever may watch the run; attachments (traces hold session tokens) to
// whoever may read its reports.
const FOLDERS: ReadonlyMap<string, ITicketScope> = new Map([
  ["shots", "watch"],
  ["artifacts", "report"],
]);

function notFound(): never {
  throw new HttpError(404, "not found");
}

/** A run's report and attachments: prod's take an operator. */
export function requireReadable(
  manager: RunManager,
  actor: IActor,
  id: string
): void {
  const env = manager.environmentOf(id);
  requireOnEnvironment(
    actor,
    "read",
    isGuarded(env),
    `Opening the reports and traces of ${env} runs`
  );
}

/** A file of a run's report ("" for its index.html). */
export function reportFile(id: string, relativePath: string): IRunFile {
  return {
    id: runIdFrom({ id }),
    part: "report",
    folder: "html",
    path: relativePath,
    scope: "report",
  };
}

/** A file of one of a run's folders (shots, artifacts). */
export function folderFile(
  id: string,
  folder: string,
  relativePath: string
): IRunFile {
  const scope = FOLDERS.get(folder) ?? notFound();
  return {
    id: runIdFrom({ id }),
    part: `files/${folder}`,
    folder,
    path: relativePath,
    scope,
  };
}

function encodePath(relative: string): string {
  return relative.split("/").map(encodeURIComponent).join("/");
}

/** The file's address below an origin (or a ticket prefix), as the console spells it. */
function addressOf(file: IRunFile, search: string): string {
  return `/runs/${encodeURIComponent(file.id)}/${file.part}/${encodePath(
    file.path
  )}${search}`;
}

function serve(
  response: ServerResponse,
  file: IRunFile,
  headers: Record<string, string> = {}
): void {
  const served = serveFile(
    response,
    runFile(file.id, file.folder),
    file.path || "index.html",
    headers
  );
  if (!served) {
    notFound();
  }
}

/** Without QA_CONSOLE_FILES_URL: the console's own origin serves them. */
class SameOriginFiles implements IRunFiles {
  deliver(exchange: IFileExchange, file: IRunFile): void {
    serve(exchange.response, file);
  }

  serveByTicket(): void {
    notFound();
  }
}

// What the files origin answers: no referrer (the ticket is in the path) and nothing cached.
const FILES_ORIGIN_HEADERS = { "referrer-policy": "no-referrer" };
// The page a link from elsewhere gets: it may not be framed or keep a handle on its opener.
const HANDOFF_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
};
// Browsers say where a request comes from (Fetch Metadata). The console sends a browser on with a
// ticket only for its own pages or an address typed in; anything else (the files origin itself
// above all, which is same-site) first gets a page with a link to click.
const HANDS_OFF_FOR: ReadonlySet<string> = new Set(["same-origin", "none"]);

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** With QA_CONSOLE_FILES_URL: the console checks and sends on; that origin serves by ticket. */
class OwnOriginFiles implements IRunFiles {
  private readonly tickets: FileTickets;

  constructor(
    private readonly files: IFilesSettings,
    private readonly consoleOrigins: ReadonlySet<string>,
    stateDir: string
  ) {
    this.tickets = new FileTickets(path.join(stateDir, "files-secret"));
  }

  deliver(exchange: IFileExchange, file: IRunFile): void {
    this.handOff(exchange, file);
  }

  serveByTicket(exchange: IFileExchange, ticket: string, file: IRunFile): void {
    if (!this.tickets.opens(ticket, file.id, file.scope)) {
      throw new HttpError(
        403,
        "this link has expired or is not for this run: open it again from the QA console"
      );
    }
    serve(exchange.response, file, FILES_ORIGIN_HEADERS);
  }

  private handOff(exchange: IFileExchange, file: IRunFile): void {
    const { request, response } = exchange;
    const site = request.headers["sec-fetch-site"];
    if (typeof site === "string" && !HANDS_OFF_FOR.has(site)) {
      const here = addressOf(file, this.searchOf(exchange, null));
      response.writeHead(200, HANDOFF_PAGE_HEADERS);
      response.end(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Run ${escapeHtml(
          file.id
        )} — QA Console</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:4rem auto;max-width:34rem;padding:0 1rem}</style><p>The files of run ${escapeHtml(
          file.id
        )} open on the console's file address.</p><p><a href="${escapeHtml(
          here
        )}">Open them</a></p>`
      );
      return;
    }
    const ticketed = `${this.files.url}/t/${this.tickets.issue(
      file.id,
      file.scope
    )}`;
    response.writeHead(302, {
      location: `${ticketed}${addressOf(
        file,
        this.searchOf(exchange, { file, ticketed })
      )}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    response.end();
  }

  // The query as asked; the trace viewer's ?trace= (a file of this run on the console's address)
  // moves to the files origin with the same ticket.
  private searchOf(
    exchange: IFileExchange,
    target: { file: IRunFile; ticketed: string } | null
  ): string {
    const query = new URLSearchParams(exchange.query);
    const trace = query.get("trace");
    if (target !== null && trace !== null) {
      query.set(
        "trace",
        this.movedTrace(trace, target.file.id, target.ticketed)
      );
    }
    const search = query.toString();
    return search === "" ? "" : `?${search}`;
  }

  private movedTrace(trace: string, id: string, ticketed: string): string {
    let url: URL;
    try {
      url = new URL(trace);
    } catch {
      return trace;
    }
    const prefix = `/runs/${encodeURIComponent(id)}/files/`;
    return this.consoleOrigins.has(url.origin) &&
      url.pathname.startsWith(prefix)
      ? `${ticketed}${url.pathname}${url.search}`
      : trace;
  }
}

export function createRunFiles(settings: IConsoleSettings): IRunFiles {
  return settings.files === null
    ? new SameOriginFiles()
    : new OwnOriginFiles(
        settings.files,
        settings.allowedOrigins,
        settings.stateDir
      );
}
