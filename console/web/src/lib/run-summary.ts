import { isLoginProject } from "@shared/test-list";
import type {
  IRunPhase,
  IRunState,
  IStepState,
  ITestState,
  ITestStatus,
} from "@shared/types";
import type {
  IFailedTest,
  IFailureGroup,
  INormaliser,
  ISetupMiss,
  ISlowStep,
  ISlowTest,
  ISummaryFigures,
  ITimelineBar,
  ITimelineLane,
} from "@/types";
import { TEST_STATUS_LOOKS } from "./status";

// A run taken apart for its Summary tab: what failed (grouped by cause), what was slowest and
// what each worker ran when. Pure functions of the run's state, so the tab follows it live.

const FAILED_STATUSES: ReadonlySet<ITestStatus> = new Set([
  "failed",
  "timedOut",
]);
// Tests that are over, whichever way (they have their duration).
const DONE_STATUSES: ReadonlySet<ITestStatus> = new Set([
  "passed",
  "failed",
  "flaky",
  "timedOut",
  "interrupted",
]);
const GOING_PHASES: ReadonlySet<IRunPhase> = new Set(["starting", "running"]);

// A URL loses its query first (it holds digits and quotes).
const URL_QUERY: INormaliser = {
  pattern: /(https?:\/\/[^\s?#"'`]+)[?#][^\s"'`]*/g,
  replacement: "$1",
};
// A ' after a letter is an apostrophe (couldn't), not a quote.
const QUOTED: INormaliser = {
  pattern: /"[^"]*"|(?<!\w)'[^']*'|`[^`]*`|“[^”]*”/g,
  replacement: '"…"',
};
// Ids (a uuid, or hex that mixes letters and digits), then any other number, whatever its length.
const IDS_AND_NUMBERS: INormaliser[] = [
  {
    pattern:
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: "<id>",
  },
  {
    pattern: /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi,
    replacement: "<id>",
  },
  { pattern: /\d+/g, replacement: "#" },
  { pattern: /\s+/g, replacement: " " },
];
// What an error's first line loses to become its group's key, in this order.
const LINE_NORMALISERS = [URL_QUERY, QUOTED, ...IDS_AND_NUMBERS];
// What the element it names loses: not its quoted text, which says which element it is.
const LOCATOR_NORMALISERS = [URL_QUERY, ...IDS_AND_NUMBERS];

// The element a Playwright error names, on a line after its first: `Locator: getByText('Save')`
// (an expect), or a call log's `- waiting for getByRole('button', { name: 'Save' })`.
const LOCATOR_LINE =
  /^\s*(?:-\s*)?(?:Locator:\s*(\S.*?)|waiting for\s+((?:locator|frameLocator|getBy[A-Za-z]+)\(.*?))\s*$/m;

const NO_MESSAGE = "Failed without an error message";

function testsInOrder(state: IRunState): ITestState[] {
  return state.order.flatMap((testId) => {
    const test = state.tests[testId];
    return test === undefined ? [] : [test];
  });
}

/** The first line of an error, as it reads. */
function causeOf(message: string): string {
  const line = message
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text !== "");
  return line ?? NO_MESSAGE;
}

/** The first element an error names (a locator), as it reads; null: it names none. */
export function locatorOf(message: string): string | null {
  const found = LOCATOR_LINE.exec(message);
  return found?.[1] ?? found?.[2] ?? null;
}

function normalised(text: string, normalisers: INormaliser[]): string {
  return normalisers
    .reduce(
      (result, { pattern, replacement }) =>
        result.replace(pattern, replacement),
      text
    )
    .trim();
}

/**
 * A cause without what changes from one failure to the next (numbers, names, ids), with the
 * element it names when it names one: a timeout on another button is another cause.
 */
export function causeKey(cause: string, locator: string | null = null): string {
  const key = normalised(cause, LINE_NORMALISERS);
  return locator === null
    ? key
    : `${key} @ ${normalised(locator, LOCATOR_NORMALISERS)}`;
}

/** The deepest step that failed (the first of them at that depth). */
function failingStep(test: ITestState): IStepState | null {
  return test.steps.reduce<IStepState | null>(
    (deepest, step) =>
      step.status === "failed" &&
      (deepest === null || step.depth > deepest.depth)
        ? step
        : deepest,
    null
  );
}

function failedTest(test: ITestState): IFailedTest {
  const step = failingStep(test);
  return {
    testId: test.testId,
    title: test.title,
    suite: test.suite,
    file: test.file ?? test.spec,
    project: test.project,
    status: test.status,
    ms: test.ms,
    retry: test.retry,
    step: step === null ? null : { title: step.title, yaml: step.yaml },
    yaml: step?.yaml ?? test.errors[0]?.yaml ?? null,
  };
}

/** Failed and timed-out tests by cause: the commonest first, then the earliest in the run. */
export function failureGroups(state: IRunState): IFailureGroup[] {
  const groups = new Map<string, IFailureGroup>();
  for (const test of testsInOrder(state)) {
    if (!FAILED_STATUSES.has(test.status)) {
      continue;
    }
    const message = test.errors[0]?.message ?? "";
    const cause = causeOf(message);
    const locator = locatorOf(message);
    const key = causeKey(cause, locator);
    const group = groups.get(key) ?? {
      key,
      cause,
      locator,
      setup: false,
      tests: [],
    };
    group.tests.push(failedTest(test));
    group.setup = group.setup || isLoginProject(test.project);
    groups.set(key, group);
  }
  // The map keeps the order of first appearance, and the sort is stable.
  return [...groups.values()].sort(
    (left, right) => right.tests.length - left.tests.length
  );
}

function neverRan(test: ITestState, over: boolean): boolean {
  const notStarted = test.startedAt === null;
  const ways: Record<ITestStatus, boolean> = {
    skipped: true,
    queued: over,
    interrupted: notStarted,
    running: false,
    passed: false,
    failed: false,
    flaky: false,
    timedOut: false,
  };
  return ways[test.status];
}

/** Tests that never ran in a run whose setup (the login) failed, and which setups those were. */
export function notRunBecauseOfSetup(state: IRunState): ISetupMiss {
  const tests = testsInOrder(state);
  const setupTitles = tests
    .filter(
      (test) => isLoginProject(test.project) && FAILED_STATUSES.has(test.status)
    )
    .map((test) => test.title);
  if (setupTitles.length === 0) {
    return { count: 0, setupTitles: [] };
  }
  const over = !GOING_PHASES.has(state.phase);
  const count = tests.filter(
    (test) => !isLoginProject(test.project) && neverRan(test, over)
  ).length;
  return { count, setupTitles };
}

/** Every step above a YAML step, however deep (a repeat's rounds sit between it and its steps). */
function yamlAncestors(test: ITestState): Set<string> {
  const parentOf = new Map(
    test.steps.map((step) => [step.stepId, step.parentId])
  );
  const ancestors = new Set<string>();
  for (const step of test.steps) {
    if (step.kind !== "yaml") {
      continue;
    }
    let parentId = step.parentId;
    while (parentId !== null && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      parentId = parentOf.get(parentId) ?? null;
    }
  }
  return ancestors;
}

/** YAML steps that hold no other YAML step: a template call's steps, not the call itself. */
function leafYamlSteps(test: ITestState): (IStepState & { ms: number })[] {
  const ancestors = yamlAncestors(test);
  return test.steps.flatMap((step) =>
    step.kind === "yaml" && step.ms !== null && !ancestors.has(step.stepId)
      ? [{ ...step, ms: step.ms }]
      : []
  );
}

function byMsDescending<TItem extends { ms: number }>(
  left: TItem,
  right: TItem
): number {
  return right.ms - left.ms;
}

/** The finished tests that took longest, each with its slowest YAML step. */
export function slowestTests(state: IRunState, limit: number): ISlowTest[] {
  return testsInOrder(state)
    .flatMap((test): ISlowTest[] => {
      if (test.ms === null || !DONE_STATUSES.has(test.status)) {
        return [];
      }
      const slowest = leafYamlSteps(test).sort(byMsDescending)[0];
      return [
        {
          testId: test.testId,
          title: test.title,
          status: test.status,
          ms: test.ms,
          step:
            slowest === undefined
              ? null
              : { title: slowest.title, ms: slowest.ms },
        },
      ];
    })
    .sort(byMsDescending)
    .slice(0, limit);
}

/** The YAML steps of the whole run that took longest, with their tests. */
export function slowestSteps(state: IRunState, limit: number): ISlowStep[] {
  return testsInOrder(state)
    .flatMap((test) =>
      leafYamlSteps(test).map(
        (step): ISlowStep => ({
          testId: test.testId,
          stepId: step.stepId,
          title: step.title,
          ms: step.ms,
          testTitle: test.title,
        })
      )
    )
    .sort(byMsDescending)
    .slice(0, limit);
}

/**
 * What each worker ran, in ms from the run's start. A test still going ends at the run's
 * newest event (the timeline grows as events come in).
 */
export function timeline(state: IRunState): ITimelineLane[] {
  const tests = testsInOrder(state);
  const starts = tests.flatMap((test) =>
    test.startedAt === null ? [] : [Date.parse(test.startedAt)]
  );
  const runStart =
    state.startedAt === null
      ? Math.min(...starts)
      : Date.parse(state.startedAt);
  const lastEvent =
    state.lastEventAt === null ? runStart : Date.parse(state.lastEventAt);
  const lanes = new Map<number, ITimelineBar[]>();
  for (const test of tests) {
    if (test.lane === null || test.startedAt === null) {
      continue;
    }
    const startMs = Math.max(0, Date.parse(test.startedAt) - runStart);
    const endMs =
      test.ms === null
        ? Math.max(startMs, lastEvent - runStart)
        : startMs + test.ms;
    const bars = lanes.get(test.lane) ?? [];
    bars.push({
      testId: test.testId,
      title: test.title,
      status: test.status,
      tone: TEST_STATUS_LOOKS[test.status].tone,
      startMs,
      endMs,
    });
    lanes.set(test.lane, bars);
  }
  return [...lanes.entries()]
    .sort(([left], [right]) => left - right)
    .map(([lane, bars]) => ({
      lane,
      bars: bars.sort((left, right) => left.startMs - right.startMs),
    }));
}

/** The run's headline numbers. */
export function summaryFigures(state: IRunState): ISummaryFigures {
  const retried = testsInOrder(state).reduce(
    (sum, test) => sum + test.retry,
    0
  );
  return {
    total: state.counts.total,
    passed: state.counts.passed,
    failed: state.counts.failed,
    flaky: state.counts.flaky,
    retried,
    skipped: state.counts.skipped,
    ms: state.ms,
  };
}

// Round steps of a time axis, none more than twice the one before: some step always gives
// four to six ticks.
const TICK_STEPS_MS = [
  100, 200, 250, 500, 1_000, 2_000, 3_000, 5_000, 10_000, 15_000, 20_000,
  30_000, 60_000, 120_000, 180_000, 300_000, 600_000, 900_000, 1_200_000,
  1_800_000, 3_600_000, 7_200_000, 10_800_000,
];
const TARGET_TICKS = 5;

/** Round times for a time axis of this length, from 0: four to six of them (five if it can). */
export function timeTicks(spanMs: number): number[] {
  const countFor = (step: number): number => Math.floor(spanMs / step) + 1;
  const step = TICK_STEPS_MS.reduce(
    (best, candidate) =>
      Math.abs(countFor(candidate) - TARGET_TICKS) <=
      Math.abs(countFor(best) - TARGET_TICKS)
        ? candidate
        : best,
    TICK_STEPS_MS[0] ?? 1_000
  );
  return Array.from({ length: countFor(step) }, (_, index) => index * step);
}
