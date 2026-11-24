import fs from "node:fs";
import path from "node:path";
import { devices } from "@playwright/test";
import { createModelClient } from "./ai/client";
import { captureViewport } from "./ai/evidence";
import { draftTest } from "./ai/author/draft";
import { authorCase } from "./ai/author/loop";
import { targetRefusal, watchWrites } from "./ai/author/page-guards";
import { aiChecksVerdict } from "./ai/author/verify";
import { aiRunContext } from "./ai/run-context";
import { resolveAiSettings } from "./ai/settings";
import { runSpend } from "./ai/spend";
import { environmentVariables, getEnvironment } from "./environment";
import { ErrorMonitor } from "./error-monitor";
import { test } from "./fixtures";
import { parseTestSuite } from "./loader";
import { notifier } from "./notices";
import { E2E_ROOT } from "./paths";
import { runPaths } from "./run-dir";
import { runId, runVariables, testVariables } from "./run-info";
import { runSteps, runTestCase, TEST_FRAME } from "./runner";
import { selectedProfileName } from "./run-selection";
import { assertNoErrors } from "./steps/assertions";
import { parseYamlText } from "./yaml-document";
import type {
  IAuthorDraft,
  IAuthorResult,
  IAuthorStep,
  IRunContext,
} from "./types";

// pnpm author's one test (engine/scripts/author.ts starts it as the project <env>:author): the AI
// walks the described case with nemo's steps as tools (engine/ai/author/). Before a step runs, its
// target is checked (engine/ai/author/page-guards.ts); while it runs, writes are watched on the
// network and, where the environment does not allow them, stopped; after it, a page off the site
// ends the case. The steps that worked become the draft in reports/author/<run id>/.

const environment = getEnvironment();
const goal = process.env.E2E_AUTHOR_GOAL?.trim() ?? "";
const AUTHOR_TIMEOUT_MS = 15 * 60_000;
const TARGET_WAIT_MS = 10_000;
const START_STEP: IAuthorStep = { keyword: "goto", args: "/", submits: false };

function firstLine(error: unknown): string {
  // Without the report's colour codes: what the model reads.
  return (error instanceof Error ? error.message : String(error))
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")[0];
}

/** Where this author run writes: the run's folder (the console), else reports/author/<run id>. */
function authorFolder(): string {
  const runDir = runPaths().runDir;
  return runDir === null
    ? path.join(E2E_ROOT, "reports", "author", runId())
    : path.join(runDir, "author");
}

test(`author: ${goal}`, async ({
  page,
  api,
  resources,
  errorMonitor,
  browser,
}, testInfo) => {
  testInfo.setTimeout(AUTHOR_TIMEOUT_MS);
  if (goal === "") {
    throw new Error('E2E_AUTHOR_GOAL is empty: pnpm author "<what to check>"');
  }
  if (environment.guarded) {
    throw new Error(
      `${environment.name} is guarded: tests are written on another environment (e.g. staging)`
    );
  }
  const settings = resolveAiSettings(environment.name, selectedProfileName());
  if (settings === null || settings.author === null) {
    throw new Error(
      "No ai.author in e2e.config.yaml (docs/guide.md → Writing a test with AI)"
    );
  }
  const author = settings.author;
  const client = createModelClient(settings, author.model, runSpend());
  const base = new URL(environment.baseUrl).origin;
  const appOrigins = [
    base,
    ...(environment.apiUrl === null
      ? []
      : [new URL(environment.apiUrl).origin]),
  ];
  const writes = await watchWrites(
    page,
    environment.authorWrites,
    appOrigins,
    author.ignoreWrites
  );
  const context: IRunContext = {
    page,
    api,
    resources,
    errorMonitor,
    environment,
    testInfo,
    variables: {
      env: environmentVariables(environment),
      run: runVariables(),
      test: testVariables(goal),
    },
    aiCheckCount: 0,
    stepLog: [],
    ai: aiRunContext(environment),
  };

  let position = 0;
  const act = async (step: {
    keyword: string;
    args: unknown;
  }): Promise<{
    error: string | null;
    submits: boolean;
    stop: string | null;
  }> => {
    const refused = await targetRefusal(
      page,
      step.keyword,
      step.args,
      author.avoid,
      environment.baseUrl,
      TARGET_WAIT_MS
    );
    if (refused !== null) {
      return { error: refused, submits: false, stop: null };
    }
    position += 1;
    const before = page.url();
    // A step that is not kept must leave no trace on the page: the draft is only what was kept.
    const undo = async (): Promise<void> => {
      if (page.url() !== before) {
        await page.goto(before).catch(() => undefined);
      }
    };
    writes.begin();
    let error: string | null = null;
    try {
      await runSteps(
        [
          {
            kind: "action",
            keyword: step.keyword,
            args: step.args,
            position,
            location: {
              file: "author",
              line: null,
              label: `author step ${position}`,
            },
          },
        ],
        context,
        TEST_FRAME
      );
    } catch (thrown) {
      error = firstLine(thrown);
    }
    const written = writes.end();
    const origin = new URL(page.url()).origin;
    if (origin !== base) {
      return { error, submits: false, stop: `it left the site for ${origin}` };
    }
    if (written.length > 0 && !environment.authorWrites) {
      await undo();
      return {
        error: `this sends data (${written.join(", ")}) and ${
          environment.name
        } does not allow writes (author_writes): it was stopped; check the page without sending it`,
        submits: false,
        stop: null,
      };
    }
    if (error !== null) {
      await undo();
    }
    return {
      error,
      submits: error === null && written.length > 0,
      stop: null,
    };
  };

  const folder = authorFolder();
  fs.mkdirSync(folder, { recursive: true });
  let result: IAuthorResult = {
    outcome: "incomplete",
    summary: "the author did not run to the end",
    kept: [],
    turns: [],
  };
  let draft: IAuthorDraft | null = null;
  let verification: { verified: boolean; why: string } | null = null;

  // The draft, run on its own like any test (fresh browser, no retries), `times` times in a row;
  // every ai_check it holds must be judged pass. In this process, so its steps are live too.
  const verify = async (
    yaml: string,
    times: number
  ): Promise<{ verified: boolean; why: string }> => {
    const suite = parseTestSuite(
      "draft",
      parseYamlText(yaml, "draft"),
      environment
    );
    for (let round = 1; round <= times; round += 1) {
      const why =
        await test.step(`verify the draft (${round}/${times})`, async () => {
          const fresh = await browser.newContext({
            ...(environment.device === null ? {} : devices[environment.device]),
            baseURL: environment.baseUrl,
            ...(environment.signsIn
              ? { storageState: environment.storageStatePath }
              : {}),
          });
          const freshPage = await fresh.newPage();
          const monitor = await ErrorMonitor.attach(
            freshPage,
            base,
            api.origin,
            notifier(testInfo)
          );
          const before = testInfo.annotations.length;
          try {
            for (const testCase of suite.cases) {
              await runTestCase(testCase, {
                ...context,
                page: freshPage,
                errorMonitor: monitor,
                aiCheckCount: 0,
                stepLog: [],
              });
              await assertNoErrors(freshPage, monitor);
            }
          } catch (thrown) {
            return firstLine(thrown);
          } finally {
            await fresh.close();
          }
          const checks = suite.cases
            .flatMap((testCase) => testCase.steps)
            .filter(
              (step) => step.kind === "action" && step.keyword === "ai_check"
            ).length;
          return aiChecksVerdict(testInfo.annotations.slice(before), checks);
        });
      if (why !== null) {
        return { verified: false, why: `run ${round}: ${why}` };
      }
    }
    return { verified: true, why: `passed ${times} time(s) in a row` };
  };
  try {
    await page.goto("/");
    let turn = 0;
    result = await authorCase(goal, {
      client,
      observe: async () => {
        const evidence = await captureViewport(page);
        turn += 1;
        fs.writeFileSync(path.join(folder, `turn-${turn}.png`), evidence.png);
        return evidence;
      },
      act,
      maxActions: author.maxActions,
    });
    if (result.outcome === "done") {
      const kept =
        result.kept[0]?.keyword === "goto"
          ? result.kept
          : [START_STEP, ...result.kept];
      draft = draftTest(
        goal,
        result.summary,
        kept,
        environment,
        environment.authorWrites
      );
      fs.writeFileSync(
        path.join(folder, `${draft.slug}.test.yaml`),
        draft.yaml
      );
      verification = await verify(
        draft.yaml,
        Math.max(
          1,
          Math.min(5, Number(process.env.E2E_AUTHOR_VERIFY ?? "1") || 1)
        )
      );
    }
  } finally {
    // Written whatever happened: the transcript is what tells why.
    fs.writeFileSync(
      path.join(folder, "result.json"),
      JSON.stringify(
        {
          goal,
          environment: environment.name,
          outcome: result.outcome,
          summary: result.summary,
          turns: result.turns,
          verification,
          draft:
            draft === null
              ? null
              : {
                  file: `${draft.slug}.test.yaml`,
                  tier: draft.tier,
                  submitsForm: draft.submitsForm,
                },
        },
        null,
        2
      )
    );
  }
  await testInfo.attach("result.json", {
    path: path.join(folder, "result.json"),
  });
  if (verification !== null && !verification.verified) {
    throw new Error(`The draft was not verified: ${verification.why}`);
  }
  if (result.outcome !== "done") {
    throw new Error(
      `The author did not finish (${result.outcome}): ${result.summary}`
    );
  }
});
