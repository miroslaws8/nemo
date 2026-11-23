import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  IIngestAgentChecks,
  IIngestClaim,
  IIngestCursor,
} from "../console/shared/types.ts";

// Sends a CI run to the server QA console as it goes, so people watch it there as they watch the
// console's own runs (docs/guide.md → QA Console → CI runs live). Node runs this file directly (no npm
// packages).
//   node ci/ingest.mts wait     before the run: waits while a run of the console's own uses the
//                               environment (it then holds it for this step); at most 20 minutes,
//                               and not at all once the console does not answer for 30 s
//   node ci/ingest.mts follow   during the run (ci/run.sh starts it and stops it with SIGTERM):
//                               opens a stream for this pipeline, sends reports/events.ndjson in
//                               batches and, while someone watches, the step screenshots; once
//                               stopped it sends what is left for up to a minute (a console
//                               it never reached gets one last try)
//   node ci/ingest.mts report   in the after-script: the HTML report, attachments and screenshots
//   node ci/ingest.mts agents   has the console queue the agent checks its environment lists
//                               (agent_checks in e2e.config.yaml): in an e2e step's after-script
//                               with --after-deploy (only when the step tested a deploy:
//                               reports/ready.json), or in a scheduled agent-checks-* pipeline
// Without QA_CONSOLE_INGEST_URL and QA_CONSOLE_INGEST_TOKEN it does nothing. It never fails the
// step: a console that is down or refuses only means the run is not seen there.

const ROOT = path.resolve(import.meta.dirname, "..");
const REPORTS = path.join(ROOT, "reports");
// What ci/wait-for-deploy.ts found: "ready" when the step tested the deploy that started it.
const READY_FILE = path.join(REPORTS, "ready.json");
const EVENTS = path.join(REPORTS, "events.ndjson");
// The stream follow opened, for report (another process, after the run).
const STREAM_FILE = path.join(REPORTS, "console-stream.json");
const REPORT_ARCHIVE = path.join(REPORTS, "console-report.tgz");
const REPORT_PARTS = ["html", "artifacts", "shots"];
const MAX_BATCH_EVENTS = 1000;
const MAX_BATCH_BYTES = 800 * 1024;
const MAX_REPORT_BYTES = 200 * 1024 * 1024;
const POLL_MS = 500;
// After the run: a minute to send what is left, or one last try at a console never reached.
const FLUSH_MS = 60_000;
const LAST_TRY_MS = 5000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
// Waiting for the environment: the tests start anyway after 20 minutes, or once the console has
// not answered for 30 s (asked every 5 s meanwhile).
const WAIT_MAX_MS = 20 * 60_000;
const WAIT_UNANSWERED_MS = 30_000;
const WAIT_RETRY_MS = 5000;
const REQUEST_TIMEOUT_MS = 30_000;
const REPORT_TIMEOUT_MS = 5 * 60_000;

interface ISettings {
  url: string;
  token: string;
  pipeline: number;
  env: string;
  profile: string;
}

/** One line of the events file: its seq and the line as written. */
interface IEventLine {
  seq: number;
  line: string;
  shot: string | null;
}

/** The console said no for good (no such pipeline, a wrong token): stop trying. */
class Refused extends Error {}

function log(message: string): void {
  console.log(`[qa-console] ${message}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSettings(): ISettings | null {
  const url = (process.env.QA_CONSOLE_INGEST_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  const token = (process.env.QA_CONSOLE_INGEST_TOKEN ?? "").trim();
  if (url === "" || token === "") {
    return null;
  }
  const pipeline = Number(process.env.BITBUCKET_BUILD_NUMBER ?? "");
  if (!Number.isInteger(pipeline) || pipeline <= 0) {
    log("no BITBUCKET_BUILD_NUMBER: not a CI run, nothing to send");
    return null;
  }
  return {
    url,
    token,
    pipeline,
    env: process.env.E2E_ENV ?? "staging",
    profile: process.env.E2E_PROFILE ?? "smoke",
  };
}

function isCursor(value: unknown): value is IIngestCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "next" in value &&
    typeof value.next === "number" &&
    "wantShots" in value &&
    typeof value.wantShots === "boolean"
  );
}

function isClaim(value: unknown): value is IIngestClaim {
  return (
    typeof value === "object" &&
    value !== null &&
    "granted" in value &&
    typeof value.granted === "boolean" &&
    "waitingFor" in value &&
    (value.waitingFor === null || typeof value.waitingFor === "string") &&
    "retryMs" in value &&
    typeof value.retryMs === "number"
  );
}

function isAgentChecks(value: unknown): value is IIngestAgentChecks {
  return (
    typeof value === "object" &&
    value !== null &&
    "note" in value &&
    (value.note === null || typeof value.note === "string") &&
    "checks" in value &&
    Array.isArray(value.checks) &&
    value.checks.every(
      (check: unknown) =>
        typeof check === "object" &&
        check !== null &&
        "skill" in check &&
        typeof check.skill === "string" &&
        "runId" in check &&
        (check.runId === null || typeof check.runId === "string") &&
        "problem" in check &&
        (check.problem === null || typeof check.problem === "string")
    )
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(
  settings: ISettings,
  method: string,
  route: string,
  body: string | Blob,
  contentType: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  return fetch(`${settings.url}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${settings.token}`,
      "content-type": contentType,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// An answer of the expected shape (a cursor comes with a 409 too); otherwise a 4xx is final.
async function answerOf<TAnswer>(
  response: Response,
  isAnswer: (value: unknown) => value is TAnswer
): Promise<TAnswer> {
  const body: unknown = await response.json().catch(() => null);
  if (isAnswer(body)) {
    return body;
  }
  const reason =
    typeof body === "object" && body !== null && "error" in body
      ? String(body.error)
      : response.statusText;
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 429
  ) {
    throw new Refused(`${response.status} ${reason}`);
  }
  throw new Error(`${response.status} ${reason}`);
}

function cursorOf(response: Response): Promise<IIngestCursor> {
  return answerOf(response, isCursor);
}

/** The new lines of the events file since the last read (whole lines only). */
class EventReader {
  private offset = 0;
  private rest = "";

  read(): IEventLine[] {
    let size: number;
    try {
      size = fs.statSync(EVENTS).size;
    } catch {
      return [];
    }
    if (size <= this.offset) {
      return [];
    }
    const buffer = Buffer.alloc(size - this.offset);
    const descriptor = fs.openSync(EVENTS, "r");
    try {
      fs.readSync(descriptor, buffer, 0, buffer.length, this.offset);
    } finally {
      fs.closeSync(descriptor);
    }
    this.offset = size;
    const lines = `${this.rest}${buffer.toString("utf8")}`.split("\n");
    this.rest = lines.pop() ?? "";
    return lines.flatMap((line) => {
      try {
        const event: unknown = JSON.parse(line);
        if (typeof event !== "object" || event === null || !("seq" in event)) {
          return [];
        }
        const shot =
          "type" in event && event.type === "step.shot" && "path" in event
            ? String(event.path)
            : null;
        return [{ seq: Number(event.seq), line, shot }];
      } catch {
        return [];
      }
    });
  }
}

// The events from `next` on, as many as one request takes.
function batchFrom(events: IEventLine[], next: number): IEventLine[] {
  const batch: IEventLine[] = [];
  let bytes = 0;
  for (let seq = next; events[seq] !== undefined; seq += 1) {
    const event = events[seq];
    if (
      event === undefined ||
      batch.length === MAX_BATCH_EVENTS ||
      (batch.length > 0 && bytes + event.line.length > MAX_BATCH_BYTES)
    ) {
      break;
    }
    batch.push(event);
    bytes += event.line.length;
  }
  return batch;
}

async function waitTurn(settings: ISettings): Promise<void> {
  const started = Date.now();
  let unansweredSince: number | null = null;
  let told: string | null = null;
  while (Date.now() - started < WAIT_MAX_MS) {
    let delay = WAIT_RETRY_MS;
    try {
      const response = await call(
        settings,
        "POST",
        "/api/ingest/claims",
        JSON.stringify({ pipeline: settings.pipeline, env: settings.env }),
        "application/json"
      );
      const claim = await answerOf(response, isClaim);
      unansweredSince = null;
      if (claim.granted) {
        if (told !== null) {
          log(`${settings.env} is free after ${minutesSince(started)}`);
        }
        return;
      }
      if (claim.waitingFor !== told) {
        told = claim.waitingFor;
        log(
          `${settings.env} is in use by ${
            claim.waitingFor ?? "the console"
          }: the tests start once it is done`
        );
      }
      delay = claim.retryMs;
    } catch (error) {
      if (error instanceof Refused) {
        log(`the console would not hold ${settings.env} (${error.message})`);
        return;
      }
      unansweredSince ??= Date.now();
      if (Date.now() - unansweredSince >= WAIT_UNANSWERED_MS) {
        log(`the console does not answer (${messageOf(error)})`);
        return;
      }
    }
    await wait(delay);
  }
  log(
    `waited ${minutesSince(started)} for ${
      settings.env
    }: the tests start now, alongside the console's run`
  );
}

function minutesSince(started: number): string {
  const seconds = Math.round((Date.now() - started) / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

async function openStream(
  settings: ISettings,
  attempt: string
): Promise<IIngestCursor> {
  const response = await call(
    settings,
    "POST",
    "/api/ingest/streams",
    JSON.stringify({
      pipeline: settings.pipeline,
      attempt,
      env: settings.env,
      profile: settings.profile,
    }),
    "application/json"
  );
  const cursor = await cursorOf(response);
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(STREAM_FILE, JSON.stringify({ id: cursor.id }));
  log(`the console follows this run: ${settings.url}/runs/${cursor.id}`);
  return cursor;
}

async function sendEvents(
  settings: ISettings,
  cursor: IIngestCursor,
  batch: IEventLine[]
): Promise<IIngestCursor> {
  const body = `{"from":${cursor.next},"events":[${batch
    .map((event) => event.line)
    .join(",")}]}`;
  const response = await call(
    settings,
    "POST",
    `/api/ingest/streams/${encodeURIComponent(cursor.id)}/events`,
    body,
    "application/json"
  );
  return cursorOf(response);
}

// The screenshots a batch named, while someone watches the run (best effort).
async function sendShots(
  settings: ISettings,
  cursor: IIngestCursor,
  batch: IEventLine[]
): Promise<void> {
  const names = new Set(
    batch.flatMap((event) =>
      event.shot === null ? [] : [path.basename(event.shot)]
    )
  );
  for (const name of names) {
    try {
      const body = new Blob([
        fs.readFileSync(path.join(REPORTS, "shots", name)),
      ]);
      await call(
        settings,
        "PUT",
        `/api/ingest/streams/${encodeURIComponent(
          cursor.id
        )}/shots/${encodeURIComponent(name)}`,
        body,
        "image/png"
      );
    } catch {
      // The next screenshot of that test replaces it anyway.
    }
  }
}

async function follow(settings: ISettings): Promise<void> {
  let stopAt = Number.POSITIVE_INFINITY;
  let cursor: IIngestCursor | null = null;
  process.on("SIGTERM", () => {
    stopAt = Date.now() + (cursor === null ? LAST_TRY_MS : FLUSH_MS);
  });
  const attempt = randomUUID();
  const reader = new EventReader();
  // Every event read, by seq: the console may ask for any of them again.
  const events: IEventLine[] = [];
  let failures = 0;
  while (Date.now() < stopAt) {
    try {
      cursor ??= await openStream(settings, attempt);
      for (const event of reader.read()) {
        events[event.seq] = event;
      }
      const batch = batchFrom(events, cursor.next);
      if (batch.length > 0) {
        cursor = await sendEvents(settings, cursor, batch);
        if (cursor.wantShots) {
          await sendShots(settings, cursor, batch);
        }
        failures = 0;
        continue;
      }
      if (stopAt !== Number.POSITIVE_INFINITY) {
        log(`sent all ${events.length} events`);
        return;
      }
      await wait(POLL_MS);
    } catch (error) {
      if (error instanceof Refused) {
        log(`the console refused the run: ${error.message}`);
        return;
      }
      failures += 1;
      const delay =
        BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] ?? POLL_MS;
      log(
        `the console does not answer (${messageOf(error)}); again in ${
          delay / 1000
        } s`
      );
      await wait(Math.min(delay, Math.max(0, stopAt - Date.now())));
    }
  }
  log("stopped before the console had every event");
}

function streamId(): string | null {
  try {
    const stream: unknown = JSON.parse(fs.readFileSync(STREAM_FILE, "utf8"));
    return typeof stream === "object" && stream !== null && "id" in stream
      ? String(stream.id)
      : null;
  } catch {
    return null;
  }
}

async function report(settings: ISettings): Promise<void> {
  const id = streamId();
  if (id === null) {
    log("no stream was opened: no report to send");
    return;
  }
  const parts = REPORT_PARTS.filter((part) =>
    fs.existsSync(path.join(REPORTS, part))
  );
  if (parts.length === 0) {
    log("no report to send");
    return;
  }
  execFileSync("tar", ["-czf", REPORT_ARCHIVE, "-C", REPORTS, ...parts]);
  const size = fs.statSync(REPORT_ARCHIVE).size;
  if (size > MAX_REPORT_BYTES) {
    log(
      `the report is ${Math.round(
        size / 1024 / 1024
      )} MB, more than the console takes`
    );
    return;
  }
  const response = await call(
    settings,
    "PUT",
    `/api/ingest/streams/${encodeURIComponent(id)}/report`,
    new Blob([fs.readFileSync(REPORT_ARCHIVE)]),
    "application/gzip",
    REPORT_TIMEOUT_MS
  );
  log(
    response.ok
      ? `the report is on the console: ${settings.url}/runs/${id}`
      : `the console did not take the report: ${response.status}`
  );
}

// The step tested the deploy that started it (not superseded by a newer one, not timed out).
function testedDeploy(): boolean {
  try {
    const ready: unknown = JSON.parse(fs.readFileSync(READY_FILE, "utf8"));
    return (
      typeof ready === "object" &&
      ready !== null &&
      "outcome" in ready &&
      ready.outcome === "ready"
    );
  } catch {
    return false;
  }
}

async function queueAgentChecks(settings: ISettings): Promise<void> {
  if (process.argv.includes("--after-deploy") && !testedDeploy()) {
    log("this step tested no new deploy: no agent checks");
    return;
  }
  const response = await call(
    settings,
    "POST",
    "/api/ingest/agent-checks",
    JSON.stringify({ pipeline: settings.pipeline, env: settings.env }),
    "application/json"
  );
  const answer = await answerOf(response, isAgentChecks);
  if (answer.note !== null) {
    log(answer.note);
  }
  for (const check of answer.checks) {
    log(
      check.runId === null
        ? `agent check /${check.skill} not queued: ${check.problem ?? "?"}`
        : `agent check /${check.skill} queued: ${settings.url}/runs/${check.runId}`
    );
  }
}

const COMMANDS: Record<string, (settings: ISettings) => Promise<void>> = {
  wait: waitTurn,
  follow,
  report,
  agents: queueAgentChecks,
};

async function main(): Promise<void> {
  const command = COMMANDS[process.argv[2] ?? ""];
  if (command === undefined) {
    log(
      "usage: node ci/ingest.mts wait | follow | report | agents [--after-deploy]"
    );
    return;
  }
  const settings = readSettings();
  if (settings === null) {
    return;
  }
  try {
    await command(settings);
  } catch (error) {
    log(`not sent: ${messageOf(error)}`);
  }
}

await main();
process.exit(0);
