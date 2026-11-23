import path from "node:path";
import { test, type Locator, type Location } from "@playwright/test";
import { describeTarget, locate } from "./locate";
import { notifier } from "./notices";
import { E2E_ROOT } from "./paths";
import { describeRateLimitHits, pauseForHits, sleep } from "./rate-limit";
import { PARAMS_VARIABLE, targetSchema } from "./schema";
import { SETUPS_BY_NAME } from "./setups";
import { STEPS_BY_KEYWORD } from "./steps";
import { getTemplate, resolveTemplateParams } from "./templates";
import type {
  IActionStep,
  IRepeatStep,
  IRunContext,
  ISetupCall,
  IStepFrame,
  IStepNode,
  ITemplateCallStep,
  ITestCase,
  IVariables,
} from "./types";
import { evaluateCondition, interpolate, isRecord } from "./variables";

const STEP_SCREENSHOTS_ENABLED = process.env.E2E_STEP_SCREENSHOTS !== "0";

// How long each `repeat` round waits for its `until` target before running the steps again.
const REPEAT_SETTLE_MS = 3_000;

// A page whose requests the API refused with 429 (its rate limit) can show a wrong state:
// Knowledge Space shows its first-run intro when its counts are refused. When a step then fails,
// the steps from the page's goto run again once the limit resets, at most once per pause listed
// here (the least to wait; the API's longer advice wins).
const RATE_LIMIT_REPLAY_FLOORS_MS = [5_000, 30_000];

const TEST_FRAME: IStepFrame = {
  params: null,
  numberPrefix: "",
  callChain: [],
};

/** The variables a step sees: the test's own, plus `params` inside a template. */
function scopeVariables(context: IRunContext, frame: IStepFrame): IVariables {
  if (frame.params === null) {
    return context.variables;
  }
  return { ...context.variables, [PARAMS_VARIABLE]: frame.params };
}

function stepNumber(frame: IStepFrame, position: number): string {
  if (frame.numberPrefix === "") {
    return String(position).padStart(2, "0");
  }
  return `${frame.numberPrefix}.${position}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// An engine error inside a template names the whole call chain:
// tests/…/x.test.yaml:18 › add_asset_via_modal › templates/…/y.template.yaml:9
function withLocation<TResult>(
  frame: IStepFrame,
  step: IStepNode,
  action: () => TResult
): TResult {
  try {
    return action();
  } catch (error) {
    const chain = [...frame.callChain, step.location.label].join(" › ");
    throw new Error(`${chain}: ${describeError(error)}`);
  }
}

// Report steps point at the YAML line they come from.
function stepOptions(step: IStepNode): { location?: Location } {
  if (step.location.line === null) {
    return {};
  }
  return {
    location: {
      file: path.join(E2E_ROOT, step.location.file),
      line: step.location.line,
      column: 1,
    },
  };
}

function findSkipReason(step: IStepNode, variables: IVariables): string | null {
  if (step.when !== undefined && !evaluateCondition(variables, step.when)) {
    return `when ${step.when}`;
  }
  if (step.unless !== undefined && evaluateCondition(variables, step.unless)) {
    return `unless ${step.unless}`;
  }
  return null;
}

/**
 * A step for the AI judge's "steps so far": as written, with its ${…} left as they are, so values
 * (a typed password, a tokenised link) never leave the machine.
 */
export function stepLogLine(step: IActionStep): string {
  const definition = STEPS_BY_KEYWORD.get(step.keyword);
  try {
    return definition === undefined
      ? step.keyword
      : definition.describe(step.args);
  } catch {
    return step.keyword;
  }
}

function describeAction(step: IActionStep, variables: IVariables): string {
  const definition = STEPS_BY_KEYWORD.get(step.keyword);
  if (definition === undefined) {
    return step.keyword;
  }
  try {
    return definition.describe(
      interpolate(step.args, variables, { strict: false })
    );
  } catch {
    return step.keyword;
  }
}

function describeTemplateCall(
  step: ITemplateCallStep,
  variables: IVariables
): string {
  const template = getTemplate(step.template);
  if (template.title === null) {
    return step.template;
  }
  try {
    const params = resolveTemplateParams(
      template,
      interpolate(step.args, variables, { strict: false })
    );
    return String(
      interpolate(
        template.title,
        { ...variables, [PARAMS_VARIABLE]: params },
        { strict: false }
      )
    );
  } catch {
    return step.template;
  }
}

function describeRepeat(step: IRepeatStep, variables: IVariables): string {
  const until = targetSchema.safeParse(
    interpolate(step.until, variables, { strict: false })
  );
  return until.success
    ? `repeat until ${describeTarget(until.data)} is visible (max ${step.max})`
    : "repeat";
}

function describeStep(step: IStepNode, variables: IVariables): string {
  if (step.name !== undefined) {
    return step.name;
  }
  switch (step.kind) {
    case "action":
      return describeAction(step, variables);
    case "template":
      return describeTemplateCall(step, variables);
    case "repeat":
      return describeRepeat(step, variables);
    default: {
      const unknownStep: never = step;
      return String(unknownStep);
    }
  }
}

async function attachScreenshot(
  context: IRunContext,
  name: string
): Promise<void> {
  if (!STEP_SCREENSHOTS_ENABLED || context.page.isClosed()) {
    return;
  }
  await context.testInfo.attach(name, {
    body: await context.page.screenshot(),
    contentType: "image/png",
  });
}

async function runAction(
  step: IActionStep,
  context: IRunContext,
  frame: IStepFrame,
  number: string
): Promise<void> {
  const definition = STEPS_BY_KEYWORD.get(step.keyword);
  if (definition === undefined) {
    throw new Error(`${step.location.label}: unknown step "${step.keyword}"`);
  }

  const args = withLocation(frame, step, () => {
    const resolved = interpolate(step.args, scopeVariables(context, frame), {
      strict: true,
    });
    definition.schema.parse(resolved);
    return resolved;
  });
  await definition.run(args, context);
  context.stepLog.push(stepLogLine(step));
  await attachScreenshot(context, `step-${number}`);
}

async function runTemplateCall(
  step: ITemplateCallStep,
  context: IRunContext,
  frame: IStepFrame,
  number: string
): Promise<void> {
  const template = getTemplate(step.template);
  const params = withLocation(frame, step, () =>
    resolveTemplateParams(
      template,
      interpolate(step.args, scopeVariables(context, frame), { strict: true })
    )
  );

  await runSteps(template.steps, context, {
    params,
    numberPrefix: number,
    callChain: [
      ...frame.callChain,
      `${step.location.label} › ${template.name}`,
    ],
  });
}

async function isVisibleWithin(
  locator: Locator,
  timeoutMs: number
): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

// Each round first gives `until` a moment to appear (the previous round's last click may still be
// loading it), then runs the steps again; rounds show as "05 #1", "05 #2" in the report.
async function runRepeat(
  step: IRepeatStep,
  context: IRunContext,
  frame: IStepFrame,
  number: string
): Promise<void> {
  const until = withLocation(frame, step, () =>
    targetSchema.parse(
      interpolate(step.until, scopeVariables(context, frame), { strict: true })
    )
  );
  const untilLocator = locate(context.page, until);

  for (let round = 1; round <= step.max; round += 1) {
    if (await isVisibleWithin(untilLocator, REPEAT_SETTLE_MS)) {
      return;
    }
    await test.step(`${number} #${round}`, () =>
      runSteps(step.steps, context, { ...frame, numberPrefix: number }));
  }
  if (!(await isVisibleWithin(untilLocator, REPEAT_SETTLE_MS))) {
    throw new Error(
      `${step.location.label}: ${describeTarget(
        until
      )} still not visible after ${step.max} rounds`
    );
  }
}

// Each YAML step becomes one report step (a template call becomes a group of them); a skipped
// conditional step is still listed, so the report shows which branch ran.
async function runStep(
  step: IStepNode,
  context: IRunContext,
  frame: IStepFrame
): Promise<void> {
  const variables = scopeVariables(context, frame);
  const number = stepNumber(frame, step.position);
  const title = `${number} ${describeStep(step, variables)}`;
  const options = stepOptions(step);
  const skipReason = withLocation(frame, step, () =>
    findSkipReason(step, variables)
  );

  if (skipReason !== null) {
    await test.step.skip(
      `${title} — skipped (${skipReason})`,
      async () => {},
      options
    );
    return;
  }

  switch (step.kind) {
    case "action":
      await test.step(
        title,
        () => runAction(step, context, frame, number),
        options
      );
      return;
    case "template":
      await test.step(
        title,
        () => runTemplateCall(step, context, frame, number),
        options
      );
      return;
    case "repeat":
      await test.step(
        title,
        () => runRepeat(step, context, frame, number),
        options
      );
      return;
    default: {
      const unknownStep: never = step;
      throw new Error(`Unknown step ${JSON.stringify(unknownStep)}`);
    }
  }
}

function isGoto(step: IStepNode): boolean {
  return step.kind === "action" && step.keyword === "goto";
}

function observesOnly(step: IStepNode): boolean {
  return (
    step.kind === "action" &&
    (STEPS_BY_KEYWORD.get(step.keyword)?.observesOnly ?? false)
  );
}

/**
 * Whether the steps from a goto up to a failed step can run again: everything in between only
 * looked at the page, and the failed step is a single action, so nothing is done twice.
 */
function canReplay(
  steps: IStepNode[],
  gotoIndex: number,
  failedIndex: number
): boolean {
  return (
    steps[failedIndex].kind === "action" &&
    steps.slice(gotoIndex + 1, failedIndex).every(observesOnly)
  );
}

async function waitOutRateLimit(
  context: IRunContext,
  floorMs: number,
  replayFrom: IStepNode
): Promise<void> {
  const hits = context.errorMonitor.rateLimitHits();
  const pauseMs = pauseForHits(hits, floorMs);
  const seconds = Math.ceil(pauseMs / 1000);
  context.testInfo.annotations.push({
    type: "rate limited",
    description: `${describeRateLimitHits(
      hits
    )} — waited ${seconds}s and ran the steps again from ${
      replayFrom.location.label
    }`,
  });
  notifier(context.testInfo)(
    "rate-limit",
    `${describeRateLimitHits(
      hits
    )}: waiting ${seconds}s, then running the steps again from ${
      replayFrom.location.label
    }`
  );
  await test.step(`API rate limit: wait ${seconds}s, then run again from ${replayFrom.location.label}`, () =>
    sleep(pauseMs));
}

export async function runSteps(
  steps: IStepNode[],
  context: IRunContext,
  frame: IStepFrame
): Promise<void> {
  let gotoIndex: number | null = null;
  let replays = 0;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (isGoto(step)) {
      gotoIndex = index;
    }

    try {
      await runStep(step, context, frame);
    } catch (error) {
      const floorMs = RATE_LIMIT_REPLAY_FLOORS_MS.at(replays);
      if (
        floorMs === undefined ||
        gotoIndex === null ||
        context.errorMonitor.rateLimitHits().length === 0 ||
        !canReplay(steps, gotoIndex, index)
      ) {
        throw error;
      }
      replays += 1;
      await waitOutRateLimit(context, floorMs, steps[gotoIndex]);
      // The loop's increment lands on the goto again.
      index = gotoIndex - 1;
    }
  }
}

function describeSetupCall(call: ISetupCall): string {
  if (!isRecord(call.args) || Object.keys(call.args).length === 0) {
    return call.name;
  }
  const params = Object.entries(call.args)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");
  return `${call.name} (${params})`;
}

export async function runTestCase(
  testCase: ITestCase,
  context: IRunContext
): Promise<void> {
  for (const call of testCase.setup) {
    const setup = SETUPS_BY_NAME.get(call.name);
    if (setup === undefined) {
      throw new Error(`Unknown setup "${call.name}"`);
    }
    await test.step(`setup: ${describeSetupCall(call)}`, () =>
      setup.run(call.args, context));
  }

  await runSteps(testCase.steps, context, TEST_FRAME);
}
