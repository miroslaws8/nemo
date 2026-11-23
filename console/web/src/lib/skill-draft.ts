import { isMap, parseDocument, stringify } from "yaml";
import type { ISkillDraft, ISkillFields } from "@/types";

// A skill's form and its skill.yaml: the form's draft becomes the file the console checks and keeps
// (fields in the schema's order, the unused optional ones left out), and a file reads back into a
// draft. The console checks the file, never the draft.

const SCHEMA_LINE =
  "# yaml-language-server: $schema=../../../schema/skill-file.schema.json";
const SAFETIES = ["read_only", "records_activity", "creates_data"] as const;

export function emptyDraft(): ISkillDraft {
  return {
    description: "",
    title: "",
    summary: "",
    safety: "read_only",
    ai_credits: false,
    side_effects: "",
    arguments: "",
    start_at: "",
    rules: [],
    sections: [],
    steps: [""],
    screenshots: { folder: "", files: [""] },
    report: [""],
    pass_if: [],
    fail_if: [""],
    not_a_failure: [],
  };
}

export function draftFromFields(fields: ISkillFields): ISkillDraft {
  return {
    description: fields.description,
    title: fields.title,
    summary: fields.summary,
    safety: fields.safety,
    ai_credits: fields.ai_credits,
    side_effects: fields.side_effects ?? "",
    arguments: fields.arguments ?? "",
    start_at: fields.start_at ?? "",
    rules: [...fields.rules],
    sections: fields.sections.map((section) => ({ ...section })),
    steps: [...fields.steps],
    screenshots:
      fields.screenshots === undefined
        ? null
        : {
            folder: fields.screenshots.folder,
            files: [...fields.screenshots.files],
          },
    report: [...fields.report],
    pass_if: [...fields.pass_if],
    fail_if: [...fields.fail_if],
    not_a_failure: [...fields.not_a_failure],
  };
}

function texts(items: string[]): string[] {
  return items.map((item) => item.trim());
}

/** The draft as a skill.yaml: what the console checks and keeps. */
export function draftToYaml(draft: ISkillDraft): string {
  const skill: Record<string, unknown> = {
    description: draft.description.trim(),
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    safety: draft.safety,
  };
  if (draft.ai_credits) {
    skill.ai_credits = true;
  }
  if (draft.side_effects.trim() !== "" || draft.safety !== "read_only") {
    skill.side_effects = draft.side_effects.trim();
  }
  if (draft.arguments.trim() !== "") {
    skill.arguments = draft.arguments.trim();
  }
  if (draft.start_at.trim() !== "") {
    skill.start_at = draft.start_at.trim();
  }
  if (draft.rules.length > 0) {
    skill.rules = texts(draft.rules);
  }
  if (draft.sections.length > 0) {
    skill.sections = draft.sections.map((section) => ({
      title: section.title.trim(),
      text: section.text.trim(),
    }));
  }
  skill.steps = texts(draft.steps);
  if (draft.screenshots !== null) {
    skill.screenshots = {
      folder: draft.screenshots.folder.trim(),
      files: texts(draft.screenshots.files),
    };
  }
  skill.report = texts(draft.report);
  if (draft.pass_if.length > 0) {
    skill.pass_if = texts(draft.pass_if);
  }
  skill.fail_if = texts(draft.fail_if);
  if (draft.not_a_failure.length > 0) {
    skill.not_a_failure = texts(draft.not_a_failure);
  }
  return `${SCHEMA_LINE}\n${stringify(skill, { lineWidth: 100 })}`;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : String(item)))
    : [];
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** A skill.yaml read back into a draft; null when it is not YAML holding a skill's fields. */
export function draftFromYaml(text: string): ISkillDraft | null {
  const document = parseDocument(text);
  if (document.errors.length > 0 || !isMap(document.contents)) {
    return null;
  }
  const data = recordOf(document.toJS());
  const shots = recordOf(data.screenshots);
  const safety = SAFETIES.find((candidate) => candidate === data.safety);
  return {
    description: textOf(data.description),
    title: textOf(data.title),
    summary: textOf(data.summary),
    safety: safety ?? "read_only",
    ai_credits: data.ai_credits === true,
    side_effects: textOf(data.side_effects),
    arguments: textOf(data.arguments),
    start_at: textOf(data.start_at),
    rules: textsOf(data.rules),
    sections: (Array.isArray(data.sections) ? data.sections : []).map(
      (section) => {
        const entry = recordOf(section);
        return { title: textOf(entry.title), text: textOf(entry.text) };
      }
    ),
    steps: textsOf(data.steps),
    screenshots:
      data.screenshots === undefined
        ? null
        : { folder: textOf(shots.folder), files: textsOf(shots.files) },
    report: textsOf(data.report),
    pass_if: textsOf(data.pass_if),
    fail_if: textsOf(data.fail_if),
    not_a_failure: textsOf(data.not_a_failure),
  };
}

/** A field as people read it: screenshots.files #2 (lists count from 1). */
export function fieldLabel(path: (string | number)[]): string {
  return path
    .map((part) => (typeof part === "number" ? ` #${part + 1}` : `.${part}`))
    .join("")
    .replace(/^\./, "");
}

/** The id of a field's control in the form (for a problem to take you to it). */
export function fieldId(path: (string | number)[]): string {
  return `skill-field-${path.join("-")}`;
}
