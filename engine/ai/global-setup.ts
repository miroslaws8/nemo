import { loadTestSuites } from "../loader";
import { selectRun } from "../run-selection";
import { loadTemplates } from "../templates";
import { resolveAiSettings } from "./settings";
import { aiStartProblem, stepsUse } from "./start-check";

/** Playwright's global setup: the AI start check (engine/ai/start-check.ts) for this run. */
export default async function globalSetup(): Promise<void> {
  const run = selectRun();
  const settings = resolveAiSettings(run.environment.name, run.profileName);
  if (settings === null) {
    return;
  }
  const templates = loadTemplates();
  const tierNames = run.tiers.map((tier) => tier.name);
  const usesAiCheck = loadTestSuites(run.environment)
    .filter((suite) => tierNames.includes(suite.tier))
    .some((suite) =>
      suite.cases.some((testCase) =>
        stepsUse(testCase.steps, "ai_check", templates)
      )
    );
  const problem = aiStartProblem(
    settings,
    usesAiCheck,
    Boolean(process.env.CI)
  );
  if (problem !== null) {
    throw new Error(problem);
  }
}
