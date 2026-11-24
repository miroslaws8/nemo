import { isLoginProject } from "@shared/test-list";
import type {
  IRunRecord,
  IRunState,
  IRunStatus,
  ITestState,
} from "@shared/types";
import { consoleConfig, tierNamed } from "@/state/config";
import type { IRunKindChoice, IRunOrigin } from "@/types";
import { tierOf } from "./format";
import {
  isFinishedStatus,
  REPORTED_PHASES,
  RETRYABLE_TEST_STATUSES,
} from "./status";

// What a run's buttons depend on. The retry choices mirror the server's (console/server/
// run-manager.ts), so the counts on the buttons are what a retry really takes.

// A run that ended early: "Retry failed" also takes the tests it never started.
const ENDED_EARLY: ReadonlySet<IRunStatus> = new Set([
  "interrupted",
  "killed",
  "crashed",
  "timedout",
]);

/** The run's tests a retry can name (the login setup always runs by itself). */
export function selectableTests(state: IRunState): ITestState[] {
  return state.order.flatMap((testId) => {
    const test = state.tests[testId];
    return test === undefined || isLoginProject(test.project) ? [] : [test];
  });
}

/** An agent check (Hermes): it runs again as a whole, and leaves its data for review. */
export function isAgentCheck(run: IRunRecord): boolean {
  return run.agent !== null;
}

/** A test being written with AI from a description: it runs again as a whole. */
export function isAuthorRun(run: IRunRecord): boolean {
  return run.author !== null;
}

/** What the run runs: the YAML tests, an agent check, or writing a test. */
export function runKindOf(run: IRunRecord): IRunKindChoice {
  if (isAuthorRun(run)) {
    return "author";
  }
  return isAgentCheck(run) ? "agent" : "tests";
}

/** What "Retry failed" takes (an agent check: nothing, it only runs again). */
export function failedTests(run: IRunRecord, state: IRunState): ITestState[] {
  if (isAgentCheck(run) || isAuthorRun(run)) {
    return [];
  }
  return selectableTests(state).filter(
    (test) =>
      RETRYABLE_TEST_STATUSES.has(test.status) ||
      (test.status === "queued" && ENDED_EARLY.has(run.status))
  );
}

/** Tiers that run in full before these tests unless the run skips them (e.g. smoke before ai). */
export function neededTiers(tests: ITestState[]): string[] {
  const tiers = new Set(
    tests.flatMap((test) => tierNamed(tierOf(test.project))?.needs ?? [])
  );
  return [...tiers];
}

/** The HTML report is written when Playwright ends a run; a force-stopped run has none. */
export function hasReport(run: IRunRecord, state: IRunState): boolean {
  return (
    isFinishedStatus(run.status) &&
    run.status !== "killed" &&
    REPORTED_PHASES.has(state.phase)
  );
}

/** Who runs it: the console, or a CI pipeline it follows. */
export function originOf(run: IRunRecord): IRunOrigin {
  return run.ci === null ? "console" : "ci";
}

/** Whether Clean up may find data of the run: an agent check's skill may have made some. */
export function cleanable(run: IRunRecord, state: IRunState): boolean {
  return isAgentCheck(run) || touchesData(run, state);
}

/** Whether the run's tests may have made data: it ran a tier that is not read-only. */
export function touchesData(run: IRunRecord, state: IRunState): boolean {
  if (isAgentCheck(run)) {
    return false;
  }
  const tests = selectableTests(state);
  const tiers =
    tests.length > 0
      ? tests.map((test) => tierOf(test.project))
      : consoleConfig.value?.profiles.find(
          (profile) => profile.name === run.profile
        )?.tiers ?? [];
  return tiers.some((tier) => tierNamed(tier)?.readOnly === false);
}
