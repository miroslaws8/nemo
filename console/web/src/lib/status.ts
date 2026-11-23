import {
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePauseIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleStopIcon,
  CircleXIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TimerOffIcon,
  TriangleAlertIcon,
} from "@lucide/vue";
import { ACTIVE_RUN_STATUSES } from "@shared/api";
import type {
  ICiStatus,
  ICiStepStatus,
  IRunPhase,
  IRunStatus,
  IStepState,
  ITestStatus,
} from "@shared/types";
import type { ICountSegment, IStatusLook, ITone, IToneClasses } from "@/types";

// What every run and test status looks like. "interrupted" is what Playwright calls a Stop.

export const RUN_STATUS_LOOKS: Record<IRunStatus, IStatusLook> = {
  queued: {
    label: "Queued",
    tone: "idle",
    icon: CircleDashedIcon,
    live: false,
  },
  // A server console gets the run's commit and packages ready.
  preparing: {
    label: "Preparing",
    tone: "run",
    icon: LoaderCircleIcon,
    live: true,
  },
  starting: {
    label: "Starting",
    tone: "run",
    icon: LoaderCircleIcon,
    live: true,
  },
  running: {
    label: "Running",
    tone: "run",
    icon: LoaderCircleIcon,
    live: true,
  },
  stopping: {
    label: "Stopping",
    tone: "stop",
    icon: LoaderCircleIcon,
    live: true,
  },
  passed: {
    label: "Passed",
    tone: "pass",
    icon: CircleCheckIcon,
    live: false,
  },
  failed: { label: "Failed", tone: "fail", icon: CircleXIcon, live: false },
  interrupted: {
    label: "Stopped",
    tone: "stop",
    icon: CircleStopIcon,
    live: false,
  },
  timedout: {
    label: "Timed out",
    tone: "fail",
    icon: TimerOffIcon,
    live: false,
  },
  killed: {
    label: "Force-stopped",
    tone: "stop",
    icon: OctagonXIcon,
    live: false,
  },
  crashed: {
    label: "Crashed",
    tone: "fail",
    icon: TriangleAlertIcon,
    live: false,
  },
};

export const TEST_STATUS_LOOKS: Record<ITestStatus, IStatusLook> = {
  queued: {
    label: "Waiting",
    tone: "idle",
    icon: CircleDashedIcon,
    live: false,
  },
  running: {
    label: "Running",
    tone: "run",
    icon: LoaderCircleIcon,
    live: true,
  },
  passed: {
    label: "Passed",
    tone: "pass",
    icon: CircleCheckIcon,
    live: false,
  },
  failed: { label: "Failed", tone: "fail", icon: CircleXIcon, live: false },
  flaky: {
    label: "Flaky",
    tone: "flaky",
    icon: CircleAlertIcon,
    live: false,
  },
  skipped: {
    label: "Skipped",
    tone: "idle",
    icon: CircleMinusIcon,
    live: false,
  },
  interrupted: {
    label: "Stopped",
    tone: "stop",
    icon: CircleStopIcon,
    live: false,
  },
  timedOut: {
    label: "Timed out",
    tone: "fail",
    icon: TimerOffIcon,
    live: false,
  },
};

/** A CI pipeline's status, in the looks of the local runs. */
export const CI_STATUS_LOOKS: Record<ICiStatus, IStatusLook> = {
  pending: { ...RUN_STATUS_LOOKS.queued, label: "Pending" },
  running: RUN_STATUS_LOOKS.running,
  paused: {
    label: "Paused",
    tone: "stop",
    icon: CirclePauseIcon,
    live: false,
  },
  passed: RUN_STATUS_LOOKS.passed,
  failed: RUN_STATUS_LOOKS.failed,
  error: { ...RUN_STATUS_LOOKS.crashed, label: "Error" },
  stopped: RUN_STATUS_LOOKS.interrupted,
  expired: { ...RUN_STATUS_LOOKS.timedout, label: "Expired" },
};

export const CI_STEP_LOOKS: Record<ICiStepStatus, IStatusLook> = {
  pending: TEST_STATUS_LOOKS.queued,
  ready: TEST_STATUS_LOOKS.queued,
  running: TEST_STATUS_LOOKS.running,
  passed: TEST_STATUS_LOOKS.passed,
  failed: TEST_STATUS_LOOKS.failed,
  error: { ...RUN_STATUS_LOOKS.crashed, label: "Error" },
  stopped: TEST_STATUS_LOOKS.interrupted,
  "not-run": { ...TEST_STATUS_LOOKS.skipped, label: "Not run" },
  expired: { ...RUN_STATUS_LOOKS.timedout, label: "Expired" },
};

export const STEP_STATUS_LOOKS: Record<IStepState["status"], IStatusLook> = {
  running: TEST_STATUS_LOOKS.running,
  passed: TEST_STATUS_LOOKS.passed,
  failed: TEST_STATUS_LOOKS.failed,
  interrupted: TEST_STATUS_LOOKS.interrupted,
};

export const TONE_CLASSES: Record<ITone, IToneClasses> = {
  pass: { text: "text-pass", bar: "bg-pass", soft: "bg-pass/10" },
  fail: { text: "text-fail", bar: "bg-fail", soft: "bg-fail/10" },
  flaky: { text: "text-flaky", bar: "bg-flaky", soft: "bg-flaky/10" },
  run: { text: "text-run", bar: "bg-run", soft: "bg-run/10" },
  stop: { text: "text-stop", bar: "bg-stop", soft: "bg-stop/10" },
  idle: { text: "text-idle", bar: "bg-idle/35", soft: "bg-idle/10" },
};

/** The order of the counts in a progress bar and its legend: finished first, then going. */
export const COUNT_SEGMENTS: ICountSegment[] = [
  { key: "passed", label: "passed", tone: "pass" },
  { key: "flaky", label: "flaky", tone: "flaky" },
  { key: "failed", label: "failed", tone: "fail" },
  { key: "interrupted", label: "stopped", tone: "stop" },
  { key: "skipped", label: "skipped", tone: "idle" },
  { key: "running", label: "running", tone: "run" },
  { key: "queued", label: "waiting", tone: "idle" },
];

/** Tests a "Retry failed" takes (the server adds the never-started ones of a stopped run). */
export const RETRYABLE_TEST_STATUSES: ReadonlySet<ITestStatus> = new Set([
  "failed",
  "timedOut",
  "interrupted",
]);

/** Run phases after which the HTML report has been written. */
export const REPORTED_PHASES: ReadonlySet<IRunPhase> = new Set([
  "passed",
  "failed",
  "timedout",
  "interrupted",
]);

export function isActiveStatus(status: IRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.some((active) => active === status);
}

/** Neither waiting nor going: the run is over (whichever way). */
export function isFinishedStatus(status: IRunStatus): boolean {
  return status !== "queued" && !isActiveStatus(status);
}
