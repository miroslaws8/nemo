import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createModelClient } from "./ai/client";
import { captureViewport } from "./ai/evidence";
import { draftTest } from "./ai/author/draft";
import { refuseByAvoid, refuseGoto } from "./ai/author/guards";
import { authorCase } from "./ai/author/loop";
import { aiRunContext } from "./ai/run-context";
import { resolveAiSettings } from "./ai/settings";
import { runSpend } from "./ai/spend";
import { environmentVariables, getEnvironment } from "./environment";
import { test } from "./fixtures";
import { locate } from "./locate";
import { E2E_ROOT } from "./paths";
import { runId, runVariables, testVariables } from "./run-info";
import { runSteps, TEST_FRAME } from "./runner";
import { selectedProfileName } from "./run-selection";
import { targetSchema } from "./schema";
import type { IAuthorStep, IRunContext } from "./types";

// pnpm author's one test (engine/scripts/author.ts starts it as the project <env>:author): the AI
// walks the described case with nemo's steps as tools (engine/ai/author/), guarded here before
// each step runs, and the steps that worked become the draft in reports/author/<run id>/.

const environment = getEnvironment();
const goal = process.env.E2E_AUTHOR_GOAL?.trim() ?? "";
const AUTHOR_TIMEOUT_MS = 15 * 60_000;
const START_STEP: IAuthorStep = { keyword: "goto", args: "/", submits: false };

/** The output folder of this author run. */
export function authorFolder(): string {
  return path.join(E2E_ROOT, "reports", "author", runId());
}

const targetLike = targetSchema;

/** A click target's accessible name (or text) and whether it submits a form. */
async function inspectTarget(
  page: Page,
  args: unknown
): Promise<{ name: string; submits: boolean } | null> {
  const target = targetLike.safeParse(args);
  if (!target.success) {
    return null;
  }
  const element = locate(page, target.data).first();
  if ((await element.count()) === 0) {
    return null;
  }
  return element.evaluate((node) => {
    const name =
      node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "";
    const submits =
      (node instanceof HTMLButtonElement || node instanceof HTMLInputElement) &&
      node.type === "submit" &&
      node.form !== null;
    return { name, submits };
  });
}

/** Whether Enter now would submit a form: the focus is in a form's field. */
async function enterSubmits(page: Page, args: unknown): Promise<boolean> {
  const key =
    typeof args === "string"
      ? args
      : typeof args === "object" && args !== null && "key" in args
      ? String(args.key)
      : "";
  if (key !== "Enter") {
    return false;
  }
  return page.evaluate(() => {
    const focused = document.activeElement;
    return focused !== null && focused.closest("form") !== null;
  });
}

test(`author: ${goal}`, async ({
  page,
  api,
  resources,
  errorMonitor,
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
  }): Promise<{ error: string | null; submits: boolean }> => {
    let submits = false;
    if (step.keyword === "goto" && typeof step.args === "string") {
      const refused = refuseGoto(step.args, environment.baseUrl);
      if (refused !== null) {
        return { error: refused, submits };
      }
    }
    if (step.keyword === "click") {
      const target = await inspectTarget(page, step.args);
      if (target !== null) {
        const refused = refuseByAvoid(target.name, author.avoid);
        if (refused !== null) {
          return { error: refused, submits };
        }
        submits = target.submits;
      }
    }
    if (step.keyword === "press") {
      submits = await enterSubmits(page, step.args);
    }
    if (submits && !environment.authorWrites) {
      return {
        error: `this would send a form, and ${environment.name} does not allow writes (author_writes): check the form without sending it`,
        submits,
      };
    }
    position += 1;
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
    } catch (error) {
      return {
        // The first line, without the report's colour codes: what the model reads.
        error: (error instanceof Error ? error.message : String(error))
          .replace(/\u001b\[[0-9;]*m/g, "")
          .split("\n")[0],
        submits,
      };
    }
    if (new URL(page.url()).origin !== base) {
      await page.goBack().catch(() => undefined);
      return {
        error: `that left the site (${
          new URL(page.url()).origin
        }); stay on ${base}`,
        submits,
      };
    }
    return { error: null, submits };
  };

  await page.goto("/");
  let turn = 0;
  const folder = authorFolder();
  fs.mkdirSync(folder, { recursive: true });
  const result = await authorCase(goal, {
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

  const kept =
    result.kept[0]?.keyword === "goto"
      ? result.kept
      : [START_STEP, ...result.kept];
  const draft =
    result.outcome === "done"
      ? draftTest(
          goal,
          result.summary,
          kept,
          environment,
          environment.authorWrites
        )
      : null;
  if (draft !== null) {
    fs.writeFileSync(path.join(folder, `${draft.slug}.test.yaml`), draft.yaml);
  }
  fs.writeFileSync(
    path.join(folder, "result.json"),
    JSON.stringify(
      {
        goal,
        environment: environment.name,
        outcome: result.outcome,
        summary: result.summary,
        turns: result.turns,
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
  await testInfo.attach("result.json", {
    path: path.join(folder, "result.json"),
  });
  if (result.outcome !== "done") {
    throw new Error(
      `The author did not finish (${result.outcome}): ${result.summary}`
    );
  }
});
