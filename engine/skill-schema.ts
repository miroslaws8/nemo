import { z } from "zod";

// What a skill.yaml holds (hermes/skills/<name>/skill.yaml): engine/skills.ts reads and writes
// skills with it, and the QA console's contract (console/shared/api.ts) shows them with it, so it
// imports zod only.

// The folder's name is the skill's (the agentskills.io format Hermes follows: at most 64
// characters); hermes/install.sh links only qa-* folders into ~/.hermes.
export const SKILL_NAME_PATTERN = /^qa-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
// A skill.yaml the console takes, in bytes.
export const SKILL_MAX_BYTES = 64 * 1024;

export const SKILL_SAFETIES = [
  "read_only",
  "records_activity",
  "creates_data",
] as const;

export const SIDE_EFFECTS_NEEDED =
  "say what it records or creates (every safety but read_only needs it)";

const markdownList = (what: string) =>
  z.array(z.string().trim().min(1)).describe(what);

// The fields of a skill.yaml. skillFileSchema adds the rule across fields; parseSkillSource checks
// that rule apart, so a file with other mistakes still hears about it.
export const skillFieldsSchema = z.strictObject({
  description: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .describe(
      "What the skill checks and when to use it: Hermes's list of skills and the QA console's New run show it."
    ),
  title: z.string().trim().min(1).describe("The heading of its SKILL.md."),
  summary: z
    .string()
    .trim()
    .min(1)
    .describe("What it does, in a few sentences (Markdown)."),
  safety: z
    .enum(["read_only", "records_activity", "creates_data"])
    .describe(
      "What it changes in the app: read_only (nothing but logging in), records_activity (the test account's own progress or attempts), creates_data (records titled as the shared contract says)."
    ),
  ai_credits: z
    .boolean()
    .default(false)
    .describe("It spends AI credits on the environment."),
  side_effects: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "What exactly it records or creates (records_activity, creates_data), e.g. 'one learner attempt for the test account'."
    ),
  arguments: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "What it takes besides the environment, e.g. 'the asset type, a registry slug'."
    ),
  start_at: z
    .string()
    .regex(/^\//, "a path from the app's root, e.g. /dashboard")
    .optional()
    .describe(
      "The page it starts on, from the app's root: /dashboard/quizzes."
    ),
  rules: markdownList(
    "What to keep to all along: one rule each (Markdown)."
  ).default([]),
  sections: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1),
        text: z.string().trim().min(1),
      })
    )
    .default([])
    .describe(
      "More sections before the steps (Markdown), e.g. a one-time setup or the credentials a script needs."
    ),
  steps: markdownList(
    "What to do, in order (Markdown; a step may hold a list, a table or a code block)."
  ).min(1),
  screenshots: z
    .strictObject({
      folder: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/, "a folder name, e.g. quiz")
        .describe("Its folder under ~/nemo-output/smoke-screens/<env>/."),
      files: markdownList(
        "The screenshots to save, each with when to take it."
      ).min(1),
    })
    .optional()
    .describe(
      "The screenshots the agent saves (none: a script of the skill saves them)."
    ),
  report: markdownList("What the report gives after its RESULT line.").min(1),
  pass_if: markdownList(
    "When it passes (any of these). None: whenever no FAIL case holds."
  ).default([]),
  fail_if: markdownList("When it fails (any of these).").min(1),
  not_a_failure: markdownList(
    "What may look wrong but does not fail it."
  ).default([]),
});

export const skillFileSchema = skillFieldsSchema.refine(
  (skill) => skill.safety === "read_only" || skill.side_effects !== undefined,
  { message: SIDE_EFFECTS_NEEDED, path: ["side_effects"] }
);

// A place a skill template leaves for the author's words: [[what it checks]]. YAML may fold a long
// text inside one, so it may span lines.
export const TEMPLATE_PLACEHOLDER = /\[\[[^\]]+?\]\]/;

/** A skill template (hermes/skill-templates/<id>.yaml): what the console offers to start from. */
export const skillTemplateFileSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .describe(
      "What the template is for, as the console offers it: 'Check a page, changing nothing'."
    ),
  about: z
    .string()
    .trim()
    .min(1)
    .describe("A sentence or two on when to start from it."),
  skill: skillFieldsSchema.describe(
    "The skill it starts as: a skill.yaml's fields, with [[…]] where the author's words go."
  ),
});

/** Why a name cannot be a skill's, or null when it can. */
export function skillNameProblem(name: string): string | null {
  if (name.length > SKILL_NAME_MAX) {
    return `The name is too long: at most ${SKILL_NAME_MAX} characters`;
  }
  return SKILL_NAME_PATTERN.test(name)
    ? null
    : "The name starts with qa- and goes on in lowercase letters, digits and single hyphens, e.g. qa-landing-mobile";
}
