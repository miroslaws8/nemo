import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { ACTIVE_CI_STATUSES } from "../../shared/api";
import type {
  ICiPipeline,
  ICiStatus,
  IIngestAgentChecks,
  IIngestAgentChecksRequest,
  IIngestClaim,
  IIngestClaimRequest,
  IIngestCursor,
  IIngestEventsRequest,
  IIngestStreamRequest,
} from "../../shared/types";
import { HttpError } from "../http-error";
import type { RunManager } from "../run-manager";
import { isRunId, runDirectory } from "../run-store";
import type { CiSource } from "../sources/bitbucket";
import type { SseHub } from "../sse-hub";
import { CI_PIPELINES } from "../settings";
import type { IConsoleSettings } from "../types";
import { runProgram, tailOf } from "../workspaces/commands";
import { toolEnvironment } from "../workspaces/runner-env";

// CI runs live: a step of an e2e pipeline sends its run here (ci/ingest.mts) with one of the
// QA_CONSOLE_INGEST_TOKENS. Before its tests it asks for its environment and waits while a run of
// the console's own uses it. It opens a stream for a pipeline that Bitbucket says is running and
// tests that environment, then sends its events in order (the console keeps the cursor: after a
// restart the step sends the rest again), its step screenshots while someone watches, and its
// report at the end. A run without run.end ends 2 minutes after its pipeline does.

const STREAMS_PER_WINDOW = 30;
const STREAM_WINDOW_MS = 10 * 60_000;
const MAX_SHOT_BYTES = 5 * 1024 * 1024;
const MAX_REPORT_BYTES = 200 * 1024 * 1024;
const SHOT_NAME = /^[\w.-]+\.png$/;
// What a report may hold, as the run folder lays it out.
const REPORT_PARTS: ReadonlySet<string> = new Set([
  "html",
  "artifacts",
  "shots",
]);
const WATCH_MS = 60_000;
const ENDED_GRACE_MS = 2 * 60_000;

function digest(token: string): Buffer {
  return crypto.createHash("sha256").update(token).digest();
}

/** A stream's id from its route (404 for anything that is not one). */
export function streamIdFrom(id: string): string {
  if (!isRunId(id)) {
    throw new HttpError(404, `no stream ${id}`);
  }
  return id;
}

function isActive(status: ICiStatus): boolean {
  return ACTIVE_CI_STATUSES.some((active) => active === status);
}

/** A request body of at most `limit` bytes, written to `file`. */
function saveBody(
  request: IncomingMessage,
  file: string,
  limit: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.destroy();
        out.destroy();
        reject(new HttpError(413, `more than ${limit} bytes`));
      }
    });
    request.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => resolve());
    request.pipe(out);
  });
}

// Links in a report could point anywhere on the server: none stays.
function removeLinks(folder: string): void {
  if (!fs.existsSync(folder)) {
    return;
  }
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      fs.unlinkSync(entryPath);
    } else if (entry.isDirectory()) {
      removeLinks(entryPath);
    }
  }
}

export class IngestService {
  private readonly tokens: Buffer[];
  private readonly opened: number[] = [];
  // CI runs whose pipeline was seen over, and since when.
  private readonly endedSince = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly manager: RunManager,
    private readonly ci: CiSource,
    private readonly hub: SseHub,
    settings: IConsoleSettings
  ) {
    this.tokens = settings.ingestTokens.map(digest);
  }

  start(): void {
    if (this.tokens.length === 0) {
      return;
    }
    this.timer = setInterval(() => void this.watch(), WATCH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** CI calls with a token instead of a session (404 when the console takes no CI runs). */
  requireToken(request: IncomingMessage): void {
    if (this.tokens.length === 0) {
      throw new HttpError(
        404,
        "this console takes no CI runs (QA_CONSOLE_INGEST_TOKENS)"
      );
    }
    const header = request.headers.authorization ?? "";
    const given = digest(header.startsWith("Bearer ") ? header.slice(7) : "");
    if (!this.tokens.some((token) => crypto.timingSafeEqual(token, given))) {
      throw new HttpError(401, "not a CI ingest token");
    }
  }

  private cursor(id: string, next: number): IIngestCursor {
    return { id, next, wantShots: this.hub.isWatched(id) };
  }

  private checkRate(): void {
    const now = Date.now();
    while (
      this.opened[0] !== undefined &&
      now - this.opened[0] > STREAM_WINDOW_MS
    ) {
      this.opened.shift();
    }
    if (this.opened.length >= STREAMS_PER_WINDOW) {
      throw new HttpError(429, "too many CI streams opened lately");
    }
    this.opened.push(now);
  }

  /** A step asks for its environment's agent checks (after its tests, or on a schedule). */
  async queueAgentChecks(
    request: IIngestAgentChecksRequest
  ): Promise<IIngestAgentChecks> {
    this.checkRate();
    const pipeline = await this.runningPipeline(request.pipeline, request.env);
    if (CI_PIPELINES.get(pipeline.pattern)?.agentChecks !== true) {
      return {
        checks: [],
        note: `${pipeline.label} pipelines queue no agent checks`,
      };
    }
    return this.manager.queueAgentChecks(request.env, pipeline);
  }

  /** A step asks for its environment before its tests. */
  async claim(request: IIngestClaimRequest): Promise<IIngestClaim> {
    await this.runningPipeline(request.pipeline, request.env);
    return this.manager.claimForCi(request.env, request.pipeline);
  }

  /** A step opens (or opens again) the stream of its run. */
  async openStream(request: IIngestStreamRequest): Promise<IIngestCursor> {
    this.checkRate();
    const pipeline = await this.runningPipeline(request.pipeline, request.env);
    const { record, next } = this.manager.openCiRun(request, pipeline);
    return this.cursor(record.id, next);
  }

  // Only a pipeline Bitbucket says is running now, on that environment, may send a run.
  private async runningPipeline(
    number: number,
    env: string
  ): Promise<ICiPipeline> {
    if (!this.ci.isConfigured()) {
      throw new HttpError(
        503,
        "the console has no Bitbucket token (QA_CONSOLE_BITBUCKET_TOKEN) to check pipelines"
      );
    }
    const pipeline = await this.ci.freshPipeline(number);
    if (pipeline === null) {
      throw new HttpError(
        403,
        `pipeline #${number} is not among the latest e2e pipelines`
      );
    }
    if (!isActive(pipeline.status)) {
      throw new HttpError(
        403,
        `pipeline #${pipeline.number} is ${pipeline.status}, not running`
      );
    }
    if (pipeline.env !== env) {
      throw new HttpError(
        403,
        `pipeline #${pipeline.number} tests ${
          pipeline.env ?? "no environment"
        }, not ${env}`
      );
    }
    return pipeline;
  }

  /** Events from `from` on; not accepted (409): the cursor says where to go on from. */
  events(
    id: string,
    request: IIngestEventsRequest
  ): { accepted: boolean; cursor: IIngestCursor } {
    const { accepted, next } = this.manager.appendCiEvents(
      id,
      request.from,
      request.events
    );
    return { accepted, cursor: this.cursor(id, next) };
  }

  async shot(
    id: string,
    name: string,
    request: IncomingMessage
  ): Promise<{ saved: string }> {
    this.manager.ciRecord(id);
    if (!SHOT_NAME.test(name)) {
      throw new HttpError(400, `not a screenshot: ${name}`);
    }
    const folder = path.join(runDirectory(id), "shots");
    fs.mkdirSync(folder, { recursive: true });
    // Written aside, then renamed: a page never shows half a screenshot.
    const temporary = path.join(folder, `.${name}.part`);
    try {
      await saveBody(request, temporary, MAX_SHOT_BYTES);
      fs.renameSync(temporary, path.join(folder, name));
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return { saved: name };
  }

  /** The HTML report, attachments and screenshots, unpacked into the run's folder once checked. */
  async report(
    id: string,
    request: IncomingMessage
  ): Promise<{ saved: string }> {
    this.manager.ciRecord(id);
    const folder = runDirectory(id);
    const archive = path.join(
      folder,
      `.report-${crypto.randomBytes(4).toString("hex")}.tgz`
    );
    try {
      await saveBody(request, archive, MAX_REPORT_BYTES);
      await this.checkArchive(archive);
      for (const part of ["html", "artifacts"]) {
        fs.rmSync(path.join(folder, part), { recursive: true, force: true });
      }
      const unpacked = await runProgram(
        "tar",
        ["-xzf", archive, "-C", folder, "--no-same-owner"],
        { cwd: folder, env: toolEnvironment() }
      );
      if (unpacked.code !== 0) {
        throw new HttpError(
          400,
          `the report did not unpack: ${tailOf(unpacked.stderr)}`
        );
      }
      for (const part of REPORT_PARTS) {
        removeLinks(path.join(folder, part));
      }
    } finally {
      fs.rmSync(archive, { force: true });
    }
    return { saved: "report" };
  }

  // Every entry stays in the run folder's html/, artifacts/ or shots/.
  private async checkArchive(archive: string): Promise<void> {
    const listed = await runProgram("tar", ["-tzf", archive], {
      cwd: path.dirname(archive),
      env: toolEnvironment(),
    });
    if (listed.code !== 0) {
      throw new HttpError(400, `not a .tar.gz: ${tailOf(listed.stderr)}`);
    }
    for (const name of listed.stdout
      .split("\n")
      .filter((line) => line !== "")) {
      const normalized = path.posix.normalize(name.replace(/^\.\//, ""));
      const part = normalized.split("/")[0] ?? "";
      if (
        path.posix.isAbsolute(normalized) ||
        normalized.startsWith("..") ||
        !REPORT_PARTS.has(part)
      ) {
        throw new HttpError(400, `the report may not hold ${name}`);
      }
    }
  }

  // A CI run whose pipeline is over (or gone from the list) ends 2 minutes later without run.end.
  private async watch(): Promise<void> {
    for (const record of this.manager.ciRuns()) {
      if (record.ci === null) {
        continue;
      }
      let status: ICiStatus;
      try {
        status =
          (await this.ci.freshPipeline(record.ci.number))?.status ?? "error";
      } catch {
        continue;
      }
      if (isActive(status)) {
        this.endedSince.delete(record.id);
        continue;
      }
      const since = this.endedSince.get(record.id) ?? Date.now();
      this.endedSince.set(record.id, since);
      if (Date.now() - since >= ENDED_GRACE_MS) {
        this.manager.endCiRun(record.id, status);
        this.endedSince.delete(record.id);
      }
    }
  }
}
