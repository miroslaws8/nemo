import type { IncomingMessage } from "node:http";
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response } from "express";
import { ACCESS, SETTINGS } from "../core/tokens";
import { HttpError } from "../http-error";
import type { IAccessControl, IConsoleSettings } from "../types";
import { requestState, setRequestState } from "./request-state";

// Every request passes here before its route. The console answers only at its own addresses (the
// Host, against DNS rebinding) and takes changes only as a JSON body from its own pages (the
// Origin, against cross-site requests). The files origin (QA_CONSOLE_FILES_URL) answers run files
// by ticket (/t/…) and nothing else; a page asked at another address of the console goes to its
// own. It works out who sends the request (for AccessGuard) and reads a POST's JSON body. Once the
// response is out, every change, and every refusal, goes to the audit log.

const MAX_BODY_BYTES = 1024 * 1024;
// Answered whatever the Host, for probes; they say nothing about runs.
const PROBE_PATHS: ReadonlySet<string> = new Set(["/api/health", "/api/ready"]);
// CI sends its runs with a token, not a session cookie: no browser, no Origin to check.
const INGEST_PATH = /^\/api\/ingest\//;
// The events of a CI run come in many small batches: only opening its stream is audited.
const INGEST_EVENTS_PATH = /^\/api\/ingest\/streams\/[^/]+\/events$/;
// Checks a skill.yaml and changes nothing; the Skills page asks at every pause in typing.
const SKILL_CHECK_PATH = "/api/skills/check";
const FILES_ORIGIN_PATH = /^\/t\//;

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "malformed path");
  }
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (text === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "the body is not JSON"));
      }
    });
    request.on("error", reject);
  });
}

// Every change (or attempt) and every refusal; the sign-in routes write their own.
function shouldAudit(
  method: string,
  pathname: string,
  status: number
): boolean {
  return (
    (method === "POST" &&
      !pathname.startsWith("/auth/") &&
      !INGEST_EVENTS_PATH.test(pathname) &&
      pathname !== SKILL_CHECK_PATH) ||
    status === 403
  );
}

@Injectable()
export class RequestMiddleware implements NestMiddleware {
  constructor(
    @Inject(SETTINGS) private readonly settings: IConsoleSettings,
    @Inject(ACCESS) private readonly access: IAccessControl
  ) {}

  use(
    request: Request,
    response: Response,
    next: (error?: unknown) => void
  ): void {
    this.prepare(request, response).then(
      (proceed) => {
        if (proceed) {
          next();
        }
      },
      (error: unknown) => next(error)
    );
  }

  // false: the response is already out (a redirect to the console's own address).
  private async prepare(
    request: Request,
    response: Response
  ): Promise<boolean> {
    const url = new URL(request.originalUrl, "http://console.local");
    const state = requestState(request);
    response.on("finish", () => this.audit(request, response));
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("cache-control", "no-store");
    const pathname = decodePath(url.pathname);
    const onFilesOrigin =
      this.settings.files !== null &&
      request.headers.host === this.settings.files.host;
    setRequestState(request, {
      ...state,
      pathname,
      onFilesOrigin,
      actor: this.access.actorOf(request),
    });
    if (request.method !== "GET" || !PROBE_PATHS.has(pathname)) {
      this.checkRequest(request, pathname);
    }
    if (onFilesOrigin !== FILES_ORIGIN_PATH.test(pathname)) {
      throw new HttpError(404, "not here");
    }
    if (!onFilesOrigin) {
      const elsewhere = this.access.redirectFor(request, url);
      if (elsewhere !== null) {
        response.writeHead(302, {
          location: elsewhere,
          "cache-control": "no-store",
        });
        response.end();
        return false;
      }
      // Nothing of the console's may be framed by another origin (the files origin above all).
      response.setHeader("x-frame-options", "SAMEORIGIN");
    }
    if (request.method === "POST") {
      request.body = await readJsonBody(request);
    }
    return true;
  }

  private checkRequest(request: IncomingMessage, pathname: string): void {
    if (!this.settings.allowedHosts.has(request.headers.host ?? "")) {
      throw new HttpError(403, "unexpected Host");
    }
    if (request.method !== "POST" || INGEST_PATH.test(pathname)) {
      return;
    }
    if (
      !(request.headers["content-type"] ?? "").startsWith("application/json")
    ) {
      throw new HttpError(415, "send a JSON body");
    }
    if (!this.settings.allowedOrigins.has(request.headers.origin ?? "")) {
      throw new HttpError(403, "unexpected Origin");
    }
  }

  private audit(request: Request, response: Response): void {
    const state = requestState(request);
    const method = request.method;
    if (
      state.onFilesOrigin ||
      !shouldAudit(method, state.pathname, response.statusCode)
    ) {
      return;
    }
    const body: unknown = request.body ?? null;
    this.access.audit({
      email: state.actor.email,
      role: state.actor.role,
      action: `${method} ${state.pathname}`,
      status: response.statusCode,
      detail: state.error === null ? body : { body, error: state.error },
    });
  }
}
