import type { ICiPipeline } from "@shared/types";
// How a CI pipeline reads in the console: its title, profile and what started it.

const DEPLOY_VARIABLES = ["E2E_EXPECT_FRONTEND_BUILD", "E2E_EXPECT_API_BUILD"];

function variable(pipeline: ICiPipeline, key: string): string | null {
  const value = pipeline.variables.find((entry) => entry.key === key)?.value;
  return value === undefined || value === "" ? null : value;
}

export function ciTitle(pipeline: ICiPipeline): string {
  return `${pipeline.label} #${pipeline.number}`;
}

/** The profile it ran (E2E_PROFILE), when the pipeline takes one. */
export function ciProfile(pipeline: ICiPipeline): string | null {
  return variable(pipeline, "E2E_PROFILE");
}

// What started a pipeline, the first rule that fits.
const CAUSES: ((pipeline: ICiPipeline) => string | null)[] = [
  (pipeline) => {
    const builds = DEPLOY_VARIABLES.flatMap((key) => {
      const value = variable(pipeline, key);
      return value === null ? [] : [value];
    });
    return builds.length > 0
      ? `after the deploy of ${builds.join(" + ")}`
      : null;
  },
  (pipeline) =>
    pipeline.trigger.startsWith("schedule") ? "on schedule" : null,
  (pipeline) => (pipeline.creator === null ? null : `by ${pipeline.creator}`),
];

export function ciCause(pipeline: ICiPipeline): string {
  for (const cause of CAUSES) {
    const text = cause(pipeline);
    if (text !== null) {
      return text;
    }
  }
  return "by hand";
}
