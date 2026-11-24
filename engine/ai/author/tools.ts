import { z } from "zod";
import { STEPS_BY_KEYWORD } from "../../steps";
import type { IModelTool } from "../../types";

// The tools of the test author: the steps it may take, as nemo's own steps (so a walked case is
// already a YAML test), and `finish`. Each tool takes `{ args }`, the step's YAML argument: some
// steps take a plain string or `true`, and tool parameters must be an object.

/** The steps the author may take: they look, navigate, click and type; none makes setups or tracks data. */
export const AUTHOR_STEP_KEYWORDS = [
  "goto",
  "click",
  "fill",
  "press",
  "expect",
  "expect_visible",
  "expect_hidden",
  "expect_url",
  "expect_fits_width",
  "ai_check",
] as const;

const DESCRIPTIONS: Record<(typeof AUTHOR_STEP_KEYWORDS)[number], string> = {
  goto: "Open a page: a path of the site (e.g. /pricing) or a URL on the same site.",
  click:
    "Click a target: { button: name } or { role, name } (links: role link), or { text }, { label }, { placeholder }, { css }; optional in: dialog, nth.",
  fill: "Type into a field: a target and value, e.g. { label: Email, value: qa@example.com }.",
  press:
    "Press a key, e.g. Enter, for whatever has focus, or { target…, key }.",
  expect:
    "Assert on a target: visible, checked, enabled, contains (text), matches (regex), count.",
  expect_visible: "Assert that a target is visible.",
  expect_hidden: "Assert that a target is hidden or absent.",
  expect_url:
    "Assert the URL: exactly one of contains, starts_with, matches (regex).",
  expect_fits_width:
    "Assert that the page fits the window's width (nothing scrolls sideways). args: true.",
  ai_check:
    "Ask an AI judge a question about the page, only for what no plain assertion can check (layout, readability).",
};

/** What `finish` takes: whether the goal was reached, and one line saying what the test checks. */
export const finishSchema = z.strictObject({
  outcome: z.enum(["done", "impossible"]),
  summary: z.string().min(3).max(200),
});

/** A JSON Schema without its "$schema" keys: tool parameters are a schema's body only. */
function bare(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dialect, ...body } = schema;
  return body;
}

function argsTool(
  name: string,
  description: string,
  args: z.ZodType
): IModelTool {
  return {
    name,
    description,
    schema: {
      type: "object",
      properties: { args: bare(z.toJSONSchema(args, { io: "input" })) },
      required: ["args"],
      additionalProperties: false,
    },
  };
}

export function authorTools(): IModelTool[] {
  const steps = AUTHOR_STEP_KEYWORDS.map((keyword) => {
    const step = STEPS_BY_KEYWORD.get(keyword);
    if (step === undefined) {
      throw new Error(`No step "${keyword}" in the registry`);
    }
    return argsTool(keyword, DESCRIPTIONS[keyword], step.schema);
  });
  const finishJson = z.toJSONSchema(finishSchema);
  return [
    ...steps,
    {
      name: "finish",
      description:
        "End the case: outcome done (the goal is reached and asserted) or impossible (it cannot be reached; say why), and a one-line summary of what the test checks.",
      schema: { ...bare(finishJson), type: "object" },
    },
  ];
}
