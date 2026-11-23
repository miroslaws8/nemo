import fs from "node:fs";
import { buildEnvironment } from "../../engine/environment";
import { newRunId } from "../../engine/run-info";
import type { ILiveEvent } from "../../engine/types";
import { ACTIVE_RUN_STATUSES, liveEventSchema } from "../shared/api";
import { emptyRunState, reduceRun, settleRun } from "../shared/reducer";
import type {
  IAgentQueuedBy,
  IAgentRun,
  ICatalogTest,
  ICiPipeline,
  ICiStatus,
  IIngestAgentChecks,
  IIngestClaim,
  IIngestStreamRequest,
  IRetryRequest,
  IRetryScope,
  IRunDetail,
  IRunPhase,
  IRunRecord,
  IRunSelection,
  IRunSource,
  IRunStatus,
  IStartAgentRunRequest,
  IStartRunRequest,
  ISweepResult,
  ITestState,
  ITestStatus,
} from "../shared/types";
import type { AgentRuns } from "./agents/agent-runs";
import { CiClaims } from "./ci-claims";
import { requireOffered } from "./environments";
import { HttpError } from "./http-error";
import { NdjsonTail, readAllEvents } from "./ndjson-tail";
import {
  interruptGroup,
  isSameProcess,
  killTree,
  processStartTime,
  spawnDetached,
} from "./process-control";
import {
  listRuns,
  pruneRuns,
  readRun,
  rebuildState,
  runDirectory,
  runFile,
  writeRun,
} from "./run-store";
import { consoleSettings } from "./config";
import {
  CI_CLAIM_GRANTED_MS,
  CI_CLAIM_POLL_MS,
  CI_CLAIM_WAITING_MS,
  STOP_GRACE_MS,
} from "./settings";
import type { SseHub } from "./sse-hub";
import { sweepRun } from "./sweep-runner";
import { isLoginProject, testListLine } from "../shared/test-list";
import type {
  IEnvironmentActivity,
  ILiveRun,
  IPreparedRun,
  IRunKind,
  IRunners,
  IRunPlan,
  ISpawnedProcess,
  ISweeper,
  IWorkspace,
} from "./types";

// Starts, follows and stops the runs. A run waits in the queue while its environment is busy (a
// run or a cleanup there: all of them use the environment's one QA account) or the console's
// QA_CONSOLE_MAX_ACTIVE_RUNS are going. Taken from the queue it is prepared first ("preparing":
// a server gets its commit and packages ready, console/server/workspaces), then started.
// A CI run the console follows (record.ci, console/server/ingest) is a run without a process:
// its stream appends its events, it holds its environment but no slot, and it ends with its
// run.end (or its pipeline). The console cannot stop it: its pipeline can.

const EXIT_WATCH_MS = 2_000;
const INTERRUPTED_EXIT_CODE = 130;
const RETRYABLE: ReadonlySet<ITestStatus> = new Set([
  "failed",
  "timedOut",
  "interrupted",
]);
// A run that ended early: "retry failed" also takes the tests it never started (a resume).
const ENDED_EARLY: ReadonlySet<IRunStatus> = new Set([
  "interrupted",
  "killed",
  "crashed",
  "timedout",
]);
const DRAINING_MESSAGE =
  "the console is shutting down; try again in a minute when it is back";
const DRAIN_CHECK_MS = 500;

// Why an environment can't take a cleanup now.
const BUSY_MESSAGES: Record<IEnvironmentActivity, (env: string) => string> = {
  run: (env) => `a run is going on ${env}; clean up when it is done`,
  cleanup: (env) => `a cleanup is going on ${env}; try again when it is done`,
  ci: (env) => `CI is about to test ${env}; clean up when its run is done`,
};

const STATUS_AFTER: Record<IRunPhase, IRunStatus | null> = {
  starting: null,
  running: null,
  passed: "passed",
  failed: "failed",
  timedout: "timedout",
  interrupted: "interrupted",
};

function now(): string {
  return new Date().toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isActive(status: IRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.some((active) => active === status);
}

function finalStatus(live: ILiveRun, exitCode: number | null): IRunStatus {
  if (live.forced) {
    return "killed";
  }
  const fromEvents = STATUS_AFTER[live.state.phase];
  if (fromEvents !== null) {
    return fromEvents;
  }
  // Stopped before Playwright reported anything: what was asked for, not a crash.
  const stopped =
    live.record.stopRequestedAt !== null || exitCode === INTERRUPTED_EXIT_CODE;
  return stopped ? "interrupted" : "crashed";
}

// A CI run that never said run.end, by how its pipeline ended.
const CI_ENDINGS: Partial<Record<ICiStatus, IRunStatus>> = {
  stopped: "interrupted",
  passed: "passed",
  failed: "failed",
};

function isCi(live: ILiveRun): boolean {
  return live.record.ci !== null;
}

// What a run is told through its environment (E2E_*: engine/run-dir.ts, run-info.ts, the config).
function runVariables(record: IRunRecord): Record<string, string> {
  return {
    E2E_ENV: record.env,
    E2E_PROFILE: record.profile,
    E2E_RUN_ID: record.id,
    E2E_RUN_DIR: runDirectory(record.id),
    FORCE_COLOR: "0",
    ...(record.skipNeeds ? { E2E_SKIP_NEEDS: "1" } : {}),
  };
}

function selectionArgs(record: IRunRecord): string[] {
  if (record.selection.testIds !== null) {
    return ["--test-list", runFile(record.id, "test-list.txt")];
  }
  if (record.selection.grep !== null) {
    return ["--grep", record.selection.grep];
  }
  return [];
}

// The same tests: the same picked ids (in any order), or the same grep over the whole profile.
function sameSelection(left: IRunSelection, right: IRunSelection): boolean {
  if (left.grep !== right.grep) {
    return false;
  }
  if (left.testIds === null || right.testIds === null) {
    return left.testIds === right.testIds;
  }
  const ids = new Set(left.testIds);
  return (
    left.testIds.length === right.testIds.length &&
    right.testIds.every((testId) => ids.has(testId))
  );
}

function describeTests(tests: Pick<ICatalogTest, "title">[]): string {
  const first = tests[0];
  return tests.length === 1 && first !== undefined
    ? `"${first.title}"`
    : `${tests.length} tests`;
}

function selectableTests(parent: IRunDetail): ITestState[] {
  return parent.state.order.flatMap((testId) => {
    const test = parent.state.tests[testId];
    return test === undefined || isLoginProject(test.project) ? [] : [test];
  });
}

// What each retry scope takes from the finished run; null keeps the run's own selection.
const RETRY_CHOICES: Record<
  IRetryScope,
  (
    parent: IRunDetail,
    tests: ITestState[],
    request: IRetryRequest
  ) => ITestState[] | null
> = {
  test: (_parent, tests, request) => {
    const wanted = new Set(request.testIds ?? []);
    if (wanted.size === 0) {
      throw new HttpError(400, "name the tests to retry (testIds)");
    }
    const found = tests.filter((test) => wanted.has(test.testId));
    if (found.length !== wanted.size) {
      throw new HttpError(400, "some of these tests are not in that run");
    }
    return found;
  },
  failed: (parent, tests) =>
    tests.filter(
      (test) =>
        RETRYABLE.has(test.status) ||
        (test.status === "queued" && ENDED_EARLY.has(parent.run.status))
    ),
  all: (parent, tests) => {
    const chosen = parent.run.selection.testIds;
    return chosen === null
      ? null
      : tests.filter((test) => chosen.includes(test.testId));
  },
};

function retryPlan(
  parent: IRunDetail,
  request: IRetryRequest
): Omit<IRunPlan, "source"> {
  const base = {
    env: parent.run.env,
    profile: parent.run.profile,
    parentId: parent.run.id,
    skipNeeds: request.skipNeeds ?? parent.run.skipNeeds,
    alongsideCi: false,
    agent: null,
  };
  const chosen = RETRY_CHOICES[request.scope](
    parent,
    selectableTests(parent),
    request
  );
  if (chosen === null) {
    return {
      ...base,
      kind: "retry",
      selection: {
        ...parent.run.selection,
        label: `again: ${parent.run.selection.label}`,
      },
      listLines: null,
    };
  }
  if (chosen.length === 0) {
    throw new HttpError(400, "nothing to retry in that run");
  }
  return {
    ...base,
    kind: "retry",
    selection: {
      label: `retry ${describeTests(chosen)}`,
      testIds: chosen.map((test) => test.testId),
      grep: null,
    },
    listLines: chosen.map(testListLine),
  };
}

// A run of the YAML tests: Playwright with its selection.
const TEST_RUNS: IRunKind = {
  launch: (record, prepared) => ({
    command: prepared.playwright(["test", ...selectionArgs(record)]),
    env: prepared.env,
  }),
  retryPlan,
  ended: () => ({}),
};

// The profile an agent check's record names (it runs no profile of tests).
const AGENT_PROFILE = "agent";

export class RunManager implements ISweeper {
  private readonly live = new Map<string, ILiveRun>();
  private readonly queue: string[] = [];
  // Environments a cleanup (a sweep) is working on.
  private readonly cleaning = new Set<string>();
  // Environments CI steps asked for: queued runs wait there (ci/ingest.mts wait).
  private readonly claims = new CiClaims(() => this.pump());
  private draining = false;
  private readonly kinds: Record<"tests" | "agent", IRunKind>;

  constructor(
    private readonly hub: SseHub,
    private readonly workspace: IWorkspace,
    private readonly runners: IRunners,
    private readonly agents: AgentRuns
  ) {
    this.kinds = { tests: TEST_RUNS, agent: agents };
  }

  /** After a (re)start: follow runners still going, settle the ones that ended, re-queue. */
  restore(): void {
    for (const record of [...listRuns()].reverse()) {
      // Folders from before the runners had users of their own get their group too.
      this.runners.share(record.env, runDirectory(record.id));
      if (record.status === "queued") {
        this.queue.push(record.id);
      } else if (record.status === "preparing") {
        // Its tests never started: it starts over.
        this.save({ ...record, status: "queued", startedAt: null });
        this.queue.push(record.id);
      } else if (record.ci !== null && isActive(record.status)) {
        // Its stream goes on where the file ends (the CI step sends the rest again).
        const live = this.follow(record);
        live.ingestNext =
          (readAllEvents(runFile(record.id, "events.ndjson")).at(-1)?.seq ??
            -1) + 1;
      } else if (isActive(record.status)) {
        this.reattach(record);
      }
    }
    this.workspace.tidy(new Set(this.live.keys()));
    this.prune();
    this.pump();
  }

  /** The console's own runs going now (not the CI runs it follows). */
  activeRuns(): IRunRecord[] {
    return this.ownRuns().map((live) => live.record);
  }

  /** The CI runs it follows now. */
  ciRuns(): IRunRecord[] {
    return [...this.live.values()].filter(isCi).map((live) => live.record);
  }

  /** Shutting down: no new runs or cleanups, the queue waits. */
  isDraining(): boolean {
    return this.draining;
  }

  /**
   * A server shutting down (its container stops, and its processes with it): takes no new work,
   * stops the runs going so their tests delete their data, and resolves once none is left. Queued
   * runs stay queued for the next start.
   */
  async drain(): Promise<void> {
    this.draining = true;
    // CI runs go on in their pipelines: the next console follows them again.
    for (const live of this.ownRuns()) {
      if (live.preparing !== null) {
        this.endPreparation(live, "queued", null);
      } else if (
        live.record.status !== "stopping" &&
        live.record.pid !== null
      ) {
        this.stop(live.record.id, false, null);
      }
    }
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.ownRuns().length === 0) {
          resolve();
          return;
        }
        setTimeout(check, DRAIN_CHECK_MS);
      };
      check();
    });
  }

  /** Kills every run at once and records them as killed (a second signal: the console exits). */
  killAll(): void {
    this.draining = true;
    for (const live of this.ownRuns()) {
      if (live.preparing !== null) {
        this.endPreparation(live, "queued", null);
        continue;
      }
      this.forceStop(live);
      this.finish(live, null);
    }
  }

  /** Stops following the runs and leaves the runners going (the console is closing). */
  detach(): void {
    for (const live of this.live.values()) {
      live.tail?.stop();
      this.clearTimers(live);
    }
  }

  runs(env: string | null): IRunRecord[] {
    return listRuns()
      .filter((record) => env === null || record.env === env)
      .map((record) => this.live.get(record.id)?.record ?? record);
  }

  detail(id: string): IRunDetail {
    const live = this.live.get(id);
    if (live !== undefined) {
      return { run: live.record, state: live.state };
    }
    const record = this.recordOf(id);
    const state = rebuildState(id);
    if (record.status !== "queued") {
      settleRun(state);
    }
    return { run: record, state };
  }

  /** The events after `afterSeq`, to bring a (re)connecting browser up to date. */
  backlog(id: string, afterSeq: number): ILiveEvent[] {
    const events =
      this.live.get(id)?.events ?? readAllEvents(runFile(id, "events.ndjson"));
    return events.filter((event) => event.seq > afterSeq);
  }

  /** The environment a run tests (a route checks the role it takes). */
  environmentOf(id: string): string {
    return this.recordOf(id).env;
  }

  /** The branch and commit a run tests (null: the working tree). */
  sourceOf(id: string): IRunSource {
    const record = this.recordOf(id);
    return { ref: record.ref, sha: record.sha };
  }

  /** Queues a new run; `by` is who asked (null where nobody signs in). */
  async start(
    request: IStartRunRequest,
    by: string | null
  ): Promise<IRunRecord> {
    this.checkAcceptingWork();
    const env = request.env.toLowerCase();
    const profile = request.profile.toLowerCase();
    this.checkRunnable(env, request.confirm);
    const source = await this.workspace.resolve(
      env,
      profile,
      request.ref ?? null
    );
    return this.enqueue(await this.planFor(env, profile, request, source), by);
  }

  /** Queues an agent check (Hermes runs a skill of the environment's commit). */
  async startAgent(
    request: IStartAgentRunRequest,
    by: string | null,
    queuedBy: IAgentQueuedBy | null = null
  ): Promise<IRunRecord> {
    this.checkAcceptingWork();
    const env = request.env.toLowerCase();
    this.checkRunnable(env, request.confirm);
    const source = await this.workspace.resolve(env, null, request.ref ?? null);
    const agent: IAgentRun = await this.agents.plan(request, source, queuedBy);
    return this.enqueue(
      {
        env,
        profile: AGENT_PROFILE,
        kind: "run",
        parentId: null,
        selection: {
          label: [`/${agent.skill}`, agent.arguments]
            .filter((part) => part !== "")
            .join(" "),
          testIds: null,
          grep: null,
        },
        skipNeeds: false,
        alongsideCi: request.alongsideCi ?? false,
        listLines: null,
        source,
        agent,
      },
      by
    );
  }

  /**
   * A CI step (its pipeline checked by the caller) queues the agent checks its environment lists,
   * on the environment's own branch; a step that asks again gets the checks it queued before.
   */
  async queueAgentChecks(
    env: string,
    pipeline: ICiPipeline
  ): Promise<IIngestAgentChecks> {
    this.checkAcceptingWork();
    const earlier = listRuns().filter(
      (record) => record.agent?.queuedBy?.number === pipeline.number
    );
    if (earlier.length > 0) {
      return {
        checks: earlier.map((record) => ({
          skill: record.agent?.skill ?? "",
          runId: record.id,
          problem: null,
        })),
        note: null,
      };
    }
    const source = await this.workspace.resolve(env, null, null);
    const skills = await this.agents.listedChecks(env, source);
    const queuedBy: IAgentQueuedBy = {
      number: pipeline.number,
      label: pipeline.label,
      url: pipeline.url,
    };
    const checks: IIngestAgentChecks["checks"] = [];
    for (const skill of skills) {
      try {
        // CI's own list: the environment's name stands for the person who would type it.
        const record = await this.startAgent(
          { env, skill, confirm: env },
          pipeline.creator,
          queuedBy
        );
        checks.push({ skill, runId: record.id, problem: null });
      } catch (error) {
        checks.push({ skill, runId: null, problem: messageOf(error) });
      }
    }
    return {
      checks,
      note:
        skills.length === 0
          ? `${env} lists no agent checks (agent_checks in e2e.config.yaml)`
          : null,
    };
  }

  async retry(
    parentId: string,
    request: IRetryRequest,
    by: string | null
  ): Promise<IRunRecord> {
    this.checkAcceptingWork();
    const parent = this.detail(parentId);
    if (parent.run.ci !== null) {
      throw new HttpError(
        409,
        `run pipeline #${parent.run.ci.number} again from its CI page`
      );
    }
    if (isActive(parent.run.status) || parent.run.status === "queued") {
      throw new HttpError(409, `run ${parentId} has not finished`);
    }
    this.checkRunnable(parent.run.env, request.confirm);
    const plan: IRunPlan = {
      ...this.kindOf(parent.run).retryPlan(parent, request),
      source: await this.workspace.retrySource(parent.run),
    };
    this.checkNotRetried(plan);
    return this.enqueue(plan, by);
  }

  stop(id: string, force: boolean, by: string | null): IRunRecord {
    const position = this.queue.indexOf(id);
    if (position !== -1) {
      this.queue.splice(position, 1);
      const stoppedAt = now();
      return this.save({
        ...this.recordOf(id),
        status: "interrupted",
        stopRequestedAt: stoppedAt,
        endedAt: stoppedAt,
        stoppedBy: by,
      });
    }
    const live = this.live.get(id);
    if (live !== undefined && live.record.ci !== null) {
      throw new HttpError(
        409,
        `stop pipeline #${live.record.ci.number} from its CI page`
      );
    }
    if (live !== undefined && live.preparing !== null) {
      return this.endPreparation(live, "interrupted", by);
    }
    if (live === undefined || live.record.pid === null) {
      throw new HttpError(409, `run ${id} is not running`);
    }
    if (force) {
      this.update(live, { stoppedBy: live.record.stoppedBy ?? by });
      this.forceStop(live);
      return live.record;
    }
    if (live.record.status !== "stopping") {
      interruptGroup(live.record.pid);
      this.update(live, {
        status: "stopping",
        stopRequestedAt: now(),
        stoppedBy: by,
      });
      live.stopTimer = setTimeout(() => this.forceStop(live), STOP_GRACE_MS);
    }
    return live.record;
  }

  async cleanup(
    id: string,
    apply: boolean,
    confirm: string | undefined
  ): Promise<ISweepResult> {
    const record = this.recordOf(id);
    if (isActive(record.status) || record.status === "queued") {
      throw new HttpError(409, `run ${id} has not finished`);
    }
    if (
      apply &&
      buildEnvironment(record.env).guarded &&
      confirm !== record.env
    ) {
      throw new HttpError(
        428,
        `${record.env} is guarded: confirm with its name`
      );
    }
    // A CI run's test data is named after its build number.
    return this.sweep(
      record.env,
      record.ci === null ? record.id : String(record.ci.number),
      apply
    );
  }

  /** Sweeps one run's data (a local run or a CI pipeline) while nothing else uses the environment. */
  sweep(env: string, runId: string, apply: boolean): Promise<ISweepResult> {
    return this.withCleanupLock(env, () =>
      sweepRun(env, runId, apply, this.workspace.toolVariables())
    );
  }

  /**
   * Runs a cleanup on an environment no run or other cleanup is using (each uses its QA account);
   * runs queued for that environment wait until it is done. CI cleanups go through here too.
   */
  async withCleanupLock<TResult>(
    env: string,
    work: () => Promise<TResult>
  ): Promise<TResult> {
    this.checkAcceptingWork();
    const activity = this.environmentActivity(env);
    if (activity !== null) {
      throw new HttpError(409, BUSY_MESSAGES[activity](env));
    }
    this.cleaning.add(env);
    try {
      return await work();
    } finally {
      this.cleaning.delete(env);
      this.pump();
    }
  }

  /**
   * A CI step asks for its environment before its tests (its pipeline checked by the caller): it
   * goes once no run of the console's own and no cleanup uses it. Asking holds back the runs
   * queued there, so the step is next; its stream opening (or the claim lapsing) lets them go.
   */
  claimForCi(env: string, pipeline: number): IIngestClaim {
    const holder = this.ownRuns().find((live) => live.record.env === env);
    const waitingFor =
      holder !== undefined
        ? `run ${holder.record.id} of the console (${
            consoleSettings().publicUrl
          }/runs/${holder.record.id})`
        : this.cleaning.has(env)
        ? `a cleanup of ${env}`
        : null;
    this.claims.hold(
      env,
      pipeline,
      waitingFor === null ? CI_CLAIM_GRANTED_MS : CI_CLAIM_WAITING_MS
    );
    return {
      granted: waitingFor === null,
      waitingFor,
      retryMs: CI_CLAIM_POLL_MS,
    };
  }

  /**
   * A CI step starts sending its run (its pipeline checked by the caller): b<number>, or
   * b<number>-2… for a rerun of the step. The same try opening again gets its run back.
   */
  openCiRun(
    request: IIngestStreamRequest,
    pipeline: ICiPipeline
  ): { record: IRunRecord; next: number } {
    this.checkAcceptingWork();
    // The run holds the environment from here on.
    this.claims.release(pipeline.number);
    const earlier = listRuns().filter(
      (record) => record.ci?.number === pipeline.number
    );
    const same = earlier.find(
      (record) => record.ci?.attempt === request.attempt
    );
    if (same !== undefined) {
      return { record: same, next: this.live.get(same.id)?.ingestNext ?? 0 };
    }
    // An earlier try of the step is over: a rerun starts only after it.
    for (const record of earlier) {
      const live = this.live.get(record.id);
      if (live !== undefined) {
        this.finish(live, null, STATUS_AFTER[live.state.phase] ?? "crashed");
      }
    }
    const taken = new Set(earlier.map((record) => record.id));
    let id = `b${pipeline.number}`;
    for (let attempt = 2; taken.has(id); attempt += 1) {
      id = `b${pipeline.number}-${attempt}`;
    }
    const started = now();
    const live = this.follow({
      id,
      env: request.env,
      profile: request.profile,
      kind: "run",
      parentId: null,
      selection: {
        label: `${pipeline.label} pipeline #${pipeline.number}`,
        testIds: null,
        grep: null,
      },
      skipNeeds: false,
      status: "running",
      createdAt: started,
      startedAt: started,
      endedAt: null,
      pid: null,
      processStart: null,
      exitCode: null,
      stopRequestedAt: null,
      summary: null,
      startedBy: pipeline.creator,
      stoppedBy: null,
      ref: pipeline.branch,
      sha: null,
      ci: {
        number: pipeline.number,
        attempt: request.attempt,
        url: pipeline.url,
      },
      alongsideCi: false,
      agent: null,
    });
    live.ingestNext = 0;
    return { record: live.record, next: 0 };
  }

  /**
   * Appends a CI run's events in order: `from` must be the seq it expects next (else it says
   * which, and the step sends again from there). Its tail then shows them like any run's.
   */
  appendCiEvents(
    id: string,
    from: number,
    events: unknown[]
  ): { accepted: boolean; next: number } {
    const live = this.live.get(id);
    if (live === undefined || live.ingestNext === null) {
      throw new HttpError(410, `run ${id} is not taking events`);
    }
    if (from !== live.ingestNext) {
      return { accepted: false, next: live.ingestNext };
    }
    const lines = events.map((raw, index) => {
      const parsed = liveEventSchema.safeParse(raw);
      if (!parsed.success || parsed.data.seq !== from + index) {
        throw new HttpError(
          400,
          `event ${from + index} is not a live event in order`
        );
      }
      return `${JSON.stringify(parsed.data)}\n`;
    });
    if (lines.length > 0) {
      fs.appendFileSync(runFile(id, "events.ndjson"), lines.join(""));
    }
    live.ingestNext = from + lines.length;
    return { accepted: true, next: live.ingestNext };
  }

  /** The CI run a stream writes to (404 for none, 409 for a run of the console's own). */
  ciRecord(id: string): IRunRecord {
    const record = this.recordOf(id);
    if (record.ci === null) {
      throw new HttpError(409, `run ${id} is not a CI run`);
    }
    return record;
  }

  /** A CI run whose pipeline ended without its run.end: over, as its pipeline says. */
  endCiRun(id: string, pipelineStatus: ICiStatus): void {
    const live = this.live.get(id);
    if (live === undefined || !isCi(live)) {
      return;
    }
    // The run says why the rest of it is missing.
    const event: ILiveEvent = {
      seq: live.ingestNext ?? live.state.lastSeq + 1,
      ts: now(),
      type: "run.error",
      message: `The console stopped getting this run's events; its pipeline ended ${pipelineStatus}. The pipeline's log and test report in Bitbucket have the rest.`,
    };
    try {
      fs.appendFileSync(
        runFile(id, "events.ndjson"),
        `${JSON.stringify(event)}\n`
      );
    } catch {
      // The record below still ends it.
    }
    this.onEvent(live, event);
    this.finish(
      live,
      null,
      STATUS_AFTER[live.state.phase] ?? CI_ENDINGS[pipelineStatus] ?? "crashed"
    );
  }

  private ownRuns(): ILiveRun[] {
    return [...this.live.values()].filter((live) => !isCi(live));
  }

  // Two people retrying the same tests of a run at once: the second one hears who was first.
  private checkNotRetried(plan: IRunPlan): void {
    const waiting = this.queue.flatMap((id) => {
      const record = readRun(id);
      return record === null ? [] : [record];
    });
    const going = [...this.live.values()].map((live) => live.record);
    const same = [...waiting, ...going].find(
      (record) =>
        record.parentId === plan.parentId &&
        sameSelection(record.selection, plan.selection)
    );
    if (same !== undefined) {
      throw new HttpError(
        409,
        `${same.startedBy ?? "Someone"} already started this retry: run ${
          same.id
        }`
      );
    }
  }

  private checkAcceptingWork(): void {
    if (this.draining) {
      throw new HttpError(503, DRAINING_MESSAGE);
    }
  }

  // The environment, and its name typed when it is guarded; the workspace checks the profile.
  private checkRunnable(env: string, confirm: string | undefined): void {
    if (requireOffered(env).guarded && confirm !== env) {
      throw new HttpError(
        428,
        `${env} is guarded: its runs write real data with the shared QA account. Confirm with "${env}".`
      );
    }
  }

  private async planFor(
    env: string,
    profile: string,
    request: IStartRunRequest,
    source: IRunSource
  ): Promise<IRunPlan> {
    const base = {
      env,
      profile,
      parentId: null,
      skipNeeds: request.skipNeeds ?? false,
      alongsideCi: request.alongsideCi ?? false,
      source,
      agent: null,
    };
    const testIds = request.selection?.testIds;
    if (testIds !== undefined) {
      const catalog = new Map(
        (await this.workspace.catalog(env, profile, source, false)).map(
          (test) => [test.testId, test]
        )
      );
      const tests = testIds.flatMap((testId) => {
        const test = catalog.get(testId);
        return test === undefined ? [] : [test];
      });
      if (tests.length !== testIds.length) {
        throw new HttpError(
          400,
          `some of these tests are not in the ${env} × ${profile} catalog`
        );
      }
      return {
        ...base,
        kind: "run",
        selection: { label: describeTests(tests), testIds, grep: null },
        listLines: tests.map((test) => test.listLine),
      };
    }

    const grep = request.selection?.grep ?? null;
    if (grep !== null) {
      try {
        new RegExp(grep);
      } catch {
        throw new HttpError(400, `grep "${grep}" is not a regular expression`);
      }
    }
    return {
      ...base,
      kind: "run",
      selection: {
        label:
          grep === null ? `all ${profile} tests` : `tests matching ${grep}`,
        testIds: null,
        grep,
      },
      listLines: null,
    };
  }

  private async enqueue(
    plan: IRunPlan,
    by: string | null
  ): Promise<IRunRecord> {
    const id = newRunId();
    // The commit stays until the run's folder goes, whatever happens to its branch.
    await this.workspace.pin(id, plan.source);
    const record: IRunRecord = {
      id,
      env: plan.env,
      profile: plan.profile,
      kind: plan.kind,
      parentId: plan.parentId,
      selection: plan.selection,
      skipNeeds: plan.skipNeeds,
      alongsideCi: plan.alongsideCi,
      status: "queued",
      createdAt: now(),
      startedAt: null,
      endedAt: null,
      pid: null,
      processStart: null,
      exitCode: null,
      stopRequestedAt: null,
      summary: null,
      startedBy: by,
      stoppedBy: null,
      ref: plan.source.ref,
      sha: plan.source.sha,
      ci: null,
      agent: plan.agent,
    };
    this.save(record);
    if (plan.listLines !== null) {
      fs.writeFileSync(
        runFile(record.id, "test-list.txt"),
        `${plan.listLines.join("\n")}\n`
      );
    }
    this.queue.push(record.id);
    this.pump();
    return this.live.get(record.id)?.record ?? record;
  }

  private pump(): void {
    if (this.draining) {
      return;
    }
    for (const id of [...this.queue]) {
      if (this.ownRuns().length >= consoleSettings().maxActiveRuns) {
        return;
      }
      const record = readRun(id);
      if (record !== null && this.isEnvBusy(record.env, record.alongsideCi)) {
        continue;
      }
      this.queue.splice(this.queue.indexOf(id), 1);
      if (record !== null && record.status === "queued") {
        this.launch(record);
      }
    }
  }

  // The run holds its environment and a slot from here on, while it is prepared and while it runs.
  private launch(record: IRunRecord): void {
    const live = this.follow({
      ...record,
      status: "preparing",
      startedAt: now(),
    });
    const preparing = new AbortController();
    live.preparing = preparing;
    void this.prepareAndStart(live, preparing.signal);
  }

  private async prepareAndStart(
    live: ILiveRun,
    signal: AbortSignal
  ): Promise<void> {
    const record = live.record;
    let prepared: IPreparedRun;
    try {
      prepared = await this.workspace.prepare(
        record,
        runVariables(record),
        signal
      );
    } catch (error) {
      if (this.live.get(record.id) === live && !signal.aborted) {
        this.failPreparation(live, messageOf(error));
      }
      return;
    }
    // Stopped (or the console drained) while the last step finished.
    if (this.live.get(record.id) !== live || signal.aborted) {
      return;
    }
    live.preparing = null;
    let spawned: ISpawnedProcess;
    try {
      const launch = this.kindOf(record).launch(record, prepared);
      spawned = spawnDetached(
        launch.command,
        prepared.cwd,
        launch.env,
        runFile(record.id, "console.log")
      );
    } catch (error) {
      this.update(live, this.endedPatch(live.record));
      this.failPreparation(
        live,
        `the runner did not start: ${messageOf(error)}`
      );
      return;
    }
    this.update(live, {
      status: "starting",
      pid: spawned.pid,
      processStart: processStartTime(spawned.pid),
    });
    live.child = spawned.child;
    spawned.child.on("exit", (code) => this.finish(live, code));
    spawned.child.on("error", () => this.finish(live, null));
  }

  // Preparing failed: the run says why (its log and a run error) and ends as crashed.
  private failPreparation(live: ILiveRun, reason: string): void {
    const event: ILiveEvent = {
      seq: Math.max(live.state.lastSeq + 1, 0),
      ts: now(),
      type: "run.error",
      message: `The run could not be prepared: ${reason}`,
    };
    try {
      fs.appendFileSync(
        runFile(live.record.id, "events.ndjson"),
        `${JSON.stringify(event)}\n`
      );
      fs.appendFileSync(
        runFile(live.record.id, "console.log"),
        `${event.message}\n`
      );
    } catch {
      // The record below still says it crashed.
    }
    this.onEvent(live, event);
    this.endPreparation(live, "crashed", null);
  }

  /**
   * Ends a run that is still being prepared, without starting it: back to the queue (the console
   * shuts down), or over (stopped, or it failed). What was prepared goes.
   */
  private endPreparation(
    live: ILiveRun,
    status: "queued" | "interrupted" | "crashed",
    by: string | null
  ): IRunRecord {
    live.preparing?.abort();
    live.preparing = null;
    live.tail?.stop();
    this.clearTimers(live);
    this.live.delete(live.record.id);
    this.workspace.release(live.record.id);
    const ended = now();
    const endings: Record<
      typeof status,
      { patch: Partial<IRunRecord>; then: (id: string) => void }
    > = {
      // First in line again, for the next start.
      queued: {
        patch: { status: "queued", startedAt: null },
        then: (id) => this.queue.unshift(id),
      },
      interrupted: {
        patch: {
          status: "interrupted",
          endedAt: ended,
          stopRequestedAt: ended,
          stoppedBy: by,
        },
        then: () => this.freeSlot(),
      },
      crashed: {
        patch: { status: "crashed", endedAt: ended },
        then: () => this.freeSlot(),
      },
    };
    const ending = endings[status];
    const record = this.save({ ...live.record, ...ending.patch });
    ending.then(record.id);
    return record;
  }

  private freeSlot(): void {
    this.prune();
    this.pump();
  }

  private follow(record: IRunRecord): ILiveRun {
    const live: ILiveRun = {
      record,
      state: emptyRunState(),
      events: [],
      tail: null,
      child: null,
      stopTimer: null,
      exitWatch: null,
      forced: false,
      preparing: null,
      ingestNext: null,
    };
    this.live.set(record.id, live);
    this.save(record);
    live.tail = new NdjsonTail(runFile(record.id, "events.ndjson"), (event) =>
      this.onEvent(live, event)
    );
    live.tail.start();
    return live;
  }

  // A runner this console did not start (it was restarted): watched through its pid.
  private reattach(record: IRunRecord): void {
    const live = this.follow(record);
    const pid = record.pid;
    if (pid === null || !isSameProcess(pid, record.processStart)) {
      this.finish(live, null);
      return;
    }
    live.exitWatch = setInterval(() => {
      if (!isSameProcess(pid, record.processStart)) {
        this.finish(live, null);
      }
    }, EXIT_WATCH_MS);
    if (record.status === "stopping" && record.stopRequestedAt !== null) {
      const waited = Date.now() - Date.parse(record.stopRequestedAt);
      live.stopTimer = setTimeout(
        () => this.forceStop(live),
        Math.max(0, STOP_GRACE_MS - waited)
      );
    }
  }

  private onEvent(live: ILiveRun, event: ILiveEvent): void {
    if (event.seq <= live.state.lastSeq) {
      return;
    }
    live.events.push(event);
    reduceRun(live.state, event);
    this.hub.publishEvent(live.record.id, event);
    if (event.type === "run.begin" && live.record.status === "starting") {
      this.update(live, { status: "running" });
    }
    if (event.type === "run.end" && isCi(live)) {
      this.finish(live, null);
    }
  }

  // `status` null: as its events and exit code say, once the last events are read (a process
  // may exit right after writing its run.end).
  private finish(
    live: ILiveRun,
    exitCode: number | null,
    status: IRunStatus | null = null
  ): void {
    if (this.live.get(live.record.id) !== live) {
      return;
    }
    live.tail?.stop();
    const ended = status ?? finalStatus(live, exitCode);
    this.clearTimers(live);
    this.live.delete(live.record.id);
    settleRun(live.state);
    this.save({
      ...live.record,
      ...this.endedPatch(live.record),
      status: ended,
      exitCode,
      endedAt: now(),
      summary: live.state.counts,
    });
    this.workspace.release(live.record.id);
    this.freeSlot();
  }

  // Keeps the newest QA_CONSOLE_KEEP_RUNS run folders.
  private prune(): void {
    const removed = pruneRuns(
      consoleSettings().keepRuns,
      (id) => this.live.has(id) || this.queue.includes(id)
    );
    if (removed.length > 0) {
      this.hub.publishRemoved(removed);
      this.workspace.forget(removed).catch((error: unknown) => {
        console.error(
          `✗ Could not let go of old runs' commits: ${messageOf(error)}`
        );
      });
    }
  }

  private forceStop(live: ILiveRun): void {
    if (live.record.pid === null) {
      return;
    }
    live.forced = true;
    const env = live.record.env;
    killTree(live.record.pid, (targets) => this.runners.kill(env, targets));
  }

  private clearTimers(live: ILiveRun): void {
    if (live.stopTimer !== null) {
      clearTimeout(live.stopTimer);
      live.stopTimer = null;
    }
    if (live.exitWatch !== null) {
      clearInterval(live.exitWatch);
      live.exitWatch = null;
    }
  }

  private update(live: ILiveRun, patch: Partial<IRunRecord>): void {
    live.record = { ...live.record, ...patch };
    this.save(live.record);
  }

  private save(record: IRunRecord): IRunRecord {
    writeRun(record);
    // Only the runner of its environment may write in (and read) a run's folder.
    this.runners.share(record.env, runDirectory(record.id));
    this.hub.publishRun(record);
    return record;
  }

  private kindOf(record: IRunRecord): IRunKind {
    return this.kinds[record.agent === null ? "tests" : "agent"];
  }

  // What a run's kind adds once its process is over; a failure there does not keep it going.
  private endedPatch(record: IRunRecord): Partial<IRunRecord> {
    try {
      return this.kindOf(record).ended(record);
    } catch (error) {
      console.error(
        `✗ Run ${record.id} did not wind down: ${messageOf(error)}`
      );
      return {};
    }
  }

  private recordOf(id: string): IRunRecord {
    const record = this.live.get(id)?.record ?? readRun(id);
    if (record === null) {
      throw new HttpError(404, `no run ${id}`);
    }
    return record;
  }

  // `alongsideCi`: a run an operator started without waiting for CI counts no CI run or claim.
  private environmentActivity(
    env: string,
    alongsideCi = false
  ): IEnvironmentActivity | null {
    const going = [...this.live.values()].filter(
      (live) => live.record.env === env && !(alongsideCi && isCi(live))
    );
    if (going.length > 0) {
      return "run";
    }
    if (this.cleaning.has(env)) {
      return "cleanup";
    }
    return !alongsideCi && this.claims.holds(env) ? "ci" : null;
  }

  private isEnvBusy(env: string, alongsideCi = false): boolean {
    return this.environmentActivity(env, alongsideCi) !== null;
  }
}
