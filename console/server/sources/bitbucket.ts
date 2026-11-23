import { buildEnvironment, envSetting } from "../../../engine/environment";
import { loadE2eConfig } from "../../../engine/config";
import { ACTIVE_CI_STATUSES } from "../../shared/api";
import type {
  ICiDetail,
  ICiLog,
  ICiOverview,
  ICiPipeline,
  ICiReport,
  ICiStatus,
  ICiStep,
  ICiStepStatus,
  ICiTestCase,
  ISweepResult,
} from "../../shared/types";
import { HttpError } from "../http-error";
import { redact } from "../redact";
import {
  BITBUCKET_REPOSITORY_KEY,
  BITBUCKET_TOKEN_KEY,
  CI_ACTIVE_POLL_MS,
  CI_IDLE_POLL_MS,
  CI_LIST_SIZE,
  CI_LOG_POLL_MS,
  CI_PIPELINES,
} from "../settings";
import type { SseHub } from "../sse-hub";
import type { ISweeper } from "../types";
import {
  BitbucketApi,
  BitbucketError,
  bitbucketPipelineSchema,
  bitbucketReasonSchema,
  bitbucketReportSchema,
  bitbucketStepSchema,
  bitbucketTestCaseSchema,
  pageOf,
  type IBitbucketPipeline,
  type IBitbucketStep,
} from "./bitbucket-api";

// The repository's e2e pipelines on Bitbucket, for the console: a list kept current while a page
// is open (polled, then pushed as the stream's "ci" event), a pipeline's steps, test report and
// log on request, and stop, rerun and clean up. Pipelines have no live events: the log is what
// shows a running one.

const LOG_CHUNK_BYTES = 256 * 1024;
const NEWLINE = 0x0a;
// Step logs kept in memory (a post-deploy log is a few MB).
const KEEP_LOGS = 8;
// Failed tests whose reasons are fetched (one request each).
const MAX_REASONS = 10;
// Variables a rerun keeps: the profile. The deploy builds to wait for are left out, so a rerun
// tests what is deployed now instead of waiting for (or skipping on) an older deploy.
const RERUN_VARIABLES: ReadonlySet<string> = new Set(["E2E_PROFILE"]);

const PIPELINE_STATES: ReadonlyMap<string, ICiStatus> = new Map([
  ["PENDING", "pending"],
  ["PARSING", "pending"],
  ["HALTED", "paused"],
]);
const COMPLETED_PIPELINES: ReadonlyMap<string, ICiStatus> = new Map([
  ["SUCCESSFUL", "passed"],
  ["FAILED", "failed"],
  ["ERROR", "error"],
  ["STOPPED", "stopped"],
  ["EXPIRED", "expired"],
]);
const STEP_STATES: ReadonlyMap<string, ICiStepStatus> = new Map([
  ["PENDING", "pending"],
  ["READY", "ready"],
  ["IN_PROGRESS", "running"],
]);
const COMPLETED_STEPS: ReadonlyMap<string, ICiStepStatus> = new Map([
  ["SUCCESSFUL", "passed"],
  ["FAILED", "failed"],
  ["ERROR", "error"],
  ["STOPPED", "stopped"],
  ["NOT_RUN", "not-run"],
  ["EXPIRED", "expired"],
]);
const FAILED_CASE_STATUSES: ReadonlySet<string> = new Set(["FAILED", "ERROR"]);
// The text fields of a test case reason, in the order they are shown.
const REASON_FIELDS = ["message", "output", "stack_trace", "stackTrace"];

interface IStepLog {
  buffer: Buffer;
  fetchedAt: number;
  complete: boolean;
}

interface IDetailCache {
  fetchedAt: number;
  status: ICiStatus;
  steps: ICiStep[];
  reports: Map<string, ICiReport | null>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isActive(status: ICiStatus): boolean {
  return ACTIVE_CI_STATUSES.some((active) => active === status);
}

function pipelineStatus(state: IBitbucketPipeline["state"]): ICiStatus {
  if (state.name === "COMPLETED") {
    return COMPLETED_PIPELINES.get(state.result?.name ?? "") ?? "error";
  }
  if (state.name === "IN_PROGRESS") {
    return state.stage?.name === "PAUSED" ? "paused" : "running";
  }
  return PIPELINE_STATES.get(state.name) ?? "pending";
}

function stepStatus(state: IBitbucketStep["state"]): ICiStepStatus {
  if (state.name === "COMPLETED") {
    return COMPLETED_STEPS.get(state.result?.name ?? "") ?? "error";
  }
  return STEP_STATES.get(state.name) ?? "pending";
}

function isFinishedStep(status: ICiStepStatus): boolean {
  return status !== "pending" && status !== "ready" && status !== "running";
}

// The environment a rerun or cleanup asks the name of: the pipeline's own if it is guarded; for
// one that tests no environment (the sweep), the first guarded one it touches.
function guardedEnvFor(env: string | null): string | null {
  if (env !== null) {
    return buildEnvironment(env).guarded ? env : null;
  }
  return (
    Object.keys(loadE2eConfig().environments).find(
      (name) => buildEnvironment(name).guarded
    ) ?? null
  );
}

function toCiPipeline(
  api: BitbucketApi,
  pipeline: IBitbucketPipeline
): ICiPipeline[] {
  const pattern = pipeline.target?.selector?.pattern ?? "";
  const kind = CI_PIPELINES.get(pattern);
  if (kind === undefined) {
    return [];
  }
  return [
    {
      number: pipeline.build_number,
      pattern,
      label: kind.label,
      env: kind.env,
      guardedEnv: guardedEnvFor(kind.env),
      branch: pipeline.target?.ref_name ?? null,
      status: pipelineStatus(pipeline.state),
      createdAt: pipeline.created_on,
      endedAt: pipeline.completed_on ?? null,
      creator: pipeline.creator?.display_name ?? null,
      trigger: (pipeline.trigger?.name ?? pipeline.trigger?.type ?? "")
        .replace(/^pipeline_trigger_/, "")
        .toLowerCase(),
      variables: (pipeline.variables ?? []).flatMap((variable) =>
        variable.secured === true
          ? []
          : [{ key: variable.key, value: variable.value ?? "" }]
      ),
      url: api.pipelinePage(pipeline.build_number),
    },
  ];
}

function toCiStep(step: IBitbucketStep, index: number): ICiStep {
  return {
    uuid: step.uuid,
    name: step.name ?? `Step ${index + 1}`,
    status: stepStatus(step.state),
    startedAt: step.started_on ?? null,
    endedAt: step.completed_on ?? null,
  };
}

function reasonText(reason: Record<string, unknown>): string {
  return REASON_FIELDS.flatMap((field) => {
    const value = reason[field];
    return typeof value === "string" && value.trim() !== "" ? [value] : [];
  }).join("\n");
}

export class CiSource {
  private readonly api: BitbucketApi | null;
  private overview: ICiOverview;
  private readonly uuids = new Map<number, string>();
  private readonly details = new Map<number, IDetailCache>();
  private readonly logs = new Map<string, IStepLog>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly hub: SseHub,
    private readonly sweeper: ISweeper
  ) {
    const token = envSetting(BITBUCKET_TOKEN_KEY);
    const repository = envSetting(BITBUCKET_REPOSITORY_KEY);
    this.api =
      token === null || repository === null
        ? null
        : new BitbucketApi(token, repository);
    this.overview = {
      configured: this.api !== null,
      error: null,
      pausedUntil: null,
      checkedAt: null,
      pipelines: [],
    };
  }

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** The list, asked again first when it is older than an active poll. */
  async current(): Promise<ICiOverview> {
    const checked =
      this.overview.checkedAt === null
        ? 0
        : Date.parse(this.overview.checkedAt);
    if (this.api !== null && Date.now() - checked > CI_ACTIVE_POLL_MS) {
      await this.refreshList();
    }
    return this.overview;
  }

  async detail(number: number): Promise<ICiDetail> {
    const api = this.requireApi();
    const pipeline = await this.pipeline(number);
    const uuid = this.uuidOf(number);
    const cached = this.details.get(number);
    const stale =
      cached === undefined ||
      cached.status !== pipeline.status ||
      (isActive(pipeline.status) &&
        Date.now() - cached.fetchedAt > CI_ACTIVE_POLL_MS);
    const detail = stale
      ? await this.fetchDetail(api, uuid, pipeline, cached)
      : cached;
    return {
      pipeline,
      steps: detail.steps,
      reports: detail.steps.map((step) => ({
        stepUuid: step.uuid,
        report: detail.reports.get(step.uuid) ?? null,
      })),
    };
  }

  async log(number: number, stepUuid: string, offset: number): Promise<ICiLog> {
    const api = this.requireApi();
    const uuid = this.uuidOf(number);
    const step = (await this.detail(number)).steps.find(
      (candidate) => candidate.uuid === stepUuid
    );
    if (step === undefined) {
      throw new HttpError(404, `pipeline #${number} has no step ${stepUuid}`);
    }
    const log = await this.fetchLog(api, uuid, step);
    const start = Math.min(Math.max(offset, 0), log.buffer.length);
    let chunk = log.buffer.subarray(start, start + LOG_CHUNK_BYTES);
    // A log still growing is handed out in whole lines (none while a line is half written), so a
    // character is never cut in two.
    if (!log.complete || start + chunk.length < log.buffer.length) {
      chunk = chunk.subarray(0, chunk.lastIndexOf(NEWLINE) + 1);
    }
    return {
      offset: start + chunk.length,
      text: redact(chunk.toString("utf8")),
      complete: log.complete && start + chunk.length >= log.buffer.length,
    };
  }

  async stopPipeline(number: number): Promise<ICiPipeline> {
    const api = this.requireApi();
    const pipeline = await this.pipeline(number);
    if (!isActive(pipeline.status)) {
      throw new HttpError(409, `pipeline #${number} is not running`);
    }
    const response = await this.call(() =>
      api.send(
        `/pipelines/${encodeURIComponent(this.uuidOf(number))}/stopPipeline`,
        "action",
        { method: "POST" }
      )
    );
    if (!response.ok) {
      throw this.httpError(await api.failure(response));
    }
    await this.refreshList();
    return this.find(number) ?? pipeline;
  }

  async rerun(
    number: number,
    confirm: string | undefined
  ): Promise<ICiPipeline> {
    const api = this.requireApi();
    const pipeline = await this.pipeline(number);
    if (pipeline.guardedEnv !== null && confirm !== pipeline.guardedEnv) {
      throw new HttpError(
        428,
        `${pipeline.pattern} runs on ${pipeline.guardedEnv}: confirm with "${pipeline.guardedEnv}"`
      );
    }
    if (pipeline.branch === null) {
      throw new HttpError(409, `pipeline #${number} has no branch to run on`);
    }
    const started = await this.call(() =>
      api.json("/pipelines/", bitbucketPipelineSchema, "action", {
        method: "POST",
        body: {
          target: {
            type: "pipeline_ref_target",
            ref_type: "branch",
            ref_name: pipeline.branch,
            selector: { type: "custom", pattern: pipeline.pattern },
          },
          variables: pipeline.variables.filter((variable) =>
            RERUN_VARIABLES.has(variable.key)
          ),
        },
      })
    );
    const [created] = toCiPipeline(api, started);
    if (created === undefined) {
      throw new HttpError(502, "Bitbucket started a pipeline of another kind");
    }
    this.uuids.set(created.number, started.uuid);
    await this.refreshList();
    return this.find(created.number) ?? created;
  }

  async cleanup(
    number: number,
    apply: boolean,
    confirm: string | undefined
  ): Promise<ISweepResult> {
    const pipeline = await this.pipeline(number);
    if (pipeline.env === null) {
      throw new HttpError(409, `${pipeline.pattern} creates no test data`);
    }
    if (isActive(pipeline.status)) {
      throw new HttpError(
        409,
        `pipeline #${number} is still going; clean up when it is done`
      );
    }
    if (
      apply &&
      pipeline.guardedEnv !== null &&
      confirm !== pipeline.guardedEnv
    ) {
      throw new HttpError(
        428,
        `${pipeline.guardedEnv} is guarded: confirm with its name`
      );
    }
    return this.sweeper.sweep(pipeline.env, String(number), apply);
  }

  private schedule(delayMs: number): void {
    this.stop();
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref();
  }

  // Polls only while someone looks (a page holds the event stream open).
  private async tick(): Promise<void> {
    if (this.api !== null && this.hub.clientCount() > 0) {
      await this.refreshList();
    }
    const going = this.overview.pipelines.some((pipeline) =>
      isActive(pipeline.status)
    );
    this.schedule(going ? CI_ACTIVE_POLL_MS : CI_IDLE_POLL_MS);
  }

  private refreshList(): Promise<void> {
    if (this.refreshing === null) {
      this.refreshing = this.loadList().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async loadList(): Promise<void> {
    const api = this.api;
    if (api === null) {
      return;
    }
    const before = JSON.stringify(this.overview);
    try {
      const page = await api.json(
        `/pipelines/?target.selector.type=CUSTOM&sort=-created_on&pagelen=${CI_LIST_SIZE}`,
        pageOf(bitbucketPipelineSchema),
        "poll"
      );
      for (const pipeline of page.values) {
        this.uuids.set(pipeline.build_number, pipeline.uuid);
      }
      this.overview = {
        configured: true,
        error: null,
        pausedUntil: null,
        checkedAt: new Date().toISOString(),
        pipelines: page.values.flatMap((pipeline) =>
          toCiPipeline(api, pipeline)
        ),
      };
    } catch (error) {
      this.overview = {
        ...this.overview,
        error: messageOf(error),
        pausedUntil: api.pausedUntil(),
      };
    }
    if (JSON.stringify(this.overview) !== before) {
      this.hub.publishCi(this.overview);
    }
  }

  private find(number: number): ICiPipeline | undefined {
    return this.overview.pipelines.find(
      (pipeline) => pipeline.number === number
    );
  }

  /** One of the latest pipelines (a route checks the role acting on it takes). */
  async pipelineOf(number: number): Promise<ICiPipeline> {
    return this.pipeline(number);
  }

  /** Whether it can ask Bitbucket (a token is set). */
  isConfigured(): boolean {
    return this.api !== null;
  }

  /** A pipeline as Bitbucket had it at most an active poll ago; null: not among the latest. */
  async freshPipeline(number: number): Promise<ICiPipeline | null> {
    await this.current();
    if (this.find(number) === undefined) {
      await this.refreshList();
    }
    return this.find(number) ?? null;
  }

  private async pipeline(number: number): Promise<ICiPipeline> {
    const known = this.find(number);
    if (known !== undefined) {
      return known;
    }
    await this.refreshList();
    const found = this.find(number);
    if (found === undefined) {
      throw new HttpError(
        404,
        `pipeline #${number} is not among the latest ${CI_LIST_SIZE} e2e pipelines`
      );
    }
    return found;
  }

  private uuidOf(number: number): string {
    const uuid = this.uuids.get(number);
    if (uuid === undefined) {
      throw new HttpError(404, `no pipeline #${number}`);
    }
    return uuid;
  }

  private requireApi(): BitbucketApi {
    if (this.api === null) {
      throw new HttpError(
        409,
        `CI is not set up: add ${BITBUCKET_REPOSITORY_KEY} and ${BITBUCKET_TOKEN_KEY} to .env and restart the console`
      );
    }
    return this.api;
  }

  private httpError(error: BitbucketError): HttpError {
    return new HttpError(
      error.status === 401 ? 502 : error.status,
      error.message
    );
  }

  // Bitbucket's errors reach the page as HTTP errors with Bitbucket's message.
  private async call<TResult>(
    request: () => Promise<TResult>
  ): Promise<TResult> {
    try {
      return await request();
    } catch (error) {
      if (error instanceof BitbucketError) {
        throw this.httpError(error);
      }
      throw error;
    }
  }

  private async fetchDetail(
    api: BitbucketApi,
    uuid: string,
    pipeline: ICiPipeline,
    cached: IDetailCache | undefined
  ): Promise<IDetailCache> {
    const page = await this.call(() =>
      api.json(
        `/pipelines/${encodeURIComponent(uuid)}/steps/?pagelen=100`,
        pageOf(bitbucketStepSchema),
        "poll"
      )
    );
    const steps = page.values.map(toCiStep);
    const reports = new Map(cached?.reports ?? []);
    for (const step of steps) {
      if (isFinishedStep(step.status) && !reports.has(step.uuid)) {
        reports.set(step.uuid, await this.fetchReport(api, uuid, step.uuid));
      }
    }
    const detail: IDetailCache = {
      fetchedAt: Date.now(),
      status: pipeline.status,
      steps,
      reports,
    };
    this.details.set(pipeline.number, detail);
    return detail;
  }

  // Bitbucket keeps a report only for a step whose tests ran (404 otherwise).
  private async fetchReport(
    api: BitbucketApi,
    uuid: string,
    stepUuid: string
  ): Promise<ICiReport | null> {
    const stepPath = `/pipelines/${encodeURIComponent(
      uuid
    )}/steps/${encodeURIComponent(stepUuid)}`;
    const response = await this.call(() =>
      api.send(`${stepPath}/test_reports`, "poll")
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw this.httpError(await api.failure(response));
    }
    const summary = bitbucketReportSchema.safeParse(
      await response.json().catch(() => null)
    );
    if (!summary.success) {
      return null;
    }
    const failed =
      (summary.data.number_of_failed_test_cases ?? 0) +
      (summary.data.number_of_error_test_cases ?? 0);
    return {
      total: summary.data.number_of_test_cases ?? 0,
      passed: summary.data.number_of_successful_test_cases ?? 0,
      failed,
      skipped: summary.data.number_of_skipped_test_cases ?? 0,
      failedCases:
        failed === 0 ? [] : await this.fetchFailedCases(api, stepPath),
    };
  }

  private async fetchFailedCases(
    api: BitbucketApi,
    stepPath: string
  ): Promise<ICiTestCase[]> {
    const page = await this.call(() =>
      api.json(
        `${stepPath}/test_reports/test_cases?pagelen=100`,
        pageOf(bitbucketTestCaseSchema),
        "poll"
      )
    );
    const failed = page.values.filter((testCase) =>
      FAILED_CASE_STATUSES.has(testCase.status ?? "")
    );
    const cases: ICiTestCase[] = [];
    for (const [index, testCase] of failed.entries()) {
      cases.push({
        name: testCase.name ?? testCase.fully_qualified_name ?? testCase.uuid,
        suite: testCase.package_name ?? null,
        status: (testCase.status ?? "").toLowerCase(),
        reasons:
          index < MAX_REASONS
            ? await this.fetchReasons(api, stepPath, testCase.uuid)
            : [],
      });
    }
    return cases;
  }

  private async fetchReasons(
    api: BitbucketApi,
    stepPath: string,
    caseUuid: string
  ): Promise<string[]> {
    try {
      const page = await api.json(
        `${stepPath}/test_reports/test_cases/${encodeURIComponent(
          caseUuid
        )}/test_case_reasons`,
        pageOf(bitbucketReasonSchema),
        "poll"
      );
      return page.values
        .map((reason) => redact(reasonText(reason)))
        .filter((text) => text !== "");
    } catch {
      return [];
    }
  }

  // Reads on from what it has (an HTTP Range); a finished step's log is read to its end once.
  private async fetchLog(
    api: BitbucketApi,
    uuid: string,
    step: ICiStep
  ): Promise<IStepLog> {
    const known = this.logs.get(step.uuid);
    if (
      known !== undefined &&
      (known.complete || Date.now() - known.fetchedAt < CI_LOG_POLL_MS)
    ) {
      return known;
    }
    const finished = isFinishedStep(step.status);
    const buffer = known?.buffer ?? Buffer.alloc(0);
    const response = await this.call(() =>
      api.send(
        `/pipelines/${encodeURIComponent(uuid)}/steps/${encodeURIComponent(
          step.uuid
        )}/log`,
        "poll",
        { headers: { Range: `bytes=${buffer.length}-` } }
      )
    );
    let next = buffer;
    if (response.status === 206) {
      next = Buffer.concat([buffer, Buffer.from(await response.arrayBuffer())]);
    } else if (response.status === 200) {
      const whole = Buffer.from(await response.arrayBuffer());
      next = whole.length >= buffer.length ? whole : buffer;
    } else if (response.status !== 416 && response.status !== 404) {
      throw this.httpError(await api.failure(response));
    }
    const log: IStepLog = {
      buffer: next,
      fetchedAt: Date.now(),
      complete: finished,
    };
    this.logs.delete(step.uuid);
    this.logs.set(step.uuid, log);
    for (const key of [...this.logs.keys()].slice(0, -KEEP_LOGS)) {
      this.logs.delete(key);
    }
    return log;
  }
}
