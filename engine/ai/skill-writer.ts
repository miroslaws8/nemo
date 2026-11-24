import { z } from "zod";
import { SKILL_NAME_MAX } from "../skill-schema";
import type { IModelRequest, ISkillWriterInput } from "../types";
import { parseJsonAnswer } from "./json-answer";

// A skill from a description (the QA console: Skills → Add skill → Describe it): what to ask a
// model for a nemo skill.yaml, and how to read its answer. The console checks the skill like any
// other (SkillChecks) and asks once more with the problems when there are errors.

const MAX_ANSWER_TOKENS = 8192;
const CALL_TIMEOUT_MS = 120_000;

const SYSTEM = [
  "You write skills for nemo's agent checks: an AI agent (Hermes) opens the web app in a browser and follows the skill the way a careful tester would, saves screenshots, and ends with RESULT: PASS or RESULT: FAIL.",
  "A skill is a skill.yaml with the fields below. Write plain, concrete steps a tester could follow; name pages by their path from the app's root (start_at, `<base>/<path>`); say what each screenshot shows; give FAIL conditions a person can check.",
  "Every skill also follows nemo's shared contract, which you must not repeat in it: the environment is the skill's first argument and gives `<base>`; logins come from the browser vault (never type a password); a skill never deletes or edits data it did not make, never pays, never publishes to real users; anything it creates is titled with QA_DATA_PREFIX; screenshots go where the contract says.",
  "Choose safety honestly: read_only when it only looks; records_activity when it leaves the test account's own progress or attempts; creates_data when it makes records (then say what in side_effects).",
  'Answer with JSON only: {"name": "qa-…", "yaml": "<the whole skill.yaml>"}. The name is lowercase words joined by dashes, starting with qa-. The YAML has only the fields below, no name field.',
].join("\n");

/** The fields of a skill, one line each, as the console's form explains them. */
function fieldLines(input: ISkillWriterInput): string {
  return input.fields
    .map(
      (field) =>
        `- ${field.field}${field.required ? " (required)" : ""}: ${
          field.description
        }`
    )
    .join("\n");
}

export function skillWriterRequest(input: ISkillWriterInput): IModelRequest {
  const retry =
    input.problems.length === 0
      ? []
      : [
          "",
          "Your last skill.yaml had these problems; answer again with all of them fixed:",
          ...input.problems.map((problem) => `- ${problem}`),
        ];
  return {
    system: SYSTEM,
    tools: [],
    maxTokens: MAX_ANSWER_TOKENS,
    timeoutMs: CALL_TIMEOUT_MS,
    messages: [
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: [
              `The fields of skill.yaml:\n${fieldLines(input)}`,
              `An example skill.yaml:\n${input.example}`,
              `The environments it may run on: ${input.environments.join(
                ", "
              )}.`,
              `What the skill should check, in the words of the person who wants it:\n${input.description}`,
              ...retry,
            ].join("\n\n"),
          },
        ],
      },
    ],
  };
}

const answerSchema = z.object({
  name: z.string().default(""),
  yaml: z.string().min(1),
});

/** The model's { name, yaml }, or null when the answer holds no skill.yaml. */
export function parseSkillAnswer(
  text: string
): { name: string; yaml: string } | null {
  return parseJsonAnswer(text, answerSchema);
}

/** A skill name from any text: qa- and kebab-case words, within the name limit. */
export function skillNameFrom(text: string): string {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/^qa-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = `qa-${words}`.slice(0, SKILL_NAME_MAX).replace(/-+$/g, "");
  return name === "qa" || name === "qa-" ? "qa-new-check" : name;
}
