import { stringify } from "yaml";
import { parseTestSuite } from "../../loader";
import type { IAuthorDraft, IAuthorStep, IEnvironment } from "../../types";
import { parseYamlText } from "../../yaml-document";

// The test the author writes from the steps that worked: one suite, one test, tagged `authored`.
// It only looks (smoke) unless a step sent a form; such a draft writes data, so it is regression,
// tagged `writes`, limited to the environment it was made on, and says it is not cleaned up.

const MAX_SUITE_LENGTH = 80;
const MAX_SLUG_LENGTH = 60;
// A test list splits a full title on this character (engine/loader.ts checkTitles).
const TITLE_SEPARATOR = /›/g;

const HEADER = [
  "# yaml-language-server: $schema=../../schema/test-file.schema.json",
  "# Written by `pnpm author` from a description, and verified by a run of its own.",
];

const WRITES_NOTE =
  "# This test submits a form: the data it makes is not cleaned up (no gateway for it,\n# docs/guide.md → Test data and cleanup), so it runs only where it was written.";

function clean(text: string): string {
  return text.replace(TITLE_SEPARATOR, "-").replace(/\s+/g, " ").trim();
}

/** A goto to the site's own address as its route, so the test follows QA_<NAME>_URL. */
function asRoute(step: IAuthorStep, baseUrl: string): IAuthorStep {
  if (step.keyword !== "goto" || typeof step.args !== "string") {
    return step;
  }
  const base = new URL(baseUrl).origin;
  try {
    const url = new URL(step.args);
    return url.origin === base
      ? { ...step, args: `${url.pathname}${url.search}${url.hash}` }
      : step;
  } catch {
    return step;
  }
}

function slugOf(goal: string): string {
  const slug = goal
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const short = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return short === "" ? "authored-test" : short;
}

export function draftTest(
  goal: string,
  summary: string,
  kept: IAuthorStep[],
  environment: IEnvironment,
  writesAllowed: boolean
): IAuthorDraft {
  const submitsForm = kept.some((step) => step.submits);
  if (submitsForm && !writesAllowed) {
    throw new Error(
      `a step sent a form, but ${environment.name} does not allow writes (author_writes)`
    );
  }
  const tier = submitsForm ? "regression" : "smoke";
  const document = {
    suite: clean(goal).slice(0, MAX_SUITE_LENGTH),
    tier,
    tags: submitsForm ? ["authored", "writes"] : ["authored"],
    ...(submitsForm ? { environments: [environment.name] } : {}),
    tests: [
      {
        name: clean(summary) || clean(goal),
        steps: kept
          .map((step) => asRoute(step, environment.baseUrl))
          // A step the model repeated at once says nothing more.
          .filter(
            (step, index, steps) =>
              index === 0 ||
              JSON.stringify(steps[index - 1]) !== JSON.stringify(step)
          )
          .map((step) => ({ [step.keyword]: step.args })),
      },
    ],
  };
  const yaml = [
    ...HEADER,
    ...(submitsForm ? [WRITES_NOTE] : []),
    stringify(document, { lineWidth: 100, aliasDuplicateObjects: false }),
  ].join("\n");

  // A draft that does not load is a bug here, not a test to offer.
  parseTestSuite("draft", parseYamlText(yaml, "draft"), environment);
  return { yaml, slug: slugOf(goal), tier, submitsForm };
}
