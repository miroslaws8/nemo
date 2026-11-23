import fs from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { E2E_ROOT } from "./paths";
import type {
  IGeneratedFile,
  ISkillFile,
  ISkillParse,
  ISkillProblem,
  IYamlDocument,
  IYamlNodePath,
  IYamlPosition,
} from "./types";
import {
  SIDE_EFFECTS_NEEDED,
  skillFieldsSchema,
  skillNameProblem,
  skillTemplateFileSchema,
} from "./skill-schema";
import { readYamlSource } from "./yaml-document";

// Hermes Agent reads a skill from its SKILL.md: YAML front matter and Markdown. Ours are written
// as hermes/skills/<name>/skill.yaml (what the skill does) and filled into the Markdown every
// skill shares, hermes/skill-template.md: `pnpm skills` writes each SKILL.md and
// `pnpm validate` checks they are up to date.

export const SKILLS_DIRECTORY = path.join(E2E_ROOT, "hermes", "skills");
// Skill templates: what the QA console offers to start a skill from (README → Skills).
export const SKILL_TEMPLATES_FOLDER = "hermes/skill-templates";
const SKILL_TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// The name a template's skill is filled in under, to check that it makes a SKILL.md.
const TEMPLATE_CHECK_NAME = "qa-template-check";
export const SKILL_TEMPLATE_PATH = path.join(
  E2E_ROOT,
  "hermes",
  "skill-template.md"
);
export const SKILL_SOURCE = "skill.yaml";
export const SKILL_FILE = "SKILL.md";
// The first line of a skill.yaml: the editor completes and checks it against the schema.
export const SKILL_SOURCE_HEADER =
  "# yaml-language-server: $schema=../../../schema/skill-file.schema.json";
const GENERATED_NOTE =
  "# Written by `pnpm skills` from skill.yaml and hermes/skill-template.md: edit those.";

// The template: {{key}} a value; {{#key}} … {{/key}} lines kept when the skill has the value,
// {{^key}} … {{/key}} when it has not. Its leading <!-- comment --> stays out of SKILL.md.
const BLOCK_PATTERN = /^\{\{([#^])(\w+)\}\}\n([\s\S]*?)^\{\{\/\2\}\}$\n?/gm;
const VALUE_PATTERN = /\{\{(\w+)\}\}/g;
const LEADING_COMMENT = /^<!--[\s\S]*?-->\s*/;

type ITemplateValue = string | boolean;

function indentRest(text: string, width: number): string {
  const [first, ...rest] = text.split("\n");
  return [
    first,
    ...rest.map((line) => (line === "" ? "" : `${" ".repeat(width)}${line}`)),
  ].join("\n");
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${indentRest(item, 2)}`).join("\n");
}

function numberedList(items: string[]): string {
  return items
    .map((item, index) => {
      const marker = `${index + 1}. `;
      return `${marker}${indentRest(item, marker.length)}`;
    })
    .join("\n");
}

function templateValues(skill: ISkillFile): Record<string, ITemplateValue> {
  return {
    title: skill.title,
    summary: skill.summary,
    read_only: skill.safety === "read_only",
    records_activity: skill.safety === "records_activity",
    creates_data: skill.safety === "creates_data",
    ai_credits: skill.ai_credits,
    side_effects: skill.side_effects ?? "",
    arguments: skill.arguments ?? "",
    start_at: skill.start_at ?? "",
    rules: bulletList(skill.rules),
    sections: skill.sections
      .map((section) => `## ${section.title}\n\n${section.text}`)
      .join("\n\n"),
    steps: numberedList(skill.steps),
    screenshots_folder: skill.screenshots?.folder ?? "",
    screenshots: bulletList(skill.screenshots?.files ?? []),
    report: bulletList(skill.report),
    pass_if: bulletList(skill.pass_if),
    fail_if: bulletList(skill.fail_if),
    not_a_failure: bulletList(skill.not_a_failure),
  };
}

function valueOf(
  values: Record<string, ITemplateValue>,
  key: string
): ITemplateValue {
  const value = values[key];
  if (value === undefined) {
    throw new Error(
      `${path.relative(E2E_ROOT, SKILL_TEMPLATE_PATH)}: no value {{${key}}}`
    );
  }
  return value;
}

function isPresent(value: ITemplateValue): boolean {
  return typeof value === "boolean" ? value : value.trim() !== "";
}

/** The template filled in: blocks first (a kept block's own blocks on the next pass), then values. */
function fillTemplate(
  template: string,
  values: Record<string, ITemplateValue>
): string {
  let text = template.replace(LEADING_COMMENT, "");
  for (;;) {
    const next = text.replace(
      BLOCK_PATTERN,
      (_block, kind: string, key: string, body: string) =>
        (kind === "#") === isPresent(valueOf(values, key)) ? body : ""
    );
    if (next === text) {
      break;
    }
    text = next;
  }
  const filled = text.replace(VALUE_PATTERN, (_placeholder, key: string) => {
    const value = valueOf(values, key);
    if (typeof value !== "string") {
      throw new Error(
        `${path.relative(
          E2E_ROOT,
          SKILL_TEMPLATE_PATH
        )}: {{${key}}} is a yes or no: use it as {{#${key}}} … {{/${key}}}`
      );
    }
    return value;
  });
  return filled
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A skill's SKILL.md: its front matter (name, description) and the filled-in template. */
export function renderSkill(
  name: string,
  skill: ISkillFile,
  template: string
): string {
  const frontMatter = stringify(
    { name, description: skill.description },
    { lineWidth: 0 }
  ).trimEnd();
  const body = fillTemplate(template, templateValues(skill));
  return `---\n${GENERATED_NOTE}\n${frontMatter}\n---\n\n${body}\n`;
}

interface IFieldHelp {
  field: string;
  required: boolean;
  description: string;
}

interface IJsonSchemaObject {
  properties?: Record<
    string,
    { description?: string; properties?: unknown; required?: string[] }
  >;
  required?: string[];
}

/** Every field of a skill.yaml with what it says, from the schema (screenshots' as screenshots.x). */
export function skillFields(): IFieldHelp[] {
  const schema = z.toJSONSchema(skillFieldsSchema, {
    io: "input",
    unrepresentable: "any",
  }) as IJsonSchemaObject;
  return Object.entries(schema.properties ?? {}).flatMap(([field, value]) => {
    const own: IFieldHelp = {
      field,
      required: (schema.required ?? []).includes(field),
      description: value.description ?? "",
    };
    const nested = value.properties as IJsonSchemaObject["properties"];
    return [
      own,
      ...Object.entries(nested ?? {}).map(([inner, innerValue]) => ({
        field: `${field}.${inner}`,
        required: (value.required ?? []).includes(inner),
        description: innerValue.description ?? "",
      })),
    ];
  });
}

const fieldHelp = new Map<string, string>();

function helpFor(field: string): string {
  if (fieldHelp.size === 0) {
    for (const entry of skillFields()) {
      fieldHelp.set(entry.field, entry.description);
    }
  }
  return fieldHelp.get(field) ?? "";
}

// The fields of each level of a skill.yaml, for "did you mean".
const KNOWN_KEYS: Record<string, string[]> = {
  "": Object.keys(skillFieldsSchema.shape),
  screenshots: ["folder", "files"],
  sections: ["title", "text"],
};

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_cell, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return row[right.length];
}

/** The known field a mistyped one is closest to, when it is close enough to be a typo. */
function closestKey(key: string, known: string[]): string | null {
  const ranked = known
    .map((candidate) => ({ candidate, distance: editDistance(key, candidate) }))
    .sort((left, right) => left.distance - right.distance);
  const best = ranked[0];
  return best !== undefined && best.distance <= Math.max(2, key.length / 4)
    ? best.candidate
    : null;
}

/** A field as people read it: screenshots.files #2 (lists count from 1). */
function fieldName(nodePath: IYamlNodePath): string {
  return nodePath
    .map((part) => (typeof part === "number" ? ` #${part + 1}` : `.${part}`))
    .join("")
    .replace(/^\./, "");
}

function levelOf(nodePath: IYamlNodePath): string {
  return nodePath.filter((part) => typeof part === "string").join(".");
}

function valueAt(data: unknown, nodePath: IYamlNodePath): unknown {
  let value: unknown = data;
  for (const part of nodePath) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

/** Where a field is: its key when it has one (`steps:`), else its own node (a list item). */
function positionFor(
  document: IYamlDocument,
  nodePath: IYamlNodePath
): IYamlPosition | null {
  const last = nodePath.at(-1);
  if (typeof last === "string") {
    return (
      document.positionOf(nodePath.slice(0, -1), last) ??
      document.positionOf(nodePath)
    );
  }
  return document.positionOf(nodePath);
}

const EXPECTED_WORDS: Record<string, string> = {
  string: "a text",
  array: "a list (lines that start with -)",
  boolean: "true or false",
  object: "a set of fields",
};

function problem(
  message: string,
  nodePath: IYamlNodePath,
  position: IYamlPosition | null
): ISkillProblem {
  return {
    severity: "error",
    message,
    path: nodePath,
    line: position?.line ?? null,
    column: position?.column ?? null,
  };
}

/** A schema issue as people read it, at its place in the file. */
function problemsOfIssue(
  issue: z.core.$ZodIssue,
  document: IYamlDocument
): ISkillProblem[] {
  const nodePath = issue.path.filter(
    (part): part is string | number =>
      typeof part === "string" || typeof part === "number"
  );
  const field = fieldName(nodePath);
  const at = positionFor(document, nodePath);
  switch (issue.code) {
    case "unrecognized_keys":
      return issue.keys.map((key) => {
        const suggestion = closestKey(key, KNOWN_KEYS[levelOf(nodePath)] ?? []);
        return problem(
          `\`${key}\` is not a field${
            nodePath.length === 0 ? " of a skill" : ` of ${field}`
          }${suggestion === null ? "" : ` — did you mean \`${suggestion}\`?`}`,
          [...nodePath, key],
          document.positionOf(nodePath, key)
        );
      });
    case "invalid_type": {
      if (nodePath.length === 0) {
        return [
          problem(
            "A skill.yaml is a set of fields: description, title, summary, safety, steps, report, fail_if …",
            [],
            null
          ),
        ];
      }
      if (valueAt(document.data, nodePath) === undefined) {
        const help = helpFor(levelOf(nodePath));
        return [
          problem(
            `\`${field}\` is missing${help === "" ? "" : `: ${help}`}`,
            nodePath,
            nodePath.length === 1
              ? null
              : document.positionOf(nodePath.slice(0, -1))
          ),
        ];
      }
      // "- Log in with password: x" is a field to YAML, not a text: the ": " makes it one.
      const readAsField =
        issue.expected === "string" &&
        typeof valueAt(document.data, nodePath) === "object";
      return [
        problem(
          `\`${field}\` should be ${
            EXPECTED_WORDS[issue.expected] ?? issue.expected
          }${
            readAsField
              ? ` — YAML reads it as a field because of the ": " in it: put the text in quotes`
              : ""
          }`,
          nodePath,
          at
        ),
      ];
    }
    case "invalid_value": {
      const choices = issue.values.map(String).join(", ");
      return [
        valueAt(document.data, nodePath) === undefined
          ? problem(
              `\`${field}\` is missing: one of ${choices}`,
              nodePath,
              null
            )
          : problem(`\`${field}\` must be one of: ${choices}`, nodePath, at),
      ];
    }
    case "too_small":
      return [
        problem(
          issue.origin === "array"
            ? `\`${field}\` needs at least ${String(issue.minimum)} item${
                Number(issue.minimum) === 1 ? "" : "s"
              }`
            : `\`${field}\` is empty`,
          nodePath,
          at
        ),
      ];
    case "too_big":
      return [
        problem(
          issue.origin === "string"
            ? `\`${field}\` is too long: at most ${String(
                issue.maximum
              )} characters`
            : `\`${field}\` has too many items: at most ${String(
                issue.maximum
              )}`,
          nodePath,
          at
        ),
      ];
    default:
      return [problem(`\`${field}\`: ${issue.message}`, nodePath, at)];
  }
}

/** The text as a skill.yaml file starts: with the line that gives the editor its schema. */
export function withSchemaHeader(text: string): string {
  return text.startsWith("# yaml-language-server:")
    ? text
    : `${SKILL_SOURCE_HEADER}\n${text}`;
}

function byPlace(left: ISkillProblem, right: ISkillProblem): number {
  return (
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.column ?? 0) - (right.column ?? 0)
  );
}

// What a SKILL.md says for a skill not named yet.
const UNNAMED_SKILL = "<name>";

/**
 * A skill.yaml read for `name` (null: one being written, not named yet): every problem in one go
 * (where it is and what to do), and once there are no errors the skill and its SKILL.md.
 */
export function parseSkillSource(
  name: string | null,
  text: string,
  template: string
): ISkillParse {
  const problems: ISkillProblem[] = [];
  const nameProblem = name === null ? null : skillNameProblem(name);
  if (nameProblem !== null) {
    problems.push(problem(nameProblem, [], null));
  }
  const source = text.replace(/^﻿/, "");
  if (source.trim() === "") {
    return {
      skill: null,
      skillMd: null,
      problems: [...problems, problem("The file is empty", [], null)],
    };
  }
  const read = readYamlSource(source);
  if (read.document === null) {
    return {
      skill: null,
      skillMd: null,
      problems: [
        ...problems,
        problem(
          `This is not YAML: ${read.error.message}`,
          [],
          read.error.position
        ),
      ],
    };
  }
  const document = read.document;
  const parsed = skillFieldsSchema.safeParse(document.data);
  if (!parsed.success) {
    problems.push(
      ...parsed.error.issues.flatMap((issue) =>
        problemsOfIssue(issue, document)
      )
    );
  }
  const safety = valueAt(document.data, ["safety"]);
  const sideEffects = valueAt(document.data, ["side_effects"]);
  if (
    (safety === "records_activity" || safety === "creates_data") &&
    (typeof sideEffects !== "string" || sideEffects.trim() === "") &&
    !problems.some((found) => found.path[0] === "side_effects")
  ) {
    problems.push(
      problem(
        `\`side_effects\` is missing: ${SIDE_EFFECTS_NEEDED}`,
        ["side_effects"],
        document.positionOf([], "safety")
      )
    );
  }
  if (problems.length > 0 || !parsed.success) {
    return { skill: null, skillMd: null, problems: problems.sort(byPlace) };
  }
  try {
    return {
      skill: parsed.data,
      skillMd: renderSkill(name ?? UNNAMED_SKILL, parsed.data, template),
      problems: [],
    };
  } catch (error) {
    return {
      skill: null,
      skillMd: null,
      problems: [
        problem(
          `Its SKILL.md cannot be written: ${
            error instanceof Error ? error.message : String(error)
          }`,
          [],
          null
        ),
      ],
    };
  }
}

/** A problem as one line for the terminal: file:line:column message. */
export function formatSkillProblem(
  label: string,
  found: ISkillProblem
): string {
  const where =
    found.line === null ? label : `${label}:${found.line}:${found.column ?? 1}`;
  return `${where} ${found.message}`;
}

/** Every skill's SKILL.md as skill.yaml and the template make it; a broken skill is a problem. */
export function buildSkillFiles(): {
  files: IGeneratedFile[];
  problems: string[];
} {
  const template = fs.readFileSync(SKILL_TEMPLATE_PATH, "utf8");
  const folders = fs
    .readdirSync(SKILLS_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(SKILLS_DIRECTORY, entry.name))
    .sort();
  const files: IGeneratedFile[] = [];
  const problems: string[] = [];
  for (const folder of folders) {
    const source = path.join(folder, SKILL_SOURCE);
    const label = path.relative(E2E_ROOT, source);
    if (!fs.existsSync(source)) {
      problems.push(`${label} is missing: every skill is written as one`);
      continue;
    }
    const read = parseSkillSource(
      path.basename(folder),
      fs.readFileSync(source, "utf8"),
      template
    );
    if (read.skillMd === null) {
      problems.push(
        ...read.problems.map((found) => formatSkillProblem(label, found))
      );
      continue;
    }
    files.push({ path: path.join(folder, SKILL_FILE), content: read.skillMd });
  }
  return { files, problems };
}

/** A template's id: its file's name (read-only-page.yaml → read-only-page), or null for another file. */
export function skillTemplateId(fileName: string): string | null {
  const id = fileName.replace(/\.ya?ml$/, "");
  return id !== fileName && SKILL_TEMPLATE_ID_PATTERN.test(id) ? id : null;
}

/** A skill template's text read: the template, or what is wrong with it (label:line:column first). */
export function parseSkillTemplate(
  label: string,
  text: string,
  template: string
): {
  template: z.infer<typeof skillTemplateFileSchema> | null;
  problems: string[];
} {
  const read = readYamlSource(text.replace(/^\uFEFF/, ""));
  if (read.document === null) {
    const at = read.error.position;
    return {
      template: null,
      problems: [
        `${label}${
          at === null ? "" : `:${at.line}:${at.column}`
        } This is not YAML: ${read.error.message}`,
      ],
    };
  }
  const parsed = skillTemplateFileSchema.safeParse(read.document.data);
  if (!parsed.success) {
    return {
      template: null,
      problems: [`${label}: ${z.prettifyError(parsed.error)}`],
    };
  }
  try {
    renderSkill(TEMPLATE_CHECK_NAME, parsed.data.skill, template);
  } catch (error) {
    return {
      template: null,
      problems: [
        `${label}: its skill makes no SKILL.md: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }
  return { template: parsed.data, problems: [] };
}

/** What is wrong with the repo's skill templates (none: every one reads and makes a SKILL.md). */
export function findBrokenSkillTemplates(): string[] {
  const folder = path.join(E2E_ROOT, SKILL_TEMPLATES_FOLDER);
  if (!fs.existsSync(folder)) {
    return [];
  }
  const template = fs.readFileSync(SKILL_TEMPLATE_PATH, "utf8");
  return fs
    .readdirSync(folder)
    .sort()
    .flatMap((fileName) => {
      const label = `${SKILL_TEMPLATES_FOLDER}/${fileName}`;
      if (fileName.startsWith(".")) {
        return [];
      }
      if (skillTemplateId(fileName) === null) {
        return [
          `${label}: a template is <id>.yaml, the id in lowercase letters, digits and hyphens`,
        ];
      }
      return parseSkillTemplate(
        label,
        fs.readFileSync(path.join(folder, fileName), "utf8"),
        template
      ).problems;
    });
}
