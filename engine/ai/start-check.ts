import type { IAiSettings, IStepNode, ITemplateDefinition } from "../types";
import { missingKeys } from "./client";

// In CI, a run whose tests ask the AI judge while its key is not set stops before any test:
// every ai_check would be "not judged", and a forgotten secret would look like passing checks.
// It runs as Playwright's global setup (engine/ai/global-setup.ts), so listing tests (`--list`,
// ci/validate.sh) and runs without an ai_check never trip it.

/** Whether the steps (inside templates and repeats too) use the step `keyword`. */
export function stepsUse(
  steps: IStepNode[],
  keyword: string,
  templates: ReadonlyMap<string, ITemplateDefinition>
): boolean {
  return steps.some((step) => {
    switch (step.kind) {
      case "action":
        return step.keyword === keyword;
      case "template": {
        const template = templates.get(step.template);
        return (
          template !== undefined && stepsUse(template.steps, keyword, templates)
        );
      }
      case "repeat":
        return stepsUse(step.steps, keyword, templates);
      default: {
        const unknownStep: never = step;
        return Boolean(unknownStep);
      }
    }
  });
}

/** Why the run must not start, or null. */
export function aiStartProblem(
  settings: IAiSettings | null,
  usesAiCheck: boolean,
  isCi: boolean
): string | null {
  if (settings === null || !usesAiCheck || !isCi) {
    return null;
  }
  const missing = missingKeys(settings);
  return missing.length === 0
    ? null
    : `${missing.join("; ")} (CI: the run's tests use ai_check)`;
}
