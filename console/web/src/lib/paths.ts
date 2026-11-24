import type { ISkillOrigin } from "@shared/types";

// URLs of the console's pages and of a run's files, report and traces (served by console/server).

function runBase(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}`;
}

/** The app's page of a run. */
export function runPath(runId: string): string {
  return runBase(runId);
}

/** A commit's page from the console's template ({sha}), or null when it has none. */
export function commitUrl(template: string | null, sha: string): string | null {
  return template === null ? null : template.replace("{sha}", sha);
}

/** The Skills page, on a branch (null: the default environment's). */
export function skillsPath(ref: string | null = null): string {
  return ref === null ? "/skills" : `/skills?${new URLSearchParams({ ref })}`;
}

/**
 * A skill's page. `origin` "console" picks a console skill that a repo skill of the same name
 * shadows on that branch; `ref` the branch its repo skills come from.
 */
export function skillPath(
  name: string,
  origin: ISkillOrigin | null = null,
  ref: string | null = null
): string {
  const query = new URLSearchParams();
  if (origin === "console") {
    query.set("origin", origin);
  }
  if (ref !== null) {
    query.set("ref", ref);
  }
  const search = query.toString();
  return `/skills/${encodeURIComponent(name)}${
    search === "" ? "" : `?${search}`
  }`;
}

/** Where a skill.yaml becomes a new skill. */
export function newSkillPath(): string {
  return "/skills/new";
}

/** Where a skill.yaml file becomes a new skill. */
export function uploadSkillPath(): string {
  return "/skills/new/upload";
}

/** The form a new skill is made in: from a template, from a copy of a skill, or blank. */
export function composeSkillPath(
  start: { template: string } | { from: string; origin: ISkillOrigin | null }
): string {
  const query = new URLSearchParams(
    "template" in start
      ? { template: start.template }
      : start.origin === null
      ? { from: start.from }
      : { from: start.from, origin: start.origin }
  );
  return `/skills/new/form?${query}`;
}

/** The skill form opening on a skill AI wrote (state/dialogs.ts skillStart carries it). */
export function writtenSkillPath(): string {
  return "/skills/new/form";
}

/** Where a skill gets a new version. */
export function replaceSkillPath(name: string): string {
  return `/skills/${encodeURIComponent(name)}/replace`;
}

/** A skill's skill.yaml to download: of a branch, or one version of a console skill. */
/** POST: deletes a skill from where this console keeps them. */
export function deleteSkillUrl(name: string): string {
  return `/api/skills/${encodeURIComponent(name)}/delete`;
}

/** POST: makes a version of a stored skill the one prod runs. */
export function promoteSkillUrl(name: string): string {
  return `/api/skills/${encodeURIComponent(name)}/promote`;
}

export function skillYamlUrl(
  name: string,
  options: {
    ref?: string | null;
    origin?: ISkillOrigin | null;
    version?: number | null;
  } = {}
): string {
  const query = new URLSearchParams();
  if (options.ref !== undefined && options.ref !== null) {
    query.set("ref", options.ref);
  }
  if (options.origin !== undefined && options.origin !== null) {
    query.set("origin", options.origin);
  }
  if (options.version !== undefined && options.version !== null) {
    query.set("version", String(options.version));
  }
  const search = query.toString();
  return `/api/skills/${encodeURIComponent(name)}/skill.yaml${
    search === "" ? "" : `?${search}`
  }`;
}

/** The CI pipelines' list. */
export function ciListPath(): string {
  return "/ci";
}

/** The app's page of a CI pipeline, by its build number. */
export function ciPath(number: number): string {
  return `/ci/${number}`;
}

export function runLogUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/log`;
}

export function ciLogUrl(number: number, stepUuid: string): string {
  return `/api/ci/pipelines/${number}/steps/${encodeURIComponent(
    stepUuid
  )}/log`;
}

/** A file of a run (screenshot, trace, attachment), by its path relative to the run folder. */
export function runFileUrl(runId: string, relativePath: string): string {
  const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${runBase(runId)}/files/${encoded}`;
}

/** Only the run folder's shots/ and artifacts/ are served. */
export function isServedRunFile(relativePath: string): boolean {
  return (
    relativePath.startsWith("shots/") || relativePath.startsWith("artifacts/")
  );
}

/** The run's HTML report, opened at one test when `testId` is given. */
export function reportUrl(runId: string, testId: string | null): string {
  const base = `${runBase(runId)}/report/`;
  return testId === null
    ? base
    : `${base}#?testId=${encodeURIComponent(testId)}`;
}

/** Playwright's trace viewer (shipped inside the run's HTML report) opening one trace. */
export function traceUrl(runId: string, tracePath: string): string {
  const trace = new URL(runFileUrl(runId, tracePath), window.location.origin);
  return `${runBase(runId)}/report/trace/index.html?trace=${encodeURIComponent(
    trace.href
  )}`;
}
