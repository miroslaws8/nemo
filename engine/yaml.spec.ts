import { createModelClient } from "./ai/client";
import { resolveAiSettings } from "./ai/settings";
import { runSpend } from "./ai/spend";
import { loadE2eConfig } from "./config";
import { environmentVariables, getEnvironment } from "./environment";
import { test } from "./fixtures";
import { loadTestSuites } from "./loader";
import { withRateLimitNote } from "./rate-limit";
import { runTestCase } from "./runner";
import { runVariables, testVariables } from "./run-info";
import { selectedProfileName } from "./run-selection";
import { assertNoErrors } from "./steps/assertions";
import type { IAiRunContext, ITestBody, ITestCase } from "./types";

// The only Playwright spec: it turns every tests/**/*.test.yaml into Playwright tests.
// Tests are written in YAML; nothing here needs editing to add one.

const environment = getEnvironment();

// The run's AI, once per worker: the judge's models, sharing the run's budget.
function aiRunContext(): IAiRunContext | null {
  const settings = resolveAiSettings(environment.name, selectedProfileName());
  if (settings === null) {
    return null;
  }
  const spend = runSpend();
  const escalateTo = settings.judge.escalateTo;
  return {
    settings,
    primary: createModelClient(settings, settings.judge.model, spend),
    escalation:
      escalateTo === null
        ? null
        : createModelClient(settings, escalateTo, spend),
  };
}

const ai = aiRunContext();

function createTestBody(testCase: ITestCase): ITestBody {
  return async ({ page, api, resources, errorMonitor }, testInfo) => {
    testInfo.setTimeout(testCase.timeoutMs);

    try {
      await runTestCase(testCase, {
        page,
        api,
        resources,
        errorMonitor,
        environment,
        testInfo,
        variables: {
          env: environmentVariables(environment),
          run: runVariables(),
          test: testVariables(testCase.title),
          ...structuredClone(testCase.variables),
        },
        aiCheckCount: 0,
        stepLog: [],
        ai,
      });

      // Inside the test body, so the verdict is final before the cleanup fixture reads it.
      if (loadE2eConfig().error_monitor.auto_check) {
        await test.step("no errors during the test", () =>
          assertNoErrors(page, errorMonitor));
      }
    } catch (error) {
      throw withRateLimitNote(error, errorMonitor.rateLimitHits());
    }
  };
}

// Each tier is its own Playwright project that selects tests by the @tier-<name> tag.
for (const suite of loadTestSuites(environment)) {
  test.describe(
    suite.suite,
    { tag: [`tier-${suite.tier}`, ...suite.tags].map((tag) => `@${tag}`) },
    () => {
      for (const testCase of suite.cases) {
        const details = {
          annotation: { type: "file", description: suite.file },
        };
        const body = createTestBody(testCase);

        if (testCase.only) {
          test.only(testCase.title, details, body);
        } else if (testCase.skip) {
          test.skip(testCase.title, details, body);
        } else {
          test(testCase.title, details, body);
        }
      }
    }
  );
}
