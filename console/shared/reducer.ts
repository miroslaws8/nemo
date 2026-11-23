import type { ILiveEvent } from "../../engine/types";
import type {
  IRunCounts,
  IRunState,
  IStepState,
  ITestState,
  ITestStatus,
} from "./types";

// Rebuilds what a run looks like from its live events (engine/reporters/live-events.ts). The server
// keeps one per active run and the web app one per open run; both feed it the same events. It
// changes the state in place (a reactive object in the web app) and skips events it has seen.

type IEventOf<TType extends ILiveEvent["type"]> = Extract<
  ILiveEvent,
  { type: TType }
>;

const COUNTED_AS: Record<ITestStatus, keyof IRunCounts> = {
  queued: "queued",
  running: "running",
  passed: "passed",
  failed: "failed",
  flaky: "flaky",
  skipped: "skipped",
  interrupted: "interrupted",
  timedOut: "failed",
};

function zeroCounts(): IRunCounts {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    interrupted: 0,
    running: 0,
    queued: 0,
  };
}

export function emptyRunState(): IRunState {
  return {
    runId: null,
    env: null,
    profile: null,
    workers: 0,
    phase: "starting",
    order: [],
    tests: {},
    lanes: {},
    counts: zeroCounts(),
    startedAt: null,
    endedAt: null,
    ms: null,
    runErrors: [],
    notices: { "rate-limit": null, "session-lost": null },
    lastSeq: -1,
    lastEventAt: null,
  };
}

function recount(state: IRunState): void {
  const counts = zeroCounts();
  for (const testId of state.order) {
    const test = state.tests[testId];
    if (test === undefined) {
      continue;
    }
    counts.total += 1;
    counts[COUNTED_AS[test.status]] += 1;
  }
  state.counts = counts;
}

// Events of an earlier attempt of a retried test no longer change what is shown.
function attemptOf(
  state: IRunState,
  event: { testId: string; retry: number }
): ITestState | undefined {
  const test = state.tests[event.testId];
  return test !== undefined && test.retry === event.retry ? test : undefined;
}

function onRunBegin(state: IRunState, event: IEventOf<"run.begin">): void {
  state.runId = event.runId;
  state.env = event.env;
  state.profile = event.profile;
  state.workers = event.workers;
  state.phase = "running";
  state.startedAt = event.ts;
  state.order = event.tests.map((test) => test.testId);
  state.tests = Object.fromEntries(
    event.tests.map((test): [string, ITestState] => [
      test.testId,
      {
        ...test,
        status: "queued",
        retry: 0,
        lane: null,
        startedAt: null,
        ms: null,
        steps: [],
        currentStepId: null,
        shot: null,
        shotVersion: null,
        shots: [],
        errors: [],
        annotations: [],
        attachments: [],
      },
    ])
  );
  recount(state);
}

function onTestBegin(state: IRunState, event: IEventOf<"test.begin">): void {
  const test = state.tests[event.testId];
  if (test === undefined) {
    return;
  }
  test.status = "running";
  test.retry = event.retry;
  test.lane = event.lane;
  test.startedAt = event.ts;
  test.ms = null;
  test.steps = [];
  test.currentStepId = null;
  test.shot = null;
  test.shotVersion = null;
  test.shots = [];
  test.errors = [];
  test.annotations = [];
  test.attachments = [];
  state.lanes[String(event.lane)] = event.testId;
  recount(state);
}

function onStepBegin(state: IRunState, event: IEventOf<"step.begin">): void {
  const test = attemptOf(state, event);
  if (test === undefined) {
    return;
  }
  const parent = test.steps.find((step) => step.stepId === event.parentId);
  const step: IStepState = {
    stepId: event.stepId,
    parentId: event.parentId,
    depth: parent === undefined ? 0 : parent.depth + 1,
    title: event.title,
    kind: event.kind,
    yaml: event.yaml,
    status: "running",
    startedAt: event.ts,
    ms: null,
    error: null,
    note: null,
  };
  test.steps.push(step);
  test.currentStepId = event.stepId;
}

function onStepEnd(state: IRunState, event: IEventOf<"step.end">): void {
  const test = attemptOf(state, event);
  const step = test?.steps.find(
    (candidate) => candidate.stepId === event.stepId
  );
  if (test === undefined || step === undefined) {
    return;
  }
  step.status = event.error === null ? "passed" : "failed";
  step.ms = event.ms;
  step.error = event.error;
  step.note = event.note ?? null;
  if (test.currentStepId === event.stepId) {
    test.currentStepId = step.parentId;
  }
}

function onStepShot(state: IRunState, event: IEventOf<"step.shot">): void {
  const test = attemptOf(state, event);
  if (test !== undefined) {
    test.shot = event.path;
    test.shotVersion = event.seq;
    const shot = { path: event.path, stepId: event.stepId, seq: event.seq };
    const same = test.shots.findIndex((known) => known.path === event.path);
    if (same === -1) {
      test.shots.push(shot);
    } else {
      test.shots[same] = shot;
    }
  }
}

// Notices of every attempt count: a rate limit slowed the run down whichever attempt it hit.
function onTestNotice(state: IRunState, event: IEventOf<"test.notice">): void {
  const earlier = state.notices[event.kind];
  state.notices[event.kind] = {
    count: (earlier?.count ?? 0) + 1,
    firstAt: earlier?.firstAt ?? event.ts,
    lastAt: event.ts,
    lastMessage: event.message,
    lastTestId: event.testId,
  };
}

function endStatus(event: IEventOf<"test.end">): ITestStatus {
  return event.outcome === "flaky" ? "flaky" : event.status;
}

function onTestEnd(state: IRunState, event: IEventOf<"test.end">): void {
  const test = attemptOf(state, event);
  if (test === undefined) {
    return;
  }
  test.status = endStatus(event);
  test.ms = event.ms;
  test.currentStepId = null;
  test.errors = event.errors;
  test.annotations = event.annotations;
  test.attachments = event.attachments;
  if (test.lane !== null && state.lanes[String(test.lane)] === test.testId) {
    state.lanes[String(test.lane)] = null;
  }
  recount(state);
}

function onRunEnd(state: IRunState, event: IEventOf<"run.end">): void {
  state.phase = event.status;
  state.endedAt = event.ts;
  state.ms = event.ms;
  for (const lane of Object.keys(state.lanes)) {
    state.lanes[lane] = null;
  }
  recount(state);
}

/**
 * Closes a run whose runner ended without "run.end" (force-stopped or crashed): what was going
 * counts as stopped, so nothing reads as still running. A run that ended normally is left as is.
 */
export function settleRun(state: IRunState): void {
  if (state.phase !== "starting" && state.phase !== "running") {
    return;
  }
  for (const testId of state.order) {
    const test = state.tests[testId];
    if (test === undefined || test.status !== "running") {
      continue;
    }
    test.status = "interrupted";
    test.currentStepId = null;
    for (const step of test.steps) {
      if (step.status === "running") {
        step.status = "interrupted";
      }
    }
  }
  for (const lane of Object.keys(state.lanes)) {
    state.lanes[lane] = null;
  }
  state.phase = "interrupted";
  recount(state);
}

/** Applies one event; an event already applied (by seq) is ignored, so replays are safe. */
export function reduceRun(state: IRunState, event: ILiveEvent): IRunState {
  if (event.seq <= state.lastSeq) {
    return state;
  }
  state.lastSeq = event.seq;
  state.lastEventAt = event.ts;
  switch (event.type) {
    case "run.begin":
      onRunBegin(state, event);
      break;
    case "test.begin":
      onTestBegin(state, event);
      break;
    case "step.begin":
      onStepBegin(state, event);
      break;
    case "step.end":
      onStepEnd(state, event);
      break;
    case "step.shot":
      onStepShot(state, event);
      break;
    case "test.end":
      onTestEnd(state, event);
      break;
    case "test.notice":
      onTestNotice(state, event);
      break;
    case "run.error":
      state.runErrors.push(event.message);
      break;
    case "run.end":
      onRunEnd(state, event);
      break;
    case "test.output":
      // Output is read from the run log; it does not change the state.
      break;
    default: {
      const unknownEvent: never = event;
      return unknownEvent;
    }
  }
  return state;
}
